import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createDomainStore } from '@/lib/agent/domain-store'
import type { JobPosting, JobSource } from './job-domain'
import { refreshJobSource } from './job-refresh'
import type { JobSourceAdapter, JobSourceRefreshResult } from './sources'

const first = '2026-08-01T08:00:00.000Z'
const second = '2026-08-02T08:00:00.000Z'
const source: JobSource = {
  id: 'job-source-1', kind: 'greenhouse', label: 'Example', sourceKey: 'example',
  enabled: true, createdAt: first, updatedAt: first
}

function posting(id: string, checkedAt = first, contentHash = `hash:${id}`): JobPosting {
  return {
    id: `posting-${id}`, sourceId: source.id, externalId: id,
    canonicalUrl: `https://boards.greenhouse.io/example/jobs/${id}`,
    applyUrl: `https://boards.greenhouse.io/example/jobs/${id}`,
    title: `Engineer ${id}`, company: 'Example', description: `Build system ${id}.`, locale: 'en',
    firstSeenAt: checkedAt, lastCheckedAt: checkedAt, status: 'open', contentHash
  }
}

function createStore() {
  return createDomainStore({
    databaseName: `job-refresh-${crypto.randomUUID()}`,
    indexedDB: new IDBFactory()
  })
}

function adapter(result: JobSourceRefreshResult): JobSourceAdapter {
  return {
    kind: 'greenhouse', validateSourceKey: (value) => value, recognizeUrl: () => null,
    refresh: async () => result
  }
}

describe('refreshJobSource', () => {
  it('atomically inserts and idempotently updates source postings', async () => {
    const store = createStore()
    const initial = { sourceId: source.id, completeness: 'complete' as const, checkedAt: first, postings: [posting('1')], warnings: [] }
    expect(await refreshJobSource({ source, adapter: adapter(initial), store })).toMatchObject({ newCount: 1, updatedCount: 0 })

    const repeated = { ...initial, checkedAt: second, postings: [posting('1', second)] }
    expect(await refreshJobSource({ source, adapter: adapter(repeated), store })).toMatchObject({ newCount: 0, updatedCount: 0, unchangedCount: 1 })
    expect(await store.get('jobPostings', 'posting-1')).toMatchObject({ firstSeenAt: first, lastCheckedAt: second })
  })

  it('anchors a newly persisted source to its first check when the client clock is ahead', async () => {
    const store = createStore()
    const clientAheadSource = { ...source, createdAt: second, updatedAt: second }
    await refreshJobSource({
      source: clientAheadSource,
      adapter: adapter({
        sourceId: source.id,
        completeness: 'complete',
        checkedAt: first,
        postings: [posting('1')],
        warnings: []
      }),
      store
    })
    expect(await store.get('jobSources', source.id)).toMatchObject({
      createdAt: first,
      updatedAt: first
    })
  })

  it('closes missing jobs only after a complete refresh', async () => {
    const store = createStore()
    await refreshJobSource({
      source, adapter: adapter({ sourceId: source.id, completeness: 'complete', checkedAt: first, postings: [posting('1'), posting('2')], warnings: [] }), store
    })
    const partial = await refreshJobSource({
      source, adapter: adapter({ sourceId: source.id, completeness: 'partial', checkedAt: second, postings: [posting('1', second)], warnings: ['partial'] }), store
    })
    expect(partial.closedCount).toBe(0)
    expect((await store.get('jobPostings', 'posting-2'))?.status).toBe('open')

    const complete = await refreshJobSource({
      source, adapter: adapter({ sourceId: source.id, completeness: 'complete', checkedAt: second, postings: [posting('1', second)], warnings: [] }), store
    })
    expect(complete.closedCount).toBe(1)
    expect((await store.get('jobPostings', 'posting-2'))?.status).toBe('closed')
  })

  it('rolls back all writes when cancellation is observed during persistence', async () => {
    const store = createStore()
    const controller = new AbortController()
    const cancellingAdapter: JobSourceAdapter = {
      ...adapter({ sourceId: source.id, completeness: 'complete', checkedAt: first, postings: [], warnings: [] }),
      async refresh() {
        controller.abort()
        return { sourceId: source.id, completeness: 'complete', checkedAt: first, postings: [posting('1')], warnings: [] }
      }
    }
    await expect(refreshJobSource({ source, adapter: cancellingAdapter, store, signal: controller.signal })).rejects.toBeDefined()
    expect(await store.list('jobSources')).toEqual([])
    expect(await store.list('jobPostings')).toEqual([])
  })
})
