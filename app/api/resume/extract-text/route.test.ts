import { File as NodeFile } from 'node:buffer'
import { deflateRawSync } from 'node:zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const parserMocks = vi.hoisted(() => ({ runDocumentParser: vi.fn() }))

vi.mock('@/lib/server/document-parser', () => {
  class DocumentParserError extends Error {
    constructor(readonly code: string) {
      super(code)
      this.name = 'DocumentParserError'
    }
  }
  return { DocumentParserError, runDocumentParser: parserMocks.runDocumentParser }
})

import { DocumentParserError } from '@/lib/server/document-parser'
import { crc32 } from '@/lib/server/crc32'
import { DOCX_MAX_UNCOMPRESSED_BYTES } from '@/lib/server/docx-preflight'
import { FixedWindowRateLimiter, createAiRequestGuard } from '@/lib/server/request-guard'
import {
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_MULTIPART_BYTES,
  MAX_PDF_PAGES,
  MAX_RESUME_FILE_BYTES,
  createExtractTextRoute
} from './route'

type Part = [string, FormDataEntryValue]
type ZipEntry = {
  name: string
  data?: Uint8Array
  compressedSize?: number
  uncompressedSize?: number
}

class TestFormData {
  constructor(private readonly parts: Part[]) {}
  getAll(key: string) { return this.parts.filter(([name]) => name === key).map(([, value]) => value) }
  entries() { return this.parts[Symbol.iterator]() }
}

function file(parts: Array<string | Uint8Array<ArrayBuffer>>, name: string, type = '') {
  return new NodeFile(parts, name, { type }) as unknown as File
}

function pdfFile(type = 'application/pdf', name = 'resume.pdf', extraBytes = 0) {
  return file(['%PDF-1.7\n', new Uint8Array(extraBytes)], name, type)
}

function zipDirectory(entries: ZipEntry[]) {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const data = Buffer.from(entry.data ?? new Uint8Array())
    const compressed = deflateRawSync(data)
    const local = new Uint8Array(30 + name.length + compressed.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(8, 8, true)
    localView.setUint32(14, crc32(data), true)
    localView.setUint32(18, compressed.length, true)
    localView.setUint32(22, data.length, true)
    localView.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(compressed, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(10, 8, true)
    centralView.setUint32(16, crc32(data), true)
    centralView.setUint32(20, entry.compressedSize ?? compressed.length, true)
    centralView.setUint32(24, entry.uncompressedSize ?? data.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)
    offset += local.length
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  const output = new Uint8Array(offset + centralSize + end.length)
  let cursor = 0
  for (const part of [...locals, ...centrals, end]) {
    output.set(part, cursor)
    cursor += part.length
  }
  return output
}

function docxFile(type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', entries: ZipEntry[] = [
  { name: '[Content_Types].xml' },
  { name: 'word/document.xml' }
], name = 'resume.docx') {
  return file([zipDirectory(entries)], name, type)
}

function txtFile(content = '  Ada\r\nEngineer  ', type = 'text/plain', name = 'resume.txt') {
  return file([content], name, type)
}

function createPost() {
  return createExtractTextRoute({
    guard: createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter() })
  })
}

function upload(post: ReturnType<typeof createExtractTextRoute>, {
  parts = [['file', txtFile()]],
  contentLength,
  formData = vi.fn(async () => new TestFormData(parts) as unknown as FormData),
  headers = {}
}: {
  parts?: Part[]
  contentLength?: number | null
  formData?: ReturnType<typeof vi.fn>
  headers?: Record<string, string>
} = {}) {
  const length = contentLength === undefined
    ? parts.reduce((total, [, value]) => total + (typeof value === 'string' ? value.length : value.size), 1_024)
    : contentLength
  const requestHeaders = new Headers(headers)
  if (length !== null) requestHeaders.set('content-length', String(length))
  const request = {
    url: 'http://localhost/api/resume/extract-text',
    headers: requestHeaders,
    signal: new AbortController().signal,
    formData
  } as unknown as Request
  return { response: post(request), formData, request }
}

async function expectCode(responsePromise: Promise<Response>, status: number, code: string) {
  const response = await responsePromise
  expect(response.status).toBe(status)
  expect((await response.json()).code).toBe(code)
}

