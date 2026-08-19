import { describe, expect, it } from 'vitest'
import { normalizeResumeData } from '@/lib/resume-model'
import {
  assertMarketplaceJobUrl,
  automaticSourceKinds,
  buildOfficialMarketplaceSearchUrl,
  detectMarketplaceFromJobUrl,
  deriveJobSearchSeed
} from './job-marketplace'

describe('job marketplace capabilities', () => {
  it('derives a bounded initial search from structured resume evidence', () => {
    const resume = normalizeResumeData({
      profile: {
        name: 'Ada',
        title: 'Platform Engineer',
        location: 'Shanghai',
        tags: ['TypeScript'],
        links: [],
        summary: []
      },
      targetRole: 'Staff Platform Engineer',
      skills: [{ group: 'Core', items: ['TypeScript', 'Kubernetes'] }],
      experiences: [{ company: 'Example', role: 'Platform Engineer', period: '2024', tags: ['Cloud'], bullets: [] }],
      projects: [], education: [], certifications: [], awards: [], languages: [], openSource: []
    })

    expect(deriveJobSearchSeed(resume)).toEqual({
      name: 'Staff Platform Engineer search',
      titles: ['Staff Platform Engineer', 'Platform Engineer'],
      locations: ['Shanghai'],
      preferredTerms: ['TypeScript', 'Kubernetes', 'Cloud']
    })
  })

  it('only returns source kinds for marketplaces with reviewed automatic adapters', () => {
    expect(automaticSourceKinds(['boss', 'greenhouse', '51job', 'lever', '58']))
      .toEqual(['greenhouse', 'lever'])
  })

  it('builds HTTPS official search links without allowing a caller-provided host', () => {
    const boss = new URL(buildOfficialMarketplaceSearchUrl({
      platform: 'boss',
      title: '前端工程师 & AI'
    }))
    expect(boss.origin).toBe('https://www.zhipin.com')
    expect(boss.searchParams.get('query')).toBe('前端工程师 & AI')

    const job51 = new URL(buildOfficialMarketplaceSearchUrl({
      platform: '51job',
      title: '平台工程师',
      location: '上海'
    }))
    expect(job51.origin).toBe('https://we.51job.com')
    expect(job51.searchParams.get('keyword')).toBe('平台工程师')

    expect(new URL(buildOfficialMarketplaceSearchUrl({ platform: '58', title: '客服' })).origin)
      .toBe('https://www.58.com')

    const lagou = new URL(buildOfficialMarketplaceSearchUrl({ platform: 'lagou', title: '前端工程师' }))
    expect(lagou.origin).toBe('https://www.lagou.com')
    expect(lagou.searchParams.get('kd')).toBe('前端工程师')

    const liepin = new URL(buildOfficialMarketplaceSearchUrl({ platform: 'liepin', title: '产品经理' }))
    expect(liepin.origin).toBe('https://www.liepin.com')
    expect(liepin.searchParams.get('key')).toBe('产品经理')
  })

  it('accepts only HTTPS job URLs on the selected marketplace host', () => {
    expect(assertMarketplaceJobUrl('boss', 'https://www.zhipin.com/job_detail/abc.html#detail')).toBe(
      'https://www.zhipin.com/job_detail/abc.html'
    )
    expect(assertMarketplaceJobUrl('51job', 'https://jobs.51job.com/example.html')).toBe(
      'https://jobs.51job.com/example.html'
    )
    expect(() => assertMarketplaceJobUrl('boss', 'https://jobs.51job.com/example.html')).toThrow()
    expect(() => assertMarketplaceJobUrl('boss', 'https://zhipin.com.evil.example/job')).toThrow()
    expect(() => assertMarketplaceJobUrl('58', 'http://www.58.com/job/1')).toThrow()
    expect(detectMarketplaceFromJobUrl('https://jobs.51job.com/example.html')).toBe('51job')
    expect(detectMarketplaceFromJobUrl('https://www.lagou.com/jobs/1.html')).toBe('lagou')
    expect(detectMarketplaceFromJobUrl('https://www.liepin.com/job/1.shtml')).toBe('liepin')
    expect(detectMarketplaceFromJobUrl('https://example.com/job')).toBeUndefined()
  })
})
