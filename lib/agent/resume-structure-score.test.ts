import { describe, expect, it } from 'vitest'
import { normalizeResumeData } from '@/lib/resume-model'
import {
  RESUME_STRUCTURE_RUBRIC_VERSION,
  resumeStructureScoreSchema,
  scoreResumeStructure
} from './resume-structure-score'

const completeResume = normalizeResumeData({
  profile: {
    name: 'Ada Candidate',
    title: 'Staff Engineer',
    email: 'ada@example.test',
    summary: ['Builds reliable developer platforms for product engineering teams.'],
    tags: [],
    links: []
  },
  skills: [{ group: 'Engineering', items: ['TypeScript'] }],
  experiences: [{
    company: 'Example Co',
    role: 'Staff Engineer',
    period: '2022–Present',
    bullets: ['Led a platform migration that reduced release recovery time across five teams.'],
    tags: []
  }],
  projects: [],
  metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-16T08:00:00.000Z' }
})

describe('resume structure score', () => {
  it('scores a complete readable structure with an explicit deterministic rubric', () => {
    expect(scoreResumeStructure(completeResume)).toMatchObject({
      rubricVersion: RESUME_STRUCTURE_RUBRIC_VERSION,
      score: 100
    })
  })

  it('keeps missing structure separate from requirement alignment', () => {
    const result = scoreResumeStructure(normalizeResumeData({
      profile: { name: '', title: '', summary: [], tags: [], links: [] },
      skills: [],
      experiences: [],
      projects: [],
      metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-16T08:00:00.000Z' }
    }))

    expect(result.score).toBe(0)
    expect(result.rules.every((rule) => rule.factor === 0)).toBe(true)
  })

  it('uses proportional rule contributions and records the inspected resume paths', () => {
    const input = {
      ...completeResume,
      experiences: [
        ...completeResume.experiences,
        { company: 'Second Co', role: '', period: '', bullets: [], tags: [] }
      ]
    }
    const result = scoreResumeStructure(input)
    const experience = result.rules.find((rule) => rule.id === 'experience-structure')

    expect(experience).toMatchObject({ factor: 0.5, points: 12.5 })
    expect(experience?.resumePaths).toContain('experiences.1.role')
    expect(result.score).toBe(87.5)
  })

  it('is deterministic, validates totals, and does not mutate its input', () => {
    const input = structuredClone(completeResume)
    const snapshot = structuredClone(input)
    const first = scoreResumeStructure(input)

    expect(scoreResumeStructure(input)).toEqual(first)
    expect(resumeStructureScoreSchema.parse(first)).toEqual(first)
    expect(input).toEqual(snapshot)
    expect(() => resumeStructureScoreSchema.parse({ ...first, score: first.score - 1 })).toThrow()
  })
})
