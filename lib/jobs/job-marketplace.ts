import { z } from 'zod'
import type { ResumeData } from '@/lib/resume-model'

export const JOB_MARKETPLACE_IDS = [
  'greenhouse',
  'lever',
  'boss',
  '51job',
  'lagou',
  'liepin',
  '58'
] as const

export const PRIMARY_JOB_MARKETPLACE_IDS = [
  'boss'
] as const satisfies readonly JobMarketplaceId[]

export const jobMarketplaceIdSchema = z.enum(JOB_MARKETPLACE_IDS)

export type JobMarketplaceId = z.infer<typeof jobMarketplaceIdSchema>
export type JobMarketplaceCapability = 'automatic' | 'official-search' | 'partner-required'

export type JobMarketplaceDefinition = {
  id: JobMarketplaceId
  capability: JobMarketplaceCapability
  sourceKind?: 'greenhouse' | 'lever'
  officialUrl: string
}

export const jobMarketplaceRegistry = {
  greenhouse: {
    id: 'greenhouse',
    capability: 'automatic',
    sourceKind: 'greenhouse',
    officialUrl: 'https://www.greenhouse.com/'
  },
  lever: {
    id: 'lever',
    capability: 'automatic',
    sourceKind: 'lever',
    officialUrl: 'https://www.lever.co/'
  },
  boss: {
    id: 'boss',
    capability: 'official-search',
    officialUrl: 'https://www.zhipin.com/'
  },
  '51job': {
    id: '51job',
    capability: 'official-search',
    officialUrl: 'https://we.51job.com/'
  },
  lagou: {
    id: 'lagou',
    capability: 'official-search',
    officialUrl: 'https://www.lagou.com/'
  },
  liepin: {
    id: 'liepin',
    capability: 'official-search',
    officialUrl: 'https://www.liepin.com/'
  },
  '58': {
    id: '58',
    capability: 'partner-required',
    officialUrl: 'https://www.58.com/job/'
  }
} as const satisfies Record<JobMarketplaceId, JobMarketplaceDefinition>

export const DEFAULT_JOB_MARKETPLACES: readonly JobMarketplaceId[] = [...PRIMARY_JOB_MARKETPLACE_IDS]

const marketplaceJobHosts: Record<JobMarketplaceId, readonly string[]> = {
  greenhouse: ['greenhouse.io'],
  lever: ['lever.co'],
  boss: ['zhipin.com'],
  '51job': ['51job.com'],
  lagou: ['lagou.com'],
  liepin: ['liepin.com'],
  '58': ['58.com']
}

export type JobSearchSeed = {
  name: string
  titles: string[]
  locations: string[]
  preferredTerms: string[]
}

export function deriveJobSearchSeed(resume: ResumeData): JobSearchSeed {
  const titles = uniqueBounded([
    resume.targetRole,
    resume.profile.title,
    ...resume.experiences.map((experience) => experience.role)
  ], 8)
  const preferredTerms = uniqueBounded([
    ...resume.profile.tags,
    ...resume.skills.flatMap((skill) => skill.items),
    ...resume.experiences.flatMap((experience) => experience.tags),
    ...resume.projects.flatMap((project) => project.tags)
  ], 24)
  return {
    name: titles[0] ? `${titles[0]} search` : 'Resume search',
    titles,
    locations: uniqueBounded([resume.profile.location], 5),
    preferredTerms
  }
}

export function automaticSourceKinds(platforms: readonly JobMarketplaceId[]) {
  return platforms.flatMap((platform) => {
    const definition = jobMarketplaceRegistry[platform]
    return 'sourceKind' in definition ? [definition.sourceKind] : []
  })
}

export function buildOfficialMarketplaceSearchUrl(input: {
  platform: Extract<JobMarketplaceId, 'boss' | '51job' | 'lagou' | 'liepin' | '58'>
  title?: string
  location?: string
}) {
  const title = input.title?.trim() ?? ''
  if (input.platform === 'boss') {
    const url = new URL('/web/geek/job', 'https://www.zhipin.com')
    if (title) url.searchParams.set('query', title)
    return url.toString()
  }
  if (input.platform === '51job') {
    const url = new URL('/pc/search', 'https://we.51job.com')
    if (title) url.searchParams.set('keyword', title)
    return url.toString()
  }
  if (input.platform === 'lagou') {
    const url = new URL('/wn/jobs', 'https://www.lagou.com')
    if (title) url.searchParams.set('kd', title)
    return url.toString()
  }
  if (input.platform === 'liepin') {
    const url = new URL('/zhaopin/', 'https://www.liepin.com')
    if (title) url.searchParams.set('key', title)
    return url.toString()
  }
  const url = new URL('/job/', 'https://www.58.com')
  if (title) url.searchParams.set('key', title)
  return url.toString()
}

export function assertMarketplaceJobUrl(platform: JobMarketplaceId, value: string) {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new TypeError('Job URL is invalid')
  }
  const allowed = marketplaceJobHosts[platform]
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || !allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  ) throw new TypeError('Job URL does not match the selected marketplace')
  url.hash = ''
  return url.toString()
}

export function detectMarketplaceFromJobUrl(value: string): JobMarketplaceId | undefined {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.username || url.password) return undefined
  return JOB_MARKETPLACE_IDS.find((platform) => (
    marketplaceJobHosts[platform].some((host) => (
      url.hostname === host || url.hostname.endsWith(`.${host}`)
    ))
  ))
}

function uniqueBounded(values: readonly (string | undefined)[], maximum: number) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value?.normalize('NFKC').trim()
    if (!normalized) continue
    const identity = normalized.toLocaleLowerCase()
    if (seen.has(identity)) continue
    seen.add(identity)
    result.push(normalized.slice(0, 120))
    if (result.length === maximum) break
  }
  return result
}
