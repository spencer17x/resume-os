import { z } from 'zod'
import { careerFactSchema } from './domain-store'
import {
  OPTIMIZATION_RUN_VERSION,
  OptimizationRunTransitionError,
  SAFE_OPTIMIZATION_TRANSFORMATIONS,
  optimizationPlanSchema,
  transitionOptimizationRun,
  type OptimizationPlan,
  type OptimizationRun
} from './optimization-run'
import {
  jobRequirementSchema,
  MAX_JOB_REQUIREMENTS,
  requirementMatchSchema
} from './requirement-matrix'
import {
  resumeLocaleSchema,
  type ResumeData
} from '@/lib/resume-model'

export const MAX_OPTIMIZATION_PLAN_BODY_BYTES = 256_000
export const MAX_OPTIMIZATION_PLAN_OUTPUT_BYTES = 64_000
export const MAX_OPTIMIZATION_PLAN_FACTS = 500
export const MAX_OPTIMIZATION_PLAN_TARGETS = 500

const safeTransformationSchema = z.enum(SAFE_OPTIMIZATION_TRANSFORMATIONS)

const stableIdSchema = z.string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim(), 'ID must not contain surrounding whitespace')

export const optimizationPlanTargetSchema = z.object({
  path: z.string().trim().min(1).max(240),
  current: z.union([
    z.string().max(20_000),
    z.array(z.string().max(2_000)).max(100)
  ]),
  transformations: z.array(safeTransformationSchema).min(1).max(4)
}).strict().superRefine((target, context) => {
  const unique = new Set(target.transformations)
  if (unique.size !== target.transformations.length) {
    context.addIssue({
      code: 'custom',
      path: ['transformations'],
      message: 'Target transformations must be unique'
    })
  }
})

const contextFields = {
  sourceDraftId: stableIdSchema,
  targetJobId: stableIdSchema,
  requirements: z.array(jobRequirementSchema).min(1).max(MAX_JOB_REQUIREMENTS),
  requirementMatches: z.array(requirementMatchSchema).min(1).max(MAX_JOB_REQUIREMENTS),
  careerFacts: z.array(careerFactSchema).max(MAX_OPTIMIZATION_PLAN_FACTS),
  resumeTargets: z.array(optimizationPlanTargetSchema).min(1).max(MAX_OPTIMIZATION_PLAN_TARGETS)
} as const

export const optimizationPlanContextSchema = z.object(contextFields)
  .strict()
  .superRefine(validateContextReferences)

export const optimizationPlanRequestSchema = z.object({
  locale: resumeLocaleSchema,
  instruction: z.string().trim().min(1).max(4_000),
  ...contextFields
}).strict().superRefine(validateContextReferences)

export const OPTIMIZATION_PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'summary', 'items'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 160 },
    summary: { type: 'string', minLength: 1, maxLength: 2_000 },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'requirementIds', 'factIds', 'targetPath', 'intent', 'transformation'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 160 },
          requirementIds: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 160 }
          },
          factIds: {
            type: 'array',
            maxItems: 100,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 160 }
          },
          targetPath: { type: 'string', minLength: 1, maxLength: 240 },
          intent: { type: 'string', minLength: 1, maxLength: 2_000 },
          transformation: {
            type: 'string',
            enum: ['rewrite', 'emphasize', 'reorder', 'add-from-fact']
          }
        }
      }
    }
  }
} as const satisfies Record<string, unknown>

export type OptimizationPlanContext = z.infer<typeof optimizationPlanContextSchema>
export type OptimizationPlanRequest = z.infer<typeof optimizationPlanRequestSchema>
export type OptimizationPlanTarget = z.infer<typeof optimizationPlanTargetSchema>

export class OptimizationPlanPreparationError extends Error {
  constructor(readonly code: 'INVALID_CONTEXT' | 'INVALID_PLAN') {
    super(code)
    this.name = 'OptimizationPlanPreparationError'
  }
}

export function parseOptimizationPlanContext(input: unknown): OptimizationPlanContext {
  const result = optimizationPlanContextSchema.safeParse(input)
  if (!result.success) throw new OptimizationPlanPreparationError('INVALID_CONTEXT')
  return result.data
}

/**
 * Validates a model-authored plan against the exact request context by exercising
 * the same `prepare-plan` state transition used by persisted optimization runs.
 * No state is stored and the caller's values are not mutated.
 */
export function prepareOptimizationPlan(
  contextInput: unknown,
  planInput: unknown
): OptimizationPlan {
  const context = parseOptimizationPlanContext(contextInput)
  const planResult = optimizationPlanSchema.safeParse(planInput)
  if (!planResult.success) throw new OptimizationPlanPreparationError('INVALID_PLAN')
  if (
    new TextEncoder().encode(JSON.stringify(planResult.data)).byteLength
      > MAX_OPTIMIZATION_PLAN_OUTPUT_BYTES
  ) {
    throw new OptimizationPlanPreparationError('INVALID_PLAN')
  }
  const factsById = new Map(context.careerFacts.map((fact) => [fact.id, fact]))
  const targetsByPath = new Map(context.resumeTargets.map((target) => [target.path, target]))
  if (planResult.data.items.some((item) => item.transformation === 'remove')) {
    throw new OptimizationPlanPreparationError('INVALID_PLAN')
  }
  if (planResult.data.items.some((item) => {
    if (!item.targetPath) return true
    const target = targetsByPath.get(item.targetPath)
    return !target || !target.transformations.includes(
      item.transformation as z.infer<typeof safeTransformationSchema>
    )
  })) {
    throw new OptimizationPlanPreparationError('INVALID_PLAN')
  }
  if (planResult.data.items.some((item) => item.factIds.some((factId) => {
    const fact = factsById.get(factId)
    return fact?.verification !== 'user-confirmed'
      && fact?.verification !== 'document-backed'
  }))) {
    throw new OptimizationPlanPreparationError('INVALID_PLAN')
  }

  const validationTime = '1970-01-01T00:00:00.000Z'
  const validationRun: OptimizationRun = {
    version: OPTIMIZATION_RUN_VERSION,
    id: 'optimization-plan-validation',
    sourceDraftId: context.sourceDraftId,
    targetJobId: context.targetJobId,
    stage: 'evidence-mapped',
    inputFingerprint: 'optimization-plan-validation-v1',
    requirementMatches: context.requirementMatches,
    questions: [],
    createdAt: validationTime,
    updatedAt: validationTime
  }

  try {
    const prepared = transitionOptimizationRun(
      validationRun,
      { type: 'prepare-plan', plan: planResult.data },
      validationTime
    )
    if (!prepared.plan) throw new OptimizationPlanPreparationError('INVALID_PLAN')
    return prepared.plan
  } catch (error) {
    if (error instanceof OptimizationPlanPreparationError) throw error
    if (error instanceof OptimizationRunTransitionError) {
      throw new OptimizationPlanPreparationError('INVALID_PLAN')
    }
    throw error
  }
}

