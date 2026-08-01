import { describe, expect, it } from 'vitest'
import { createSourceHttpClient } from './http'
import { JobSourceError } from './types'

const url = new URL('https://api.lever.co/v0/postings/example')

describe('source HTTP client', () => {
  it('blocks redirects and oversized declared responses', async () => {
    await expectErrorCode(
      createSourceHttpClient({ fetch: async () => new Response(null, { status: 302 }) }).getJson(url),
      'REDIRECT_BLOCKED'
    )
    await expectErrorCode(
      createSourceHttpClient({
        fetch: async () => new Response('{}', { headers: { 'content-length': '100' } }),
        maxResponseBytes: 10
      }).getJson(url),
      'RESPONSE_TOO_LARGE'
    )
  })

  it('returns bounded retry information without exposing response bodies', async () => {
    try {
      await createSourceHttpClient({
        fetch: async () => new Response('private upstream details', {
          status: 429,
          headers: { 'retry-after': '120' }
        })
      }).getJson(url)
      throw new Error('Expected rate limit')
    } catch (error) {
      expect(error).toBeInstanceOf(JobSourceError)
      expect((error as JobSourceError).code).toBe('RATE_LIMITED')
      expect((error as JobSourceError).retryAfterSeconds).toBe(120)
      expect((error as Error).message).not.toContain('private upstream details')
    }
  })

  it('propagates caller cancellation', async () => {
    const controller = new AbortController()
    const client = createSourceHttpClient({
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    })
    const request = client.getJson(url, controller.signal)
    controller.abort()
    await expectErrorCode(request, 'REQUEST_ABORTED')
  })
})

async function expectErrorCode(operation: Promise<unknown>, code: JobSourceError['code']) {
  try {
    await operation
    throw new Error(`Expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(JobSourceError)
    expect((error as JobSourceError).code).toBe(code)
  }
}
