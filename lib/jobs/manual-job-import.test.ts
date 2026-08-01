import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it } from 'vitest'
import { createDomainStore, type IndexedDbDomainStore } from '@/lib/agent/domain-store'
import type { JobSearchProfile } from './job-domain'
import { importMarketplaceJob } from './manual-job-import'

const now = '2026-08-01T08:00:00.000Z'
const stores: IndexedDbDomainStore[] = []
const profile: JobSearchProfile = {
  id: 'profile-1', name: 'Platform roles', platforms: ['boss'], titles: ['Platform Engineer'],
  adjacentTitles: [], locations: ['Shanghai'], excludedLocations: [], workplaceTypes: [],
  employmentTypes: [], requiredTerms: [], preferredTerms: ['TypeScript'], excludedTerms: [],
  maximumAgeDays: 30, createdAt: now, updatedAt: now
}

function createStore() {
  const store = createDomainStore({
    databaseName: `manual-job-import-${crypto.randomUUID()}`,
    indexedDB: new IDBFactory()
  })
  stores.push(store)
  return store
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()))
})

describe('importMarketplaceJob', () => {
  it('stores and scores a user-provided marketplace job without fetching the URL', async () => {
    const store = createStore()
    await store.put('jobSearchProfiles', profile)
    const result = await importMarketplaceJob({
      store,
      platform: 'boss',
      url: 'https://www.zhipin.com/job_detail/example.html#job',
      title: 'Platform Engineer',
      company: 'Example',
      description: '<p>Build TypeScript platforms.</p>',
      location: 'Shanghai',
      locale: 'en',
      profile,
      sourceDraftId: 'draft-1',
      facts: [],
      now
    })

    expect(result.posting).toMatchObject({
      canonicalUrl: 'https://www.zhipin.com/job_detail/example.html',
      description: 'Build TypeScript platforms.',
      company: 'Example'
    })
    expect(result.recommendation.preliminaryScore).toBeGreaterThan(0)
    expect(await store.list('jobSources')).toHaveLength(1)
    expect(await store.list('jobPostings')).toHaveLength(1)
    expect(await store.list('jobRecommendations')).toHaveLength(1)
  })

  it('rejects a URL from a different platform before writing local data', async () => {
    const store = createStore()
    await store.put('jobSearchProfiles', profile)
    await expect(importMarketplaceJob({
      store,
      platform: 'boss',
      url: 'https://jobs.51job.com/example.html',
      title: 'Platform Engineer',
      company: 'Example',
      description: 'Build TypeScript platforms.',
      locale: 'en',
      profile,
      sourceDraftId: 'draft-1',
      facts: [],
      now
    })).rejects.toThrow()
    expect(await store.list('jobPostings')).toEqual([])
  })
})
