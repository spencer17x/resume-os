import { z } from 'zod'
import type { JobPosting } from '../job-domain'
import { createSourceHttpClient } from './http'
import {
  normalizeEmploymentType,
  normalizeSourcePosting,
  normalizeWorkplaceType
} from './normalize'
import {
  JobSourceError,
  MAX_SOURCE_POSTINGS,
  type JobSourceAdapter,
  type JobSourceAdapterDependencies
} from './types'

const leverListSchema = z.array(z.unknown()).max(MAX_SOURCE_POSTINGS)
const leverJobSchema = z.object({
  id: z.string().trim().min(1).max(300),
  text: z.string().trim().min(1).max(300),
  hostedUrl: z.string().trim().min(1).max(2_000),
  applyUrl: z.string().trim().min(1).max(2_000),
  description: z.string().max(140_000).optional(),
  descriptionPlain: z.string().max(140_000).optional(),
  additional: z.string().max(140_000).optional(),
  workplaceType: z.string().trim().max(80).optional(),
  categories: z.object({
    commitment: z.string().trim().max(120).optional(),
    location: z.string().trim().max(500).optional()
  }).passthrough().optional(),
  lists: z.array(z.object({
    text: z.string().trim().max(500).optional(),
    content: z.string().max(140_000).optional()
  }).passthrough()).max(100).optional()
}).passthrough()

const sourceKeyPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/iu
const recognizedHosts = new Set(['jobs.lever.co', 'jobs.eu.lever.co', 'api.lever.co'])

export function createLeverAdapter(
  dependencies: JobSourceAdapterDependencies = {}
): JobSourceAdapter {
  const http = createSourceHttpClient(dependencies)
  const now = dependencies.now ?? (() => new Date().toISOString())

  return {
    kind: 'lever',

    validateSourceKey(value) {
      const normalized = value.trim()
      if (!sourceKeyPattern.test(normalized)) throw new JobSourceError('INVALID_SOURCE')
      return normalized
    },

    recognizeUrl(url) {
      if (url.protocol !== 'https:' || !recognizedHosts.has(url.hostname.toLowerCase())) return null
      const segments = url.pathname.split('/').filter(Boolean)
      const sourceKey = segments[0] === 'v0' && segments[1] === 'postings'
        ? segments[2]
        : segments[0]
      const externalId = segments[0] === 'v0' && segments[1] === 'postings'
        ? segments[3]
        : segments[1]
      if (!sourceKey || !sourceKeyPattern.test(sourceKey)) return null
      return { sourceKey, ...(externalId ? { externalId } : {}) }
    },

    async refresh({ source, signal }) {
      if (source.kind !== 'lever' || !source.sourceKey) {
        throw new JobSourceError('INVALID_SOURCE')
      }
      const sourceKey = this.validateSourceKey(source.sourceKey)
      const url = new URL(`https://api.lever.co/v0/postings/${encodeURIComponent(sourceKey)}`)
      url.searchParams.set('mode', 'json')
      const raw = leverListSchema.safeParse(await http.getJson(url, signal))
      if (!raw.success) throw new JobSourceError('RESPONSE_INVALID', 0, { cause: raw.error })

      const checkedAt = now()
      const postings: JobPosting[] = []
      const warnings: string[] = []
      const externalIds = new Set<string>()
      raw.data.forEach((candidate, index) => {
        const parsed = leverJobSchema.safeParse(candidate)
        if (!parsed.success || externalIds.has(parsed.data?.id ?? '')) {
          warnings.push(`lever-item-${index}-invalid`)
          return
        }
        const description = [
          parsed.data.descriptionPlain ?? parsed.data.description,
          ...(parsed.data.lists ?? []).flatMap((list) => [list.text, list.content]),
          parsed.data.additional
        ].filter((value): value is string => Boolean(value?.trim())).join('\n')
        try {
          postings.push(normalizeSourcePosting(source, {
            externalId: parsed.data.id,
            canonicalUrl: parsed.data.hostedUrl,
            applyUrl: parsed.data.applyUrl,
            title: parsed.data.text,
            description,
            ...(parsed.data.categories?.location
              ? { location: parsed.data.categories.location }
              : {}),
            ...(normalizeWorkplaceType(parsed.data.workplaceType)
              ? { workplaceType: normalizeWorkplaceType(parsed.data.workplaceType) }
              : {}),
            ...(normalizeEmploymentType(parsed.data.categories?.commitment)
              ? { employmentType: normalizeEmploymentType(parsed.data.categories?.commitment) }
              : {})
          }, checkedAt))
          externalIds.add(parsed.data.id)
        } catch {
          warnings.push(`lever-item-${index}-invalid`)
        }
      })
      if (raw.data.length > 0 && postings.length === 0) {
        throw new JobSourceError('RESPONSE_INVALID')
      }
      return {
        sourceId: source.id,
        completeness: warnings.length > 0 ? 'partial' : 'complete',
        checkedAt,
        postings,
        warnings
      }
    }
  }
}
