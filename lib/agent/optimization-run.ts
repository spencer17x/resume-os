import { z } from 'zod'
import {
  requirementMatchSchema,
  requirementScoreResultSchema,
  type RequirementMatch,
  type ScoreResult
} from './requirement-matrix'
import {
  modelResumeChangeSetSchema,
  validateResumeChangesAgainstApprovedPlan,
  type ResumeChangeSet
} from './resume-change-set'

export const OPTIMIZATION_RUN_VERSION = 1 as const

export const AGENT_STAGES = [
  'draft',
  'requirements-ready',
  'evidence-mapped',
  'awaiting-answers',
  'plan-ready',
  'awaiting-plan-approval',
  'generating-changes',
  'awaiting-change-approval',
  'validated',
  'applied',
  'stale',
  'failed',
  'abandoned'
] as const

export const agentStageSchema = z.enum(AGENT_STAGES)
export type AgentStage = z.infer<typeof agentStageSchema>

const stableIdSchema = z.string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim(), 'ID must not contain surrounding whitespace')

const fingerprintSchema = z.string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), 'Fingerprint must not contain surrounding whitespace')

const timestampSchema = z.iso.datetime({ offset: true })
const boundedTextSchema = z.string().trim().min(1).max(2_000)

export const agentQuestionSchema = z.object({
  id: stableIdSchema,
  requirementId: stableIdSchema,
  prompt: z.string().trim().min(1).max(1_000),
  status: z.enum(['open', 'answered', 'gap-confirmed']),
  factIds: z.array(stableIdSchema).max(100).default([])
}).strict().superRefine((question, context) => {
  addDuplicateIssues(question.factIds, context, ['factIds'], 'Fact IDs must be unique')
  if (question.status === 'answered' && question.factIds.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['factIds'],
      message: 'An answered question must link at least one fact'
    })
  }
  if (question.status === 'gap-confirmed' && question.factIds.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['factIds'],
      message: 'A confirmed gap cannot link supporting facts'
    })
  }
})

export const optimizationPlanItemSchema = z.object({
  id: stableIdSchema,
  requirementIds: z.array(stableIdSchema).min(1).max(100),
  factIds: z.array(stableIdSchema).max(100),
  intent: boundedTextSchema,
  transformation: z.enum(['rewrite', 'emphasize', 'remove', 'reorder', 'add-from-fact'])
}).strict().superRefine((item, context) => {
  addDuplicateIssues(item.requirementIds, context, ['requirementIds'], 'Requirement IDs must be unique')
  addDuplicateIssues(item.factIds, context, ['factIds'], 'Fact IDs must be unique')
  if (item.transformation === 'add-from-fact' && item.factIds.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['factIds'],
      message: 'Adding content requires at least one supporting fact'
    })
  }
})

export const optimizationPlanSchema = z.object({
  id: stableIdSchema,
  summary: boundedTextSchema,
  items: z.array(optimizationPlanItemSchema).min(1).max(100),
  approvedAt: timestampSchema.optional()
}).strict().superRefine((plan, context) => {
  addDuplicateIssues(plan.items.map((item) => item.id), context, ['items'], 'Plan item IDs must be unique')
})

