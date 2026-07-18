import { describe, expect, it } from 'vitest'
import {
  MAX_REQUIREMENT_WEIGHT,
  REQUIREMENT_SCORING_RUBRIC_VERSION,
  jobRequirementSchema,
  requirementMatchSchema,
  requirementMatrixSchema,
  requirementScoreResultSchema,
  scoreResultSchema,
  scoreRequirementMatrix,
  targetJobSchema
} from './requirement-matrix'

const timestamp = '2026-07-16T08:00:00.000Z'

function requirement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'requirement-a',
    jobId: 'job-1',
    text: 'Build reliable TypeScript services',
    category: 'skill',
    priority: 'must',
    weight: 5,
    keywords: ['TypeScript', 'reliability'],
    userConfirmed: true,
    ...overrides
  }
}

function match(overrides: Record<string, unknown> = {}) {
  return {
    requirementId: 'requirement-a',
    factIds: ['fact-b', 'fact-a'],
    status: 'direct',
    rationale: 'The candidate has shipped TypeScript services.',
    ...overrides
  }
}

function matrix(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    targetJobId: 'job-1',
    inputFingerprint: 'sha256:stable-input',
    requirements: [
      requirement(),
      requirement({
        id: 'requirement-b',
        text: 'Own production operations',
        category: 'responsibility',
        priority: 'preferred',
        weight: 3
      }),
      requirement({
        id: 'requirement-c',
        text: 'Fintech domain experience',
        category: 'domain',
        priority: 'signal',
        weight: 2
      })
    ],
    matches: [
      match(),
      match({
        requirementId: 'requirement-b',
        factIds: ['fact-c'],
        status: 'partial',
        rationale: 'Has adjacent on-call experience.'
      }),
      match({
        requirementId: 'requirement-c',
        factIds: [],
        status: 'gap',
        rationale: 'No fintech evidence is available.'
      })
    ],
    ...overrides
  }
}

describe('requirement matrix contracts', () => {
  it('parses strict TargetJob, JobRequirement, and RequirementMatch contracts', () => {
    expect(targetJobSchema.parse({
      id: 'job-1',
      title: 'Staff Engineer',
      company: 'Analytical Engines',
      description: 'Lead platform engineering.',
      locale: 'en',
      createdAt: timestamp,
      updatedAt: timestamp
    })).toMatchObject({ id: 'job-1', locale: 'en' })

    expect(jobRequirementSchema.parse(requirement())).toMatchObject({
      category: 'skill',
      priority: 'must'
    })
    expect(requirementMatchSchema.parse(match())).toMatchObject({ status: 'direct' })

    expect(() => targetJobSchema.parse({
      id: 'job-1',
      title: 'Engineer',
      description: 'Build systems.',
      locale: 'en',
      createdAt: timestamp,
      updatedAt: timestamp,
      unexpected: true
    })).toThrow()
    expect(() => jobRequirementSchema.parse({ ...requirement(), unexpected: true })).toThrow()
    expect(() => requirementMatchSchema.parse({ ...match(), unexpected: true })).toThrow()
  })

  it.each([
    0,
    -1,
    MAX_REQUIREMENT_WEIGHT + 0.01,
    Number.POSITIVE_INFINITY,
    Number.NaN
  ])('rejects invalid requirement weight %s', (weight) => {
    expect(() => jobRequirementSchema.parse(requirement({ weight }))).toThrow()
  })

  it('accepts a finite positive weight without rounding it to zero', () => {
    const result = scoreRequirementMatrix(matrix({
      requirements: [requirement({ weight: 0.00001 })],
      matches: [match()]
    }))

    expect(result.totalWeight).toBe(0.00001)
    expect(result.requirementCoverage).toBe(100)
  })

  it('restricts categories and priorities to the documented rubric', () => {
    expect(() => jobRequirementSchema.parse(requirement({ category: 'personality' }))).toThrow()
    expect(() => jobRequirementSchema.parse(requirement({ priority: 'optional' }))).toThrow()
  })

  it('rejects duplicate requirements, orphan matches, and duplicate matches', () => {
    expect(() => requirementMatrixSchema.parse(matrix({
      requirements: [requirement(), requirement()]
    }))).toThrow(/Requirement IDs must be unique/)

    expect(() => requirementMatrixSchema.parse(matrix({
      matches: [match({ requirementId: 'missing-requirement' })]
    }))).toThrow(/Match must reference a requirement/)

    expect(() => requirementMatrixSchema.parse(matrix({
      matches: [match(), match({ factIds: ['fact-c'] })]
    }))).toThrow(/at most one match/)
  })

  it('rejects requirements from a different target job and duplicate evidence refs', () => {
    expect(() => requirementMatrixSchema.parse(matrix({
      requirements: [requirement({ jobId: 'job-2' })],
      matches: []
    }))).toThrow(/target job/)

    expect(() => requirementMatchSchema.parse(match({ factIds: ['fact-a', 'fact-a'] })))
      .toThrow(/Fact IDs must be unique/)
  })

  it('does not allow match labels to contradict their evidence links', () => {
    expect(() => requirementMatchSchema.parse(match({ factIds: [], status: 'direct' })))
      .toThrow(/require supporting facts/)
    expect(() => requirementMatchSchema.parse(match({ factIds: [], status: 'partial' })))
      .toThrow(/require supporting facts/)
    expect(() => requirementMatchSchema.parse(match({ factIds: ['fact-a'], status: 'gap' })))
      .toThrow(/gap cannot cite supporting facts/i)
  })
})

