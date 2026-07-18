import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NoObjectGeneratedError } from 'ai'

const agentMocks = vi.hoisted(() => ({
  generateAgentText: vi.fn(),
  streamAgentObject: vi.fn(),
  abort: vi.fn(),
  dispose: vi.fn()
}))

vi.mock('@/lib/agent/openai', () => ({
  generateAgentText: agentMocks.generateAgentText,
  streamAgentObject: agentMocks.streamAgentObject,
  createAgentErrorResponse: () => Response.json({
    error: 'AI service is temporarily unavailable.',
    code: 'AI_UNAVAILABLE'
  }, { status: 502 })
}))

import { FixedWindowRateLimiter, createAiRequestGuard } from '@/lib/server/request-guard'
import { MAX_GENERATE_BACKGROUND_CHARS, createResumeGenerateRoute } from './route'

const generatedResume = JSON.stringify({
  profile: {
    name: 'Lin Chen',
    title: 'Frontend Engineer',
    summary: ['Builds accessible product interfaces'],
    tags: ['Frontend']
  },
  targetRole: 'Frontend Engineer',
  skills: [{ group: 'Frontend', items: ['React'] }],
  experiences: [],
  projects: []
})

function request(body: unknown) {
  return new Request('http://localhost/api/resume/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function streamRequest(body: unknown) {
  return new Request('http://localhost/api/resume/generate', {
    method: 'POST',
    headers: {
      Accept: 'application/x-ndjson',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}

function oversizedChunkedRequest() {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"locale":"en","targetRole":"'))
      controller.enqueue(encoder.encode('x'.repeat(32_001)))
      controller.enqueue(encoder.encode('","seniority":"mid"}'))
      controller.close()
    }
  })
  return new Request('http://localhost/api/resume/generate', {
    method: 'POST',
    body,
    duplex: 'half'
  } as RequestInit)
}

describe('POST /api/resume/generate', () => {
  let post: ReturnType<typeof createResumeGenerateRoute>

  beforeEach(() => {
    post = createResumeGenerateRoute({
      guard: createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter() })
    })
    agentMocks.generateAgentText.mockReset().mockResolvedValue({
      text: generatedResume,
      model: 'test-model'
    })
    agentMocks.abort.mockReset()
    agentMocks.dispose.mockReset()
    agentMocks.streamAgentObject.mockReset().mockReturnValue({
      model: 'test-model',
      partialOutputStream: (async function* () {
        yield { profile: { name: 'Lin' } }
        yield JSON.parse(generatedResume)
      })(),
      output: Promise.resolve(JSON.parse(generatedResume)),
      text: Promise.resolve(generatedResume),
      abort: agentMocks.abort,
      dispose: agentMocks.dispose
    })
  })

  it('generates and normalizes a simulated resume', async () => {
    const apiRequest = request({
      locale: 'zh',
      targetRole: 'Agent Engineer',
      seniority: 'senior',
      background: 'Five years building frontend platforms.'
    })
    const response = await post(apiRequest)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.model).toBe('test-model')
    expect(body.data.targetRole).toBe('Agent Engineer')
    expect(body.data.metadata).toMatchObject({ locale: 'zh', source: 'ai-generated' })
    expect(JSON.parse(agentMocks.generateAgentText.mock.calls[0][0])).toMatchObject({
      targetRole: 'Agent Engineer',
      seniority: 'senior'
    })
    expect(agentMocks.generateAgentText.mock.calls[0][1]).toEqual(expect.objectContaining({
      system: expect.stringContaining('Return exactly one JSON object'),
      request: apiRequest,
      abortSignal: apiRequest.signal,
      maxOutputTokens: 5_000
    }))
  })

  it('streams normalized partial resumes and a validated final result', async () => {
    const apiRequest = streamRequest({
      locale: 'zh',
      targetRole: 'Agent Engineer',
      seniority: 'senior'
    })
    const response = await post(apiRequest)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(response.headers.get('Content-Type')).toContain('application/x-ndjson')
    expect(events[0]).toMatchObject({
      type: 'start',
      model: 'test-model',
      data: {
        targetRole: 'Agent Engineer',
        metadata: { locale: 'zh', source: 'ai-generated' }
      }
    })
    expect(events[1]).toMatchObject({
      type: 'partial',
      data: {
        profile: { name: 'Lin' },
        targetRole: 'Agent Engineer',
        metadata: { locale: 'zh', source: 'ai-generated' }
      }
    })
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      model: 'test-model',
      data: {
        profile: { name: 'Lin Chen' },
        targetRole: 'Agent Engineer',
        metadata: { locale: 'zh', source: 'ai-generated' }
      }
    })
    expect(agentMocks.streamAgentObject).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ request: apiRequest, abortSignal: apiRequest.signal, maxOutputTokens: 5_000 })
    )
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
    expect(agentMocks.dispose).toHaveBeenCalledOnce()
  })

  it('recovers a schema-valid streamed resume when provider structured output rejects it', async () => {
    const outputError = new NoObjectGeneratedError({
      message: 'provider structured output mismatch',
      response: {} as never,
      usage: {} as never,
      finishReason: 'stop'
    })
    agentMocks.streamAgentObject.mockReturnValueOnce({
      model: 'test-model',
      partialOutputStream: (async function* () {
        yield JSON.parse(generatedResume)
      })(),
      output: Promise.reject(outputError),
      text: Promise.resolve(generatedResume),
      abort: agentMocks.abort,
      dispose: agentMocks.dispose
    })

    const response = await post(streamRequest({
      locale: 'en',
      targetRole: 'Frontend Engineer',
      seniority: 'mid'
    }))
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events.at(-1)).toMatchObject({
      type: 'result',
      model: 'test-model',
      data: { profile: { name: 'Lin Chen' }, metadata: { source: 'ai-generated' } }
    })
    expect(events.some((event) => event.type === 'error')).toBe(false)
  })

  it.each([
    { locale: 'fr', targetRole: 'Engineer', seniority: 'mid' },
    { locale: 'en', targetRole: '', seniority: 'mid' },
    { locale: 'en', targetRole: 'Engineer', seniority: 'principal' },
    { locale: 'en', targetRole: 'x'.repeat(121), seniority: 'lead' },
    { locale: 'en', targetRole: 'Engineer', seniority: 'junior', background: 'x'.repeat(MAX_GENERATE_BACKGROUND_CHARS + 1) }
  ])('rejects invalid generation input', async (body) => {
    const response = await post(request(body))
    expect(response.status).toBe(400)
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it('rejects cross-origin requests before calling the provider', async () => {
    const response = await post(new Request('http://localhost/api/resume/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site'
      },
      body: JSON.stringify({ locale: 'en', targetRole: 'Engineer', seniority: 'mid' })
    }))

    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('AI_PUBLIC_ACCESS_DISABLED')
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it('sanitizes provider failures', async () => {
    agentMocks.generateAgentText.mockRejectedValueOnce(new Error('raw provider credential detail'))

    const response = await post(request({ locale: 'en', targetRole: 'Engineer', seniority: 'mid' }))
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.code).toBe('AI_UNAVAILABLE')
    expect(JSON.stringify(body)).not.toContain('credential')
  })

  it('returns a stable invalid-output code for malformed AI JSON', async () => {
    agentMocks.generateAgentText.mockResolvedValueOnce({ text: 'not json', model: 'test-model' })

    const response = await post(request({ locale: 'en', targetRole: 'Engineer', seniority: 'mid' }))

    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('AI_OUTPUT_INVALID')
  })

  it('rejects an omitted-length chunked JSON body after crossing the byte budget', async () => {
    const response = await post(oversizedChunkedRequest())

    expect(response.status).toBe(413)
    expect((await response.json()).code).toBe('PAYLOAD_TOO_LARGE')
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it('enforces its injected route limit without shared test state', async () => {
    const limitedPost = createResumeGenerateRoute({
      guard: createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter(), now: () => 2_000 }),
      rateLimit: { limit: 1, windowMs: 7_000 }
    })

    expect((await limitedPost(request({ locale: 'en', targetRole: 'Engineer', seniority: 'mid' }))).status).toBe(200)
    const response = await limitedPost(request({ locale: 'en', targetRole: 'Engineer', seniority: 'mid' }))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('7')
  })
})
