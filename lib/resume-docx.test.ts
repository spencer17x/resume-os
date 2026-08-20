import { describe, expect, it } from 'vitest'
import yauzl from 'yauzl'
import { normalizeResumeData } from './resume-model'
import { renderResumeDocx, resumeDocxFileName } from './resume-docx'

describe('resume DOCX rendering', () => {
  it('creates a bounded valid ZIP with escaped UTF-8 resume content', async () => {
    const resume = normalizeResumeData({
      profile: { name: '张三 / Ada', title: '平台工程师', summary: ['负责 A&B <平台>'] },
      experiences: [{ company: '示例公司', role: '工程师', period: '2024–2026', bullets: ['交付组件库'] }],
      metadata: { source: 'paste', locale: 'zh', updatedAt: '2026-08-19T08:00:00.000Z' }
    })
    const bytes = renderResumeDocx(resume)
    expect(bytes.byteLength).toBeLessThan(1_000_000)
    expect(resumeDocxFileName(resume, '示例/平台')).toBe('示例-平台.docx')
    const entries = await readZip(bytes)
    expect(entries.keys()).toContain('word/document.xml')
    expect(entries.get('word/document.xml')).toContain('张三 / Ada')
    expect(entries.get('word/document.xml')).toContain('A&amp;B &lt;平台&gt;')
  })
})

function readZip(bytes: Uint8Array) {
  return new Promise<Map<string, string>>((resolve, reject) => {
    yauzl.fromBuffer(Buffer.from(bytes), { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('ZIP unavailable'))
      const entries = new Map<string, string>()
      zip.readEntry()
      zip.on('entry', (entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error('Entry unavailable'))
          const chunks: Buffer[] = []
          stream.on('data', (chunk: Buffer) => chunks.push(chunk))
          stream.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks).toString('utf8')); zip.readEntry() })
        })
      })
      zip.on('end', () => resolve(entries))
      zip.on('error', reject)
    })
  })
}
