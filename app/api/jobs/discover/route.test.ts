import { describe, expect, it, vi } from 'vitest'
import type { JobSourceAdapter } from '@/lib/jobs/sources/types'
import { JobSourceError } from '@/lib/jobs/sources/types'
import { FixedWindowRateLimiter, createAiRequestGuard } from '@/lib/server/request-guard'
import { createDiscoverJobsRoute } from './route'

const now = '2026-08-01T08:00:00.000Z'

function createAdapter(refresh = vi.fn<JobSourceAdapter['refresh']>().mockResolvedValue({
  sourceId: 'job-source-result', completeness: 'complete', checkedAt: now, postings: [], warnings: []
})): JobSourceAdapter {
  return {
    kind: 'greenhouse',
    validateSourceKey(value) {
      if (!/^[a-z0-9_-]+$/iu.test(value)) throw new JobSourceError('INVALID_SOURCE')
      return value
    },
    recognizeUrl: () => null,
    refresh
  }
}

function createPost(adapter = createAdapter()) {
  return {
    adapter,
    post: createDiscoverJobsRoute({
      guard: createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter() }),
      adapters: new Map([['greenhouse', adapter]]),
      now: () => now
    })
  }
}

function request(body: unknown, headers?: HeadersInit) {
  return new Request('http://localhost/api/jobs/discover', {
    method: 'POST', headers, body: JSON.stringify(body)
  })
}

describe('POST /api/jobs/discover', () => {
  it('accepts only a fixed source enum and bounded public source key', async () => {
    const { adapter, post } = createPost()
    const response = await post(request({ source: 'greenhouse', sourceKey: 'example' }))
    expect(response.status).toBe(200)
    expect(adapter.refresh).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({ kind: 'greenhouse', sourceKey: 'example', label: 'example' }),
      signal: expect.any(AbortSignal)
    }))

    expect((await post(request({ source: 'greenhouse', sourceKey: 'example', url: 'https://evil.example' }))).status).toBe(400)
    expect((await post(request({ source: 'custom', sourceKey: 'example' }))).status).toBe(400)
    expect((await post(request({ source: 'greenhouse', sourceKey: 'https://evil.example' }))).status).toBe(400)
  })

  it('rejects cross-origin browser requests before adapter work', async () => {
    const { adapter, post } = createPost()
    const response = await post(request(
      { source: 'greenhouse', sourceKey: 'example' },
      { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' }
    ))
    expect(response.status).toBe(403)
    expect(adapter.refresh).not.toHaveBeenCalled()
  })

  it('maps bounded source failures without exposing upstream details', async () => {
    const failures = [
      ['RESPONSE_TOO_LARGE', 502, 'JOB_SOURCE_RESPONSE_TOO_LARGE'],
      ['REQUEST_TIMEOUT', 504, 'JOB_SOURCE_TIMEOUT'],
      ['REQUEST_ABORTED', 499, 'REQUEST_ABORTED'],
      ['REQUEST_FAILED', 502, 'JOB_SOURCE_UNAVAILABLE']
    ] as const
    for (const [code, status, responseCode] of failures) {
      const refresh = vi.fn<JobSourceAdapter['refresh']>().mockRejectedValue(
        new JobSourceError(code, 0, { cause: new Error('private upstream body') })
      )
      const response = await createPost(createAdapter(refresh)).post(
        request({ source: 'greenhouse', sourceKey: 'example' })
      )
      expect(response.status).toBe(status)
      const body = await response.json()
      expect(body.code).toBe(responseCode)
      expect(JSON.stringify(body)).not.toContain('private upstream body')
    }
  })
})
