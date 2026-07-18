import {
  createDomainStore,
  type CareerFact,
  type DomainStoreTransaction,
  type IndexedDbDomainStore,
  type ResumeVariant
} from './domain-store'
import {
  jdRequirementAnalysisSchema,
  type JDRequirementAnalysis
} from './jd-report'
import { startOptimizationWorkflow } from './agent-workflow'
import {
  transitionOptimizationRun,
  type OptimizationPlan,
  type OptimizationRun
} from './optimization-run'
import type { ResumeChangeSet } from './resume-change-set'
import type {
  JobRequirement,
  RequirementMatrix,
  RequirementMatch,
  ScoreResult,
  TargetJob
} from './requirement-matrix'
import { requirementMatrixSchema } from './requirement-matrix'
import type { ResumeData } from '@/lib/resume-model'

export const ACTIVE_WORKFLOW_STORAGE_KEY = 'resume-os-active-workflow-v1'
export const ACTIVE_WORKFLOW_CHANGED_EVENT = 'resume-os-active-workflow-changed'

export type ActiveWorkflowPreference = {
  targetJobId: string
  optimizationRunId: string
}

export type ActiveWorkflowSummary = {
  preference: ActiveWorkflowPreference
  targetJob: TargetJob
  run: OptimizationRun
}

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export async function persistAnalysisAsOptimizationRun(input: {
  store: IndexedDbDomainStore
  analysis: JDRequirementAnalysis
  sourceDraftId: string
  runId: string
  locale: 'zh' | 'en'
  now: string
}): Promise<{ run: OptimizationRun; matrix: RequirementMatrix }> {
  const analysis = jdRequirementAnalysisSchema.parse(input.analysis)
  const existingRequirements = await input.store.list('jobRequirements')
  const confirmedRequirements = new Map(
    existingRequirements
      .filter((requirement) => requirement.userConfirmed)
      .map((requirement) => [requirement.id, requirement])
  )
  const requirements = analysis.matrix.requirements.map((requirement) => {
    const confirmed = confirmedRequirements.get(requirement.id)
    return confirmed?.jobId === analysis.targetJob.id ? confirmed : requirement
  })
  const hasPreservedCorrection = requirements.some(
    (requirement, index) => requirement !== analysis.matrix.requirements[index]
  )
  const matrix = hasPreservedCorrection
    ? requirementMatrixSchema.parse({
        ...analysis.matrix,
        inputFingerprint: fingerprintWorkflowContext(JSON.stringify({
          extracted: analysis.matrix.inputFingerprint,
          confirmedRequirements: requirements
        })),
        requirements
      })
    : analysis.matrix
  const workflow = startOptimizationWorkflow({
    id: input.runId,
    sourceDraftId: input.sourceDraftId,
    matrix,
    locale: input.locale,
    now: input.now
  })

  await input.store.transaction(
    ['targetJobs', 'jobRequirements', 'requirementMatches', 'optimizationRuns'],
    'readwrite',
    async (transaction) => {
      await transaction.put('targetJobs', analysis.targetJob)
      for (const requirement of workflow.matrix.requirements) {
        await transaction.put('jobRequirements', requirement)
      }
      for (const match of workflow.matrix.matches) {
        await transaction.put('requirementMatches', match)
      }
      await transaction.put('optimizationRuns', workflow.run)
    }
  )

  return workflow
}

export function readActiveWorkflowPreference(
  storage: BrowserStorage | null = browserStorage()
): ActiveWorkflowPreference | null {
  if (!storage) return null
  try {
    const value = JSON.parse(storage.getItem(ACTIVE_WORKFLOW_STORAGE_KEY) ?? 'null') as unknown
    if (!isActiveWorkflowPreference(value)) return null
    return value
  } catch {
    return null
  }
}

export function saveActiveWorkflowPreference(
  preference: ActiveWorkflowPreference,
  storage: BrowserStorage | null = browserStorage()
) {
  if (!isActiveWorkflowPreference(preference)) {
    throw new TypeError('Active workflow preference is invalid.')
  }
  storage?.setItem(ACTIVE_WORKFLOW_STORAGE_KEY, JSON.stringify(preference))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ACTIVE_WORKFLOW_CHANGED_EVENT, { detail: preference }))
  }
}

