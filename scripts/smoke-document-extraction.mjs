import { spawn } from 'node:child_process'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Worker } from 'node:worker_threads'
import { deflateRawSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const nextBin = require.resolve('next/dist/bin/next')
const PDF_TEXT = 'PDF Production Smoke Resume'
const DOCX_TEXT = 'DOCX Production Smoke Resume'

await assertTracedWorker()

const port = await availablePort()
const baseUrl = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, [
  nextBin,
  'start',
  '--hostname',
  '127.0.0.1',
  '--port',
  String(port)
], {
  cwd: process.cwd(),
  env: { ...process.env, RESUME_OS_LOCAL_ONLY: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
})

let serverOutput = ''
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString() })
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString() })
const serverExit = new Promise((resolve) => server.once('exit', resolve))

try {
  await waitForServer(`${baseUrl}/en/studio`, server)
  await assertExtraction(baseUrl, 'smoke.pdf', 'application/pdf', createPdf(PDF_TEXT), PDF_TEXT)
  await assertExtraction(baseUrl, 'smoke.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', createDocx(DOCX_TEXT), DOCX_TEXT)
  process.stdout.write('Production trace and route extraction smoke passed for PDF and DOCX.\n')
} catch (error) {
  const detail = serverOutput.trim().split('\n').slice(-20).join('\n')
  throw new Error(`${error instanceof Error ? error.message : String(error)}${detail ? `\nServer output:\n${detail}` : ''}`)
} finally {
  if (server.exitCode === null) server.kill('SIGTERM')
  await Promise.race([serverExit, delay(2_000)])
  if (server.exitCode === null) {
    server.kill('SIGKILL')
    await serverExit
  }
}

async function assertTracedWorker() {
  const projectRoot = process.cwd()
  const tracePath = resolve('.next/server/app/api/resume/extract-text/route.js.nft.json')
  const traceDirectory = dirname(tracePath)
  const trace = JSON.parse(await readFile(tracePath, 'utf8'))
  const sources = trace.files.map((file) => resolve(traceDirectory, file))
  const sandbox = await mkdtemp(join(tmpdir(), 'resume-os-trace-'))

  try {
    for (const source of sources) {
      const stats = await lstat(source)
      if (!stats.isSymbolicLink()) continue
      const target = tracedSandboxPath(sandbox, projectRoot, source)
      await mkdir(dirname(target), { recursive: true })
      await symlink(await readlink(source), target)
    }
    for (const source of sources) {
      const stats = await lstat(source)
      if (stats.isSymbolicLink()) continue
      const target = tracedSandboxPath(sandbox, projectRoot, source)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(source, target)
    }

    const workerTracePath = trace.files.find((file) => (
      file.includes('../../../../assets/document-parser-worker.') && file.endsWith('.mjs')
    ))
    if (!workerTracePath) throw new Error('Document parser worker asset is missing from the route trace')
    const workerSource = resolve(traceDirectory, workerTracePath)
    const workerPath = tracedSandboxPath(sandbox, projectRoot, workerSource)
    const [pdfResult, docxResult] = await Promise.all([
      runTracedWorker(workerPath, {
        type: 'pdf',
        data: new Uint8Array(createPdf(PDF_TEXT)),
        maxPdfPages: 25,
        maxTextChars: 40_000
      }),
      runTracedWorker(workerPath, {
        type: 'docx',
        data: new Uint8Array(createDocx(DOCX_TEXT)),
        maxTextChars: 40_000
      })
    ])
    if (!pdfResult.text.includes(PDF_TEXT) || !docxResult.text.includes(DOCX_TEXT)) {
      throw new Error('Traced document worker returned unexpected text')
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
}

function tracedSandboxPath(sandbox, projectRoot, source) {
  const projectPath = relative(projectRoot, source)
  if (isAbsolute(projectPath) || projectPath === '..' || projectPath.startsWith(`..${sep}`)) {
    throw new Error('Document route trace contains a file outside the project root')
  }
  return join(sandbox, projectPath)
}

function runTracedWorker(workerPath, task) {
  return new Promise((resolveResult, rejectResult) => {
    const worker = new Worker(workerPath)
    let settled = false
    const settle = async (complete) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      await worker.terminate().catch(() => undefined)
      complete()
    }
    const timeout = setTimeout(() => {
      void settle(() => rejectResult(new Error('Traced document worker timed out')))
    }, 10_000)
    worker.once('message', (message) => {
      void settle(() => message.ok
        ? resolveResult(message.result)
        : rejectResult(new Error(`Traced document worker returned ${message.code}`)))
    })
    worker.once('error', (error) => void settle(() => rejectResult(error)))
    worker.postMessage(task)
  })
}

async function assertExtraction(baseUrl, fileName, mimeType, bytes, expectedText) {
  const form = new FormData()
  form.set('file', new Blob([bytes], { type: mimeType }), fileName)
  const response = await fetch(`${baseUrl}/api/resume/extract-text`, {
    method: 'POST',
    body: form
  })
  const payload = await response.json().catch(() => ({}))

  if (response.status !== 200) {
    throw new Error(`${fileName} extraction returned ${response.status}: ${JSON.stringify(payload)}`)
  }
  if (typeof payload.text !== 'string' || !payload.text.includes(expectedText)) {
    throw new Error(`${fileName} extraction did not contain the expected text`)
  }
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with code ${child.exitCode}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The socket is expected to reject until Next finishes binding the port.
    }
    await delay(100)
  }
  throw new Error('Timed out waiting for next start')
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function createPdf(text) {
  const content = `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'ascii')
}

function escapePdfText(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

function createDocx(text) {
  const entries = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`]
  ].map(([name, value]) => ({ name, data: Buffer.from(value, 'utf8') }))
  return createZip(entries)
}

function createZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data)
    const checksum = crc32(entry.data)
    const local = Buffer.alloc(30 + name.length + compressed.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    compressed.copy(local, 30 + name.length)
    localParts.push(local)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centralParts.push(central)
    offset += local.length
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, ...centralParts, end])
}

function crc32(data, previous = 0) {
  let checksum = (previous ^ 0xffffffff) >>> 0
  for (const byte of data) {
    checksum ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum & 1) !== 0 ? 0xedb88320 ^ (checksum >>> 1) : checksum >>> 1
    }
  }
  return (checksum ^ 0xffffffff) >>> 0
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
