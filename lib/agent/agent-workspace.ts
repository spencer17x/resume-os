import {
  careerFactSchema,
  evidenceSourceSchema,
  type CareerFact,
  type IndexedDbDomainStore
} from './domain-store'
import {
  resolveWorkflowQuestion
} from './agent-workflow'
import {
  requirementMatrixSchema,
  type RequirementMatrix
} from './requirement-matrix'
import {
  loadActiveWorkflowSummary,
  type ActiveWorkflowSummary
} from './workflow-persistence'

export type AgentWorkspace = {
  summary: ActiveWorkflowSummary
  matrix: RequirementMatrix
  facts: CareerFact[]
}

export type ResolveAgentQuestionResult = {
  workspace: AgentWorkspace
  createdFact?: CareerFact
}

export async function loadActiveAgentWorkspace(input: {
  store: IndexedDbDomainStore
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
}): Promise<AgentWorkspace | null> {
  const summary = await loadActiveWorkflowSummary(input)
  if (!summary) return null
  const requirementIds = new Set(
    summary.run.requirementMatches.map((match) => match.requirementId)
  )
  const [allRequirements, facts] = await Promise.all([
    input.store.list('jobRequirements'),
    input.store.list('careerFacts')
  ])
  const requirements = allRequirements
    .filter((requirement) => requirementIds.has(requirement.id))
    .sort((left, right) => compareStrings(left.id, right.id))
  if (requirements.length !== requirementIds.size) {
    throw new TypeError('The active Agent run has missing job requirements.')
  }
  const matrix = requirementMatrixSchema.parse({
    version: 1,
    targetJobId: summary.run.targetJobId,
    inputFingerprint: summary.run.inputFingerprint,
    requirements,
    matches: summary.run.requirementMatches
  })

  return {
    summary,
    matrix,
    facts: [...facts].sort((left, right) => compareStrings(left.id, right.id))
  }
}

export async function resolveAgentQuestionWithFact(input: {
  store: IndexedDbDomainStore
  workspace: AgentWorkspace
  questionId: string
  factId: string
  status: 'direct' | 'partial'
  rationale: string
  now: string
}): Promise<ResolveAgentQuestionResult> {
  const result = await input.store.transaction(
    ['careerFacts', 'requirementMatches', 'optimizationRuns'],
    'readwrite',
    async (transaction) => {
      const [fact, run] = await Promise.all([
        transaction.get('careerFacts', input.factId),
        transaction.get('optimizationRuns', input.workspace.summary.run.id)
      ])
      if (!fact) throw new TypeError('The selected career fact does not exist.')
      if (!run) throw new TypeError('The optimization run does not exist.')
      const confirmedFact = fact.verification === 'imported'
        ? careerFactSchema.parse({
            ...fact,
            verification: 'user-confirmed',
            updatedAt: input.now
          })
        : fact
      const resolved = resolveWorkflowQuestion({
        run,
        matrix: matrixForLatestRun(input.workspace.matrix, run),
        questionId: input.questionId,
        resolution: {
          type: 'fact',
          factIds: [confirmedFact.id],
          status: input.status,
          rationale: input.rationale
        },
        now: input.now
      })
      if (confirmedFact !== fact) await transaction.put('careerFacts', confirmedFact)
      const match = resolved.matrix.matches.find((item) => (
        item.requirementId === resolved.run.questions.find((question) => question.id === input.questionId)?.requirementId
      ))
      if (!match) throw new TypeError('The resolved requirement match is missing.')
      await transaction.put('requirementMatches', match)
      await transaction.put('optimizationRuns', resolved.run)
      return {
        ...resolved,
        facts: (await transaction.list('careerFacts')).sort(compareById),
        confirmedFact,
        factWasConfirmed: confirmedFact !== fact
      }
    }
  )

  return {
    workspace: withResolvedWorkflow(input.workspace, result.run, result.matrix, result.facts),
    ...(result.factWasConfirmed ? { createdFact: result.confirmedFact } : {})
  }
}

