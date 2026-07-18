import { describe, expect, it } from 'vitest'
import { getEmptyResumeData, getSampleResumeData } from './resume-sample'

describe('resume sample privacy', () => {
  it.each([
    { locale: 'en' as const, name: 'Demo Candidate' },
    { locale: 'zh' as const, name: '演示候选人' }
  ])('keeps the $locale sample fictional and free of contact details', ({ locale, name }) => {
    const sample = getSampleResumeData(locale)

    expect(sample.profile.name).toBe(name)
    expect(sample.profile).toMatchObject({ email: '', github: '', blog: '', links: [] })
    expect(sample.profile.phone).toBeUndefined()
    expect(sample.experiences.every(({ company }) => (
      company.includes('Fictional') || company.includes('虚构')
    ))).toBe(true)
  })

  it('returns a structurally complete empty placeholder instead of sample content', () => {
    const empty = getEmptyResumeData('en')

    expect(empty.profile).toMatchObject({ name: '', title: '', links: [], summary: [], tags: [] })
    expect(empty.skills).toEqual([])
    expect(empty.experiences).toEqual([])
    expect(empty.projects).toEqual([])
  })
})
