import { describe, expect, it } from 'vitest'
import { MAX_JOB_CLIPBOARD_LENGTH, parseJobClipboardText } from './job-clipboard-import'

describe('parseJobClipboardText', () => {
  it('extracts a labeled Chinese marketplace share locally', () => {
    expect(parseJobClipboardText(`
职位：高级平台工程师
公司：示例科技
地点：上海
链接：https://www.zhipin.com/job_detail/example.html?from=share
职位描述：
负责 TypeScript 开发者平台建设。
提升交付可靠性。
    `)).toEqual({
      platform: 'boss',
      url: 'https://www.zhipin.com/job_detail/example.html?from=share',
      title: '高级平台工程师',
      company: '示例科技',
      location: '上海',
      description: '负责 TypeScript 开发者平台建设。\n提升交付可靠性。'
    })
  })

  it('extracts inline English labels and leaves unknown hosts for review', () => {
    expect(parseJobClipboardText(`
Job title: Platform Engineer
Company: Example
Location: Remote
URL: https://careers.example.com/job/1
Job description: Build reliable systems.
    `)).toEqual({
      url: 'https://careers.example.com/job/1',
      title: 'Platform Engineer',
      company: 'Example',
      location: 'Remote',
      description: 'Build reliable systems.'
    })
  })

  it('rejects empty and oversized clipboard input', () => {
    expect(() => parseJobClipboardText('  ')).toThrow()
    expect(() => parseJobClipboardText('x'.repeat(MAX_JOB_CLIPBOARD_LENGTH + 1))).toThrow()
  })
})
