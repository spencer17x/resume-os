import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildJDRequirementAnalysis, jdRequirementAnalysisSchema } from './jd-report'
import { reviseRequirementMatrix } from './agent-workflow'
import { createDomainStore } from './domain-store'
import { transitionOptimizationRun } from './optimization-run'
import { parseModelResumeChangeSet } from './resume-change-set'
import { createResumeVariant } from './resume-variant'
import { scoreRequirementMatrix } from './requirement-matrix'
import {
  ACTIVE_WORKFLOW_CHANGED_EVENT,
  ACTIVE_WORKFLOW_STORAGE_KEY,
  approveOptimizationPlan,
  clearActiveWorkflowPreference,
  discardOptimizationChangeSet,
  fingerprintOptimizationInputs,
  fingerprintWorkflowContext,
  loadActiveWorkflowSummary,
  persistAnalysisAsOptimizationRun,
  persistAcceptedResumeVariant,
  persistOptimizationChangeSet,
  persistRequirementRevision,
  persistOptimizationPlan,
  persistRunInputChange,
  readActiveWorkflowPreference,
  saveActiveWorkflowPreference
} from './workflow-persistence'
import { normalizeResumeData } from '@/lib/resume-model'

const now = '2026-07-16T08:00:00.000Z'
const resume = normalizeResumeData({
  profile: { name: 'Ada Candidate', title: 'Engineer', summary: [], tags: [], links: [] },
  metadata: { source: 'paste', locale: 'en', updatedAt: now }
})
const extractedAnalysis = buildJDRequirementAnalysis({
  report: {
    jobTitle: 'Platform Lead',
    company: '',
    requirements: [{
      text: 'Lead platform work', category: 'responsibility',
      priority: 'must', weight: 5, keywords: ['platform']
    }],
    resumeEmphasis: [],
    interviewPrep: []
  },
  jobDescription: 'Lead platform work',
  locale: 'en',
  resume,
  timestamp: now
})
const confirmedMatrix = extractedAnalysis.matrix.requirements.reduce(
  (matrix, requirement) => reviseRequirementMatrix(matrix, requirement.id, {
    userConfirmed: true
  }),
  extractedAnalysis.matrix
)
const analysis = jdRequirementAnalysisSchema.parse({
  ...extractedAnalysis,
  matrix: confirmedMatrix,
  score: scoreRequirementMatrix(confirmedMatrix)
})

beforeEach(() => window.localStorage.clear())