export async function resolveAgentQuestionWithNewFact(input: {
  store: IndexedDbDomainStore
  workspace: AgentWorkspace
  questionId: string
  factId: string
  evidenceSourceId: string
  text: string
  kind: CareerFact['kind']
  status: 'direct' | 'partial'
  rationale: string
  now: string
}): Promise<ResolveAgentQuestionResult> {
  const result = await input.store.transaction(
    ['evidenceSources', 'careerFacts', 'requirementMatches', 'optimizationRuns'],
    'readwrite',
    async (transaction) => {
      const run = await transaction.get('optimizationRuns', input.workspace.summary.run.id)
      if (!run) throw new TypeError('The optimization run does not exist.')
      const question = run.questions.find((item) => item.id === input.questionId)
      if (!question) throw new TypeError('The Agent question does not exist.')
      const source = evidenceSourceSchema.parse({
        id: input.evidenceSourceId,
        type: 'user-answer',
        label: 'Agent evidence answer',
        excerpt: input.text,
        createdAt: input.now
      })
      const fact = careerFactSchema.parse({
        id: input.factId,
        kind: input.kind,
        text: input.text,
        evidenceRefs: [source.id],
        verification: 'user-confirmed',
        tags: ['agent-answer', question.requirementId],
        createdAt: input.now,
        updatedAt: input.now
      })
      const resolved = resolveWorkflowQuestion({
        run,
        matrix: matrixForLatestRun(input.workspace.matrix, run),
        questionId: input.questionId,
        resolution: {
          type: 'fact',
          factIds: [fact.id],
          status: input.status,
          rationale: input.rationale
        },
        now: input.now
      })
      const match = resolved.matrix.matches.find(
        (item) => item.requirementId === question.requirementId
      )
      if (!match) throw new TypeError('The resolved requirement match is missing.')
      await transaction.put('evidenceSources', source)
      await transaction.put('careerFacts', fact)
      await transaction.put('requirementMatches', match)
      await transaction.put('optimizationRuns', resolved.run)
      return {
        ...resolved,
        fact,
        facts: (await transaction.list('careerFacts')).sort(compareById)
      }
    }
  )

  return {
    workspace: withResolvedWorkflow(input.workspace, result.run, result.matrix, result.facts),
    createdFact: result.fact
  }
}

export async function confirmAgentQuestionGap(input: {
  store: IndexedDbDomainStore
  workspace: AgentWorkspace
  questionId: string
  rationale: string
  now: string
}): Promise<ResolveAgentQuestionResult> {
  const result = await input.store.transaction(
    ['careerFacts', 'requirementMatches', 'optimizationRuns'],
    'readwrite',
    async (transaction) => {
      const run = await transaction.get('optimizationRuns', input.workspace.summary.run.id)
      if (!run) throw new TypeError('The optimization run does not exist.')
      const question = run.questions.find((item) => item.id === input.questionId)
      if (!question) throw new TypeError('The Agent question does not exist.')
      const resolved = resolveWorkflowQuestion({
        run,
        matrix: matrixForLatestRun(input.workspace.matrix, run),
        questionId: input.questionId,
        resolution: { type: 'gap', rationale: input.rationale },
        now: input.now
      })
      const match = resolved.matrix.matches.find(
        (item) => item.requirementId === question.requirementId
      )
      if (!match) throw new TypeError('The resolved requirement match is missing.')
      await transaction.put('requirementMatches', match)
      await transaction.put('optimizationRuns', resolved.run)
      return {
        ...resolved,
        facts: (await transaction.list('careerFacts')).sort(compareById)
      }
    }
  )

  return {
    workspace: withResolvedWorkflow(input.workspace, result.run, result.matrix, result.facts)
  }
}

function matrixForLatestRun(matrix: RequirementMatrix, run: AgentWorkspace['summary']['run']) {
  return requirementMatrixSchema.parse({
    ...matrix,
    targetJobId: run.targetJobId,
    inputFingerprint: run.inputFingerprint,
    matches: run.requirementMatches
  })
}

function withResolvedWorkflow(
  workspace: AgentWorkspace,
  run: AgentWorkspace['summary']['run'],
  matrix: RequirementMatrix,
  facts: CareerFact[]
): AgentWorkspace {
  return {
    summary: { ...workspace.summary, run },
    matrix,
    facts
  }
}

function compareById(left: { id: string }, right: { id: string }) {
  return compareStrings(left.id, right.id)
}

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}
