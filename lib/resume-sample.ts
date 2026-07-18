import { getResumeData } from '@/data/resume'
import type { Locale } from '@/i18n/routing'
import { normalizeResumeData } from './resume-model'

const SAMPLE_UPDATED_AT = '2026-07-06T00:00:00.000Z'

export function getEmptyResumeData(locale: Locale) {
  return normalizeResumeData({}, {
    source: 'sample',
    locale,
    now: SAMPLE_UPDATED_AT
  })
}

export function getSampleResumeData(locale: Locale) {
  const data = getResumeData(locale)

  return normalizeResumeData(
    {
      ...data,
      profile: {
        ...data.profile,
        links: [
          { label: 'GitHub', url: data.profile.github },
          { label: 'Blog', url: data.profile.blog }
        ]
      },
      education: [],
      certifications: [],
      awards: [],
      languages: locale === 'zh' ? ['中文', 'English'] : ['Chinese', 'English'],
      metadata: {
        source: 'sample',
        locale,
        updatedAt: SAMPLE_UPDATED_AT
      }
    },
    { source: 'sample', locale, now: SAMPLE_UPDATED_AT }
  )
}
