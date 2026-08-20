import { describe, expect, it } from 'vitest'
import { PDFParse } from 'pdf-parse'
import { normalizeResumeData } from './resume-model'
import { renderResumePdf, resumePdfFileName } from './resume-pdf'

describe('resume PDF rendering', () => {
  it('creates a text PDF with stable layout and filename', async () => {
    const resume = normalizeResumeData({
      profile: { name: 'Ada Candidate', title: 'Platform Engineer', summary: ['Builds reliable systems.'] },
      skills: [{ group: 'Engineering', items: ['TypeScript', 'Distributed systems'] }],
      experiences: [{ company: 'Example Co', role: 'Engineer', period: '2024–2026', bullets: ['Improved reliability by 30%.'] }],
      metadata: { source: 'paste', locale: 'en', updatedAt: '2026-08-19T08:00:00.000Z' }
    })
    const bytes = renderResumePdf(resume)
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.4')
    expect(bytes.byteLength).toBeLessThan(1_000_000)
    expect(resumePdfFileName(resume, 'Example / Platform')).toBe('Example-Platform.pdf')
    const parser = new PDFParse({ data: bytes })
    try {
      const result = await parser.getText()
      expect(result.text).toContain('Ada Candidate')
      expect(result.text).toContain('Improved reliability by 30%.')
    } finally {
      await parser.destroy()
    }
  })

  it('emits selectable Chinese text with a Unicode mapping', async () => {
    const resume = normalizeResumeData({
      profile: { name: '张三', title: '平台工程师', summary: ['负责高可用平台建设'] },
      metadata: { source: 'paste', locale: 'zh', updatedAt: '2026-08-19T08:00:00.000Z' }
    })
    const parser = new PDFParse({ data: renderResumePdf(resume) })
    try {
      const result = await parser.getText()
      expect(result.text).toContain('张三')
      expect(result.text).toContain('负责高可用平台建设')
      const screenshot = await parser.getScreenshot({ desiredWidth: 600, imageDataUrl: false })
      expect(screenshot.pages[0]?.data.byteLength).toBeGreaterThan(1_000)
    } finally {
      await parser.destroy()
    }
  })

  it('paginates long resumes without dropping the final evidence line', async () => {
    const bullets = Array.from({ length: 120 }, (_, index) => `Delivered verified outcome ${index + 1}.`)
    const resume = normalizeResumeData({
      profile: { name: 'Long Candidate', title: 'Engineer' },
      experiences: [{ company: 'Example Co', role: 'Engineer', period: '2020–2026', bullets }],
      metadata: { source: 'paste', locale: 'en', updatedAt: '2026-08-19T08:00:00.000Z' }
    })
    const bytes = renderResumePdf(resume)
    expect(new TextDecoder().decode(bytes)).toMatch(/\/Count [2-9]/u)
    const parser = new PDFParse({ data: bytes })
    try {
      expect((await parser.getText()).text).toContain('Delivered verified outcome 120.')
    } finally {
      await parser.destroy()
    }
  })
})
