import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createDomainStore } from '@/lib/agent/domain-store'
import { createOptimizationRun, transitionOptimizationRun } from '@/lib/agent/optimization-run'
import { scoreRequirementMatrix } from '@/lib/agent/requirement-matrix'
import { fingerprintOptimizationInputs } from '@/lib/agent/workflow-persistence'
import { normalizeResumeData } from '@/lib/resume-model'
import type { ApplicationRecord } from './job-domain'
import {
  ApplicationRecordError,
  loadApplicationPacket,
  markApplicationApplied,
  prepareApplicationPacket,
  transitionApplicationRecord
} from './application-record'

const now = '2026-08-01T08:00:00.000Z'
const later = '2026-08-01T09:00:00.000Z'
const resume = normalizeResumeData({
  profile: { name: 'Ada', title: 'Engineer', summary: ['Builds systems.'], tags: [], links: [] },
  metadata: { source: 'paste', locale: 'en', updatedAt: now }
})

function baseRecord(): ApplicationRecord {
  return {
    id: 'application-1', postingId: 'posting-1', sourceDraftId: 'draft-1', status: 'saved',
    notes: '', createdAt: now, updatedAt: now
  }
}

async function readyHarness() {
  const store = createDomainStore({ databaseName: `application-${crypto.randomUUID()}`, indexedDB: new IDBFactory() })
  const source = { id: 'source-1', kind: 'greenhouse' as const, label: 'Example', sourceKey: 'example', enabled: true, createdAt: now, updatedAt: now }
  const profile = { id: 'profile-1', name: 'Roles', titles: ['Engineer'], adjacentTitles: [], locations: [], excludedLocations: [], workplaceTypes: [], employmentTypes: [], requiredTerms: [], preferredTerms: [], excludedTerms: [], maximumAgeDays: 30, createdAt: now, updatedAt: now }
  const posting = { id: 'posting-1', sourceId: source.id, externalId: '1', canonicalUrl: 'https://boards.greenhouse.io/example/jobs/1', applyUrl: 'https://boards.greenhouse.io/example/jobs/1', title: 'Engineer', company: 'Example', description: 'Build reliable systems.', locale: 'en' as const, firstSeenAt: now, lastCheckedAt: now, status: 'open' as const, contentHash: 'hash:posting' }
  const target = { id: 'target-1', title: posting.title, company: posting.company, description: posting.description, locale: 'en' as const, createdAt: now, updatedAt: now }
  const requirement = { id: 'requirement-1', jobId: target.id, text: 'Build reliable systems', category: 'experience' as const, priority: 'must' as const, weight: 5, keywords: ['reliable'], userConfirmed: true }
  const match = { requirementId: requirement.id, factIds: ['fact-1'], status: 'direct' as const, rationale: 'Verified experience.' }
  const fact = { id: 'fact-1', kind: 'experience' as const, text: 'Built reliable systems.', evidenceRefs: ['evidence-1'], verification: 'user-confirmed' as const, tags: ['reliable'], createdAt: now, updatedAt: now }
  const workflowFingerprint = fingerprintOptimizationInputs({ sourceDraftId: 'draft-1', resume, targetJob: target, requirements: [requirement], requirementMatches: [match], careerFacts: [fact] })
  const score = scoreRequirementMatrix({ version: 1, targetJobId: target.id, inputFingerprint: 'matrix:fingerprint', requirements: [requirement], matches: [match] })
  let run = createOptimizationRun({ id: 'run-1', sourceDraftId: 'draft-1', targetJobId: target.id, inputFingerprint: 'matrix:fingerprint', now })
  run = transitionOptimizationRun(run, { type: 'requirements-ready' }, now)
  run = transitionOptimizationRun(run, { type: 'map-evidence', requirementMatches: [match], questions: [], scoreBefore: score }, now)
  run = transitionOptimizationRun(run, { type: 'prepare-plan', plan: { id: 'plan-1', summary: 'Emphasize verified evidence.', items: [{ id: 'item-1', requirementIds: [requirement.id], factIds: [fact.id], targetPath: 'profile.summary.0', intent: 'Clarify evidence.', transformation: 'emphasize' }] } }, now)
  run = transitionOptimizationRun(run, { type: 'request-plan-approval' }, now)
  run = transitionOptimizationRun(run, { type: 'approve-plan' }, now)
  run = transitionOptimizationRun(run, { type: 'propose-changes', currentFingerprint: workflowFingerprint, changeSet: { summary: 'Clarify.', questions: [], changes: [{ id: 'change-1', path: 'profile.summary.0', original: 'Builds systems.', proposed: 'Builds reliable systems.', reason: 'Approved evidence.', needsConfirmation: false, evidence: { requirementIds: [requirement.id], factIds: [fact.id], matchType: 'direct', support: 'verified', confidence: 0.9, transformation: 'emphasize' } }] } }, now)
  run = transitionOptimizationRun(run, { type: 'approve-changes', acceptedChangeIds: ['change-1'] }, now)
  run = transitionOptimizationRun(run, { type: 'apply', currentFingerprint: workflowFingerprint, appliedVariantId: 'variant-1', scoreAfter: score }, now)
  const variant = { id: 'variant-1', sourceDraftId: 'draft-1', targetJobId: target.id, name: 'Ada · Engineer', data: resume, createdAt: now, updatedAt: now }
  const recommendation = { id: 'recommendation-1', postingId: posting.id, searchProfileId: profile.id, sourceDraftId: 'draft-1', rubricVersion: 'resume-os-job-relevance-v1', inputFingerprint: 'recommendation:fingerprint', eligibility: 'eligible' as const, preliminaryScore: 90, decision: 'saved' as const, reasons: [], analyzedTargetJobId: target.id, createdAt: now, updatedAt: now }
  const application: ApplicationRecord = { ...baseRecord(), targetJobId: target.id, postingContentHash: posting.contentHash, recommendationFingerprint: recommendation.inputFingerprint, status: 'analyzing' }
  await store.put('evidenceSources', { id: 'evidence-1', type: 'user-answer', label: 'Synthetic evidence', excerpt: 'Built reliable systems.', createdAt: now })
  await store.put('careerFacts', fact)
  await store.put('targetJobs', target)
  await store.put('jobRequirements', requirement)
  await store.put('requirementMatches', match)
  await store.put('resumeVariants', variant)
  await store.put('optimizationRuns', run)
  await store.put('jobSources', source)
  await store.put('jobSearchProfiles', profile)
  await store.put('jobPostings', posting)
  await store.put('jobRecommendations', recommendation)
  await store.put('applicationRecords', application)
  return { store, posting, application, workflowFingerprint }
}