function validateContextReferences(
  input: {
    targetJobId: string
    requirements: Array<z.infer<typeof jobRequirementSchema>>
    requirementMatches: Array<z.infer<typeof requirementMatchSchema>>
    careerFacts: Array<z.infer<typeof careerFactSchema>>
    resumeTargets: OptimizationPlanTarget[]
  },
  context: z.RefinementCtx
) {
  const requirementIds = new Set<string>()
  input.requirements.forEach((requirement, index) => {
    if (requirementIds.has(requirement.id)) {
      context.addIssue({
        code: 'custom',
        path: ['requirements', index, 'id'],
        message: 'Requirement IDs must be unique'
      })
    }
    requirementIds.add(requirement.id)
    if (requirement.jobId !== input.targetJobId) {
      context.addIssue({
        code: 'custom',
        path: ['requirements', index, 'jobId'],
        message: 'Requirement must belong to the target job'
      })
    }
  })

  const factIds = new Set<string>()
  input.careerFacts.forEach((fact, index) => {
    if (factIds.has(fact.id)) {
      context.addIssue({
        code: 'custom',
        path: ['careerFacts', index, 'id'],
        message: 'Career fact IDs must be unique'
      })
    }
    factIds.add(fact.id)
  })

  const matchedRequirementIds = new Set<string>()
  input.requirementMatches.forEach((match, matchIndex) => {
    if (matchedRequirementIds.has(match.requirementId)) {
      context.addIssue({
        code: 'custom',
        path: ['requirementMatches', matchIndex, 'requirementId'],
        message: 'Each requirement may have at most one match'
      })
    }
    matchedRequirementIds.add(match.requirementId)

    if (!requirementIds.has(match.requirementId)) {
      context.addIssue({
        code: 'custom',
        path: ['requirementMatches', matchIndex, 'requirementId'],
        message: 'Match must reference a supplied requirement'
      })
    }

    match.factIds.forEach((factId, factIndex) => {
      if (!factIds.has(factId)) {
        context.addIssue({
          code: 'custom',
          path: ['requirementMatches', matchIndex, 'factIds', factIndex],
          message: 'Match must reference a supplied career fact'
        })
      }
    })
  })

  const targetPaths = new Set<string>()
  input.resumeTargets.forEach((target, targetIndex) => {
    if (targetPaths.has(target.path)) {
      context.addIssue({
        code: 'custom',
        path: ['resumeTargets', targetIndex, 'path'],
        message: 'Resume target paths must be unique'
      })
    }
    targetPaths.add(target.path)
  })
}

export function buildOptimizationPlanTargets(resume: ResumeData): OptimizationPlanTarget[] {
  const targets: OptimizationPlanTarget[] = []
  const add = (target: OptimizationPlanTarget) => {
    if (targets.length < MAX_OPTIMIZATION_PLAN_TARGETS) targets.push(target)
  }

  resume.profile.summary.forEach((current, index) => {
    if (current.trim()) {
      add({
        path: `profile.summary.${index}`,
        current,
        transformations: ['rewrite', 'emphasize']
      })
    }
  })

  resume.experiences.forEach((experience, experienceIndex) => {
    experience.bullets.forEach((current, bulletIndex) => {
      if (current.trim()) {
        add({
          path: `experiences.${experienceIndex}.bullets.${bulletIndex}`,
          current,
          transformations: ['rewrite', 'emphasize']
        })
      }
    })
    add({
      path: `experiences.${experienceIndex}.bullets`,
      current: experience.bullets,
      transformations: ['add-from-fact']
    })
  })

  resume.projects.forEach((project, projectIndex) => {
    if (project.summary.trim()) {
      add({
        path: `projects.${projectIndex}.summary`,
        current: project.summary,
        transformations: ['rewrite', 'emphasize']
      })
    }
    project.highlights.forEach((current, highlightIndex) => {
      if (current.trim()) {
        add({
          path: `projects.${projectIndex}.highlights.${highlightIndex}`,
          current,
          transformations: ['rewrite', 'emphasize']
        })
      }
    })
    add({
      path: `projects.${projectIndex}.highlights`,
      current: project.highlights,
      transformations: ['add-from-fact']
    })
  })

  const projectIds = resume.projects.map(({ id }) => id)
  if (
    projectIds.length > 1
    && projectIds.every((id) => id.trim())
    && new Set(projectIds).size === projectIds.length
  ) {
    add({
      path: 'projects',
      current: projectIds,
      transformations: ['reorder']
    })
  }

  return targets
}
