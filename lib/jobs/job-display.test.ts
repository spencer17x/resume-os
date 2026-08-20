import { describe, expect, it } from 'vitest'
import { formatMonthlyCompensation, recommendationReasonMessageKey, sanitizeJobDisplayText } from './job-display'

describe('job display helpers', () => {
  it('removes BOSS icon-font and watermark artifacts', () => {
    expect(sanitizeJobDisplayText('工作职BOSS直聘责\uE033 负责 TypeScript')).toBe('工作职责 负责 TypeScript')
  })

  it('turns internal score codes into user-facing message keys', () => {
    expect(recommendationReasonMessageKey('career-fact-tag-overlap', 0)).toBe('careerEvidenceMissing')
    expect(recommendationReasonMessageKey('career-fact-tag-overlap', 12)).toBe('careerEvidenceMatched')
  })

  it('formats monthly salary ranges for job cards', () => {
    expect(formatMonthlyCompensation({ compensation: { minimum: 25_000, maximum: 45_000, currency: 'CNY', period: 'month' }, location: '杭州' } as never)).toBe('25K–45K/月')
  })
})