describe('POST /api/resume/extract-text', () => {
  let post: ReturnType<typeof createExtractTextRoute>

  beforeEach(() => {
    post = createPost()
    parserMocks.runDocumentParser.mockReset().mockImplementation(async (task: { type: string }) => (
      task.type === 'pdf'
        ? { text: 'PDF resume text', pageCount: 1 }
        : { text: 'DOCX resume text' }
    ))
  })

  it('rejects cross-origin uploads before parsing multipart data', async () => {
    const { response, formData } = upload(post, {
      headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' }
    })
    await expectCode(response, 403, 'AI_PUBLIC_ACCESS_DISABLED')
    expect(formData).not.toHaveBeenCalled()
  })

  it('allows a public same-origin upload without AI credentials', async () => {
    post = createExtractTextRoute({
      guard: createAiRequestGuard({
        localOnly: false,
        accessToken: null,
        limiter: new FixedWindowRateLimiter()
      })
    })

    const { response } = upload(post, {
      headers: { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' }
    })
    expect(await response).toMatchObject({ status: 200 })
  })

  it('rejects missing or excessive Content-Length before multipart parsing', async () => {
    const missing = upload(post, { contentLength: null })
    await expectCode(missing.response, 411, 'CONTENT_LENGTH_REQUIRED')
    expect(missing.formData).not.toHaveBeenCalled()

    const excessive = upload(post, { contentLength: MAX_MULTIPART_BYTES + 1 })
    await expectCode(excessive.response, 413, 'PAYLOAD_TOO_LARGE')
    expect(excessive.formData).not.toHaveBeenCalled()
  })

  it('requires exactly one file field and no unexpected parts', async () => {
    await expectCode(upload(post, { parts: [] }).response, 400, 'FILE_REQUIRED')
    await expectCode(upload(post, { parts: [['file', txtFile()], ['file', txtFile('second')]] }).response, 400, 'UNEXPECTED_MULTIPART')
    await expectCode(upload(post, { parts: [['file', txtFile()], ['note', 'unexpected']] }).response, 400, 'UNEXPECTED_MULTIPART')
  })

  it('extracts TXT directly and parses PDF/DOCX in the terminable worker', async () => {
    expect(await (await upload(post, { parts: [['file', txtFile()]] }).response).json()).toMatchObject({ text: 'Ada\nEngineer' })
    expect(await (await upload(post, { parts: [['file', pdfFile()]] }).response).json()).toMatchObject({ text: 'PDF resume text' })
    expect(await (await upload(post, { parts: [['file', docxFile()]] }).response).json()).toMatchObject({ text: 'DOCX resume text' })

    expect(parserMocks.runDocumentParser).toHaveBeenCalledTimes(2)
    expect(parserMocks.runDocumentParser.mock.calls[0][0]).toMatchObject({ type: 'pdf', maxPdfPages: MAX_PDF_PAGES })
    expect(parserMocks.runDocumentParser.mock.calls[0][1]).toEqual(expect.objectContaining({
      signal: expect.any(AbortSignal),
      timeoutMs: expect.any(Number)
    }))
    expect(parserMocks.runDocumentParser.mock.calls[1][0]).toMatchObject({ type: 'docx' })
  })

  it.each(['', 'application/octet-stream'])('accepts safe extension/signature identification with fallback MIME %j', async (mime) => {
    await expect(upload(post, { parts: [['file', pdfFile(mime)]] }).response).resolves.toMatchObject({ status: 200 })
    await expect(upload(post, { parts: [['file', docxFile(mime)]] }).response).resolves.toMatchObject({ status: 200 })
    await expect(upload(post, { parts: [['file', txtFile('resume', mime)]] }).response).resolves.toMatchObject({ status: 200 })
  })

  it.each([
    ['spoofed PDF signature', file(['plain text'], 'resume.pdf', 'application/pdf')],
    ['spoofed DOCX ZIP', file(['not zip'], 'resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')],
    ['DOCX mismatched known MIME', docxFile('application/pdf')],
    ['PDF mismatched known MIME', pdfFile('text/plain')],
    ['TXT mismatched known MIME', txtFile('resume', 'application/pdf')]
  ])('rejects %s before invoking a parser', async (_label, value) => {
    await expectCode(upload(post, { parts: [['file', value]] }).response, 400, 'INVALID_FILE_SIGNATURE')
  })

  it('rejects an unsupported extension even when the bytes are a DOCX ZIP', async () => {
    await expectCode(upload(post, {
      parts: [['file', docxFile(undefined, undefined, 'resume.zip')]]
    }).response, 400, 'UNSUPPORTED_FILE')
  })

  it('rejects binary content identified as TXT', async () => {
    const binary = file([new Uint8Array([0x00, 0x01, 0x02, 0xff, 0x41])], 'resume.txt', '')
    await expectCode(upload(post, { parts: [['file', binary]] }).response, 400, 'INVALID_FILE_SIGNATURE')
  })

  it('rejects files larger than the Vercel-safe upload limit before parser invocation', async () => {
    const largeFile = pdfFile('application/pdf', 'resume.pdf', MAX_RESUME_FILE_BYTES)
    await expectCode(upload(post, { parts: [['file', largeFile]], contentLength: largeFile.size + 1_024 }).response, 413, 'PAYLOAD_TOO_LARGE')
    expect(parserMocks.runDocumentParser).not.toHaveBeenCalled()
  })

  it('rejects missing required DOCX entries and oversized declared archives before worker extraction', async () => {
    await expectCode(upload(post, {
      parts: [['file', docxFile(undefined, [{ name: '[Content_Types].xml' }])]]
    }).response, 400, 'INVALID_FILE_SIGNATURE')
    await expectCode(upload(post, {
      parts: [['file', docxFile(undefined, [
        { name: '[Content_Types].xml' },
        { name: 'word/document.xml' },
        { name: 'word/media/large.bin', compressedSize: 1, uncompressedSize: DOCX_MAX_UNCOMPRESSED_BYTES + 1 }
      ])]]
    }).response, 422, 'EXTRACTION_LIMIT')
    expect(parserMocks.runDocumentParser).not.toHaveBeenCalled()
  })

  it('rejects actual inflated DOCX bytes hidden behind a tiny declared size before worker extraction', async () => {
    const inflatedBomb = new Uint8Array(DOCX_MAX_UNCOMPRESSED_BYTES + 1024)
    inflatedBomb.fill(0x61)
    const value = docxFile(undefined, [
      { name: '[Content_Types].xml', data: new TextEncoder().encode('<Types/>') },
      { name: 'word/document.xml', data: new TextEncoder().encode('<document/>') },
      { name: 'word/media/bomb.bin', data: inflatedBomb, uncompressedSize: 1 }
    ])

    expect(value.size).toBeLessThan(MAX_RESUME_FILE_BYTES)
    await expectCode(upload(post, { parts: [['file', value]] }).response, 422, 'EXTRACTION_LIMIT')
    expect(parserMocks.runDocumentParser).not.toHaveBeenCalled()
  }, 15_000)

  it('exercises the extraction bucket limit and Retry-After through the route', async () => {
    const limitedPost = createExtractTextRoute({
      guard: createAiRequestGuard({
        localOnly: true,
        limiter: new FixedWindowRateLimiter(),
        now: () => 5_000
      }),
      rateLimit: { limit: 1, windowMs: 10_000 }
    })

    await expect(upload(limitedPost).response).resolves.toMatchObject({ status: 200 })
    const response = await upload(limitedPost).response
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('10')
    expect((await response.json()).code).toBe('RATE_LIMITED')
  })

  it('maps worker page, output, empty, and parser failures to stable sanitized errors', async () => {
    parserMocks.runDocumentParser.mockRejectedValueOnce(new DocumentParserError('EXTRACTION_LIMIT'))
    await expectCode(upload(post, { parts: [['file', pdfFile()]] }).response, 422, 'EXTRACTION_LIMIT')

    parserMocks.runDocumentParser.mockResolvedValueOnce({ text: 'x'.repeat(MAX_EXTRACTED_TEXT_CHARS + 1) })
    await expectCode(upload(post, { parts: [['file', docxFile()]] }).response, 422, 'EXTRACTION_LIMIT')

    parserMocks.runDocumentParser.mockResolvedValueOnce({ text: '   ' })
    await expectCode(upload(post, { parts: [['file', pdfFile()]] }).response, 422, 'EMPTY_TEXT')

    parserMocks.runDocumentParser.mockRejectedValueOnce(new Error('secret parser stack'))
    const response = await upload(post, { parts: [['file', pdfFile()]] }).response
    const body = await response.json()
    expect(body.code).toBe('EXTRACTION_FAILED')
    expect(JSON.stringify(body)).not.toContain('secret parser')
  })
})
