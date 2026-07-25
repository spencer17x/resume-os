import { describe, expect, it } from 'vitest'
import {
  buildOptimizationPlanTargets,
  OPTIMIZATION_PLAN_JSON_SCHEMA,
  OptimizationPlanPreparationError,
  optimizationPlanRequestSchema,
  parseOptimizationPlanContext,
  prepareOptimizationPlan
} from './optimization-plan'
import { normalizeResumeData } from '@/lib/resume-model'

const requirement = {
  id: 'requirement-1',
  jobId: 'job-1',
  text: 'Build reliable TypeScript platforms',
  category: 'skill' as const,
  priority: 'must' as const,
  weight: 4,
  keywords: ['TypeScript'],
  userConfirmed: true
}

const careerFact = {
  id: 'fact-1',
  kind: 'experience' as const,
  text: 'Built a reliable TypeScript platform',
  evidenceRefs: ['source-1'],
  verification: 'user-confirmed' as const,
  tags: ['typescript'],
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z'
}

const context = {
  sourceDraftId: 'draft-1',
  targetJobId: 'job-1',
  requirements: [requirement],
  requirementMatches: [{
    requirementId: 'requirement-1',
    factIds: ['fact-1'],
    status: 'direct' as const,
    rationale: 'The fact directly supports the requirement.'
  }],
  careerFacts: [careerFact],
  resumeTargets: [{
    path: 'profile.summary.0',
    current: 'Built reliable platforms.',
    transformations: ['rewrite', 'emphasize'] as Array<'rewrite' | 'emphasize'>
  }]
}

const plan = {
  id: 'plan-1',
  summary: 'Emphasize relevant platform evidence.',
  items: [{
    id: 'item-1',
    requirementIds: ['requirement-1'],
    factIds: ['fact-1'],
    targetPath: 'profile.summary.0',
    intent: 'Make the verified platform work easier to find.',
    transformation: 'emphasize' as const
  }]
}

