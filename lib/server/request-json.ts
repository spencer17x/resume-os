import { apiErrorResponse, type ApiErrorCode } from '@/lib/server/request-guard'

export class RequestJsonError extends Error {
  constructor(readonly code: Extract<ApiErrorCode, 'PAYLOAD_TOO_LARGE' | 'INVALID_REQUEST' | 'REQUEST_ABORTED'>) {
    super(code)
    this.name = 'RequestJsonError'
  }
}

export async function readLimitedJson<T = unknown>(request: Request, maxBytes: number): Promise<T> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength && !/^\d+$/.test(declaredLength)) {
    throw new RequestJsonError('INVALID_REQUEST')
  }
  if (declaredLength && Number(declaredLength) > maxBytes) {
    await request.body?.cancel().catch(() => undefined)
    throw new RequestJsonError('PAYLOAD_TOO_LARGE')
  }
  if (!request.body) throw new RequestJsonError('INVALID_REQUEST')

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const abort = () => { void reader.cancel().catch(() => undefined) }
  request.signal.addEventListener('abort', abort, { once: true })

  try {
    while (true) {
      if (request.signal.aborted) throw new RequestJsonError('REQUEST_ABORTED')
      const { done, value } = await reader.read()
      if (request.signal.aborted) throw new RequestJsonError('REQUEST_ABORTED')
      if (done) break

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new RequestJsonError('PAYLOAD_TOO_LARGE')
      }
      chunks.push(value)
    }
  } finally {
    request.signal.removeEventListener('abort', abort)
  }

  if (totalBytes === 0) throw new RequestJsonError('INVALID_REQUEST')
  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as T
  } catch {
    throw new RequestJsonError('INVALID_REQUEST')
  }
}

export function requestJsonErrorResponse(error: unknown) {
  if (!(error instanceof RequestJsonError)) return null
  if (error.code === 'PAYLOAD_TOO_LARGE') return apiErrorResponse(error.code, 413)
  if (error.code === 'REQUEST_ABORTED') return apiErrorResponse(error.code, 499)
  return apiErrorResponse(error.code, 400)
}
