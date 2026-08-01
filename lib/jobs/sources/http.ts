import {
  DEFAULT_SOURCE_TIMEOUT_MS,
  JobSourceError,
  MAX_SOURCE_RESPONSE_BYTES,
  type JobSourceAdapterDependencies
} from './types'

export type SourceHttpClient = {
  getJson(url: URL, signal?: AbortSignal): Promise<unknown>
}

export function createSourceHttpClient(
  dependencies: JobSourceAdapterDependencies = {}
): SourceHttpClient {
  const fetcher = dependencies.fetch ?? fetch
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS
  const maxResponseBytes = dependencies.maxResponseBytes ?? MAX_SOURCE_RESPONSE_BYTES

  return {
    async getJson(url, signal) {
      const linked = createLinkedSignal(signal, timeoutMs)
      let response: Response
      try {
        response = await fetcher(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          redirect: 'manual',
          signal: linked.signal
        })
      } catch (error) {
        throw normalizeRequestError(error, signal, linked.didTimeout())
      } finally {
        linked.dispose()
      }

      if (response.status >= 300 && response.status < 400) {
        throw new JobSourceError('REDIRECT_BLOCKED')
      }
      if (response.status === 429) {
        throw new JobSourceError(
          'RATE_LIMITED',
          parseRetryAfter(response.headers.get('retry-after'))
        )
      }
      if (!response.ok) throw new JobSourceError('REQUEST_FAILED')

      const declaredLength = response.headers.get('content-length')
      if (
        declaredLength
        && (/^\d+$/u.test(declaredLength) ? Number(declaredLength) : Infinity) > maxResponseBytes
      ) {
        throw new JobSourceError('RESPONSE_TOO_LARGE')
      }

      const bytes = await readBoundedBody(response, maxResponseBytes, signal)
      try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      } catch (error) {
        throw new JobSourceError('RESPONSE_INVALID', 0, { cause: error })
      }
    }
  }
}

async function readBoundedBody(response: Response, maximum: number, signal?: AbortSignal) {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      if (signal?.aborted) throw abortReason(signal)
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximum) {
        await reader.cancel().catch(() => undefined)
        throw new JobSourceError('RESPONSE_TOO_LARGE')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof JobSourceError) throw error
    throw normalizeRequestError(error, signal, false)
  } finally {
    reader.releaseLock()
  }

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function createLinkedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = () => controller.abort(abortReason(parent!))
  if (parent?.aborted) abortFromParent()
  else parent?.addEventListener('abort', abortFromParent, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('Source request timed out.', 'TimeoutError'))
  }, timeoutMs)

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose() {
      clearTimeout(timer)
      parent?.removeEventListener('abort', abortFromParent)
    }
  }
}

function normalizeRequestError(error: unknown, parent: AbortSignal | undefined, timedOut: boolean) {
  if (error instanceof JobSourceError) return error
  if (timedOut) return new JobSourceError('REQUEST_TIMEOUT', 0, { cause: error })
  if (parent?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
    return new JobSourceError('REQUEST_ABORTED', 0, { cause: error })
  }
  return new JobSourceError('REQUEST_FAILED', 0, { cause: error })
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

function parseRetryAfter(value: string | null) {
  if (!value) return 0
  if (/^\d+$/u.test(value)) return Math.min(Number(value), 86_400)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 0
  return Math.max(0, Math.min(86_400, Math.ceil((timestamp - Date.now()) / 1_000)))
}
