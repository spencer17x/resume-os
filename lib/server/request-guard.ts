import { createHash, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import {
  AI_API_KEY_HEADER,
  AI_BASE_URL_HEADER,
  AI_MODEL_HEADER
} from '@/lib/agent/provider-headers'

export type ApiErrorCode =
  | 'AI_PUBLIC_ACCESS_DISABLED'
  | 'AI_ACCESS_MISCONFIGURED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_REQUEST'
  | 'CONTENT_LENGTH_REQUIRED'
  | 'FILE_REQUIRED'
  | 'UNEXPECTED_MULTIPART'
  | 'UNSUPPORTED_FILE'
  | 'INVALID_FILE_SIGNATURE'
  | 'EMPTY_TEXT'
  | 'EXTRACTION_LIMIT'
  | 'EXTRACTION_FAILED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_UNAVAILABLE'
  | 'AI_OUTPUT_INVALID'
  | 'AI_OUTPUT_TOO_LARGE'
  | 'REQUEST_ABORTED'

const apiErrorMessages: Record<ApiErrorCode, string> = {
  AI_PUBLIC_ACCESS_DISABLED: 'Public AI access is disabled.',
  AI_ACCESS_MISCONFIGURED: 'AI access is not configured safely.',
  FORBIDDEN: 'Request is not allowed.',
  RATE_LIMITED: 'Too many requests. Try again later.',
  PAYLOAD_TOO_LARGE: 'Request payload is too large.',
  INVALID_REQUEST: 'Request data is invalid.',
  CONTENT_LENGTH_REQUIRED: 'Content-Length is required.',
  FILE_REQUIRED: 'A resume file is required.',
  UNEXPECTED_MULTIPART: 'Multipart request contains unexpected parts.',
  UNSUPPORTED_FILE: 'Resume file type is not supported.',
  INVALID_FILE_SIGNATURE: 'Resume file content does not match its type.',
  EMPTY_TEXT: 'No resume text could be extracted.',
  EXTRACTION_LIMIT: 'Resume file exceeds extraction limits.',
  EXTRACTION_FAILED: 'Unable to extract resume text.',
  AI_NOT_CONFIGURED: 'AI service is not configured.',
  AI_UNAVAILABLE: 'AI service is temporarily unavailable.',
  AI_OUTPUT_INVALID: 'AI service returned an invalid response.',
  AI_OUTPUT_TOO_LARGE: 'AI service response exceeded the allowed size.',
  REQUEST_ABORTED: 'Request was cancelled.'
}

export function apiErrorResponse(
  code: ApiErrorCode,
  status: number,
  headers?: HeadersInit
) {
  return Response.json(
    { error: apiErrorMessages[code], code },
    { status, headers }
  )
}

type RateEntry = { count: number; expiresAt: number }

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateEntry>()

  constructor(private readonly maxKeys = 1_000) {}

  get size() {
    return this.entries.size
  }

  consume(key: string, limit: number, windowMs: number, now = Date.now()) {
    this.pruneExpired(now)
    const current = this.entries.get(key)

    if (!current) {
      this.ensureCapacity()
      this.entries.set(key, { count: 1, expiresAt: now + windowMs })
      return { allowed: true, retryAfterSeconds: 0 }
    }

    if (current.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.expiresAt - now) / 1_000))
      }
    }

    current.count += 1
    return { allowed: true, retryAfterSeconds: 0 }
  }

  retryAfterSeconds(key: string, limit: number, now = Date.now()) {
    this.pruneExpired(now)
    const current = this.entries.get(key)
    if (!current || current.count < limit) return 0
    return Math.max(1, Math.ceil((current.expiresAt - now) / 1_000))
  }

  private pruneExpired(now: number) {
    for (const [key, entry] of this.entries) {
      if (now >= entry.expiresAt) this.entries.delete(key)
    }
  }

  private ensureCapacity() {
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}

const MIN_ACCESS_TOKEN_BYTES = 32
const AUTH_FAILURE_KEY = 'server-auth-failures'
const DEFAULT_AUTH_FAILURE_RATE_LIMIT = { limit: 8, windowMs: 60_000 }

export type AiRequestGuard = (request: Request, options: {
  bucket: string
  limit: number
  windowMs: number
  maxBodyBytes?: number
  browserAccess?: 'byok' | 'same-origin' | 'disabled'
}) => Response | null