describe('workflow persistence', () => {
  it('does not persist an Agent run from unconfirmed extracted requirements', async () => {
    const store = createDomainStore({
      databaseName: `workflow-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })

    await expect(persistAnalysisAsOptimizationRun({
      store,
      analysis: extractedAnalysis,
      sourceDraftId: 'draft-1',
      runId: 'run-unconfirmed',
      locale: 'en',
      now
    })).rejects.toThrow(/must be confirmed/i)
    await expect(store.list('optimizationRuns')).resolves.toEqual([])
    await store.close()
  })

  it('atomically saves a target, requirements, matches, and resumable run', async () => {
    const store = createDomainStore({
      databaseName: `workflow-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    const result = await persistAnalysisAsOptimizationRun({
      store,
      analysis,
      sourceDraftId: 'draft-1',
      runId: 'run-1',
      locale: 'en',
      now
    })

    expect(result.run.stage).toBe('awaiting-answers')
    expect(await store.get('targetJobs', analysis.targetJob.id)).toEqual(analysis.targetJob)
    expect(await store.list('jobRequirements')).toEqual(result.matrix.requirements)
    expect(await store.list('requirementMatches')).toEqual(result.matrix.matches)
    expect(await store.get('optimizationRuns', 'run-1')).toEqual(result.run)
    await store.close()
  })

  it('persists only small active IDs and resolves their IndexedDB records', async () => {
    const store = createDomainStore({
      databaseName: `workflow-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    await persistAnalysisAsOptimizationRun({
      store,
      analysis,
      sourceDraftId: 'draft-1',
      runId: 'run-1',
      locale: 'en',
      now
    })
    const listener = vi.fn()
    window.addEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, listener)
    saveActiveWorkflowPreference({
      targetJobId: analysis.targetJob.id,
      optimizationRunId: 'run-1'
    })

    expect(JSON.parse(window.localStorage.getItem(ACTIVE_WORKFLOW_STORAGE_KEY) ?? '')).toEqual({
      targetJobId: analysis.targetJob.id,
      optimizationRunId: 'run-1'
    })
    await expect(loadActiveWorkflowSummary({ store })).resolves.toMatchObject({
      targetJob: { id: analysis.targetJob.id },
      run: { id: 'run-1', stage: 'awaiting-answers' }
    })
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, listener)
    await store.close()
  })

  it('rejects corrupt preferences and supports an explicit clear', () => {
    window.localStorage.setItem(ACTIVE_WORKFLOW_STORAGE_KEY, '{not-json')
    expect(readActiveWorkflowPreference()).toBeNull()

    saveActiveWorkflowPreference({ targetJobId: 'job-1', optimizationRunId: 'run-1' })
    clearActiveWorkflowPreference()
    expect(readActiveWorkflowPreference()).toBeNull()
  })

  it('marks the saved run stale when a confirmed requirement changes', async () => {
    const store = createDomainStore({
      databaseName: `workflow-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    const workflow = await persistAnalysisAsOptimizationRun({
      store,
      analysis,
      sourceDraftId: 'draft-1',
      runId: 'run-1',
      locale: 'en',
      now
    })
    const requirement = { ...workflow.matrix.requirements[0], userConfirmed: true, weight: 4 }
    const stale = await persistRequirementRevision({
      store,
      optimizationRunId: 'run-1',
      requirement,
      currentFingerprint: 'revision:changed',
      now: '2026-07-16T08:01:00.000Z'
    })

    expect(await store.get('jobRequirements', requirement.id)).toEqual(requirement)
    expect(stale).toMatchObject({
      stage: 'stale',
      staleBecauseFingerprint: 'revision:changed'
    })
    await store.close()
  })

  it('reuses a user-confirmed requirement correction in a later run for the same target job', async () => {
    const store = createDomainStore({
      databaseName: `workflow-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    const first = await persistAnalysisAsOptimizationRun({
      store, analysis, sourceDraftId: 'draft-1', runId: 'run-1', locale: 'en', now
    })
    const corrected = {
      ...first.matrix.requirements[0],
      text: 'Lead a production platform program',
      priority: 'preferred' as const,
      weight: 3,
      keywords: ['production', 'platform'],
      userConfirmed: true
    }
    await persistRequirementRevision({
      store,
      optimizationRunId: 'run-1',
      requirement: corrected,
      currentFingerprint: 'revision:user-confirmed',
      now: '2026-07-16T08:01:00.000Z'
    })

    const second = await persistAnalysisAsOptimizationRun({
      store,
      analysis,
      sourceDraftId: 'draft-1',
      runId: 'run-2',
      locale: 'en',
      now: '2026-07-16T09:00:00.000Z'
    })

    expect(second.matrix.requirements[0]).toEqual(corrected)
    expect(second.matrix.inputFingerprint).not.toBe(analysis.matrix.inputFingerprint)
    expect(await store.get('jobRequirements', corrected.id)).toEqual(corrected)
    await store.close()
  })

  it('marks an active run stale when its resume or JD context changes', async () => {
    const store = createDomainStore({
      databaseName: `workflow-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    await persistAnalysisAsOptimizationRun({
      store,
      analysis,
      sourceDraftId: 'draft-1',
      runId: 'run-1',
      locale: 'en',
      now
    })
    const fingerprint = fingerprintWorkflowContext('changed JD and resume')
    const stale = await persistRunInputChange({
      store,
      optimizationRunId: 'run-1',
      currentFingerprint: fingerprint,
      now: '2026-07-16T08:01:00.000Z'
    })

    expect(stale).toMatchObject({ stage: 'stale', staleBecauseFingerprint: fingerprint })
    await store.close()
  })

  it('fingerprints semantic optimization inputs across reloads and detects unrelated resume edits', () => {
    const input = {
      sourceDraftId: 'draft-1',
      resume,
      targetJob: analysis.targetJob,
      requirements: analysis.matrix.requirements,
      requirementMatches: analysis.matrix.matches,
      careerFacts: []
    }
    const original = fingerprintOptimizationInputs(input)
    const reloaded = fingerprintOptimizationInputs({
      ...input,
      resume: {
        ...resume,
        metadata: { ...resume.metadata, updatedAt: '2026-07-16T09:00:00.000Z' }
      }
    })
    const edited = fingerprintOptimizationInputs({
      ...input,
      resume: {
        ...resume,
        languages: ['French']
      }
    })

    expect(reloaded).toBe(original)
    expect(edited).not.toBe(original)
  })

  it('persists a reviewable plan and requires a separate approval transition', async () => {
    const store = createDomainStore({
      databaseName: `workflow-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory()
    })
    const workflow = await persistAnalysisAsOptimizationRun({
      store,
      analysis,
      sourceDraftId: 'draft-1',
      runId: 'run-1',
      locale: 'en',
      now
    })
    const question = workflow.run.questions[0]
    const evidenceMapped = transitionOptimizationRun(workflow.run, {
      type: 'complete-answers',
      requirementMatches: workflow.run.requirementMatches,
      questions: [{ ...question, status: 'gap-confirmed', factIds: [] }]
    }, '2026-07-16T08:01:00.000Z')
    await store.put('optimizationRuns', evidenceMapped)
    const plan = {
      id: 'plan-1',
      summary: 'Remove unsupported emphasis from this target-job variant.',
      items: [{
        id: 'plan-item-1',
        requirementIds: [workflow.matrix.requirements[0].id],
        factIds: [],
        intent: 'Avoid claiming experience that the user confirmed is a gap.',
        transformation: 'remove' as const
      }]
    }

    const awaiting = await persistOptimizationPlan({
      store,
      optimizationRunId: 'run-1',
      plan,
      now: '2026-07-16T08:02:00.000Z'
    })
    expect(awaiting).toMatchObject({ stage: 'awaiting-plan-approval', plan })
    expect(awaiting.plan?.approvedAt).toBeUndefined()

    const approved = await approveOptimizationPlan({
      store,
      optimizationRunId: 'run-1',
      now: '2026-07-16T08:03:00.000Z'
    })
    expect(approved.stage).toBe('generating-changes')
    expect(approved.plan?.approvedAt).toBe('2026-07-16T08:03:00.000Z')
    await store.close()
  })

  it('refuses to persist generated changes until the plan has been explicitly approved', async () => {
    const harness = await changePersistenceHarness(false)

    await expect(persistOptimizationChangeSet({
      store: harness.store,
      optimizationRunId: 'run-1',
      changeSet: harness.changeSet,
      currentFingerprint: harness.changeFingerprint,
      now: '2026-07-16T08:04:00.000Z'
    })).rejects.toThrow()
    const unchanged = await harness.store.get('optimizationRuns', 'run-1')
    expect(unchanged?.stage).toBe('awaiting-plan-approval')
    expect(unchanged?.changeSet).toBeUndefined()
    await harness.store.close()
  })

  it('writes the approved change set back to the run, then atomically saves a subset variant and completes the run', async () => {
    const harness = await changePersistenceHarness(true)
    const awaitingChanges = await persistOptimizationChangeSet({
      store: harness.store,
      optimizationRunId: 'run-1',
      changeSet: harness.changeSet,
      currentFingerprint: harness.changeFingerprint,
      now: '2026-07-16T08:04:00.000Z'
    })
    expect(awaitingChanges).toMatchObject({
      stage: 'awaiting-change-approval',
      changeSet: harness.changeSet
    })

    const masterBefore = structuredClone(harness.masterResume)
    const variant = createResumeVariant({
      id: 'variant-1', sourceDraftId: 'draft-1', targetJobId: analysis.targetJob.id,
      name: 'Ada · Platform Lead', resume: harness.masterResume,
      changeSet: harness.changeSet, acceptedIds: ['change-1'],
      facts: [harness.fact], requirements: harness.matrix.requirements,
      now: '2026-07-16T08:05:00.000Z'
    })
    const applied = await persistAcceptedResumeVariant({
      store: harness.store,
      optimizationRunId: 'run-1',
      variant,
      acceptedChangeIds: ['change-1'],
      currentFingerprint: harness.changeFingerprint,
      scoreAfter: scoreRequirementMatrix(harness.matrix),
      now: '2026-07-16T08:05:00.000Z'
    })

    expect(applied).toMatchObject({
      stage: 'applied', acceptedChangeIds: ['change-1'], appliedVariantId: 'variant-1'
    })
    expect(await harness.store.get('resumeVariants', 'variant-1')).toEqual(variant)
    expect(await harness.store.get('optimizationRuns', 'run-1')).toEqual(applied)
    expect(harness.masterResume).toEqual(masterBefore)
    await harness.store.close()
  })

  it('persists discarded suggestions so they do not return after a reload', async () => {
    const harness = await changePersistenceHarness(true)
    await persistOptimizationChangeSet({
      store: harness.store,
      optimizationRunId: 'run-1',
      changeSet: harness.changeSet,
      currentFingerprint: harness.changeFingerprint,
      now: '2026-07-16T08:04:00.000Z'
    })

    const discarded = await discardOptimizationChangeSet({
      store: harness.store,
      optimizationRunId: 'run-1',
      now: '2026-07-16T08:04:30.000Z'
    })

    expect(discarded.stage).toBe('generating-changes')
    expect(discarded.changeSet).toBeUndefined()
    await expect(harness.store.get('optimizationRuns', 'run-1')).resolves.toEqual(discarded)
    await harness.store.close()
  })

  it('does not leave a variant behind when the atomic completion transition fails', async () => {
    const harness = await changePersistenceHarness(true)
    await persistOptimizationChangeSet({
      store: harness.store,
      optimizationRunId: 'run-1',
      changeSet: harness.changeSet,
      currentFingerprint: harness.changeFingerprint,
      now: '2026-07-16T08:04:00.000Z'
    })
    const variant = createResumeVariant({
      id: 'variant-rollback', sourceDraftId: 'draft-1', targetJobId: analysis.targetJob.id,
      name: 'Rollback candidate', resume: harness.masterResume,
      changeSet: harness.changeSet, acceptedIds: ['change-1'],
      facts: [harness.fact], requirements: harness.matrix.requirements,
      now: '2026-07-16T08:05:00.000Z'
    })

    await expect(persistAcceptedResumeVariant({
      store: harness.store,
      optimizationRunId: 'run-1',
      variant,
      acceptedChangeIds: ['unknown-change'],
      currentFingerprint: harness.changeFingerprint,
      scoreAfter: scoreRequirementMatrix(harness.matrix),
      now: '2026-07-16T08:05:00.000Z'
    })).rejects.toThrow()
    await expect(harness.store.get('resumeVariants', variant.id)).resolves.toBeUndefined()
    const unchanged = await harness.store.get('optimizationRuns', 'run-1')
    expect(unchanged?.stage).toBe('awaiting-change-approval')
    expect(unchanged?.appliedVariantId).toBeUndefined()
    await harness.store.close()
  })
})

async function changePersistenceHarness(approvePlan: boolean) {
  const store = createDomainStore({
    databaseName: `workflow-change-${crypto.randomUUID()}`,
    indexedDB: new IDBFactory()
  })
  const workflow = await persistAnalysisAsOptimizationRun({
    store, analysis, sourceDraftId: 'draft-1', runId: 'run-1', locale: 'en', now
  })
  const requirement = workflow.matrix.requirements[0]
  const question = workflow.run.questions[0]
  const fact = {
    id: 'fact-1', kind: 'experience' as const,
    text: 'Led a reliable platform migration.', evidenceRefs: ['source-1'],
    verification: 'user-confirmed' as const, tags: ['platform'],
    createdAt: now, updatedAt: now
  }
  await store.put('evidenceSources', {
    id: 'source-1', type: 'user-answer', label: 'Confirmed answer', createdAt: now
  })
  await store.put('careerFacts', fact)
  const match = {
    requirementId: requirement.id, factIds: [fact.id], status: 'direct' as const,
    rationale: 'The user-confirmed fact directly supports this requirement.'
  }
  const matrix = { ...workflow.matrix, matches: [match] }
  const evidenceMapped = transitionOptimizationRun(workflow.run, {
    type: 'answer-question', questionId: question.id, resolution: 'answered',
    factIds: [fact.id], matchStatus: 'direct', rationale: match.rationale,
    scoreBefore: scoreRequirementMatrix(matrix)
  }, '2026-07-16T08:01:00.000Z')
  await store.put('requirementMatches', match)
  await store.put('optimizationRuns', evidenceMapped)
  const plan = {
    id: 'plan-1', summary: 'Emphasize the confirmed migration evidence.',
    items: [{
      id: 'item-1', requirementIds: [requirement.id], factIds: [fact.id],
      intent: 'Make the migration evidence easy to find.', transformation: 'emphasize' as const
    }]
  }
  await persistOptimizationPlan({
    store, optimizationRunId: 'run-1', plan, now: '2026-07-16T08:02:00.000Z'
  })
  if (approvePlan) {
    await approveOptimizationPlan({
      store, optimizationRunId: 'run-1', now: '2026-07-16T08:03:00.000Z'
    })
  }
  const changeSet = parseModelResumeChangeSet({
    summary: 'Emphasize verified platform work.',
    changes: [{
      id: 'change-1', path: 'profile.summary.0', original: 'Builds systems',
      proposed: 'Led a reliable platform migration.', reason: 'Follows the approved plan',
      needsConfirmation: true,
      evidence: {
        requirementIds: [requirement.id], factIds: [fact.id], matchType: 'direct',
        support: 'user-confirmed', confidence: 0.95, transformation: 'emphasize'
      }
    }], questions: []
  })
  const masterResume = normalizeResumeData({
    profile: { name: 'Ada Candidate', title: 'Engineer', summary: ['Builds systems'] },
    metadata: { source: 'paste', locale: 'en', updatedAt: now }
  })
  return {
    store, fact, matrix, changeSet, masterResume,
    changeFingerprint: 'change-context-1'
  }
}