export function clearActiveWorkflowPreference(
  storage: BrowserStorage | null = browserStorage()
) {
  storage?.removeItem(ACTIVE_WORKFLOW_STORAGE_KEY)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACTIVE_WORKFLOW_CHANGED_EVENT))
}

export async function loadActiveWorkflowSummary(input: {
  store?: IndexedDbDomainStore
  storage?: BrowserStorage | null
} = {}): Promise<ActiveWorkflowSummary | null> {
  const preference = readActiveWorkflowPreference(input.storage)
  if (!preference) return null
  const store = input.store ?? createDomainStore()
  const [targetJob, run] = await Promise.all([
    store.get('targetJobs', preference.targetJobId),
    store.get('optimizationRuns', preference.optimizationRunId)
  ])
  if (!targetJob || !run || run.targetJobId !== targetJob.id) return null
  return { preference, targetJob, run }
}

export async function persistRequirementRevision(input: {
  store: IndexedDbDomainStore
  optimizationRunId: string
  requirement: JobRequirement
  currentFingerprint: string
  now: string
}): Promise<OptimizationRun> {
  return input.store.transaction(
    ['jobRequirements', 'optimizationRuns'],
    'readwrite',
    async (transaction) => {
      const run = await transaction.get('optimizationRuns', input.optimizationRunId)
      if (!run) throw new TypeError('The optimization run does not exist.')
      if (input.requirement.jobId !== run.targetJobId) {
        throw new TypeError('The requirement does not belong to this optimization run.')
      }
      await transaction.put('jobRequirements', input.requirement)
      const stale = markRunForFingerprint(run, input.currentFingerprint, input.now)
      if (stale !== run) await transaction.put('optimizationRuns', stale)
      return stale
    }
  )
}

export async function persistRunInputChange(input: {
  store: IndexedDbDomainStore
  optimizationRunId: string
  currentFingerprint: string
  now: string
}): Promise<OptimizationRun | null> {
  return input.store.transaction(
    ['optimizationRuns'],
    'readwrite',
    async (transaction) => {
      const run = await transaction.get('optimizationRuns', input.optimizationRunId)
      if (!run) return null
      const stale = markRunForFingerprint(run, input.currentFingerprint, input.now)
      if (stale !== run) await transaction.put('optimizationRuns', stale)
      return stale
    }
  )
}

export async function persistOptimizationPlan(input: {
  store: IndexedDbDomainStore
  optimizationRunId: string
  plan: OptimizationPlan
  now: string
}): Promise<OptimizationRun> {
  return input.store.transaction(
    ['optimizationRuns'],
    'readwrite',
    async (transaction) => {
      const run = await transaction.get('optimizationRuns', input.optimizationRunId)
      if (!run) throw new TypeError('The optimization run does not exist.')
      const ready = transitionOptimizationRun(run, {
        type: 'prepare-plan',
        plan: input.plan
      }, input.now)
      const awaitingApproval = transitionOptimizationRun(ready, {
        type: 'request-plan-approval'
      }, input.now)
      await transaction.put('optimizationRuns', awaitingApproval)
      return awaitingApproval
    }
  )
}

export async function approveOptimizationPlan(input: {
  store: IndexedDbDomainStore
  optimizationRunId: string
  now: string
}): Promise<OptimizationRun> {
  return input.store.transaction(
    ['optimizationRuns'],
    'readwrite',
    async (transaction) => {
      const run = await transaction.get('optimizationRuns', input.optimizationRunId)
      if (!run) throw new TypeError('The optimization run does not exist.')
      const approved = transitionOptimizationRun(run, { type: 'approve-plan' }, input.now)
      await transaction.put('optimizationRuns', approved)
      return approved
    }
  )
}

export async function persistOptimizationChangeSet(input: {
  store: IndexedDbDomainStore
  optimizationRunId: string
  changeSet: ResumeChangeSet
  currentFingerprint: string
  now: string
}): Promise<OptimizationRun> {
  return input.store.transaction(
    ['optimizationRuns'],
    'readwrite',
    async (transaction) => {
      const run = await transaction.get('optimizationRuns', input.optimizationRunId)
      if (!run) throw new TypeError('The optimization run does not exist.')
      const awaitingApproval = transitionOptimizationRun(run, {
        type: 'propose-changes',
        changeSet: input.changeSet,
        currentFingerprint: input.currentFingerprint
      }, input.now)
      await transaction.put('optimizationRuns', awaitingApproval)
      return awaitingApproval
    }
  )
}