export const optimizationRunSchema = z.object({
  version: z.literal(OPTIMIZATION_RUN_VERSION),
  id: stableIdSchema,
  sourceDraftId: stableIdSchema,
  targetJobId: stableIdSchema,
  stage: agentStageSchema,
  inputFingerprint: fingerprintSchema,
  requirementMatches: z.array(requirementMatchSchema).max(250),
  questions: z.array(agentQuestionSchema).max(100),
  plan: optimizationPlanSchema.optional(),
  changeSet: modelResumeChangeSetSchema.optional(),
  changeInputFingerprint: fingerprintSchema.optional(),
  acceptedChangeIds: z.array(stableIdSchema).max(50).optional(),
  scoreBefore: requirementScoreResultSchema.optional(),
  scoreAfter: requirementScoreResultSchema.optional(),
  appliedVariantId: stableIdSchema.optional(),
  staleBecauseFingerprint: fingerprintSchema.optional(),
  failureMessage: z.string().trim().min(1).max(1_000).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((run, context) => {
  addDuplicateIssues(
    run.requirementMatches.map((match) => match.requirementId),
    context,
    ['requirementMatches'],
    'Requirement matches must be unique'
  )
  addDuplicateIssues(run.questions.map((question) => question.id), context, ['questions'], 'Question IDs must be unique')
  addDuplicateIssues(run.acceptedChangeIds ?? [], context, ['acceptedChangeIds'], 'Accepted change IDs must be unique')

  const stagesRequiringPlan: AgentStage[] = [
    'plan-ready',
    'awaiting-plan-approval',
    'generating-changes',
    'awaiting-change-approval',
    'validated',
    'applied'
  ]
  const stagesRequiringApprovedPlan: AgentStage[] = [
    'generating-changes',
    'awaiting-change-approval',
    'validated',
    'applied'
  ]
  const stagesRequiringChanges: AgentStage[] = [
    'awaiting-change-approval',
    'validated',
    'applied'
  ]

  if (stagesRequiringPlan.includes(run.stage) && !run.plan) {
    context.addIssue({ code: 'custom', path: ['plan'], message: 'This stage requires an optimization plan' })
  }
  if (stagesRequiringApprovedPlan.includes(run.stage) && !run.plan?.approvedAt) {
    context.addIssue({ code: 'custom', path: ['plan', 'approvedAt'], message: 'This stage requires plan approval' })
  }
  if (stagesRequiringChanges.includes(run.stage) && !run.changeSet) {
    context.addIssue({ code: 'custom', path: ['changeSet'], message: 'This stage requires a change set' })
  }
  if (stagesRequiringChanges.includes(run.stage) && !run.changeInputFingerprint) {
    context.addIssue({
      code: 'custom', path: ['changeInputFingerprint'],
      message: 'This stage requires the exact change-generation input fingerprint'
    })
  }
  if (run.stage === 'awaiting-answers' && !run.questions.some((question) => question.status === 'open')) {
    context.addIssue({ code: 'custom', path: ['questions'], message: 'This stage requires an open question' })
  }
  if (['validated', 'applied'].includes(run.stage) && run.acceptedChangeIds === undefined) {
    context.addIssue({ code: 'custom', path: ['acceptedChangeIds'], message: 'Validated changes require an explicit decision' })
  }
  if (run.stage === 'applied' && (!run.appliedVariantId || !run.scoreAfter)) {
    context.addIssue({ code: 'custom', path: ['appliedVariantId'], message: 'Applied runs require a variant and final score' })
  }
  if (run.stage === 'stale' && !run.staleBecauseFingerprint) {
    context.addIssue({ code: 'custom', path: ['staleBecauseFingerprint'], message: 'Stale runs require the observed fingerprint' })
  }
  if (run.stage === 'failed' && !run.failureMessage) {
    context.addIssue({ code: 'custom', path: ['failureMessage'], message: 'Failed runs require a safe failure message' })
  }

  for (const [field, score] of [['scoreBefore', run.scoreBefore], ['scoreAfter', run.scoreAfter]] as const) {
    if (!score) continue
    if (score.targetJobId !== run.targetJobId || score.inputFingerprint !== run.inputFingerprint) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: 'Scores must belong to the run input'
      })
    }
  }
})

const optimizationRunEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('requirements-ready') }).strict(),
  z.object({
    type: z.literal('map-evidence'),
    requirementMatches: z.array(requirementMatchSchema).max(250),
    questions: z.array(agentQuestionSchema).max(100),
    scoreBefore: requirementScoreResultSchema
  }).strict(),
  z.object({
    type: z.literal('complete-answers'),
    requirementMatches: z.array(requirementMatchSchema).max(250),
    questions: z.array(agentQuestionSchema).max(100)
  }).strict(),
  z.object({
    type: z.literal('answer-question'),
    questionId: stableIdSchema,
    resolution: z.enum(['answered', 'gap-confirmed']),
    factIds: z.array(stableIdSchema).max(100),
    matchStatus: requirementMatchSchema.shape.status,
    rationale: boundedTextSchema,
    scoreBefore: requirementScoreResultSchema
  }).strict(),
  z.object({ type: z.literal('prepare-plan'), plan: optimizationPlanSchema }).strict(),
  z.object({ type: z.literal('request-plan-approval') }).strict(),
  z.object({ type: z.literal('approve-plan') }).strict(),
  z.object({
    type: z.literal('propose-changes'),
    changeSet: modelResumeChangeSetSchema,
    currentFingerprint: fingerprintSchema
  }).strict(),
  z.object({ type: z.literal('discard-changes') }).strict(),
  z.object({ type: z.literal('approve-changes'), acceptedChangeIds: z.array(stableIdSchema).max(50) }).strict(),
  z.object({
    type: z.literal('apply'),
    currentFingerprint: fingerprintSchema,
    appliedVariantId: stableIdSchema,
    scoreAfter: requirementScoreResultSchema
  }).strict(),
  z.object({ type: z.literal('observe-input'), currentFingerprint: fingerprintSchema }).strict(),
  z.object({ type: z.literal('fail'), message: z.string().trim().min(1).max(1_000) }).strict(),
  z.object({ type: z.literal('abandon') }).strict()
])

export type AgentQuestion = z.infer<typeof agentQuestionSchema>
export type OptimizationPlan = z.infer<typeof optimizationPlanSchema>
export type OptimizationRun = z.infer<typeof optimizationRunSchema>
export type OptimizationRunEvent = z.infer<typeof optimizationRunEventSchema>

export type CreateOptimizationRunInput = {
  id: string
  sourceDraftId: string
  targetJobId: string
  inputFingerprint: string
  now: string
}

export type OptimizationRunTransitionErrorCode =
  | 'INVALID_RUN'
  | 'INVALID_EVENT'
  | 'INVALID_TRANSITION'
  | 'UNRESOLVED_QUESTIONS'
  | 'INVALID_PLAN_REFERENCE'
  | 'INCONSISTENT_SCORE'
  | 'UNKNOWN_CHANGE'
  | 'FINGERPRINT_MISMATCH'

export class OptimizationRunTransitionError extends Error {
  constructor(readonly code: OptimizationRunTransitionErrorCode) {
    super(code)
    this.name = 'OptimizationRunTransitionError'
  }
}

export function createOptimizationRun(input: CreateOptimizationRunInput): OptimizationRun {
  try {
    return optimizationRunSchema.parse({
      version: OPTIMIZATION_RUN_VERSION,
      id: input.id,
      sourceDraftId: input.sourceDraftId,
      targetJobId: input.targetJobId,
      stage: 'draft',
      inputFingerprint: input.inputFingerprint,
      requirementMatches: [],
      questions: [],
      createdAt: input.now,
      updatedAt: input.now
    })
  } catch {
    throw new OptimizationRunTransitionError('INVALID_RUN')
  }
}

