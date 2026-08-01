import {
  createDomainStore,
  DomainStoreError,
  type IndexedDbDomainStore
} from '@/lib/agent/domain-store'
import { jobPostingSchema, jobSourceSchema, type JobSource } from './job-domain'
import type { JobSourceAdapter } from './sources'

export type JobRefreshSummary = {
  sourceId: string
  completeness: 'complete' | 'partial'
  checkedAt: string
  newCount: number
  updatedCount: number
  unchangedCount: number
  closedCount: number
  warningCount: number
}

export async function refreshJobSource(input: {
  source: JobSource
  adapter: JobSourceAdapter
  store?: IndexedDbDomainStore
  signal?: AbortSignal
}): Promise<JobRefreshSummary> {
  const source = jobSourceSchema.parse(input.source)
  if (source.kind !== input.adapter.kind || source.kind === 'manual') {
    throw new TypeError('The source does not belong to this refresh adapter.')
  }
  throwIfAborted(input.signal)
  const result = await input.adapter.refresh({ source, signal: input.signal })
  throwIfAborted(input.signal)
  if (result.sourceId !== source.id) throw new TypeError('Source refresh result has the wrong source ID.')

  const store = input.store ?? createDomainStore()
  return store.transaction(
    ['jobSources', 'jobPostings'],
    'readwrite',
    async (transaction) => {
      throwIfAborted(input.signal)
      const existingSource = await transaction.get('jobSources', source.id)
      if (
        existingSource
        && (existingSource.kind !== source.kind || existingSource.sourceKey !== source.sourceKey)
      ) {
        throw new DomainStoreError(
          'REFERENTIAL_INTEGRITY',
          `Job source ${source.id} changed identity`
        )
      }
      await transaction.put('jobSources', {
        ...source,
        createdAt: existingSource?.createdAt ?? result.checkedAt,
        updatedAt: result.checkedAt
      })

      const existing = (await transaction.list('jobPostings'))
        .filter((posting) => posting.sourceId === source.id)
      const existingById = new Map(existing.map((posting) => [posting.id, posting]))
      const incomingIds = new Set<string>()
      let newCount = 0
      let updatedCount = 0
      let unchangedCount = 0
      let closedCount = 0

      for (const candidate of result.postings) {
        throwIfAborted(input.signal)
        const parsed = jobPostingSchema.parse(candidate)
        if (parsed.sourceId !== source.id || incomingIds.has(parsed.id)) {
          throw new TypeError('Source refresh returned duplicate or unrelated postings.')
        }
        incomingIds.add(parsed.id)
        const previous = existingById.get(parsed.id)
        if (!previous) newCount += 1
        else if (
          previous.contentHash !== parsed.contentHash
          || previous.status !== 'open'
          || previous.canonicalUrl !== parsed.canonicalUrl
          || previous.applyUrl !== parsed.applyUrl
        ) updatedCount += 1
        else unchangedCount += 1

        await transaction.put('jobPostings', {
          ...parsed,
          firstSeenAt: previous?.firstSeenAt ?? parsed.firstSeenAt,
          lastCheckedAt: result.checkedAt,
          status: 'open'
        })
      }

      if (result.completeness === 'complete') {
        for (const previous of existing) {
          throwIfAborted(input.signal)
          if (incomingIds.has(previous.id) || previous.status === 'closed') continue
          await transaction.put('jobPostings', {
            ...previous,
            status: 'closed',
            lastCheckedAt: result.checkedAt
          })
          closedCount += 1
        }
      }

      return {
        sourceId: source.id,
        completeness: result.completeness,
        checkedAt: result.checkedAt,
        newCount,
        updatedCount,
        unchangedCount,
        closedCount,
        warningCount: result.warnings.length
      }
    }
  )
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}
