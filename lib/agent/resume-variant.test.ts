import { describe, expect, it } from 'vitest'
import { normalizeResumeData } from '@/lib/resume-model'
import { parseModelResumeChangeSet, ResumeChangeSetError } from './resume-change-set'
import { createResumeVariant } from './resume-variant'

const source = normalizeResumeData({
  profile: { name: 'Ada', title: 'Engineer', summary: ['Builds systems'], tags: [], links: [] },
  skills: [],
  experiences: [],
  projects: [],
  education: [],
  certifications: [], awards: [], languages: [], openSource: [],
  metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-16T08:00:00.000Z' }
})

function changeSet(support: 'verified' | 'unsupported' = 'verified') {
  return parseModelResumeChangeSet({
    summary: 'Tailor the summary',
    changes: [{
      id: 'change-1',
      path: 'profile.summary.0',
      original: 'Builds systems',
      proposed: 'Builds reliable agent systems',
      reason: 'Makes verified experience easier to find',
      needsConfirmation: true,
      evidence: {
        requirementIds: support === 'verified' ? ['requirement-1'] : [],
        factIds: support === 'verified' ? ['fact-1'] : [],
        matchType: support === 'verified' ? 'direct' : 'gap',
        support,
        confidence: support === 'verified' ? 0.9 : 0,
        transformation: 'emphasize'
      }
    }],
    questions: []
  })
}

describe('createResumeVariant', () => {
  it('returns a separate validated variant and leaves the master resume untouched', () => {
    const variant = createResumeVariant({
      id: 'variant-1',
      sourceDraftId: 'draft-1',
      targetJobId: 'job-1',
      name: 'Ada — Agent Engineer',
      resume: source,
      changeSet: changeSet(),
      acceptedIds: ['change-1'],
      facts: [{
        id: 'fact-1', text: 'Builds reliable agent systems',
        verification: 'document-backed'
      }],
      requirements: [{ id: 'requirement-1' }],
      now: '2026-07-16T09:00:00.000Z'
    })

    expect(variant.data.profile.summary[0]).toBe('Builds reliable agent systems')
    expect(variant).toMatchObject({
      id: 'variant-1', sourceDraftId: 'draft-1', targetJobId: 'job-1',
      createdAt: '2026-07-16T09:00:00.000Z', updatedAt: '2026-07-16T09:00:00.000Z'
    })
    expect(source.profile.summary[0]).toBe('Builds systems')
  })

  it('refuses to create a variant from an unsupported change', () => {
    expect(() => createResumeVariant({
      id: 'variant-1', sourceDraftId: 'draft-1', targetJobId: 'job-1', name: 'Blocked',
      resume: source, changeSet: changeSet('unsupported'), acceptedIds: ['change-1'],
      facts: [], requirements: [],
      now: '2026-07-16T09:00:00.000Z'
    })).toThrowError(ResumeChangeSetError)
  })

  it('creates reversible insertion and stable-project-order variants without mutating the master', () => {
    const master = normalizeResumeData({
      ...source,
      experiences: [{
        company: 'Analytical Engines', role: 'Engineer', period: '2024', tags: [],
        bullets: ['Owned delivery']
      }],
      projects: [{
        id: 'project-a', name: 'Project A', type: 'Product', tags: [], summary: 'First', highlights: []
      }, {
        id: 'project-b', name: 'Project B', type: 'Product', tags: [], summary: 'Second', highlights: []
      }]
    })
    const structuralChanges = parseModelResumeChangeSet({
      summary: 'Add verified evidence and prioritize the relevant project',
      changes: [{
        id: 'add-1', path: 'experiences.0.bullets', original: ['Owned delivery'],
        proposed: ['Owned delivery', 'Owned platform delivery for three product teams'],
        reason: 'Adds a verified scope fact', needsConfirmation: true,
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
          support: 'verified', confidence: 1, transformation: 'add-from-fact'
        }
      }, {
        id: 'reorder-1', path: 'projects', original: ['project-a', 'project-b'],
        proposed: ['project-b', 'project-a'], reason: 'Prioritizes relevant evidence',
        needsConfirmation: true,
        evidence: {
          requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
          support: 'verified', confidence: 1, transformation: 'reorder'
        }
      }],
      questions: []
    })

    const variant = createResumeVariant({
      id: 'variant-structural', sourceDraftId: 'draft-1', targetJobId: 'job-1',
      name: 'Structural variant', resume: master, changeSet: structuralChanges,
      acceptedIds: ['add-1', 'reorder-1'],
      facts: [{
        id: 'fact-1', text: 'Owned platform delivery for three product teams',
        verification: 'document-backed'
      }],
      requirements: [{ id: 'requirement-1' }],
      now: '2026-07-16T09:00:00.000Z'
    })

    expect(variant.data.experiences[0].bullets).toHaveLength(2)
    expect(variant.data.projects.map(({ id }) => id)).toEqual(['project-b', 'project-a'])
    expect(master.experiences[0].bullets).toEqual(['Owned delivery'])
    expect(master.projects.map(({ id }) => id)).toEqual(['project-a', 'project-b'])
  })
})
