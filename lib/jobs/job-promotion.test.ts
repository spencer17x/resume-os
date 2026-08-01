import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createDomainStore } from '@/lib/agent/domain-store'
import type { TargetJob } from '@/lib/agent/requirement-matrix'
import type { JobPosting, JobRecommendation, JobSearchProfile, JobSource } from './job-domain'
import {
  JobPromotionError,
  completeJobPromotion,
  createJobPromotionIntent,
  resolveJobPromotion
} from './job-promotion'

const now = '2026-08-01T08:00:00.000Z'
const source: JobSource = { id: 'source-1', kind: 'lever', label: 'Example', sourceKey: 'example', enabled: true, createdAt: now, updatedAt: now }
const profile: JobSearchProfile = { id: 'profile-1', name: 'Roles', titles: ['Engineer'], adjacentTitles: [], locations: [], excludedLocations: [], workplaceTypes: [], employmentTypes: [], requiredTerms: [], preferredTerms: [], excludedTerms: [], maximumAgeDays: 30, createdAt: now, updatedAt: now }
const posting: JobPosting = { id: 'posting-1', sourceId: source.id, externalId: '1', canonicalUrl: 'https://jobs.lever.co/example/1', applyUrl: 'https://jobs.lever.co/example/1/apply', title: 'Engineer', company: 'Example', description: 'Build systems.', locale: 'en', firstSeenAt: now, lastCheckedAt: now, status: 'open', contentHash: 'hash:one' }
const recommendation: JobRecommendation = { id: 'recommendation-1', postingId: posting.id, searchProfileId: profile.id, sourceDraftId: 'draft-1', rubricVersion: 'resume-os-job-relevance-v1', inputFingerprint: 'fingerprint:one', eligibility: 'eligible', preliminaryScore: 80, decision: 'new', reasons: [], createdAt: now, updatedAt: now }
const target: TargetJob = { id: 'target-1', title: posting.title, company: posting.company, description: posting.description, locale: 'en', createdAt: now, updatedAt: now }

async function seededStore() {
  const store = createDomainStore({ databaseName: `promotion-${crypto.randomUUID()}`, indexedDB: new IDBFactory() })
  await store.put('jobSources', source)
  await store.put('jobSearchProfiles', profile)
  await store.put('jobPostings', posting)
  await store.put('jobRecommendations', recommendation)
  return store
}

describe('job promotion', () => {
  it('resolves only for the trusted source draft and preserves closed-job warnings', async () => {
    const store = await seededStore()
    const intent = createJobPromotionIntent({ posting, recommendation, sourceDraftId: 'draft-1', now })
    expect(await resolveJobPromotion({ store, intent, activeDraft: { id: 'draft-1', source: 'paste' } })).toMatchObject({ closed: false, posting })
    await expect(resolveJobPromotion({ store, intent, activeDraft: { id: 'other', source: 'paste' } })).rejects.toMatchObject({ code: 'WRONG_DRAFT' })
    await expect(resolveJobPromotion({ store, intent, activeDraft: { id: 'draft-1', source: 'sample' } })).rejects.toBeInstanceOf(JobPromotionError)
  })

  it('rejects changed posting or recommendation fingerprints', async () => {
    const store = await seededStore()
    const intent = createJobPromotionIntent({ posting, recommendation, sourceDraftId: 'draft-1', now })
    await store.put('jobPostings', { ...posting, contentHash: 'hash:changed' })
    await expect(resolveJobPromotion({ store, intent, activeDraft: { id: 'draft-1', source: 'upload' } })).rejects.toMatchObject({ code: 'STALE_POSTING' })
  })

  it('links recommendation and application idempotently after the target is persisted', async () => {
    const store = await seededStore()
    await store.put('targetJobs', target)
    const intent = createJobPromotionIntent({ posting, recommendation, sourceDraftId: 'draft-1', now })
    const first = await completeJobPromotion({ store, intent, targetJobId: target.id, now })
    const second = await completeJobPromotion({ store, intent, targetJobId: target.id, now })
    expect(second).toEqual(first)
    expect((await store.get('jobRecommendations', recommendation.id))?.analyzedTargetJobId).toBe(target.id)
    expect(await store.list('applicationRecords')).toEqual([first])
    expect(first).toMatchObject({ status: 'analyzing', targetJobId: target.id })
  })
})
