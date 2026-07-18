import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createResumeDraft,
  normalizeResumeData,
  resumeDataSchema,
  type ResumeData
} from './resume-model'

describe('resume model', () => {
  it('normalizes an empty resume into a complete local placeholder', () => {
    const normalized = normalizeResumeData({}, { locale: 'en', source: 'sample' })

    expect(normalized.profile).toMatchObject({
      name: '', title: '', summary: [], tags: [], links: []
    })
    expect(normalized.skills).toEqual([])
    expect(normalized.experiences).toEqual([])
    expect(normalized.projects).toEqual([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('normalizes missing optional arrays and metadata', () => {
    const normalized = normalizeResumeData({
      profile: {
        name: 'Ada Lovelace',
        title: 'AI Engineer',
        summary: ['Builds agent systems'],
        tags: ['AI']
      },
      skills: [{ group: 'AI', items: ['RAG'] }],
      experiences: [],
      projects: [],
      openSource: []
    })

    expect(normalized.profile.links).toEqual([])
    expect(normalized.education).toEqual([])
    expect(normalized.certifications).toEqual([])
    expect(normalized.awards).toEqual([])
    expect(normalized.languages).toEqual([])
    expect(normalized.metadata.source).toBe('sample')
    expect(normalized.metadata.locale).toBe('zh')
    expect(normalized.metadata.updatedAt).toMatch(/T/)
  })

  it('keeps known project ids and fills missing project arrays', () => {
    const normalized = normalizeResumeData({
      profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [] },
      skills: [],
      experiences: [],
      projects: [{ id: 'p1', name: 'Agent OS', type: 'Personal', tags: ['AI'], summary: 'Demo' }],
      openSource: []
    })

    expect(normalized.projects[0]).toMatchObject({
      id: 'p1',
      name: 'Agent OS',
      highlights: []
    })
  })

  it('creates a draft with stable metadata', () => {
    const data: ResumeData = normalizeResumeData({
      profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [] },
      skills: [],
      experiences: [],
      projects: [],
      openSource: []
    })

    const draft = createResumeDraft(data, {
      id: 'draft-1',
      name: 'Ada Resume',
      source: 'ai-generated',
      now: '2026-07-06T00:00:00.000Z'
    })

    expect(draft.id).toBe('draft-1')
    expect(draft.name).toBe('Ada Resume')
    expect(draft.source).toBe('ai-generated')
    expect(draft.data.metadata.source).toBe('ai-generated')
    expect(draft.createdAt).toBe('2026-07-06T00:00:00.000Z')
    expect(draft.snapshots).toEqual([])
  })

  it('generates distinct fallback ids when randomUUID fails at the same timestamp', () => {
    vi.stubGlobal('crypto', { randomUUID: () => { throw new Error('Unavailable') } })
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    const data = normalizeResumeData({
      profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [] },
      skills: [],
      experiences: [],
      projects: [],
      openSource: []
    })

    const first = createResumeDraft(data)
    const second = createResumeDraft(data)

    expect(first.id).not.toBe(second.id)
    expect(first.id).toMatch(/^draft-1234-/)
    expect(second.id).toMatch(/^draft-1234-/)
  })

  it('replaces a blank caller-provided id with a generated id', () => {
    const data = normalizeResumeData({
      profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [] },
      skills: [],
      experiences: [],
      projects: [],
      openSource: []
    })

    const id = createResumeDraft(data, { id: '   ' }).id
    expect(id).toBeTruthy()
    expect(id.trim()).toBe(id)
  })

  it('validates normalized data with zod', () => {
    const data = normalizeResumeData({
      profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [] },
      skills: [],
      experiences: [],
      projects: [],
      openSource: []
    })

    expect(() => resumeDataSchema.parse(data)).not.toThrow()
  })
})
