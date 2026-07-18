import { z } from 'zod'

export const REQUIREMENT_MATRIX_VERSION = 1 as const
export const REQUIREMENT_SCORE_VERSION = 1 as const
export const REQUIREMENT_SCORING_RUBRIC_VERSION = 'resume-os-alignment-v1' as const
export const MAX_REQUIREMENT_WEIGHT = 10
export const MAX_JOB_REQUIREMENTS = 250

export const jobRequirementCategorySchema = z.enum([
  'skill',
  'experience',
  'domain',
  'education',
  'responsibility'
])

export const jobRequirementPrioritySchema = z.enum(['must', 'preferred', 'signal'])
export const requirementMatchStatusSchema = z.enum(['direct', 'partial', 'gap'])

const stableIdSchema = z.string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim(), 'ID must not contain surrounding whitespace')

const inputFingerprintSchema = z.string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), 'Fingerprint must not contain surrounding whitespace')

const isoTimestampSchema = z.iso.datetime({ offset: true })
const boundedTextSchema = z.string().trim().min(1).max(2_000)

export const targetJobSchema = z.object({
  id: stableIdSchema,
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().min(1).max(100_000),
  locale: z.enum(['zh', 'en']),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema
}).strict()

export const jobRequirementSchema = z.object({
  id: stableIdSchema,
  jobId: stableIdSchema,
  text: boundedTextSchema,
  category: jobRequirementCategorySchema,
  priority: jobRequirementPrioritySchema,
  weight: z.number().finite().gt(0).max(MAX_REQUIREMENT_WEIGHT),
  keywords: z.array(z.string().trim().min(1).max(120)).max(50),
  userConfirmed: z.boolean()
}).strict()

export const requirementMatchSchema = z.object({
  requirementId: stableIdSchema,
  factIds: z.array(stableIdSchema).max(100),
  status: requirementMatchStatusSchema,
  rationale: boundedTextSchema
}).strict().superRefine((match, context) => {
  addDuplicateIssues(match.factIds, context, ['factIds'], 'Fact IDs must be unique')
  if (match.status === 'gap' && match.factIds.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['factIds'],
      message: 'A gap cannot cite supporting facts'
    })
  }
  if (match.status !== 'gap' && match.factIds.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['factIds'],
      message: 'Direct and partial matches require supporting facts'
    })
  }
})

export const requirementMatrixSchema = z.object({
  version: z.literal(REQUIREMENT_MATRIX_VERSION),
  targetJobId: stableIdSchema,
  inputFingerprint: inputFingerprintSchema,
  requirements: z.array(jobRequirementSchema).min(1).max(MAX_JOB_REQUIREMENTS),
  matches: z.array(requirementMatchSchema).max(MAX_JOB_REQUIREMENTS)
}).strict().superRefine((matrix, context) => {
  const requirementIds = new Set<string>()

  matrix.requirements.forEach((requirement, index) => {
    if (requirementIds.has(requirement.id)) {
      context.addIssue({
        code: 'custom',
        path: ['requirements', index, 'id'],
        message: 'Requirement IDs must be unique'
      })
    }
    requirementIds.add(requirement.id)

    if (requirement.jobId !== matrix.targetJobId) {
      context.addIssue({
        code: 'custom',
        path: ['requirements', index, 'jobId'],
        message: 'Requirement must belong to the target job'
      })
    }
  })

  const matchedRequirementIds = new Set<string>()
  matrix.matches.forEach((match, index) => {
    if (matchedRequirementIds.has(match.requirementId)) {
      context.addIssue({
        code: 'custom',
        path: ['matches', index, 'requirementId'],
        message: 'Each requirement may have at most one match'
      })
    }
    matchedRequirementIds.add(match.requirementId)

    if (!requirementIds.has(match.requirementId)) {
      context.addIssue({
        code: 'custom',
        path: ['matches', index, 'requirementId'],
        message: 'Match must reference a requirement in this matrix'
      })
    }
  })
})

const finitePercentageSchema = z.number().finite().min(0).max(100)