export function transitionOptimizationRun(
  runInput: unknown,
  eventInput: unknown,
  now: string
): OptimizationRun {
  const runResult = optimizationRunSchema.safeParse(runInput)
  if (!runResult.success) throw new OptimizationRunTransitionError('INVALID_RUN')
  const eventResult = optimizationRunEventSchema.safeParse(eventInput)
  if (!eventResult.success || !timestampSchema.safeParse(now).success) {
    throw new OptimizationRunTransitionError('INVALID_EVENT')
  }

  const run = runResult.data
  const event = eventResult.data
  let next: OptimizationRun

  switch (event.type) {
    case 'requirements-ready':
      requireStage(run, ['draft'])
      next = { ...run, stage: 'requirements-ready', updatedAt: now }
      break
    case 'map-evidence':
      requireStage(run, ['requirements-ready'])
      assertScoreBelongsToRun(run, event.scoreBefore)
      assertScoreMatchesMappings(event.scoreBefore, event.requirementMatches)
      assertQuestionReferences(event.requirementMatches, event.questions)
      next = {
        ...run,
        stage: event.questions.some((question) => question.status === 'open')
          ? 'awaiting-answers'
          : 'evidence-mapped',
        requirementMatches: event.requirementMatches,
        questions: event.questions,
        scoreBefore: event.scoreBefore,
        updatedAt: now
      }
      break
    case 'complete-answers':
      requireStage(run, ['awaiting-answers'])
      if (event.questions.some((question) => question.status === 'open')) {
        throw new OptimizationRunTransitionError('UNRESOLVED_QUESTIONS')
      }
      assertQuestionReferences(event.requirementMatches, event.questions)
      next = {
        ...run,
        stage: 'evidence-mapped',
        requirementMatches: event.requirementMatches,
        questions: event.questions,
        updatedAt: now
      }
      break
    case 'answer-question': {
      requireStage(run, ['awaiting-answers'])
      const questionIndex = run.questions.findIndex((question) => question.id === event.questionId)
      if (questionIndex < 0 || run.questions[questionIndex].status !== 'open') {
        throw new OptimizationRunTransitionError('INVALID_EVENT')
      }
      if (
        event.resolution === 'answered'
          ? event.factIds.length === 0 || event.matchStatus === 'gap'
          : event.factIds.length > 0 || event.matchStatus !== 'gap'
      ) {
        throw new OptimizationRunTransitionError('INVALID_EVENT')
      }

      const question = run.questions[questionIndex]
      const matchIndex = run.requirementMatches.findIndex(
        (match) => match.requirementId === question.requirementId
      )
      if (matchIndex < 0) throw new OptimizationRunTransitionError('INVALID_EVENT')
      const questions = run.questions.map((item, index) => index === questionIndex
        ? {
            ...item,
            status: event.resolution,
            factIds: event.factIds
          }
        : item)
      const requirementMatches = run.requirementMatches.map((match, index) => index === matchIndex
        ? {
            ...match,
            factIds: event.factIds,
            status: event.matchStatus,
            rationale: event.rationale
          }
        : match)
      assertScoreBelongsToRun(run, event.scoreBefore)
      assertScoreMatchesMappings(event.scoreBefore, requirementMatches)
      next = {
        ...run,
        stage: questions.some((item) => item.status === 'open')
          ? 'awaiting-answers'
          : 'evidence-mapped',
        questions,
        requirementMatches,
        scoreBefore: event.scoreBefore,
        updatedAt: now
      }
      break
    }
    case 'prepare-plan':
      requireStage(run, ['evidence-mapped'])
      if (event.plan.approvedAt) throw new OptimizationRunTransitionError('INVALID_EVENT')
      assertPlanReferences(run, event.plan)
      next = { ...run, stage: 'plan-ready', plan: event.plan, updatedAt: now }
      break
    case 'request-plan-approval':
      requireStage(run, ['plan-ready'])
      next = { ...run, stage: 'awaiting-plan-approval', updatedAt: now }
      break
    case 'approve-plan':
      requireStage(run, ['awaiting-plan-approval'])
      next = {
        ...run,
        stage: 'generating-changes',
        plan: { ...run.plan!, approvedAt: now },
        updatedAt: now
      }
      break
    case 'propose-changes':
      requireStage(run, ['generating-changes'])
      assertChangesFollowPlan(run, event.changeSet)
      next = {
        ...run,
        stage: 'awaiting-change-approval',
        changeSet: event.changeSet,
        changeInputFingerprint: event.currentFingerprint,
        updatedAt: now
      }
      break
    case 'discard-changes':
      requireStage(run, ['awaiting-change-approval'])
      next = {
        ...run,
        stage: 'generating-changes',
        changeSet: undefined,
        changeInputFingerprint: undefined,
        acceptedChangeIds: undefined,
        updatedAt: now
      }
      break
    case 'approve-changes': {
      requireStage(run, ['awaiting-change-approval'])
      const changeIds = new Set(run.changeSet!.changes.map((change) => change.id))
      if (new Set(event.acceptedChangeIds).size !== event.acceptedChangeIds.length) {
        throw new OptimizationRunTransitionError('UNKNOWN_CHANGE')
      }
      if (event.acceptedChangeIds.some((id) => !changeIds.has(id))) {
        throw new OptimizationRunTransitionError('UNKNOWN_CHANGE')
      }
      next = { ...run, stage: 'validated', acceptedChangeIds: event.acceptedChangeIds, updatedAt: now }
      break
    }
    case 'apply':
      requireStage(run, ['validated'])
      if (event.currentFingerprint !== run.changeInputFingerprint) {
        throw new OptimizationRunTransitionError('FINGERPRINT_MISMATCH')
      }
      assertScoreBelongsToRun(run, event.scoreAfter)
      next = {
        ...run,
        stage: 'applied',
        appliedVariantId: event.appliedVariantId,
        scoreAfter: event.scoreAfter,
        updatedAt: now
      }
      break
    case 'observe-input':
      requireStage(run, ACTIVE_STAGES)
      if (event.currentFingerprint === (run.changeInputFingerprint ?? run.inputFingerprint)) {
        return run
      }
      next = {
        ...run,
        stage: 'stale',
        staleBecauseFingerprint: event.currentFingerprint,
        updatedAt: now
      }
      break
    case 'fail':
      requireStage(run, ACTIVE_STAGES)
      next = { ...run, stage: 'failed', failureMessage: event.message, updatedAt: now }
      break
    case 'abandon':
      requireStage(run, ACTIVE_STAGES)
      next = { ...run, stage: 'abandoned', updatedAt: now }
      break
  }

  const parsed = optimizationRunSchema.safeParse(next)
  if (!parsed.success) throw new OptimizationRunTransitionError('INVALID_RUN')
  return parsed.data
}

