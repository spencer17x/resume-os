import type { Readable } from 'node:stream'
import { fromBuffer, type Entry, type ZipFile } from 'yauzl'
import { crc32 } from '@/lib/server/crc32'
import type { ApiErrorCode } from '@/lib/server/request-guard'

export const DOCX_MAX_ENTRIES = 512
export const DOCX_MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
const DOCX_MAX_COMPRESSION_RATIO = 200
const DOCX_RATIO_CHECK_MIN_BYTES = 1024 * 1024
const REQUIRED_DOCX_ENTRIES = new Set(['[Content_Types].xml', 'word/document.xml'])

export class DocxPreflightError extends Error {
  constructor(readonly code: Extract<ApiErrorCode, 'INVALID_FILE_SIGNATURE' | 'EXTRACTION_LIMIT' | 'REQUEST_ABORTED'>) {
    super(code)
    this.name = 'DocxPreflightError'
  }
}

export async function validateDocxArchive(
  data: Uint8Array,
  options: { signal?: AbortSignal } = {}
) {
  const zipFile = await openArchive(data, options.signal)
  return scanArchive(zipFile, options.signal)
}

function openArchive(data: Uint8Array, signal?: AbortSignal) {
  return new Promise<ZipFile>((resolve, reject) => {
    let settled = false
    const finishError = (error: DocxPreflightError) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    }
    const onAbort = () => finishError(new DocxPreflightError('REQUEST_ABORTED'))

    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }

    fromBuffer(Buffer.from(data), {
      autoClose: false,
      lazyEntries: true,
      validateEntrySizes: false,
      decodeStrings: true
    }, (openError, zipFile) => {
      if (settled || signal?.aborted) {
        zipFile?.close()
        finishError(new DocxPreflightError('REQUEST_ABORTED'))
        return
      }
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (openError || !zipFile) {
        reject(new DocxPreflightError('INVALID_FILE_SIGNATURE'))
        return
      }
      resolve(zipFile)
    })
  })
}

async function scanArchive(zipFile: ZipFile, signal?: AbortSignal) {
  let entryCount = 0
  let totalDeclaredBytes = 0
  let totalUncompressedBytes = 0
  let activeStream: Readable | null = null
  const required = new Set(REQUIRED_DOCX_ENTRIES)
  const onAbort = () => {
    activeStream?.destroy(new DocxPreflightError('REQUEST_ABORTED'))
    zipFile.close()
  }

  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    throwIfAborted(signal)
    for await (const entry of zipFile.eachEntry()) {
      throwIfAborted(signal)
      validateDirectoryEntry(entry)
      entryCount += 1
      if (entryCount > DOCX_MAX_ENTRIES) throw new DocxPreflightError('EXTRACTION_LIMIT')

      totalDeclaredBytes += entry.uncompressedSize
      if (totalDeclaredBytes > DOCX_MAX_UNCOMPRESSED_BYTES) {
        throw new DocxPreflightError('EXTRACTION_LIMIT')
      }
      required.delete(entry.fileName)

      const stream = await zipFile.openReadStreamPromise(entry)
      activeStream = stream
      throwIfAborted(signal)

      let entryBytes = 0
      let entryCrc = 0
      for await (const value of stream) {
        throwIfAborted(signal)
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
        entryBytes += chunk.byteLength
        totalUncompressedBytes += chunk.byteLength
        entryCrc = crc32(chunk, entryCrc)

        if (totalUncompressedBytes > DOCX_MAX_UNCOMPRESSED_BYTES) {
          throw new DocxPreflightError('EXTRACTION_LIMIT')
        }
        if (
          entryBytes >= DOCX_RATIO_CHECK_MIN_BYTES
          && (entry.compressedSize === 0 || entryBytes / entry.compressedSize > DOCX_MAX_COMPRESSION_RATIO)
        ) {
          throw new DocxPreflightError('EXTRACTION_LIMIT')
        }
      }
      activeStream = null

      if (entryBytes !== entry.uncompressedSize || (entryCrc >>> 0) !== (entry.crc32 >>> 0)) {
        throw new DocxPreflightError('INVALID_FILE_SIGNATURE')
      }
    }

    throwIfAborted(signal)
    if (required.size > 0) throw new DocxPreflightError('INVALID_FILE_SIGNATURE')
    return { entryCount, totalUncompressedBytes }
  } catch (error) {
    if (signal?.aborted) throw new DocxPreflightError('REQUEST_ABORTED')
    if (error instanceof DocxPreflightError) throw error
    throw new DocxPreflightError('INVALID_FILE_SIGNATURE')
  } finally {
    signal?.removeEventListener('abort', onAbort)
    activeStream?.destroy()
    zipFile.close()
  }
}

function validateDirectoryEntry(entry: Entry) {
  if ((entry.generalPurposeBitFlag & 0x1) !== 0 || !entry.canDecodeFileData()) {
    throw new DocxPreflightError('INVALID_FILE_SIGNATURE')
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DocxPreflightError('REQUEST_ABORTED')
}
