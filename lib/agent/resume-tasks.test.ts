import { describe, expect, it } from 'vitest'
import {
  RESUME_TASK_JSON_SCHEMA,
  validateDemoResumeTaskOutput,
  validateParsedResumeTaskOutput
} from './resume-tasks'

function modelOutput() {
  return {
    profile: {
      name: 'Synthetic Candidate',
      title: 'Engineer',
      links: [],
      summary: ['Builds reliable systems.'],
      tags: ['TypeScript']
    },
    targetRole: 'Untrusted model role',
    skills: [{ group: 'Core', items: ['TypeScript'] }],
    experiences: [],
    projects: [],
    education: [],
    certifications: [],
    awards: [],
    languages: ['English'],
    openSource: []
  }
}

describe('resume AI task contract', () => {
  it('uses one bounded structural schema for local model parsing and generation', () => {
    const serialized = JSON.stringify(RESUME_TASK_JSON_SCHEMA)
    expect(RESUME_TASK_JSON_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: expect.objectContaining({
        profile: expect.objectContaining({ type: 'object' }),
        experiences: expect.objectContaining({ type: 'array' }),
        projects: expect.objectContaining({ type: 'array' })
      })
    })
    expect(serialized).not.toContain('"metadata"')
    expect(serialized).not.toContain('"$schema"')
    expect(serialized).not.toContain('"default"')
  })

  it('normalizes parsed local output to the trusted import source and locale', () => {
    const parsed = validateParsedResumeTaskOutput(modelOutput(), {
      locale: 'zh',
      source: 'paste'
    })

    expect(parsed.metadata).toMatchObject({ source: 'paste', locale: 'zh' })
    expect(parsed.profile.name).toBe('Synthetic Candidate')
  })

  it('forces generated output to remain a sandbox resume for the requested role', () => {
    const generated = validateDemoResumeTaskOutput(modelOutput(), {
      locale: 'en',
      targetRole: 'Agent Engineer'
    })

    expect(generated.targetRole).toBe('Agent Engineer')
    expect(generated.metadata).toMatchObject({ source: 'ai-generated', locale: 'en' })
  })

  it('rejects invalid or oversized model output', () => {
    expect(() => validateParsedResumeTaskOutput({ profile: null }, {
      locale: 'en',
      source: 'upload'
    })).toThrow(expect.objectContaining({ code: 'AI_OUTPUT_INVALID' }))

    expect(() => validateDemoResumeTaskOutput({
      ...modelOutput(),
      profile: { ...modelOutput().profile, summary: ['x'.repeat(70_000)] }
    }, {
      locale: 'en',
      targetRole: 'Engineer'
    })).toThrow(expect.objectContaining({ code: 'AI_OUTPUT_TOO_LARGE' }))
  })
})
