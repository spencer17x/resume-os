import { DocumentParserError, runDocumentParser } from '@/lib/server/document-parser'
import { DocxPreflightError, validateDocxArchive } from '@/lib/server/docx-preflight'
import { apiErrorResponse, guardAiRequest, type AiRequestGuard, type ApiErrorCode } from '@/lib/server/request-guard'

export const runtime = 'nodejs'
export const MAX_RESUME_FILE_BYTES = 3 * 1024 * 1024
export const MAX_MULTIPART_BYTES = 4 * 1024 * 1024
export const MAX_PDF_PAGES = 25
export const MAX_EXTRACTED_TEXT_CHARS = 40_000
export const DOCUMENT_PARSE_TIMEOUT_MS = 15_000

const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const TXT_MIME = 'text/plain'
const OCTET_STREAM_MIME = 'application/octet-stream'

type ResumeFileType = 'pdf' | 'docx' | 'txt'

class ExtractionError extends Error {
  constructor(readonly code: ApiErrorCode, readonly status: number) {
    super(code)
    this.name = 'ExtractionError'
  }
}

export function createExtractTextRoute(dependencies: {
  guard?: AiRequestGuard
  rateLimit?: { limit: number; windowMs: number }
} = {}) {
  const guardRequest = dependencies.guard ?? guardAiRequest
  const rateLimit = dependencies.rateLimit ?? { limit: 10, windowMs: 60_000 }

  return async function extractTextRoute(request: Request) {
    const guard = guardRequest(request, {
      bucket: 'resume-extract',
      ...rateLimit,
      maxBodyBytes: MAX_MULTIPART_BYTES,
      browserAccess: 'same-origin'
    })
    if (guard) return guard

    const declaredLength = request.headers.get('content-length')
    if (!declaredLength) return apiErrorResponse('CONTENT_LENGTH_REQUIRED', 411)
    if (!/^\d+$/.test(declaredLength)) return apiErrorResponse('INVALID_REQUEST', 400)
    if (Number(declaredLength) > MAX_MULTIPART_BYTES) return apiErrorResponse('PAYLOAD_TOO_LARGE', 413)

    const form = await request.formData().catch(() => null)
    if (!form) return apiErrorResponse('INVALID_REQUEST', 400)

    const parts = [...form.entries()]
    const files = form.getAll('file')
    if (files.length === 0) return apiErrorResponse('FILE_REQUIRED', 400)
    if (
      parts.length !== 1
      || parts[0]?.[0] !== 'file'
      || files.length !== 1
      || !isUploadedFile(files[0])
    ) {
      return apiErrorResponse('UNEXPECTED_MULTIPART', 400)
    }

    const file = files[0]
    if (file.size > MAX_RESUME_FILE_BYTES) return apiErrorResponse('PAYLOAD_TOO_LARGE', 413)

    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const fileType = validateFileType(file, data)
      if (fileType === 'docx') await validateDocxArchive(data, { signal: request.signal })
      const text = normalizeText(await extractText(data, fileType, request.signal))
      if (!text) throw new ExtractionError('EMPTY_TEXT', 422)
      if (text.length > MAX_EXTRACTED_TEXT_CHARS) throw new ExtractionError('EXTRACTION_LIMIT', 422)

      return Response.json({
        text,
        fileName: normalizeFileName(file.name),
        mimeType: mimeFor(fileType)
      })
    } catch (error) {
      if (error instanceof ExtractionError) return apiErrorResponse(error.code, error.status)
      if (error instanceof DocxPreflightError || error instanceof DocumentParserError) {
        const status = error.code === 'REQUEST_ABORTED'
          ? 499
          : error.code === 'INVALID_FILE_SIGNATURE'
            ? 400
            : 422
        return apiErrorResponse(error.code, status)
      }
      return apiErrorResponse('EXTRACTION_FAILED', 422)
    }
  }
}

export const POST = createExtractTextRoute()

function isUploadedFile(value: FormDataEntryValue | undefined): value is File {
  return typeof value === 'object'
    && value !== null
    && typeof (value as File).name === 'string'
    && typeof (value as File).type === 'string'
    && typeof (value as File).size === 'number'
    && typeof (value as File).arrayBuffer === 'function'
}

function validateFileType(file: File, data: Uint8Array): ResumeFileType {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension !== 'pdf' && extension !== 'docx' && extension !== 'txt') {
    throw new ExtractionError('UNSUPPORTED_FILE', 400)
  }

  const expectedMime = mimeFor(extension)
  const suppliedMime = file.type.toLowerCase()
  if (suppliedMime && suppliedMime !== OCTET_STREAM_MIME && suppliedMime !== expectedMime) {
    throw new ExtractionError('INVALID_FILE_SIGNATURE', 400)
  }

  if (extension === 'pdf' && !startsWithAscii(data, '%PDF-')) {
    throw new ExtractionError('INVALID_FILE_SIGNATURE', 400)
  }
  if (extension === 'docx' && !isZipSignature(data)) {
    throw new ExtractionError('INVALID_FILE_SIGNATURE', 400)
  }
  if (extension === 'txt' && looksBinary(data)) {
    throw new ExtractionError('INVALID_FILE_SIGNATURE', 400)
  }
  return extension
}

async function extractText(data: Uint8Array, fileType: ResumeFileType, signal: AbortSignal) {
  if (fileType === 'txt') return new TextDecoder('utf-8', { fatal: true }).decode(data)

  const result = await runDocumentParser(
    fileType === 'pdf'
      ? { type: 'pdf', data, maxPdfPages: MAX_PDF_PAGES, maxTextChars: MAX_EXTRACTED_TEXT_CHARS }
      : { type: 'docx', data, maxTextChars: MAX_EXTRACTED_TEXT_CHARS },
    { signal, timeoutMs: DOCUMENT_PARSE_TIMEOUT_MS }
  )
  return result.text
}

function startsWithAscii(data: Uint8Array, signature: string) {
  if (data.length < signature.length) return false
  return [...signature].every((character, index) => data[index] === character.charCodeAt(0))
}

function isZipSignature(data: Uint8Array) {
  return data.length >= 4
    && data[0] === 0x50
    && data[1] === 0x4b
    && ((data[2] === 0x03 && data[3] === 0x04)
      || (data[2] === 0x05 && data[3] === 0x06)
      || (data[2] === 0x07 && data[3] === 0x08))
}

function looksBinary(data: Uint8Array) {
  if (data.includes(0)) return true
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return true
  }

  const controlBytes = data.reduce((count, byte) => {
    const allowedWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0d
    return count + (byte < 0x20 && !allowedWhitespace ? 1 : 0)
  }, 0)
  return data.length > 0 && controlBytes / data.length > 0.1
}

function mimeFor(fileType: ResumeFileType) {
  if (fileType === 'pdf') return PDF_MIME
  if (fileType === 'docx') return DOCX_MIME
  return TXT_MIME
}

function normalizeText(text: string) {
  return text.replace(/\r\n?/g, '\n').trim()
}

function normalizeFileName(name: string) {
  return name
    .replace(/^.*[\\/]/, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim() || 'resume'
}
