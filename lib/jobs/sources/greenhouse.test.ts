import { describe, expect, it, vi } from 'vitest'
import type { JobSource } from '../job-domain'
import { createGreenhouseAdapter } from './greenhouse'

const now = '2026-08-01T08:00:00.000Z'
const source: JobSource = {
  id: 'job-source-greenhouse-example',
  kind: 'greenhouse',
  label: 'Example Co',
  sourceKey: 'example',
  enabled: true,
  createdAt: now,
  updatedAt: now
}

describe('Greenhouse job source adapter', () => {
  it('fetches only the official API and normalizes published jobs', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true')
      expect(init).toMatchObject({ method: 'GET', redirect: 'manual' })
      return Response.json({
        jobs: [{
          id: 123,
          title: 'Staff Frontend Engineer',
          updated_at: '2026-07-31T10:00:00-04:00',
          absolute_url: 'https://boards.greenhouse.io/example/jobs/123',
          language: 'en',
          location: { name: 'Remote' },
          content: '<p>Lead the design system &amp; frontend platform.</p><script>steal()</script>'
        }]
      })
    }) as typeof fetch
    const adapter = createGreenhouseAdapter({ fetch: fetcher, now: () => now })

    const result = await adapter.refresh({ source })

    expect(result).toMatchObject({ sourceId: source.id, completeness: 'complete', checkedAt: now })
    expect(result.postings).toHaveLength(1)
    expect(result.postings[0]).toMatchObject({
      sourceId: source.id,
      externalId: '123',
      company: source.label,
      description: 'Lead the design system & frontend platform.',
      location: 'Remote',
      sourceUpdatedAt: '2026-07-31T14:00:00.000Z'
    })
    expect(result.postings[0].description).not.toContain('steal')
  })

  it('returns a partial result for isolated malformed items', async () => {
    const adapter = createGreenhouseAdapter({
      fetch: async () => Response.json({
        jobs: [
          { id: 1, title: '', absolute_url: 'bad', content: '' },
          {
            id: 2,
            title: 'Product Engineer',
            absolute_url: 'https://boards.greenhouse.io/example/jobs/2',
            content: '<p>Build product systems.</p>'
          }
        ]
      }),
      now: () => now
    })
    const result = await adapter.refresh({ source })
    expect(result.completeness).toBe('partial')
    expect(result.postings.map((posting) => posting.externalId)).toEqual(['2'])
    expect(result.warnings).toEqual(['greenhouse-item-0-invalid'])
  })

  it('recognizes only official HTTPS job URLs', () => {
    const adapter = createGreenhouseAdapter()
    expect(adapter.recognizeUrl(new URL('https://boards.greenhouse.io/example/jobs/123'))).toEqual({
      sourceKey: 'example',
      externalId: '123'
    })
    expect(adapter.recognizeUrl(new URL('https://evil.example/example/jobs/123'))).toBeNull()
    expect(adapter.recognizeUrl(new URL('http://boards.greenhouse.io/example/jobs/123'))).toBeNull()
  })
})
