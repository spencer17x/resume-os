import { describe, expect, it, vi } from 'vitest'
import { createStableJobDomainId, type JobSource } from '../job-domain'
import { createSameOriginJobSourceAdapter } from './same-origin'

const now = '2026-08-01T08:00:00.000Z'
const source: JobSource = {
  id: createStableJobDomainId('job-source', ['greenhouse', 'example']),
  kind: 'greenhouse', label: 'example', sourceKey: 'example', enabled: true,
  createdAt: now, updatedAt: now
}

describe('same-origin job source adapter', () => {
  it('uses only the fixed discovery path and validates the response', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(input).toBe('/api/jobs/discover')
      expect(JSON.parse(String(init?.body))).toEqual({ source: 'greenhouse', sourceKey: 'example' })
      return Response.json({
        sourceId: source.id, completeness: 'complete', checkedAt: now, postings: [], warnings: []
      })
    }) as typeof fetch
    await expect(createSameOriginJobSourceAdapter('greenhouse', { fetch: fetcher }).refresh({ source }))
      .resolves.toMatchObject({ sourceId: source.id })
  })

  it('rejects unrelated or malformed route responses', async () => {
    const adapter = createSameOriginJobSourceAdapter('greenhouse', {
      fetch: async () => Response.json({
        sourceId: 'different', completeness: 'complete', checkedAt: now, postings: [], warnings: []
      })
    })
    await expect(adapter.refresh({ source })).rejects.toMatchObject({ code: 'RESPONSE_INVALID' })
  })
})
