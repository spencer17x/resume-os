import {
  MAX_JOB_DESCRIPTION_LENGTH,
  createJobInputFingerprint,
  createStableJobDomainId,
  jobPostingSchema,
  type JobEmploymentType,
  type JobPosting,
  type JobSource,
  type JobWorkplaceType
} from '../job-domain'

export type NormalizedPostingInput = {
  externalId: string
  canonicalUrl: string
  applyUrl: string
  title: string
  description: string
  locale?: 'zh' | 'en'
  location?: string
  workplaceType?: JobWorkplaceType
  employmentType?: JobEmploymentType
  sourceUpdatedAt?: string
}

export function normalizeSourcePosting(
  source: JobSource,
  input: NormalizedPostingInput,
  checkedAt: string
): JobPosting {
  const description = htmlToBoundedText(input.description)
  const normalized = {
    sourceId: source.id,
    externalId: input.externalId.trim(),
    canonicalUrl: input.canonicalUrl.trim(),
    applyUrl: input.applyUrl.trim(),
    title: normalizeInlineText(input.title),
    company: normalizeInlineText(source.label),
    description,
    locale: input.locale ?? inferLocale(`${input.title}\n${description}`),
    ...(input.location ? { location: normalizeInlineText(input.location) } : {}),
    ...(input.workplaceType ? { workplaceType: input.workplaceType } : {}),
    ...(input.employmentType ? { employmentType: input.employmentType } : {}),
    ...(input.sourceUpdatedAt ? { sourceUpdatedAt: input.sourceUpdatedAt } : {})
  }
  return jobPostingSchema.parse({
    id: createStableJobDomainId('posting', [
      source.kind,
      source.sourceKey ?? source.id,
      normalized.externalId
    ]),
    ...normalized,
    firstSeenAt: checkedAt,
    lastCheckedAt: checkedAt,
    status: 'open',
    contentHash: createJobInputFingerprint(normalized)
  })
}

export function htmlToBoundedText(value: string) {
  const withoutDangerousBlocks = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
  const withBreaks = withoutDangerousBlocks
    .replace(/<(?:br|\/p|\/div|\/li|\/section|\/article|\/h[1-6])\s*\/?>/giu, '\n')
    .replace(/<li\b[^>]*>/giu, '• ')
  const decoded = decodeHtmlEntities(withBreaks.replace(/<[^>]*>/gu, ' '))
  const normalized = decoded
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  if (!normalized || normalized.length > MAX_JOB_DESCRIPTION_LENGTH) {
    throw new TypeError('Normalized job description is empty or too large')
  }
  return normalized
}

export function normalizeEmploymentType(value: string | undefined) {
  if (!value) return undefined
  const normalized = value.normalize('NFKC').trim().toLowerCase().replace(/[ _]+/gu, '-')
  const aliases: Record<string, JobEmploymentType> = {
    'full-time': 'full-time',
    fulltime: 'full-time',
    'part-time': 'part-time',
    parttime: 'part-time',
    contract: 'contract',
    contractor: 'contract',
    internship: 'internship',
    intern: 'internship'
  }
  return aliases[normalized]
}

export function normalizeWorkplaceType(value: string | undefined) {
  if (!value) return undefined
  const normalized = value.normalize('NFKC').trim().toLowerCase()
  return ['remote', 'hybrid', 'onsite'].includes(normalized)
    ? normalized as JobWorkplaceType
    : undefined
}

function normalizeInlineText(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/gu, ' ')).replace(/\s+/gu, ' ').trim()
}

function inferLocale(value: string): 'zh' | 'en' {
  return /\p{Script=Han}/u.test(value) ? 'zh' : 'en'
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, code: string) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity
    const numeric = code[1]?.toLowerCase() === 'x'
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10)
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 0x10ffff
      ? String.fromCodePoint(numeric)
      : entity
  })
}
