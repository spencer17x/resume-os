import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FixedWindowRateLimiter,
  createAiRequestGuard,
  resolveRateLimitIdentity
} from './request-guard'
import {
  AI_API_KEY_HEADER,
  AI_BASE_URL_HEADER,
  AI_MODEL_HEADER
} from '@/lib/agent/provider-headers'

const strongToken = 'server-only-token-with-at-least-32-bytes'
const guardOptions = { bucket: 'parse', limit: 2, windowMs: 60_000 }

function request(
  url = 'http://localhost:3001/api/resume/parse',
  headers: Record<string, string> = {}
) {
  return new Request(url, { method: 'POST', headers })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('AI request guard', () => {
  it('never grants access from a loopback URL or Host header without explicit local-only mode', async () => {
    const guard = createAiRequestGuard({
      localOnly: false,
      accessToken: null,
      limiter: new FixedWindowRateLimiter()
    })

    for (const candidate of [
      request(),
      request('https://resume.example/api/resume/parse', { host: 'localhost:3001' })
    ]) {
      const response = guard(candidate, guardOptions)
      expect(response?.status).toBe(403)
      expect(await response?.json()).toEqual({
        error: 'Public AI access is disabled.',
        code: 'AI_PUBLIC_ACCESS_DISABLED'
      })
    }
  })

  it('allows unauthenticated requests only when local-only process mode is injected', () => {
    const guard = createAiRequestGuard({
      localOnly: true,
      accessToken: null,
      limiter: new FixedWindowRateLimiter()
    })

    expect(guard(request('https://spoofed.example/api/resume/parse', {
      host: 'not-local.example'
    }), guardOptions)).toBeNull()
  })

  it.each(['http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001'])(
    'accepts the loopback browser Origin %s in local-only mode',
    (origin) => {
      const guard = createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter() })
      expect(guard(request(undefined, {
        origin,
        'sec-fetch-site': 'same-origin'
      }), guardOptions)).toBeNull()
    }
  )

  it('keeps cross-site browser requests blocked in local-only mode', async () => {
    const guard = createAiRequestGuard({
      localOnly: true,
      limiter: new FixedWindowRateLimiter()
    })
    const response = guard(request(undefined, {
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site'
    }), guardOptions)

    expect(response?.status).toBe(403)
    expect((await response?.json()).code).toBe('AI_PUBLIC_ACCESS_DISABLED')
  })

  it('requires a valid server bearer token when local-only mode is disabled', async () => {
    const guard = createAiRequestGuard({
      localOnly: false,
      accessToken: strongToken,
      limiter: new FixedWindowRateLimiter(),
      authFailureLimiter: new FixedWindowRateLimiter()
    })

    expect(guard(request('https://resume.example/api/resume/parse', {
      authorization: `Bearer ${strongToken}`
    }), guardOptions)).toBeNull()

    const denied = guard(request('https://resume.example/api/resume/parse'), guardOptions)
    expect(denied?.status).toBe(403)
    expect((await denied?.json()).code).toBe('AI_PUBLIC_ACCESS_DISABLED')
  })

  it('allows a public same-origin browser request only with complete BYOK configuration', async () => {
    const guard = createAiRequestGuard({
      localOnly: false,
      accessToken: null,
      limiter: new FixedWindowRateLimiter()
    })
    const headers = {
      origin: 'https://resume.example',
      'sec-fetch-site': 'same-origin',
      [AI_API_KEY_HEADER]: 'user-key',
      [AI_BASE_URL_HEADER]: 'https://api.openai.com/v1',
      [AI_MODEL_HEADER]: 'gpt-4.1-mini'
    }

    expect(guard(request('https://resume.example/api/resume/parse', headers), guardOptions)).toBeNull()

    const missing = guard(request('https://resume.example/api/resume/parse', {
      ...headers,
      [AI_API_KEY_HEADER]: ''
    }), guardOptions)
    expect(missing?.status).toBe(503)
    expect((await missing?.json()).code).toBe('AI_NOT_CONFIGURED')
  })

  it('uses the public Host and trusted forwarded protocol when the framework URL is internal', () => {
    vi.stubEnv('RESUME_OS_TRUSTED_PROXY', 'vercel')
    vi.stubEnv('VERCEL', '1')
    const guard = createAiRequestGuard({
      localOnly: false,
      accessToken: null,
      limiter: new FixedWindowRateLimiter()
    })

    expect(guard(request('http://localhost:3000/api/resume/parse', {
      origin: 'https://resume.example',
      host: 'resume.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin',
      [AI_API_KEY_HEADER]: 'user-key',
      [AI_BASE_URL_HEADER]: 'https://api.openai.com/v1',
      [AI_MODEL_HEADER]: 'gpt-4.1-mini'
    }), guardOptions)).toBeNull()
  })

  it('ignores forwarded protocol headers outside an explicitly trusted runtime', async () => {
    const guard = createAiRequestGuard({
      localOnly: false,
      accessToken: null,
      limiter: new FixedWindowRateLimiter()
    })
    const response = guard(request('http://localhost:3000/api/resume/parse', {
      origin: 'https://resume.example',
      host: 'resume.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin',
      [AI_API_KEY_HEADER]: 'user-key',
      [AI_BASE_URL_HEADER]: 'https://api.openai.com/v1',
      [AI_MODEL_HEADER]: 'gpt-4.1-mini'
    }), guardOptions)

    expect(response?.status).toBe(403)
    expect((await response?.json()).code).toBe('AI_PUBLIC_ACCESS_DISABLED')
  })

  it('rejects cross-origin BYOK requests before rate limiting', async () => {
    const guard = createAiRequestGuard({
      localOnly: false,
      accessToken: null,
      limiter: new FixedWindowRateLimiter()
    })
    const response = guard(request('https://resume.example/api/resume/parse', {
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
      [AI_API_KEY_HEADER]: 'user-key',
      [AI_BASE_URL_HEADER]: 'https://api.openai.com/v1',
      [AI_MODEL_HEADER]: 'gpt-4.1-mini'
    }), guardOptions)

    expect(response?.status).toBe(403)
    expect((await response?.json()).code).toBe('AI_PUBLIC_ACCESS_DISABLED')
  })

  it('can allow a same-origin browser route that does not use AI', () => {
    const guard = createAiRequestGuard({
      localOnly: false,
      accessToken: null,
      limiter: new FixedWindowRateLimiter()
    })

    expect(guard(request('https://resume.example/api/resume/extract-text', {
      origin: 'https://resume.example',
      'sec-fetch-site': 'same-origin'
    }), { ...guardOptions, browserAccess: 'same-origin' })).toBeNull()
  })

  it('fails safely when a configured access token is shorter than 32 bytes', async () => {
    const guard = createAiRequestGuard({
      localOnly: false,
      accessToken: 'too-short',
      limiter: new FixedWindowRateLimiter()
    })
    const response = guard(request('https://resume.example/api/resume/parse', {
      authorization: 'Bearer too-short'
    }), guardOptions)

    expect(response?.status).toBe(503)
    expect(await response?.json()).toEqual({
      error: 'AI access is not configured safely.',
      code: 'AI_ACCESS_MISCONFIGURED'
    })
  })

  it('throttles failed bearer attempts with one non-header-derived bucket', async () => {
    const authFailureLimiter = new FixedWindowRateLimiter()
    const guard = createAiRequestGuard({
      localOnly: false,
      accessToken: strongToken,
      limiter: new FixedWindowRateLimiter(),
      authFailureLimiter,
      authFailureRateLimit: { limit: 2, windowMs: 10_000 },
      now: () => 1_000
    })

    for (const forwarded of ['203.0.113.1', '198.51.100.2']) {
      const response = guard(request('https://resume.example/api/resume/parse', {
        authorization: 'Bearer wrong-token',
        'x-forwarded-for': forwarded
      }), guardOptions)
      expect(response?.status).toBe(403)
    }

    const throttled = guard(request('https://resume.example/api/resume/parse', {
      authorization: 'Bearer another-wrong-token',
      'x-forwarded-for': '192.0.2.3'
    }), guardOptions)
    expect(throttled?.status).toBe(429)
    expect(throttled?.headers.get('Retry-After')).toBe('10')
    expect((await throttled?.json()).code).toBe('RATE_LIMITED')
    expect(authFailureLimiter.size).toBe(1)

    const validDuringCooldown = guard(request('https://resume.example/api/resume/parse', {
      authorization: `Bearer ${strongToken}`
    }), guardOptions)
    expect(validDuringCooldown).toBeNull()

    const anotherInvalid = guard(request('https://resume.example/api/resume/parse', {
      authorization: 'Bearer still-wrong'
    }), guardOptions)
    expect(anotherInvalid?.status).toBe(429)
    expect(anotherInvalid?.headers.get('Retry-After')).toBe('10')
  })

  it('does not trust proxy headers unless a supported runtime is explicitly configured', () => {
    const headers = {
      'cf-connecting-ip': '203.0.113.8',
      'x-vercel-forwarded-for': '198.51.100.9',
      'x-forwarded-for': '192.0.2.10'
    }
    expect(resolveRateLimitIdentity(request(undefined, headers))).toBe('single-instance')

    vi.stubEnv('RESUME_OS_TRUSTED_PROXY', 'cloudflare')
    expect(resolveRateLimitIdentity(request(undefined, headers))).toBe('203.0.113.8')
    expect(resolveRateLimitIdentity(request(undefined, {
      'x-vercel-forwarded-for': '198.51.100.9'
    }))).toBe('single-instance')

    vi.stubEnv('RESUME_OS_TRUSTED_PROXY', 'vercel')
    vi.stubEnv('VERCEL', '1')
    expect(resolveRateLimitIdentity(request(undefined, {
      'x-forwarded-for': '198.51.100.9'
    }))).toBe('198.51.100.9')
  })

  it('returns a bounded route 429 response with Retry-After', async () => {
    const limiter = new FixedWindowRateLimiter(10)
    const guard = createAiRequestGuard({ localOnly: true, limiter, now: () => 1_000 })

    expect(guard(request(), guardOptions)).toBeNull()
    expect(guard(request(), guardOptions)).toBeNull()
    const response = guard(request(), guardOptions)

    expect(response?.status).toBe(429)
    expect(response?.headers.get('Retry-After')).toBe('60')
    expect(await response?.json()).toEqual({
      error: 'Too many requests. Try again later.',
      code: 'RATE_LIMITED'
    })
  })

  it('evicts old entries, preserves per-key windows, and never exceeds its key bound', () => {
    const limiter = new FixedWindowRateLimiter(2)
    limiter.consume('short', 1, 1_000, 0)
    limiter.consume('long', 1, 60_000, 0)
    limiter.consume('new', 1, 1_000, 2_000)

    expect(limiter.size).toBe(2)
    expect(limiter.consume('long', 1, 60_000, 2_000).allowed).toBe(false)
  })
})