export const requirementScoreContributionSchema = z.object({
  requirementId: stableIdSchema,
  category: jobRequirementCategorySchema,
  priority: jobRequirementPrioritySchema,
  weight: z.number().finite().gt(0).max(MAX_REQUIREMENT_WEIGHT),
  status: requirementMatchStatusSchema,
  matchFactor: z.union([z.literal(1), z.literal(0.5), z.literal(0)]),
  weightedCoverage: z.number().finite().nonnegative(),
  evidenceFactor: z.union([z.literal(1), z.literal(0)]),
  weightedEvidence: z.number().finite().nonnegative(),
  evidenceRefs: z.array(stableIdSchema).max(100)
}).strict()

export const requirementScoreResultSchema = z.object({
  version: z.literal(REQUIREMENT_SCORE_VERSION),
  rubricVersion: z.literal(REQUIREMENT_SCORING_RUBRIC_VERSION),
  targetJobId: stableIdSchema,
  inputFingerprint: inputFingerprintSchema,
  totalWeight: z.number().finite().positive(),
  requirementCoverage: finitePercentageSchema,
  evidenceCompleteness: finitePercentageSchema,
  contributions: z.array(requirementScoreContributionSchema).min(1).max(MAX_JOB_REQUIREMENTS)
}).strict()

export const scoreResultSchema = requirementScoreResultSchema

export type TargetJob = z.infer<typeof targetJobSchema>
export type JobRequirement = z.infer<typeof jobRequirementSchema>
export type RequirementMatch = z.infer<typeof requirementMatchSchema>
export type RequirementMatrix = z.infer<typeof requirementMatrixSchema>
export type RequirementScoreContribution = z.infer<typeof requirementScoreContributionSchema>
export type RequirementScoreResult = z.infer<typeof requirementScoreResultSchema>
export type ScoreResult = RequirementScoreResult

export const REQUIREMENT_MATCH_FACTORS = {
  direct: 1,
  partial: 0.5,
  gap: 0
} as const satisfies Record<RequirementMatch['status'], 0 | 0.5 | 1>

export function parseRequirementMatrix(input: unknown): RequirementMatrix {
  return requirementMatrixSchema.parse(input)
}

export function scoreRequirementMatrix(input: unknown): ScoreResult {
  const matrix = parseRequirementMatrix(input)
  const matches = new Map(matrix.matches.map((match) => [match.requirementId, match]))
  const requirements = [...matrix.requirements].sort((left, right) => compareStrings(left.id, right.id))

  const scoredRequirements = requirements.map((requirement) => {
    const match = matches.get(requirement.id)
    const status = match?.status ?? 'gap'
    const matchFactor = REQUIREMENT_MATCH_FACTORS[status]
    const evidenceRefs = [...(match?.factIds ?? [])].sort(compareStrings)
    const evidenceFactor = evidenceRefs.length > 0 ? 1 : 0

    return {
      contribution: {
        requirementId: requirement.id,
        category: requirement.category,
        priority: requirement.priority,
        weight: requirement.weight,
        status,
        matchFactor,
        weightedCoverage: requirement.weight * matchFactor,
        evidenceFactor,
        weightedEvidence: requirement.weight * evidenceFactor,
        evidenceRefs
      } satisfies RequirementScoreContribution,
      coverageWeight: requirement.weight * matchFactor,
      evidenceWeight: requirement.weight * evidenceFactor
    }
  })

  const contributions = scoredRequirements.map(({ contribution }) => contribution)
  const totalWeight = requirements.reduce((total, requirement) => total + requirement.weight, 0)
  const coverageWeight = scoredRequirements.reduce((total, item) => total + item.coverageWeight, 0)
  const evidenceWeight = scoredRequirements.reduce((total, item) => total + item.evidenceWeight, 0)

  return requirementScoreResultSchema.parse({
    version: REQUIREMENT_SCORE_VERSION,
    rubricVersion: REQUIREMENT_SCORING_RUBRIC_VERSION,
    targetJobId: matrix.targetJobId,
    inputFingerprint: matrix.inputFingerprint,
    totalWeight,
    requirementCoverage: roundPercentage(coverageWeight, totalWeight),
    evidenceCompleteness: roundPercentage(evidenceWeight, totalWeight),
    contributions
  })
}

function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
) {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({ code: 'custom', path: [...path, index], message })
    }
    seen.add(value)
  })
}

function compareStrings(left: string, right: string) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function roundPercentage(numerator: number, denominator: number) {
  const value = (numerator / denominator) * 100
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000
}
