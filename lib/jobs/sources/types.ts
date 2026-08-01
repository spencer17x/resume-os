import { z } from 'zod'
import { jobPostingSchema, type JobPosting, type JobSource } from '../job-domain'

export const MAX_SOURCE_RESPONSE_BYTES = 2 * 1024 * 1024
export const MAX_SOURCE_POSTINGS = 500
export const DEFAULT_SOURCE_TIMEOUT_MS = 15_000

export type JobSourceRefreshInput = {
  source: JobSource
  signal?: AbortSignal
}

export type JobSourceRefreshResult = {
  sourceId: string
  completeness: 'complete' | 'partial'
  checkedAt: string
  postings: JobPosting[]
  warnings: string[]
}

export const jobSourceRefreshResultSchema = z.object({
  sourceId: z.string().trim().min(1).max(160),
  completeness: z.enum(['complete', 'partial']),
  checkedAt: z.iso.datetime({ offset: true }),
  postings: z.array(jobPostingSchema).max(MAX_SOURCE_POSTINGS),
  warnings: z.array(z.string().trim().min(1).max(300)).max(MAX_SOURCE_POSTINGS)
}).strict()

export type JobSourceFetch = typeof fetch

export type JobSourceAdapterDependencies = {
  fetch?: JobSourceFetch
  now?: () => string
  timeoutMs?: number
  maxResponseBytes?: number
}

export interface JobSourceAdapter {
  readonly kind: JobSource['kind']
  validateSourceKey(value: string): string
  recognizeUrl(url: URL): { sourceKey: string; externalId?: string } | null
  refresh(input: JobSourceRefreshInput): Promise<JobSourceRefreshResult>
}

export type JobSourceErrorCode =
  | 'INVALID_SOURCE'
  | 'REQUEST_FAILED'
  | 'RATE_LIMITED'
  | 'REDIRECT_BLOCKED'
  | 'RESPONSE_TOO_LARGE'
  | 'RESPONSE_INVALID'
  | 'REQUEST_ABORTED'
  | 'REQUEST_TIMEOUT'

export class JobSourceError extends Error {
  constructor(
    readonly code: JobSourceErrorCode,
    readonly retryAfterSeconds = 0,
    options?: { cause?: unknown }
  ) {
    super(code, options)
    this.name = 'JobSourceError'
  }
}