describe('deterministic requirement scoring', () => {
  it('calculates weighted coverage separately from evidence completeness', () => {
    const result = scoreRequirementMatrix(matrix())

    expect(result).toMatchObject({
      rubricVersion: REQUIREMENT_SCORING_RUBRIC_VERSION,
      inputFingerprint: 'sha256:stable-input',
      totalWeight: 10,
      requirementCoverage: 65,
      evidenceCompleteness: 80
    })
    expect(result.contributions).toEqual([
      {
        requirementId: 'requirement-a',
        category: 'skill',
        priority: 'must',
        weight: 5,
        status: 'direct',
        matchFactor: 1,
        weightedCoverage: 5,
        evidenceFactor: 1,
        weightedEvidence: 5,
        evidenceRefs: ['fact-a', 'fact-b']
      },
      {
        requirementId: 'requirement-b',
        category: 'responsibility',
        priority: 'preferred',
        weight: 3,
        status: 'partial',
        matchFactor: 0.5,
        weightedCoverage: 1.5,
        evidenceFactor: 1,
        weightedEvidence: 3,
        evidenceRefs: ['fact-c']
      },
      {
        requirementId: 'requirement-c',
        category: 'domain',
        priority: 'signal',
        weight: 2,
        status: 'gap',
        matchFactor: 0,
        weightedCoverage: 0,
        evidenceFactor: 0,
        weightedEvidence: 0,
        evidenceRefs: []
      }
    ])
    expect(requirementScoreResultSchema.parse(result)).toEqual(result)
    expect(scoreResultSchema.parse(result)).toEqual(result)
  })

  it('treats an unmapped requirement as a gap without dropping its contribution', () => {
    const input = matrix({ matches: [match()] })
    const result = scoreRequirementMatrix(input)

    expect(result.requirementCoverage).toBe(50)
    expect(result.evidenceCompleteness).toBe(50)
    expect(result.contributions.map(({ requirementId, status }) => ({ requirementId, status })))
      .toEqual([
        { requirementId: 'requirement-a', status: 'direct' },
        { requirementId: 'requirement-b', status: 'gap' },
        { requirementId: 'requirement-c', status: 'gap' }
      ])
  })

  it('is deterministic for semantically equivalent input array orders and does not mutate input', () => {
    const original = matrix()
    const reordered = matrix({
      requirements: [...(original.requirements as unknown[])].reverse(),
      matches: [...(original.matches as Array<Record<string, unknown>>)]
        .reverse()
        .map((item) => ({
          ...item,
          factIds: [...(item.factIds as string[])].reverse()
        }))
    })
    const originalSnapshot = structuredClone(original)

    expect(scoreRequirementMatrix(reordered)).toEqual(scoreRequirementMatrix(original))
    expect(original).toEqual(originalSnapshot)
  })
})