describe('application records', () => {
  it('uses an explicit deterministic transition table and submission event', () => {
    const preparing = transitionApplicationRecord({ record: baseRecord(), status: 'preparing', now: later })
    const ready = transitionApplicationRecord({ record: preparing, status: 'ready-to-apply', now: later })
    expect(() => transitionApplicationRecord({ record: ready, status: 'applied', now: later })).toThrow(ApplicationRecordError)
    expect(transitionApplicationRecord({ record: ready, status: 'applied', now: later, explicitSubmission: true })).toMatchObject({ status: 'applied', submittedAt: later })
    expect(() => transitionApplicationRecord({ record: baseRecord(), status: 'applied', now: later, explicitSubmission: true })).toThrow(ApplicationRecordError)
  })

  it('becomes ready only for a current posting, applied run, related variant, and current evidence inputs', async () => {
    const { store, application, workflowFingerprint } = await readyHarness()
    const prepared = await prepareApplicationPacket({ store, recordId: application.id, resume, now: later })
    expect(prepared.ready).toBe(true)
    expect(prepared.record).toMatchObject({ status: 'ready-to-apply', resumeVariantId: 'variant-1', workflowInputFingerprint: workflowFingerprint })
    const applied = await markApplicationApplied({ store, recordId: application.id, resume, now: later })
    expect(applied).toMatchObject({ status: 'applied', submittedAt: later })
  })

  it('invalidates packet readiness when the posting changes without deleting history', async () => {
    const { store, posting, application } = await readyHarness()
    await store.put('jobPostings', { ...posting, contentHash: 'hash:changed' })
    const packet = await loadApplicationPacket({ store, recordId: application.id, resume })
    expect(packet.ready).toBe(false)
    expect(packet.checks.find((check) => check.code === 'posting-current')?.passed).toBe(false)
    await expect(prepareApplicationPacket({ store, recordId: application.id, resume, now: later })).rejects.toMatchObject({ code: 'PACKET_NOT_READY' })
    expect(await store.get('applicationRecords', application.id)).toMatchObject({ status: 'preparing' })
  })
})
