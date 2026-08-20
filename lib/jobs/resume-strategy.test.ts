import { describe, expect, it } from 'vitest'
import { normalizeResumeData } from '@/lib/resume-model'
import { classifyResumeStrategy, classifyRoleTitle, createStrategyResume } from './resume-strategy'

const sampleResume = normalizeResumeData({
  profile: { name: 'Ada', title: 'Engineer', summary: ['Builds reliable products.'] },
  experiences: [{ company: 'Example', role: 'Engineer', period: '2024-now', bullets: ['Built a TypeScript frontend.', 'Improved reliability.'] }],
  projects: [{ id: 'one', name: 'Agent Tool', type: 'AI', tags: ['Agent'], summary: 'An agent tool.', highlights: ['Added RAG workflows.'] }],
  skills: [{ group: 'Engineering', items: ['TypeScript', 'React'] }]
}, { locale: 'en' })

describe('resume strategy classification', () => {
  it('groups variants by role family instead of company identity', () => {
    expect(classifyResumeStrategy('AI Agent Engineer at Company A', sampleResume)).toBe('ai-agent')
    expect(classifyResumeStrategy('AI Agent Engineer at Company B', sampleResume)).toBe('ai-agent')
  })

  it('keeps mobile and frontend directions distinct', () => {
    const neutral = { ...sampleResume, targetRole: '', profile: { ...sampleResume.profile, title: '' }, skills: [] }
    expect(classifyResumeStrategy('React Native 客户端工程师', neutral)).toBe('mobile')
    expect(classifyResumeStrategy('高级前端工程师', neutral)).toBe('frontend')
  })

  it('uses the requested role direction before the candidate-wide AI skill set', () => {
    expect(classifyRoleTitle('高级前端开发工程师')).toBe('frontend')
    expect(classifyResumeStrategy('高级前端开发工程师', sampleResume)).toBe('frontend')
  })

  it('tailors by reordering existing evidence without creating new claims', () => {
    const tailored = createStrategyResume(sampleResume, 'frontend', 'Senior Frontend Engineer')
    expect(tailored.targetRole).toBe('Senior Frontend Engineer')
    expect(tailored.experiences.flatMap((item) => item.bullets).sort()).toEqual(
      sampleResume.experiences.flatMap((item) => item.bullets).sort()
    )
    expect(tailored.projects.flatMap((item) => item.highlights).sort()).toEqual(
      sampleResume.projects.flatMap((item) => item.highlights).sort()
    )
  })
})
