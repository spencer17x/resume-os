import { describe, expect, it, vi } from 'vitest'
import type { JobSource } from '../job-domain'
import { createLeverAdapter } from './lever'

const now = '2026-08-01T08:00:00.000Z'
const source: JobSource = {
  id: 'job-source-lever-example',
  kind: 'lever',
  label: 'Example Co',
  sourceKey: 'example',
  enabled: true,
  createdAt: now,
  updatedAt: now
}

describe('Lever job source adapter', () => {
  it('normalizes Lever postings and explicit work attributes', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.lever.co/v0/postings/example?mode=json')
      expect(init).toMatchObject({ method: 'GET', redirect: 'manual' })
      return Response.json([{
        id: 'abc-123',
        text: 'Senior Product Engineer',
        hostedUrl: 'https://jobs.lever.co/example/abc-123',
        applyUrl: 'https://jobs.lever.co/example/abc-123/apply',
        descriptionPlain: 'Build reliable product systems.',
        workplaceType: 'hybrid',
        categories: { location: 'Shanghai', commitment: 'Full-time' },
        lists: [{ text: 'What you will do', content: '<ul><li>Own delivery</li></ul>' }]
      }])
    }) as typeof fetch
    const adapter = createLeverAdapter({ fetch: fetcher, now: () => now })

    const result = await adapter.refresh({ source })

    expect(result.completeness).toBe('complete')
    expect(result.postings[0]).toMatchObject({
      externalId: 'abc-123',
      title: 'Senior Product Engineer',
      company: 'Example Co',
      location: 'Shanghai',
      workplaceType: 'hybrid',
      employmentType: 'full-time'
    })
    expect(result.postings[0].description).toContain('Own delivery')
  })

  it('recognizes hosted and API URLs without accepting lookalike hosts', () => {
    const adapter = createLeverAdapter()
    expect(adapter.recognizeUrl(new URL('https://jobs.lever.co/example/abc-123'))).toEqual({
      sourceKey: 'example',
      externalId: 'abc-123'
    })
    expect(adapter.recognizeUrl(new URL('https://api.lever.co/v0/postings/example/abc-123'))).toEqual({
      sourceKey: 'example',
      externalId: 'abc-123'
    })
    expect(adapter.recognizeUrl(new URL('https://jobs.lever.co.evil.example/example/abc'))).toBeNull()
  })
})
