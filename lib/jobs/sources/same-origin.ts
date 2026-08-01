import type { JobSource } from '../job-domain'
import { jobSourceRefreshResultSchema, JobSourceError, type JobSourceAdapter } from './types'

export function createSameOriginJobSourceAdapter(
  kind: Extract<JobSource['kind'], 'greenhouse' | 'lever'>,
  dependencies: { fetch?: typeof fetch } = {}
): JobSourceAdapter {
  const fetcher = dependencies.fetch ?? fetch
  return {
    kind,
    validateSourceKey(value) {
      const normalized = value.trim()
      if (!/^[a-z0-9][a-z0-9_-]{0,127}$/iu.test(normalized)) {
        throw new JobSourceError('INVALID_SOURCE')
      }
      return normalized
    },
    recognizeUrl: () => null,
    async refresh({ source, signal }) {
      if (source.kind !== kind || !source.sourceKey) throw new JobSourceError('INVALID_SOURCE')
      let response: Response
      try {
        response = await fetcher('/api/jobs/discover', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: kind, sourceKey: this.validateSourceKey(source.sourceKey) }),
          signal
        })
      } catch (error) {
        if (signal?.aborted) throw new JobSourceError('REQUEST_ABORTED', 0, { cause: error })
        throw new JobSourceError('REQUEST_FAILED', 0, { cause: error })
      }
      if (response.status === 429) {
        throw new JobSourceError('RATE_LIMITED', parseRetryAfter(response.headers.get('retry-after')))
      }
      if (response.status === 499) throw new JobSourceError('REQUEST_ABORTED')
      if (response.status === 504) throw new JobSourceError('REQUEST_TIMEOUT')
      if (!response.ok) throw new JobSourceError('REQUEST_FAILED')
      let value: unknown
      try {
        value = await response.json()
      } catch (error) {
        throw new JobSourceError('RESPONSE_INVALID', 0, { cause: error })
      }
      const parsed = jobSourceRefreshResultSchema.safeParse(value)
      if (!parsed.success || parsed.data.sourceId !== source.id) {
        throw new JobSourceError('RESPONSE_INVALID', 0, { cause: parsed.error })
      }
      return parsed.data
    }
  }
}

function parseRetryAfter(value: string | null) {
  return value && /^\d+$/u.test(value) ? Math.min(Number(value), 86_400) : 0
}