describe('optimization plan boundary', () => {
  it('builds a deterministic whitelist of safe, reviewable resume targets', () => {
    const targets = buildOptimizationPlanTargets(normalizeResumeData({
      profile: {
        name: 'Ada',
        title: 'Engineer',
        summary: ['Builds reliable systems'],
        tags: [],
        links: []
      },
      experiences: [{
        company: 'Example',
        role: 'Engineer',
        period: '2024',
        tags: [],
        bullets: ['Owned platform delivery']
      }],
      projects: [{
        id: 'project-1',
        name: 'Platform',
        type: 'Work',
        tags: [],
        summary: 'A reliable platform',
        highlights: ['Reduced failures']
      }],
      skills: [],
      education: [],
      certifications: [],
      awards: [],
      languages: [],
      openSource: [],
      metadata: {
        source: 'paste',
        locale: 'en',
        updatedAt: '2026-07-16T00:00:00.000Z'
      }
    }))

    expect(targets).toContainEqual({
      path: 'profile.summary.0',
      current: 'Builds reliable systems',
      transformations: ['rewrite', 'emphasize']
    })
    expect(targets).toContainEqual({
      path: 'experiences.0.bullets',
      current: ['Owned platform delivery'],
      transformations: ['add-from-fact']
    })
    expect(targets).not.toContainEqual(expect.objectContaining({
      path: 'profile.name'
    }))
  })

  it('prepares an unapproved evidence-linked plan through the run state machine without mutation', () => {
    const beforeContext = structuredClone(context)
    const beforePlan = structuredClone(plan)

    expect(prepareOptimizationPlan(context, plan)).toEqual(plan)
    expect(context).toEqual(beforeContext)
    expect(plan).toEqual(beforePlan)
  })

  it('rejects plan requirement and fact references outside the exact request mappings', () => {
    expectPreparationError(() => prepareOptimizationPlan(context, {
      ...plan,
      items: [{ ...plan.items[0], requirementIds: ['requirement-unknown'] }]
    }), 'INVALID_PLAN')

    expectPreparationError(() => prepareOptimizationPlan(context, {
      ...plan,
      items: [{ ...plan.items[0], factIds: ['fact-unknown'] }]
    }), 'INVALID_PLAN')

    expectPreparationError(() => prepareOptimizationPlan(context, {
      ...plan,
      items: [{ ...plan.items[0], targetPath: 'profile.summary.99' }]
    }), 'INVALID_PLAN')

    const secondFact = { ...careerFact, id: 'fact-2' }
    expectPreparationError(() => prepareOptimizationPlan(
      { ...context, careerFacts: [...context.careerFacts, secondFact] },
      { ...plan, items: [{ ...plan.items[0], factIds: ['fact-2'] }] }
    ), 'INVALID_PLAN')
  })

  it('rejects add-from-fact without evidence, automatic removal, and pre-approved plans', () => {
    expectPreparationError(() => prepareOptimizationPlan(context, {
      ...plan,
      items: [{ ...plan.items[0], factIds: [], transformation: 'add-from-fact' }]
    }), 'INVALID_PLAN')

    expectPreparationError(() => prepareOptimizationPlan(context, {
      ...plan,
      approvedAt: '2026-07-16T00:00:00.000Z'
    }), 'INVALID_PLAN')

    expectPreparationError(() => prepareOptimizationPlan(context, {
      ...plan,
      items: [{ ...plan.items[0], transformation: 'remove' }]
    }), 'INVALID_PLAN')
    expectPreparationError(() => prepareOptimizationPlan(context, {
      ...plan,
      items: [{ ...plan.items[0], targetPath: undefined }]
    }), 'INVALID_PLAN')
    expect(OPTIMIZATION_PLAN_JSON_SCHEMA.properties.items.items.properties.transformation.enum)
      .not.toContain('remove')
  })

  it('does not plan changes from an imported-only fact before user confirmation', () => {
    expectPreparationError(() => prepareOptimizationPlan({
      ...context,
      careerFacts: [{ ...careerFact, verification: 'imported' }]
    }, plan), 'INVALID_PLAN')
  })

  it('applies the output byte limit in the provider-independent validator', () => {
    expectPreparationError(() => prepareOptimizationPlan(context, {
      ...plan,
      items: Array.from({ length: 40 }, (_, index) => ({
        ...plan.items[0],
        id: `item-${index}`,
        intent: `Intent ${index} ${'界'.repeat(1_900)}`
      }))
    }), 'INVALID_PLAN')
  })

  it('validates context ownership before plan generation', () => {
    expectPreparationError(() => parseOptimizationPlanContext({
      ...context,
      requirements: [{ ...requirement, jobId: 'another-job' }]
    }), 'INVALID_CONTEXT')

    expectPreparationError(() => parseOptimizationPlanContext({
      ...context,
      careerFacts: [],
      requirementMatches: [{ ...context.requirementMatches[0], factIds: ['fact-1'] }]
    }), 'INVALID_CONTEXT')

    expectPreparationError(() => parseOptimizationPlanContext({
      ...context,
      requirementMatches: [{ ...context.requirementMatches[0], requirementId: 'missing-requirement' }]
    }), 'INVALID_CONTEXT')
  })

  it('keeps the route request strict and publishes a score-free Chrome response schema', () => {
    expect(optimizationPlanRequestSchema.safeParse({
      ...context,
      locale: 'en',
      instruction: 'Prioritize relevant evidence',
      unexpected: true
    }).success).toBe(false)

    expect(OPTIMIZATION_PLAN_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(OPTIMIZATION_PLAN_JSON_SCHEMA.required).toEqual(['id', 'summary', 'items'])
    expect(OPTIMIZATION_PLAN_JSON_SCHEMA.properties.items.items.required).toContain('targetPath')
    expect(JSON.stringify(OPTIMIZATION_PLAN_JSON_SCHEMA)).not.toMatch(/approvedAt|score/i)
  })
})

function expectPreparationError(
  operation: () => unknown,
  code: OptimizationPlanPreparationError['code']
) {
  try {
    operation()
    throw new Error('Expected operation to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(OptimizationPlanPreparationError)
    expect((error as OptimizationPlanPreparationError).code).toBe(code)
  }
}
