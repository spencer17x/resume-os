import { describe, expect, it } from 'vitest'
import type { JobPosting } from './job-domain'
import { findJobDuplicateSuggestions } from './job-deduplication'

const now = '2026-08-01T08:00:00.000Z'
function posting(id: string, overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id, sourceId: `source-${id}`, externalId: id,
    canonicalUrl: `https://jobs.example/${id}`, applyUrl: `https://jobs.example/${id}/apply`,
    title: 'Staff Engineer', company: 'Example', description: 'Build systems.', locale: 'en',
    location: 'Remote', firstSeenAt: now, lastCheckedAt: now, status: 'open', contentHash: 'hash-1',
    ...overrides
  }
}

describe('findJobDuplicateSuggestions', () => {
  it('suggests only high-confidence URL or content-and-identity duplicates', () => {
    expect(findJobDuplicateSuggestions([
      posting('a', { canonicalUrl: 'https://jobs.example/shared?b=2&a=1' }),
      posting('b', { canonicalUrl: 'https://jobs.example/shared?a=1&b=2' }),
      posting('c'),
      posting('d'),
      posting('e', { title: 'Different role' })
    ])).toEqual([
      { postingIds: ['a', 'b'], reason: 'same-canonical-url' },
      { postingIds: ['a', 'c'], reason: 'same-content-and-identity' },
      { postingIds: ['a', 'd'], reason: 'same-content-and-identity' },
      { postingIds: ['b', 'c'], reason: 'same-content-and-identity' },
      { postingIds: ['b', 'd'], reason: 'same-content-and-identity' },
      { postingIds: ['c', 'd'], reason: 'same-content-and-identity' }
    ])
  })

  it('does not merge matching titles without identical content and identity', () => {
    expect(findJobDuplicateSuggestions([
      posting('a', { contentHash: 'hash-a' }),
      posting('b', { contentHash: 'hash-b' })
    ])).toEqual([])
  })
})
