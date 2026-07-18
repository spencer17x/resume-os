import { isMainThread, parentPort } from 'node:worker_threads'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse')
const { extractRawText } = require('mammoth')

export class WorkerParseError extends Error {
  constructor(code) {
    super(code)
    this.name = 'WorkerParseError'
    this.code = code
  }
}

function boundedText(value, maxTextChars) {
  if (typeof value !== 'string') throw new WorkerParseError('EXTRACTION_FAILED')
  if (!Number.isInteger(maxTextChars) || maxTextChars < 1 || value.length > maxTextChars) {
    throw new WorkerParseError('EXTRACTION_LIMIT')
  }
  return value
}

export async function parseDocumentTask(task, dependencies = {}) {
  if (task.type === 'pdf') {
    const Parser = dependencies.PDFParse ?? PDFParse
    const parser = new Parser({ data: task.data })
    try {
      const info = await parser.getInfo()
      if (!Number.isInteger(info.total) || info.total < 1) {
        throw new WorkerParseError('EXTRACTION_FAILED')
      }
      if (info.total > task.maxPdfPages) {
        throw new WorkerParseError('EXTRACTION_LIMIT')
      }

      const result = await parser.getText({ first: info.total })
      return { text: boundedText(result.text, task.maxTextChars), pageCount: info.total }
    } finally {
      await parser.destroy()
    }
  }

  if (task.type === 'docx') {
    const extract = dependencies.extractRawText ?? extractRawText
    const result = await extract({ buffer: Buffer.from(task.data) })
    return { text: boundedText(result.value, task.maxTextChars) }
  }

  throw new WorkerParseError('EXTRACTION_FAILED')
}

if (!isMainThread && parentPort) {
  parentPort.once('message', async (task) => {
    try {
      const result = await parseDocumentTask(task)
      parentPort.postMessage({ ok: true, result })
    } catch (error) {
      const code = error instanceof WorkerParseError ? error.code : 'EXTRACTION_FAILED'
      parentPort.postMessage({ ok: false, code })
    } finally {
      parentPort.close()
    }
  })
}
