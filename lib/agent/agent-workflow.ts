import {
  parseRequirementMatrix,
  requirementMatrixSchema,
  scoreRequirementMatrix,
  type RequirementMatch,
  type RequirementMatrix
} from './requirement-matrix'
import {
  createOptimizationRun,
  transitionOptimizationRun,
  type OptimizationRun
} from './optimization-run'

export type StartOptimizationWorkflowInput = {
  id: string
  sourceDraftId: string
  matrix: RequirementMatrix
  locale: 'zh' | 'en'
  now: string
}

export type ResolveWorkflowQuestionInput = {
  run: OptimizationRun
  matrix: RequirementMatrix
  questionId: string
  resolution:
    | { type: 'fact'; factIds: string[]; status: 'direct' | 'partial'; rationale: string }
    | { type: 'gap'; rationale: string }
  now: string
}

export type RequirementRevision = Partial<Pick<
  RequirementMatrix['requirements'][number],
  'text' | 'category' | 'priority' | 'weight' | 'keywords' | 'userConfirmed'
>>

export function startOptimizationWorkflow(
  input: StartOptimizationWorkflowInput
): { run: OptimizationRun; matrix: RequirementMatrix } {
  const sourceMatrix = parseRequirementMatrix(input.matrix)
  if (sourceMatrix.requirements.some((requirement) => !requirement.userConfirmed)) {
    throw new TypeError('Every job requirement must be confirmed before starting an optimization run.')
  }
  const matches = completeMatches(sourceMatrix, input.locale)
  const matrix = requirementMatrixSchema.parse({ ...sourceMatrix, matches })
  const questions = matrix.requirements
    .filter((requirement) => matches.find((match) => match.requirementId === requirement.id)?.status === 'gap')
    .map((requirement) => ({
      id: `question-${requirement.id}`,
      requirementId: requirement.id,
      prompt: input.locale === 'zh'
        ? `你是否有可验证的职业事实支持这项要求：${requirement.text}`
        : `Do you have a verifiable career fact for this requirement: ${requirement.text}`,
      status: 'open' as const,
      factIds: []
    }))

  let run = createOptimizationRun({
    id: input.id,
    sourceDraftId: input.sourceDraftId,
    targetJobId: matrix.targetJobId,
    inputFingerprint: matrix.inputFingerprint,
    now: input.now
  })
  run = transitionOptimizationRun(run, { type: 'requirements-ready' }, input.now)
  run = transitionOptimizationRun(run, {
    type: 'map-evidence',
    requirementMatches: matches,
    questions,
    scoreBefore: scoreRequirementMatrix(matrix)
  }, input.now)

  return { run, matrix }
}

export function resolveWorkflowQuestion(
  input: ResolveWorkflowQuestionInput
): { run: OptimizationRun; matrix: RequirementMatrix } {
  const matrix = parseRequirementMatrix(input.matrix)
  if (
    matrix.targetJobId !== input.run.targetJobId
    || matrix.inputFingerprint !== input.run.inputFingerprint
  ) {
    throw new TypeError('The requirement matrix does not belong to this optimization run.')
  }
  const question = input.run.questions.find((item) => item.id === input.questionId)
  if (!question) throw new TypeError('The workflow question does not exist.')

  const match: RequirementMatch = input.resolution.type === 'fact'
    ? {
        requirementId: question.requirementId,
        factIds: input.resolution.factIds,
        status: input.resolution.status,
        rationale: input.resolution.rationale
      }
    : {
        requirementId: question.requirementId,
        factIds: [],
        status: 'gap',
        rationale: input.resolution.rationale
      }
  const matches = matrix.matches.map((item) => item.requirementId === match.requirementId
    ? match
    : item)
  if (!matches.some((item) => item.requirementId === match.requirementId)) matches.push(match)
  const nextMatrix = requirementMatrixSchema.parse({ ...matrix, matches })
  const run = transitionOptimizationRun(input.run, {
    type: 'answer-question',
    questionId: input.questionId,
    resolution: input.resolution.type === 'fact' ? 'answered' : 'gap-confirmed',
    factIds: match.factIds,
    matchStatus: match.status,
    rationale: match.rationale,
    scoreBefore: scoreRequirementMatrix(nextMatrix)
  }, input.now)

  return { run, matrix: nextMatrix }
}

export function reviseRequirementMatrix(
  input: RequirementMatrix,
  requirementId: string,
  revision: RequirementRevision
): RequirementMatrix {
  const matrix = parseRequirementMatrix(input)
  let found = false
  const requirements = matrix.requirements.map((requirement) => {
    if (requirement.id !== requirementId) return requirement
    found = true
    return { ...requirement, ...revision, userConfirmed: true }
  })
  if (!found) throw new TypeError('The requirement does not exist in this matrix.')

  return requirementMatrixSchema.parse({
    ...matrix,
    inputFingerprint: `revision:${stableTextHash(JSON.stringify({
      targetJobId: matrix.targetJobId,
      requirements: [...requirements].sort((left, right) => compareStrings(left.id, right.id)),
      matches: [...matrix.matches].sort((left, right) => compareStrings(left.requirementId, right.requirementId))
    }))}`,
    requirements
  })
}

function completeMatches(matrix: RequirementMatrix, locale: 'zh' | 'en') {
  const existing = new Map(matrix.matches.map((match) => [match.requirementId, match]))
  return matrix.requirements.map((requirement) => existing.get(requirement.id) ?? {
    requirementId: requirement.id,
    factIds: [],
    status: 'gap' as const,
    rationale: locale === 'zh'
      ? '尚未关联经过验证的职业事实。'
      : 'No verified career fact has been linked yet.'
  })
}

function stableTextHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}
