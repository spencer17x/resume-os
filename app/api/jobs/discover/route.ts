import { z } from 'zod'
import { createStableJobDomainId, jobSourceSchema } from '@/lib/jobs/job-domain'
import { createJobSourceRegistry } from '@/lib/jobs/sources'
import { JobSourceError, type JobSourceAdapter } from '@/lib/jobs/sources/types'
import { apiErrorResponse, guardAiRequest, type AiRequestGuard } from '@/lib/server/request-guard'
import { readLimitedJson, requestJsonErrorResponse } from '@/lib/server/request-json'

const MAX_DISCOVER_BODY_BYTES = 1_024
export const DEFAULT_DISCOVER_RATE_LIMIT = { limit: 30, windowMs: 60_000 } as const
const discoverRequestSchema = z.object({
  source: z.enum(['greenhouse', 'lever']),
  sourceKey: z.string().trim().min(1).max(128)
}).strict()

export function createDiscoverJobsRoute(dependencies: {
  guard?: AiRequestGuard
  adapters?: ReadonlyMap<string, JobSourceAdapter>
  now?: () => string
  rateLimit?: { limit: number; windowMs: number }
} = {}) {
  const guardRequest = dependencies.guard ?? guardAiRequest
  const adapters = dependencies.adapters ?? createJobSourceRegistry()
  const now = dependencies.now ?? (() => new Date().toISOString())
  const rateLimit = dependencies.rateLimit ?? DEFAULT_DISCOVER_RATE_LIMIT

  return async function discoverJobsRoute(request: Request) {
    const guarded = guardRequest(request, {
      bucket: 'jobs-discover',
      ...rateLimit,
      maxBodyBytes: MAX_DISCOVER_BODY_BYTES,
      browserAccess: 'same-origin'
    })
    if (guarded) return guarded

    let input: unknown
    try {
      input = await readLimitedJson(request, MAX_DISCOVER_BODY_BYTES)
    } catch (error) {
      return requestJsonErrorResponse(error) ?? apiErrorResponse('INVALID_REQUEST', 400)
    }
    const parsed = discoverRequestSchema.safeParse(input)
    if (!parsed.success) return apiErrorResponse('JOB_SOURCE_INVALID', 400)
    const adapter = adapters.get(parsed.data.source)
    if (!adapter) return apiErrorResponse('JOB_SOURCE_INVALID', 400)

    try {
      const sourceKey = adapter.validateSourceKey(parsed.data.sourceKey)
      const timestamp = now()
      const source = jobSourceSchema.parse({
        id: createStableJobDomainId('job-source', [parsed.data.source, sourceKey]),
        kind: parsed.data.source,
        label: sourceKey,
        sourceKey,
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      return Response.json(await adapter.refresh({ source, signal: request.signal }))
    } catch (error) {
      return jobSourceErrorResponse(error)
    }
  }
}

function jobSourceErrorResponse(error: unknown) {
  if (!(error instanceof JobSourceError)) return apiErrorResponse('JOB_SOURCE_UNAVAILABLE', 502)
  switch (error.code) {
    case 'INVALID_SOURCE': return apiErrorResponse('JOB_SOURCE_INVALID', 400)
    case 'RATE_LIMITED':
      return apiErrorResponse('RATE_LIMITED', 429, error.retryAfterSeconds > 0
        ? { 'Retry-After': String(error.retryAfterSeconds) }
        : undefined)
    case 'RESPONSE_TOO_LARGE': return apiErrorResponse('JOB_SOURCE_RESPONSE_TOO_LARGE', 502)
    case 'REQUEST_TIMEOUT': return apiErrorResponse('JOB_SOURCE_TIMEOUT', 504)
    case 'REQUEST_ABORTED': return apiErrorResponse('REQUEST_ABORTED', 499)
    default: return apiErrorResponse('JOB_SOURCE_UNAVAILABLE', 502)
  }
}

export const POST = createDiscoverJobsRoute()
