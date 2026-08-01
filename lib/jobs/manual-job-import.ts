import type { IndexedDbDomainStore } from '@/lib/agent/domain-store'
import {
  createJobInputFingerprint,
  createStableJobDomainId,
  jobPostingSchema,
  jobSourceSchema,
  type JobSearchProfile
} from './job-domain'
import {
  assertMarketplaceJobUrl,
  type JobMarketplaceId
} from './job-marketplace'
import {
  scoreJobRecommendation,
  type RecommendationCareerFact
} from './job-recommendation'
import { htmlToBoundedText } from './sources/normalize'

export async function importMarketplaceJob(input: {
  store: IndexedDbDomainStore
  platform: JobMarketplaceId
  url: string
  title: string
  company: string
  description: string
  location?: string
  locale: 'zh' | 'en'
  profile: JobSearchProfile
  sourceDraftId: string
  facts: readonly RecommendationCareerFact[]
  now?: string
}) {
  const now = input.now ?? new Date().toISOString()
  const url = assertMarketplaceJobUrl(input.platform, input.url)
  const sourceId = createStableJobDomainId('job-source', ['manual', input.platform])
  const existingSource = await input.store.get('jobSources', sourceId)
  const source = jobSourceSchema.parse({
    id: sourceId,
    kind: 'manual',
    label: input.platform,
    enabled: true,
    createdAt: existingSource?.createdAt ?? now,
    updatedAt: now
  })
  const normalized = {
    sourceId,
    externalId: createJobInputFingerprint({ platform: input.platform, url }),
    canonicalUrl: url,
    applyUrl: url,
    title: input.title.normalize('NFKC').trim(),
    company: input.company.normalize('NFKC').trim(),
    description: htmlToBoundedText(input.description),
    locale: input.locale,
    ...(input.location?.trim() ? { location: input.location.normalize('NFKC').trim() } : {})
  }
  const postingId = createStableJobDomainId('posting', [input.platform, url])
  const existingPosting = await input.store.get('jobPostings', postingId)
  const posting = jobPostingSchema.parse({
    id: postingId,
    ...normalized,
    firstSeenAt: existingPosting?.firstSeenAt ?? now,
    lastCheckedAt: now,
    status: 'open',
    contentHash: createJobInputFingerprint(normalized)
  })
  const scored = scoreJobRecommendation({
    posting,
    profile: input.profile,
    sourceDraftId: input.sourceDraftId,
    facts: input.facts,
    now
  })

  return input.store.transaction(
    ['jobSources', 'jobPostings', 'jobRecommendations'],
    'readwrite',
    async (transaction) => {
      const existingRecommendation = await transaction.get('jobRecommendations', scored.id)
      await transaction.put('jobSources', source)
      await transaction.put('jobPostings', posting)
      const recommendation = {
        ...scored,
        decision: existingRecommendation?.decision ?? scored.decision,
        analyzedTargetJobId: existingRecommendation?.analyzedTargetJobId,
        createdAt: existingRecommendation?.createdAt ?? scored.createdAt
      }
      await transaction.put('jobRecommendations', recommendation)
      return { source, posting, recommendation }
    }
  )
}
