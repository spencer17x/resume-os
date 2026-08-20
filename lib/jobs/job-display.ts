import type { JobPosting } from './job-domain'

export function sanitizeJobDisplayText(value: string) {
  return value.normalize('NFKC')
    .replace(/BOSS直聘/gu, '')
    .replace(/[\uE000-\uF8FF]/gu, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function recommendationReasonMessageKey(code: string, contribution: number) {
  if (code === 'career-fact-tag-overlap') return contribution > 0 ? 'careerEvidenceMatched' : 'careerEvidenceMissing'
  if (code === 'title-role-relevance') return 'titleRoleRelevance'
  if (code === 'soft-preference-fit') return 'preferenceFit'
  if (code === 'posting-freshness') return 'postingFreshness'
  if (code === 'blocked-company') return 'blockedCompany'
  if (code === 'required-term-missing') return 'requiredTermMissing'
  if (code === 'salary-below-minimum') return 'salaryBelowMinimum'
  return 'other'
}

export function formatMonthlyCompensation(posting: JobPosting) {
  const compensation = posting.compensation
  if (!compensation) return posting.location ?? ''
  const amount = (value: number | undefined) => value === undefined
    ? ''
    : value >= 1_000 && value % 1_000 === 0
      ? `${value / 1_000}K`
      : new Intl.NumberFormat('zh-CN').format(value)
  const range = [amount(compensation.minimum), amount(compensation.maximum)].filter(Boolean).join('–')
  return range ? `${range}/${compensation.period === 'month' ? '月' : compensation.period ?? '月'}` : posting.location ?? ''
}
