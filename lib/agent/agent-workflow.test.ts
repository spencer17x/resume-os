import { describe, expect, it } from 'vitest'
import {
  resolveWorkflowQuestion,
  reviseRequirementMatrix,
  startOptimizationWorkflow
} from './agent-workflow'

const now = '2026-07-16T08:00:00.000Z'

function matrix() {
  return {
    version: 1 as const,
    targetJobId: 'job-1',
    inputFingerprint: 'fingerprint-1',
    requirements: [
      {
        id: 'requirement-a',
        jobId: 'job-1',
        text: 'Lead a platform migration',
        category: 'experience' as const,
        priority: 'must' as const,
        weight: 5,
        keywords: [],
        userConfirmed: true
      },
      {
        id: 'requirement-b',
        jobId: 'job-1',
        text: 'Work in a regulated domain',
        category: 'domain' as const,
        priority: 'preferred' as const,
        weight: 2,
        keywords: [],
        userConfirmed: true
      }
    ],
    matches: [{
      requirementId: 'requirement-a',
      factIds: ['fact-1'],
      status: 'direct' as const,
      rationale: 'A verified fact directly supports it.'
    }]
  }
}

describe('agent workflow orchestration', () => {
  it('refuses to create a run until every extracted requirement is user-confirmed', () => {
    const unconfirmed = matrix()
    unconfirmed.requirements[1] = {
      ...unconfirmed.requirements[1],
      userConfirmed: false
    }

    expect(() => startOptimizationWorkflow({
      id: 'run-1',
      sourceDraftId: 'draft-1',
      matrix: unconfirmed,
      locale: 'en',
      now
    })).toThrow(/must be confirmed/i)
  })

  it('starts a resumable run and turns every missing mapping into a question', () => {
    const result = startOptimizationWorkflow({
      id: 'run-1',
      sourceDraftId: 'draft-1',
      matrix: matrix(),
      locale: 'en',
      now
    })

    expect(result.run.stage).toBe('awaiting-answers')
    expect(result.run.scoreBefore).toMatchObject({
      requirementCoverage: 71.4286,
      evidenceCompleteness: 71.4286
    })
    expect(result.run.questions).toEqual([expect.objectContaining({
      requirementId: 'requirement-b',
      status: 'open'
    })])
    expect(result.matrix.matches).toHaveLength(2)
  })

  it('links a verified fact, updates deterministic scoring, and resumes the run', () => {
    const started = startOptimizationWorkflow({
      id: 'run-1',
      sourceDraftId: 'draft-1',
      matrix: matrix(),
      locale: 'en',
      now
    })
    const resolved = resolveWorkflowQuestion({
      ...started,
      questionId: started.run.questions[0].id,
      resolution: {
        type: 'fact',
        factIds: ['fact-2'],
        status: 'partial',
        rationale: 'The user linked adjacent regulated-domain work.'
      },
      now: '2026-07-16T08:01:00.000Z'
    })

    expect(resolved.run.stage).toBe('evidence-mapped')
    expect(resolved.run.scoreBefore).toMatchObject({
      requirementCoverage: 85.7143,
      evidenceCompleteness: 100
    })
    expect(resolved.matrix.matches[1]).toMatchObject({
      status: 'partial',
      factIds: ['fact-2']
    })
  })

  it('records a real gap without creating evidence', () => {
    const started = startOptimizationWorkflow({
      id: 'run-1',
      sourceDraftId: 'draft-1',
      matrix: matrix(),
      locale: 'en',
      now
    })
    const resolved = resolveWorkflowQuestion({
      ...started,
      questionId: started.run.questions[0].id,
      resolution: { type: 'gap', rationale: 'The user confirmed no supporting experience.' },
      now: '2026-07-16T08:01:00.000Z'
    })

    expect(resolved.run.stage).toBe('evidence-mapped')
    expect(resolved.run.questions[0]).toMatchObject({ status: 'gap-confirmed', factIds: [] })
    expect(resolved.matrix.matches[1]).toMatchObject({ status: 'gap', factIds: [] })
  })

  it('creates a deterministic new fingerprint when a user corrects a requirement', () => {
    const original = matrix()
    const revised = reviseRequirementMatrix(original, 'requirement-b', {
      category: 'responsibility',
      priority: 'must',
      weight: 4
    })

    expect(revised.requirements[1]).toMatchObject({
      category: 'responsibility',
      priority: 'must',
      weight: 4,
      userConfirmed: true
    })
    expect(revised.inputFingerprint).toMatch(/^revision:/)
    expect(revised.inputFingerprint).not.toBe(original.inputFingerprint)
    expect(reviseRequirementMatrix(original, 'requirement-b', {
      category: 'responsibility',
      priority: 'must',
      weight: 4
    })).toEqual(revised)
  })
})