export async function discardOptimizationChangeSet(input: {
  store: IndexedDbDomainStore
  optimizationRunId: string
  now: string
}): Promise<OptimizationRun> {
  return input.store.transaction(
    ['optimizationRuns'],
    'readwrite',
    async (transaction) => {
      const run = await transaction.get('optimizationRuns', input.optimizationRunId)
      if (!run) throw new TypeError('The optimization run does not exist.')
      const generatingChanges = transitionOptimizationRun(run, {
        type: 'discard-changes'
      }, input.now)
      await transaction.put('optimizationRuns', generatingChanges)
      return generatingChanges
    }
  )
}

export async function persistAcceptedResumeVariant(input: {
  store: IndexedDbDomainStore
  optimizationRunId: string
  variant: ResumeVariant
  acceptedChangeIds: string[]
  currentFingerprint: string
  scoreAfter: ScoreResult
  now: string
}): Promise<OptimizationRun> {
  return input.store.transaction(
    ['resumeVariants', 'optimizationRuns'],
    'readwrite',
    async (transaction) => {
      const run = await transaction.get('optimizationRuns', input.optimizationRunId)
      if (!run) throw new TypeError('The optimization run does not exist.')
      if (
        input.variant.sourceDraftId !== run.sourceDraftId
        || input.variant.targetJobId !== run.targetJobId
      ) {
        throw new TypeError('The resume variant does not belong to this optimization run.')
      }
      const validated = transitionOptimizationRun(run, {
        type: 'approve-changes',
        acceptedChangeIds: input.acceptedChangeIds
      }, input.now)
      const applied = transitionOptimizationRun(validated, {
        type: 'apply',
        currentFingerprint: input.currentFingerprint,
        appliedVariantId: input.variant.id,
        scoreAfter: input.scoreAfter
      }, input.now)

      await transaction.put('resumeVariants', input.variant)
      await transaction.put('optimizationRuns', applied)
      return applied
    }
  )
}

export function fingerprintWorkflowContext(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `context:${(hash >>> 0).toString(36)}`
}

export function fingerprintOptimizationInputs(input: {
  sourceDraftId: string
  resume: ResumeData
  targetJob: TargetJob
  requirements: readonly JobRequirement[]
  requirementMatches: readonly RequirementMatch[]
  careerFacts: readonly CareerFact[]
}) {
  const { updatedAt: _updatedAt, ...stableMetadata } = input.resume.metadata
  return fingerprintWorkflowContext(JSON.stringify({
    sourceDraftId: input.sourceDraftId,
    resume: { ...input.resume, metadata: stableMetadata },
    targetJob: input.targetJob,
    requirements: [...input.requirements]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((requirement) => ({
        ...requirement,
        keywords: [...requirement.keywords].sort()
      })),
    requirementMatches: [...input.requirementMatches]
      .sort((left, right) => left.requirementId.localeCompare(right.requirementId))
      .map((match) => ({ ...match, factIds: [...match.factIds].sort() })),
    careerFacts: [...input.careerFacts]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((fact) => ({
        ...fact,
        evidenceRefs: [...fact.evidenceRefs].sort(),
        tags: [...fact.tags].sort()
      }))
  }))
}

function isActiveWorkflowPreference(value: unknown): value is ActiveWorkflowPreference {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ActiveWorkflowPreference>
  return isStableId(candidate.targetJobId) && isStableId(candidate.optimizationRunId)
}

function markRunForFingerprint(
  run: OptimizationRun,
  currentFingerprint: string,
  now: string
) {
  if (['applied', 'stale', 'failed', 'abandoned'].includes(run.stage)) return run
  return transitionOptimizationRun(run, {
    type: 'observe-input',
    currentFingerprint
  }, now)
}

function isStableId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 160
    && value === value.trim()
}

function browserStorage(): BrowserStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export type { DomainStoreTransaction }
