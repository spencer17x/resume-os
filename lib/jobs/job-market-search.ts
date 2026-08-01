import type { IndexedDbDomainStore } from '@/lib/agent/domain-store'
import type { JobSource } from './job-domain'
import { automaticSourceKinds, type JobMarketplaceId } from './job-marketplace'
import { refreshJobSource, type JobRefreshSummary } from './job-refresh'
import { createCatalogJobSources } from './job-source-catalog'
import { JobSourceError, type JobSourceAdapter } from './sources'

export const MAX_MARKET_REFRESH_SOURCES = 10

export type JobMarketRefreshFailure = {
  sourceId: string
  sourceLabel: string
  code: JobSourceError['code'] | 'UNKNOWN'
}

export type JobMarketRefreshResult = {
  summaries: JobRefreshSummary[]
  failures: JobMarketRefreshFailure[]
  skippedCount: number
  sourceCount: number
}

export async function refreshSelectedJobMarket(input: {
  platforms: readonly JobMarketplaceId[]
  existingSources: readonly JobSource[]
  store: IndexedDbDomainStore
  createAdapter: (kind: 'greenhouse' | 'lever') => JobSourceAdapter
  signal?: AbortSignal
  now?: string
  onProgress?: (completed: number, total: number, source: JobSource) => void
}): Promise<JobMarketRefreshResult> {
  const now = input.now ?? new Date().toISOString()
  const automaticKinds = new Set(automaticSourceKinds(input.platforms))
  const catalogSources = createCatalogJobSources({
    platforms: input.platforms,
    now,
    existing: input.existingSources
  })
  const sourcesById = new Map(catalogSources.map((source) => [source.id, source]))
  for (const source of input.existingSources) {
    if (
      source.enabled
      && source.kind !== 'manual'
      && automaticKinds.has(source.kind)
      && !sourcesById.has(source.id)
    ) sourcesById.set(source.id, source)
  }
  const allSources = [...sourcesById.values()].filter((source) => source.enabled)
  const sources = allSources.slice(0, MAX_MARKET_REFRESH_SOURCES)
  const summaries: JobRefreshSummary[] = []
  const failures: JobMarketRefreshFailure[] = []

  for (const [index, source] of sources.entries()) {
    throwIfAborted(input.signal)
    input.onProgress?.(index, sources.length, source)
    try {
      summaries.push(await refreshJobSource({
        source,
        adapter: input.createAdapter(source.kind as 'greenhouse' | 'lever'),
        store: input.store,
        signal: input.signal
      }))
    } catch (error) {
      throwIfAborted(input.signal)
      failures.push({
        sourceId: source.id,
        sourceLabel: source.label,
        code: error instanceof JobSourceError ? error.code : 'UNKNOWN'
      })
    }
    input.onProgress?.(index + 1, sources.length, source)
  }

  return {
    summaries,
    failures,
    skippedCount: allSources.length - sources.length,
    sourceCount: sources.length
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}
