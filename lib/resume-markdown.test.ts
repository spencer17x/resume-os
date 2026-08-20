import { describe, expect, it } from 'vitest'
import { normalizeResumeData } from '@/lib/resume-model'
import { renderResumeMarkdown, resumeMarkdownFileName } from './resume-markdown'

const sampleResume = normalizeResumeData({
  profile: { name: 'Ada', title: 'Engineer', summary: ['Builds reliable products.'] },
  experiences: [{ company: 'Example', role: 'Engineer', period: '2024-now', bullets: ['Built a TypeScript platform.'] }],
  skills: [{ group: 'Engineering', items: ['TypeScript'] }]
}, { locale: 'en' })

describe('resume Markdown rendering', () => {
  it('renders normalized resume data without introducing claims', () => {
    const markdown = renderResumeMarkdown(sampleResume)
    expect(markdown).toContain(`# ${sampleResume.profile.name}`)
    expect(markdown).toContain(sampleResume.experiences[0].bullets[0])
    expect(markdown).not.toContain('undefined')
  })

  it('creates a safe Markdown file name', () => {
    expect(resumeMarkdownFileName(sampleResume, 'AI Agent / 杭州')).toBe('AI-Agent-杭州.md')
  })
})