export function createAiRequestGuard(dependencies: {
  limiter?: FixedWindowRateLimiter
  authFailureLimiter?: FixedWindowRateLimiter
  authFailureRateLimit?: { limit: number; windowMs: number }
  localOnly?: boolean
  accessToken?: string | null
  now?: () => number
} = {}): AiRequestGuard {
  const limiter = dependencies.limiter ?? new FixedWindowRateLimiter()
  const authFailureLimiter = dependencies.authFailureLimiter ?? new FixedWindowRateLimiter(1)
  const authFailureRateLimit = dependencies.authFailureRateLimit ?? DEFAULT_AUTH_FAILURE_RATE_LIMIT
  const localOnly = dependencies.localOnly ?? process.env.RESUME_OS_LOCAL_ONLY === '1'
  const accessToken = dependencies.accessToken === undefined
    ? process.env.RESUME_OS_AI_ACCESS_TOKEN ?? null
    : dependencies.accessToken
  const now = dependencies.now ?? Date.now

  return (request, options) => {
    if (localOnly) {
      if (!isAllowedLocalClient(request)) {
        return apiErrorResponse('AI_PUBLIC_ACCESS_DISABLED', 403)
      }
    } else {
      if (accessToken && Buffer.byteLength(accessToken, 'utf8') < MIN_ACCESS_TOKEN_BYTES) {
        return apiErrorResponse('AI_ACCESS_MISCONFIGURED', 503)
      }

      const browserRequest = request.headers.has('origin')
      if (browserRequest) {
        if (!isAllowedSameOriginBrowser(request) || options.browserAccess === 'disabled') {
          return apiErrorResponse('AI_PUBLIC_ACCESS_DISABLED', 403)
        }
        if ((options.browserAccess ?? 'byok') === 'byok' && !hasCompleteBrowserAiConfig(request)) {
          return apiErrorResponse('AI_NOT_CONFIGURED', 503)
        }
      } else if (!hasValidBearerToken(request, accessToken)) {
        const authNow = now()
        const authRetryAfter = authFailureLimiter.retryAfterSeconds(
          AUTH_FAILURE_KEY,
          authFailureRateLimit.limit,
          authNow
        )
        if (authRetryAfter > 0) {
          return apiErrorResponse('RATE_LIMITED', 429, {
            'Retry-After': String(authRetryAfter)
          })
        }

        const authFailure = authFailureLimiter.consume(
          AUTH_FAILURE_KEY,
          authFailureRateLimit.limit,
          authFailureRateLimit.windowMs,
          authNow
        )
        if (!authFailure.allowed) {
          return apiErrorResponse('RATE_LIMITED', 429, {
            'Retry-After': String(authFailure.retryAfterSeconds)
          })
        }
        return apiErrorResponse('AI_PUBLIC_ACCESS_DISABLED', 403)
      }
    }

    const declaredLength = request.headers.get('content-length')
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > (options.maxBodyBytes ?? Infinity))) {
      return apiErrorResponse(
        /^\d+$/.test(declaredLength) ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST',
        /^\d+$/.test(declaredLength) ? 413 : 400
      )
    }

    const key = `${options.bucket}:${resolveRateLimitIdentity(request)}`
    const result = limiter.consume(key, options.limit, options.windowMs, now())
    if (result.allowed) return null

    return apiErrorResponse('RATE_LIMITED', 429, {
      'Retry-After': String(result.retryAfterSeconds)
    })
  }
}

// This bounded process-local limiter is defense-in-depth for local or single-instance
// use only. A multi-tenant web deployment requires real user authentication and a
// distributed rate limiter before enabling its UI to call AI routes.
const processLocalLimiter = new FixedWindowRateLimiter()
const processAuthFailureLimiter = new FixedWindowRateLimiter(1)
export const guardAiRequest = createAiRequestGuard({
  limiter: processLocalLimiter,
  authFailureLimiter: processAuthFailureLimiter
})

function isAllowedLocalClient(request: Request) {
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false

  const origin = request.headers.get('origin')
  if (!origin) return true
  const originUrl = safeUrl(origin)
  return Boolean(originUrl && isLoopbackHost(originUrl.hostname))
}

function isAllowedSameOriginBrowser(request: Request) {
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') return false

  const origin = request.headers.get('origin')
  const originUrl = origin ? safeUrl(origin) : null
  const requestUrl = safeUrl(request.url)
  if (!originUrl || !requestUrl) return false
  if (originUrl.origin === requestUrl.origin) return true

  const host = request.headers.get('host')?.trim().toLowerCase()
  if (!host || host.length > 255 || /[\s,\/]/.test(host)) return false
  const protocol = trustedForwardedProtocol(request) ?? requestUrl.protocol
  return originUrl.host.toLowerCase() === host && originUrl.protocol === protocol
}

function trustedForwardedProtocol(request: Request) {
  const trustedProxy = process.env.RESUME_OS_TRUSTED_PROXY
  const trustsForwarding = trustedProxy === 'cloudflare'
    || (trustedProxy === 'vercel' && process.env.VERCEL === '1')
  if (!trustsForwarding) return null

  const protocol = request.headers.get('x-forwarded-proto')?.trim().toLowerCase()
  return protocol === 'http' || protocol === 'https' ? `${protocol}:` : null
}

function hasCompleteBrowserAiConfig(request: Request) {
  return [AI_API_KEY_HEADER, AI_BASE_URL_HEADER, AI_MODEL_HEADER]
    .every((header) => Boolean(request.headers.get(header)?.trim()))
}

function hasValidBearerToken(request: Request, configured: string | null) {
  if (!configured) return false
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return false

  const supplied = authorization.slice('Bearer '.length)
  const expectedHash = createHash('sha256').update(configured).digest()
  const suppliedHash = createHash('sha256').update(supplied).digest()
  return timingSafeEqual(expectedHash, suppliedHash)
}

function safeUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

export function resolveRateLimitIdentity(request: Request) {
  if (process.env.RESUME_OS_TRUSTED_PROXY === 'vercel' && process.env.VERCEL === '1') {
    const candidate = request.headers.get('x-forwarded-for')?.trim()
    if (candidate && candidate.length <= 64 && isIP(candidate)) return candidate
  }

  if (process.env.RESUME_OS_TRUSTED_PROXY === 'cloudflare') {
    const candidate = request.headers.get('cf-connecting-ip')?.trim()
    if (candidate && candidate.length <= 64 && isIP(candidate)) return candidate
  }

  // Request does not expose a trustworthy socket peer address here. Without an
  // explicitly configured platform, all requests deliberately share one instance key.
  return 'single-instance'
}
