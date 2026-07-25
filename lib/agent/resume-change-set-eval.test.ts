import { describe, expect, it } from 'vitest'
import {
  ResumeChangeSetError,
  validateResumeChangeEvidence
} from './resume-change-set'

const requirements = [{ id: 'requirement-1' }]

function changeSet(input: {
  original: string
  proposed: string
  factIds: string[]
}) {
  return {
    summary: 'Synthetic evidence validation case',
    changes: [{
      id: 'change-1',
      path: 'profile.summary.0',
      original: input.original,
      proposed: input.proposed,
      reason: 'Synthetic bilingual quality evaluation',
      needsConfirmation: true,
      evidence: {
        requirementIds: ['requirement-1'],
        factIds: input.factIds,
        matchType: 'direct' as const,
        support: 'verified' as const,
        confidence: 0.8,
        transformation: 'rewrite' as const
      }
    }],
    questions: []
  }
}

function facts(...entries: Array<[id: string, text: string]>) {
  return entries.map(([id, text]) => ({
    id,
    text,
    verification: 'document-backed' as const
  }))
}

describe('synthetic resume rewrite evidence evaluations', () => {
  it('allows bounded English synthesis across the original and cited facts', () => {
    expect(() => validateResumeChangeEvidence(changeSet({
      original: 'Owned delivery',
      proposed: 'Owned reliable platform delivery',
      factIds: ['fact-platform']
    }), {
      requirements,
      facts: facts(['fact-platform', 'Reliable platform'])
    })).not.toThrow()
  })

  it('allows bounded Chinese reordering without introducing new claims', () => {
    expect(() => validateResumeChangeEvidence(changeSet({
      original: '负责平台交付',
      proposed: '覆盖五个产品团队，负责平台交付',
      factIds: ['fact-teams']
    }), {
      requirements,
      facts: facts(['fact-teams', '覆盖五个产品团队'])
    })).not.toThrow()
  })

  it('rejects a metric that is absent from every cited source', () => {
    expect(() => validateResumeChangeEvidence(changeSet({
      original: 'Owned platform delivery',
      proposed: 'Owned platform delivery for 20 teams',
      factIds: ['fact-platform']
    }), {
      requirements,
      facts: facts(['fact-platform', 'Owned platform delivery'])
    })).toThrowError(ResumeChangeSetError)
  })

  it('rejects removing a negation from otherwise supported wording', () => {
    expect(() => validateResumeChangeEvidence(changeSet({
      original: 'Owned no production incidents',
      proposed: 'Owned production incidents',
      factIds: ['fact-incidents']
    }), {
      requirements,
      facts: facts(['fact-incidents', 'Owned no production incidents'])
    })).toThrowError(ResumeChangeSetError)
  })

  it('rejects rebinding a cited skill to an unsupported responsibility', () => {
    expect(() => validateResumeChangeEvidence(changeSet({
      original: 'Managed production deployment',
      proposed: 'Managed Kubernetes production deployment',
      factIds: ['fact-kubernetes']
    }), {
      requirements,
      facts: facts(['fact-kubernetes', 'Used Kubernetes for development'])
    })).toThrowError(ResumeChangeSetError)
  })
})
