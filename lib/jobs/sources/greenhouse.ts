import { z } from 'zod'
import type { JobPosting } from '../job-domain'
import { createSourceHttpClient } from './http'
import { normalizeSourcePosting } from './normalize'
import {
  JobSourceError,
  MAX_SOURCE_POSTINGS,
  type JobSourceAdapter,
  type JobSourceAdapterDependencies
} from './types'

const greenhouseListSchema = z.object({
  jobs: z.array(z.unknown()).max(MAX_SOURCE_POSTINGS)
}).passthrough()

const greenhouseJobSchema = z.object({
  id: z.union([z.string().trim().min(1).max(300), z.number().int().nonnegative()])
    .transform(String),
  title: z.string().trim().min(1).max(300),
  updated_at: z.string().trim().min(1).max(100).optional(),
  absolute_url: z.string().trim().min(1).max(2_000),
  content: z.string().trim().min(1).max(140_000),
  language: z.string().trim().min(1).max(20).optional(),
  location: z.object({ name: z.string().trim().min(1).max(500) }).passthrough().optional()
}).passthrough()

const sourceKeyPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/iu
const recognizedHosts = new Set([
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'boards-api.greenhouse.io'
])

export function createGreenhouseAdapter(
  dependencies: JobSourceAdapterDependencies = {}
): JobSourceAdapter {
  const http = createSourceHttpClient(dependencies)
  const now = dependencies.now ?? (() => new Date().toISOString())

  return {
    kind: 'greenhouse',

    validateSourceKey(value) {
      const normalized = value.trim()
      if (!sourceKeyPattern.test(normalized)) throw new JobSourceError('INVALID_SOURCE')
      return normalized
    },

    recognizeUrl(url) {
      if (url.protocol !== 'https:' || !recognizedHosts.has(url.hostname.toLowerCase())) return null
      const segments = url.pathname.split('/').filter(Boolean)
      const jobsIndex = segments.indexOf('jobs')
      const sourceKey = segments[0]
      if (!sourceKey || !sourceKeyPattern.test(sourceKey)) return null
      return {
        sourceKey,
        ...(jobsIndex >= 0 && segments[jobsIndex + 1]
          ? { externalId: segments[jobsIndex + 1] }
          : {})
      }
    },

    async refresh({ source, signal }) {
      if (source.kind !== 'greenhouse' || !source.sourceKey) {
        throw new JobSourceError('INVALID_SOURCE')
      }
      const sourceKey = this.validateSourceKey(source.sourceKey)
      const url = new URL(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(sourceKey)}/jobs`
      )
      url.searchParams.set('content', 'true')
      const raw = greenhouseListSchema.safeParse(await http.getJson(url, signal))
      if (!raw.success) throw new JobSourceError('RESPONSE_INVALID', 0, { cause: raw.error })

      const checkedAt = now()
      const postings: JobPosting[] = []
      const warnings: string[] = []
      const externalIds = new Set<string>()
      raw.data.jobs.forEach((candidate, index) => {
        const parsed = greenhouseJobSchema.safeParse(candidate)
        if (!parsed.success || externalIds.has(parsed.data?.id ?? '')) {
          warnings.push(`greenhouse-item-${index}-invalid`)
          return
        }
        try {
          const sourceUpdatedAt = normalizeTimestamp(parsed.data.updated_at)
          postings.push(normalizeSourcePosting(source, {
            externalId: parsed.data.id,
            canonicalUrl: parsed.data.absolute_url,
            applyUrl: parsed.data.absolute_url,
            title: parsed.data.title,
            description: parsed.data.content,
            ...(parsed.data.language?.toLowerCase().startsWith('zh') ? { locale: 'zh' as const } : {}),
            ...(parsed.data.location?.name ? { location: parsed.data.location.name } : {}),
            ...(sourceUpdatedAt ? { sourceUpdatedAt } : {})
          }, checkedAt))
          externalIds.add(parsed.data.id)
        } catch {
          warnings.push(`greenhouse-item-${index}-invalid`)
        }
      })
      if (raw.data.jobs.length > 0 && postings.length === 0) {
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

function normalizeTimestamp(value: string | undefined) {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}
