import { beforeEach, describe, expect, it, vi } from 'vitest'

const agentMocks = vi.hoisted(() => ({ generateAgentText: vi.fn() }))
vi.mock('@/lib/agent/openai', () => ({
  generateAgentText: agentMocks.generateAgentText,
  createAgentErrorResponse: () => Response.json({ error: 'AI service is temporarily unavailable.', code: 'AI_UNAVAILABLE' }, { status: 502 })
}))

import { FixedWindowRateLimiter, createAiRequestGuard } from '@/lib/server/request-guard'
import { createChatRoute } from './route'

let post: ReturnType<typeof createChatRoute>

beforeEach(() => {
  post = createChatRoute({ guard: createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter() }) })
  agentMocks.generateAgentText.mockReset().mockResolvedValue({ text: 'Ready', model: 'test-model' })
})

describe('POST /api/chat', () => {
  it('uses no built-in resume data for service checks without an active resume', async () => {
    const response = await post(new Request('http://localhost/api/chat', {
      method: 'POST', body: JSON.stringify({ locale: 'en', message: 'status' })
    }))

    expect(response.status).toBe(200)
    expect(JSON.parse(agentMocks.generateAgentText.mock.calls[0][0])).toEqual({
      resume: null,
      question: 'status'
    })
    expect(agentMocks.generateAgentText.mock.calls[0][1].system).toContain('No resume data was supplied')
  })

  it('uses an optional normalized active resume in the prompt', async () => {
    const resume = {
      profile: { name: 'Custom Candidate', title: 'Engineer', summary: [], tags: [], links: [] },
      skills: [], experiences: [], projects: [], education: [], certifications: [], awards: [], languages: [], openSource: [],
      metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-13T00:00:00.000Z' }
    }
    const response = await post(new Request('http://localhost/api/chat', {
      method: 'POST', body: JSON.stringify({ locale: 'en', message: 'Summarize me', resume })
    }))

    expect(response.status).toBe(200)
    expect(agentMocks.generateAgentText.mock.calls[0][0]).toContain('Custom Candidate')
    expect(agentMocks.generateAgentText.mock.calls[0][1]).toEqual(expect.objectContaining({
      request: expect.any(Request), abortSignal: expect.any(AbortSignal), maxOutputTokens: 2_000
    }))
  })

  it('rejects an invalid provided resume instead of falling back to sample data', async () => {
    const response = await post(new Request('http://localhost/api/chat', {
      method: 'POST', body: JSON.stringify({ locale: 'en', message: 'Summarize me', resume: { profile: null } })
    }))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_REQUEST')
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it('rejects cross-origin requests before provider work', async () => {
    const response = await post(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ locale: 'en', message: 'status' })
    }))
    expect(response.status).toBe(403)
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it('returns a stable validation code', async () => {
    const response = await post(new Request('http://localhost/api/chat', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_REQUEST')
  })

  it('rejects omitted-length chunked JSON beyond the route budget', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"message":"'))
        controller.enqueue(encoder.encode('x'.repeat(80_001)))
        controller.enqueue(encoder.encode('"}'))
        controller.close()
      }
    })
    const response = await post(new Request('http://localhost/api/chat', {
      method: 'POST', body, duplex: 'half'
    } as RequestInit))

    expect(response.status).toBe(413)
    expect((await response.json()).code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('exercises the chat rate bucket with an isolated limiter', async () => {
    const limitedPost = createChatRoute({
      guard: createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter(), now: () => 3_000 }),
      rateLimit: { limit: 1, windowMs: 5_000 }
    })
    const makeRequest = () => new Request('http://localhost/api/chat', {
      method: 'POST', body: JSON.stringify({ locale: 'en', message: 'status' })
    })

    expect((await limitedPost(makeRequest())).status).toBe(200)
    const response = await limitedPost(makeRequest())
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('5')
  })
})