const ACTIVE_STAGES: AgentStage[] = AGENT_STAGES.filter(
  (stage): stage is AgentStage => !['applied', 'stale', 'failed', 'abandoned'].includes(stage)
)

function requireStage(run: OptimizationRun, allowed: readonly AgentStage[]) {
  if (!allowed.includes(run.stage)) throw new OptimizationRunTransitionError('INVALID_TRANSITION')
}

function assertScoreBelongsToRun(run: OptimizationRun, score: ScoreResult) {
  if (score.targetJobId !== run.targetJobId || score.inputFingerprint !== run.inputFingerprint) {
    throw new OptimizationRunTransitionError('FINGERPRINT_MISMATCH')
  }
}

function assertScoreMatchesMappings(score: ScoreResult, matches: readonly RequirementMatch[]) {
  const contributions = new Map(
    score.contributions.map((contribution) => [contribution.requirementId, contribution])
  )
  for (const match of matches) {
    const contribution = contributions.get(match.requirementId)
    const expectedFacts = [...match.factIds].sort(compareStrings)
    if (
      !contribution
      || contribution.status !== match.status
      || !sameStrings(contribution.evidenceRefs, expectedFacts)
    ) {
      throw new OptimizationRunTransitionError('INCONSISTENT_SCORE')
    }
  }
}

function assertQuestionReferences(
  matches: readonly RequirementMatch[],
  questions: readonly AgentQuestion[]
) {
  const requirementIds = new Set(matches.map((match) => match.requirementId))
  if (questions.some((question) => !requirementIds.has(question.requirementId))) {
    throw new OptimizationRunTransitionError('INVALID_EVENT')
  }
}

function assertPlanReferences(run: OptimizationRun, plan: OptimizationPlan) {
  const matches = new Map(run.requirementMatches.map((match) => [match.requirementId, match]))
  for (const item of plan.items) {
    if (item.requirementIds.some((id) => !matches.has(id))) {
      throw new OptimizationRunTransitionError('INVALID_PLAN_REFERENCE')
    }
    const linkedFacts = new Set(
      item.requirementIds.flatMap((requirementId) => matches.get(requirementId)?.factIds ?? [])
    )
    if (item.factIds.some((id) => !linkedFacts.has(id))) {
      throw new OptimizationRunTransitionError('INVALID_PLAN_REFERENCE')
    }
  }
}

function assertChangesFollowPlan(run: OptimizationRun, changeSet: ResumeChangeSet) {
  try {
    validateResumeChangesAgainstApprovedPlan(changeSet, run.plan!, run.requirementMatches)
  } catch {
    throw new OptimizationRunTransitionError('INVALID_PLAN_REFERENCE')
  }
}

function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
) {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value)) context.addIssue({ code: 'custom', path: [...path, index], message })
    seen.add(value)
  })
}

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export type {
  RequirementMatch,
  ResumeChangeSet,
  ScoreResult
}
