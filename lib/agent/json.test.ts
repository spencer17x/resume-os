import { describe, expect, it } from 'vitest'
import {
  MAX_AGENT_JSON_CHARS,
  MAX_NORMALIZED_RESUME_BYTES,
  AgentOutputError,
  extractJsonText,
  parseResumeJson
} from './json'

const resumeJson = JSON.stringify({
  profile: {
    name: 'Ada Lovelace',
    title: 'AI Engineer',
    summary: ['Builds reliable agent systems'],
    tags: ['AI']
  },
  skills: [{ group: 'AI', items: ['RAG'] }]
})

describe('agent JSON', () => {
  it('extracts a complete plain JSON object', () => {
    expect(extractJsonText(`  ${resumeJson}\n`)).toBe(resumeJson)
  })

  it('extracts a complete JSON code fence', () => {
    expect(extractJsonText(`\n\`\`\`json\n${resumeJson}\n\`\`\`\n`)).toBe(resumeJson)
  })

  it.each([
    ['malformed JSON', '{"profile":'],
    ['trailing prose', `${resumeJson}\nDone.`],
    ['leading prose', `Here is the resume:\n${resumeJson}`],
    ['content after a fence', `\`\`\`json\n${resumeJson}\n\`\`\`\nDone.`]
  ])('rejects %s', (_label, value) => {
    expect(() => extractJsonText(value)).toThrow('Invalid JSON response')
  })

  it('rejects duplicate keys at every object depth before JSON.parse can overwrite them', () => {
    expect(() => extractJsonText('{"profile":{"name":"Ada","name":"Grace"}}')).toThrowError(expect.objectContaining({
      code: 'AI_OUTPUT_INVALID'
    }))
    expect(() => extractJsonText('{"profile":{},"profile":{}}')).toThrowError(expect.objectContaining({
      code: 'AI_OUTPUT_INVALID'
    }))
  })

  it('validates and normalizes resume data with explicit metadata', () => {
    const data = parseResumeJson(resumeJson, {
      locale: 'en',
      source: 'paste',
      now: '2026-07-13T00:00:00.000Z'
    })

    expect(data.profile.name).toBe('Ada Lovelace')
    expect(data.projects).toEqual([])
    expect(data.education).toEqual([])
    expect(data.metadata).toEqual({
      locale: 'en',
      source: 'paste',
      updatedAt: '2026-07-13T00:00:00.000Z'
    })
  })

  it('rejects JSON that is not valid resume data', () => {
    expect(() => parseResumeJson('[]', { locale: 'zh', source: 'upload' })).toThrow(AgentOutputError)
  })

  it('rejects raw model output before JSON.parse when it exceeds the character budget', () => {
    const output = `{"profile":{"name":"${'x'.repeat(MAX_AGENT_JSON_CHARS)}"}}`

    expect(() => extractJsonText(output)).toThrowError(expect.objectContaining({
      code: 'AI_OUTPUT_TOO_LARGE'
    }))
  })

  it('rejects normalized resume data that exceeds the serialized byte budget', () => {
    const output = JSON.stringify({
      profile: {
        name: 'Ada',
        title: 'Engineer',
        summary: ['x'.repeat(MAX_NORMALIZED_RESUME_BYTES)],
        tags: []
      }
    })

    expect(() => parseResumeJson(output, { locale: 'en', source: 'paste' })).toThrowError(expect.objectContaining({
      code: 'AI_OUTPUT_TOO_LARGE'
    }))
  })
})
