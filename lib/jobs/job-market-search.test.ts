import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDomainStore, type IndexedDbDomainStore } from '@/lib/agent/domain-store'
import type { JobSourceAdapter } from './sources'
import { refreshSelectedJobMarket } from './job-market-search'

const stores: IndexedDbDomainStore[] = []
const now = '2026-08-01T08:00:00.000Z'

function createStore() {
  const store = createDomainStore({
    databaseName: `job-market-search-${crypto.randomUUID()}`,
    indexedDB: new IDBFactory()
  })
  stores.push(store)
  return store
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()))
})

describe('refreshSelectedJobMarket', () => {
  it('refreshes the curated catalog for selected automatic platforms only', async () => {
    const store = createStore()
    const refresh = vi.fn(async ({ source }: Parameters<JobSourceAdapter['refresh']>[0]) => ({
      sourceId: source.id,
      completeness: 'complete' as const,
      checkedAt: now,
      postings: [],
      warnings: []
    }))

    const result = await refreshSelectedJobMarket({
      platforms: ['greenhouse', 'boss', '51job'],
      existingSources: [],
      store,
      createAdapter: (kind) => ({ kind, validateSourceKey: (value) => value, recognizeUrl: () => null, refresh }),
      now
    })

    expect(result.failures).toEqual([])
    expect(result.sourceCount).toBeGreaterThan(0)
    expect(refresh).toHaveBeenCalledTimes(result.sourceCount)
    expect((await store.list('jobSources')).every((source) => source.kind === 'greenhouse')).toBe(true)
  })

  it('keeps successful source commits when another selected source fails', async () => {
    const store = createStore()
    let calls = 0
    const result = await refreshSelectedJobMarket({
      platforms: ['lever'],
      existingSources: [],
      store,
      createAdapter: (kind) => ({
        kind,
        validateSourceKey: (value) => value,
        recognizeUrl: () => null,
        async refresh({ source }) {
          calls += 1
          if (calls === 1) throw new Error('synthetic source failure')
          return { sourceId: source.id, completeness: 'complete', checkedAt: now, postings: [], warnings: [] }
        }
      }),
      now
    })

    expect(result.failures).toHaveLength(1)
    expect(result.summaries.length).toBe(result.sourceCount - 1)
    expect(await store.list('jobSources')).toHaveLength(result.summaries.length)
  })

  it('stops before starting another source after cancellation', async () => {
    const store = createStore()
    const controller = new AbortController()
    let calls = 0

    await expect(refreshSelectedJobMarket({
      platforms: ['greenhouse'],
      existingSources: [],
      store,
      signal: controller.signal,
      createAdapter: (kind) => ({
        kind,
        validateSourceKey: (value) => value,
        recognizeUrl: () => null,
        async refresh({ source }) {
          calls += 1
          controller.abort()
          return { sourceId: source.id, completeness: 'complete', checkedAt: now, postings: [], warnings: [] }
        }
      }),
      now
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(1)
  })
})
