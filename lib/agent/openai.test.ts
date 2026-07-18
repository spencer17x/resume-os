import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdkMocks = vi.hoisted(() => ({
  createOpenAI: vi.fn(),
  provider: vi.fn(),
  model: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
  outputObject: vi.fn()
}))

vi.mock('@ai-sdk/openai', () => ({ createOpenAI: sdkMocks.createOpenAI }))
vi.mock('ai', () => ({
  generateText: sdkMocks.generateText,
  streamText: sdkMocks.streamText,
  Output: { object: sdkMocks.outputObject }
}))

import {
  AI_REQUEST_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  AgentConfigurationError,
  createAgentErrorResponse,
  generateAgentText,
  streamAgentObject
} from './openai'
import { z } from 'zod'
import {
  AI_API_KEY_HEADER,
  AI_BASE_URL_HEADER,
  AI_MODEL_HEADER
} from './provider-headers'

function byokRequest({
  apiKey = 'byok-test-key',
  baseURL = 'https://api.openai.com/v1',
  model = 'byok-test-model'
}: {
  apiKey?: string
  baseURL?: string
  model?: string
} = {}) {
  return new Request('https://resume.example/api/chat', {
    method: 'POST',
    headers: {
      [AI_API_KEY_HEADER]: apiKey,
      [AI_BASE_URL_HEADER]: baseURL,
      [AI_MODEL_HEADER]: model
    }
  })
}

beforeEach(() => {
  sdkMocks.provider.mockReset()
  sdkMocks.createOpenAI.mockReset().mockReturnValue(Object.assign(sdkMocks.provider, {
    chat: sdkMocks.model
  }))
  sdkMocks.model.mockReset().mockReturnValue('model-handle')
  sdkMocks.generateText.mockReset().mockResolvedValue({ text: 'answer' })
  sdkMocks.outputObject.mockReset().mockReturnValue('object-output')
  sdkMocks.streamText.mockReset().mockReturnValue({
    partialOutputStream: [],
    output: Promise.resolve({ answer: 'streamed' }),
    text: Promise.resolve('{"answer":"streamed"}')
  })
  vi.stubEnv('OPENAI_API_KEY', 'test-key')
  vi.stubEnv('OPENAI_BASE_URL', '')
  vi.stubEnv('OPENAI_MODEL', 'test-model')
  vi.stubEnv('RESUME_OS_ALLOWED_AI_HOSTS', '')
  vi.stubEnv('RESUME_OS_LOCAL_ONLY', '')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('agent OpenAI boundary', () => {
  it('passes immutable system instructions, abort signal, and a bounded output budget', async () => {
    const controller = new AbortController()
    const result = await generateAgentText('untrusted user data', {
      system: 'immutable rules',
      abortSignal: controller.signal,
      maxOutputTokens: 4_500
    })

    expect(result).toEqual({ model: 'test-model', text: 'answer' })
    expect(sdkMocks.generateText).toHaveBeenCalledWith(expect.objectContaining({
      model: 'model-handle',
      system: 'immutable rules',
      prompt: 'untrusted user data',
      abortSignal: expect.any(AbortSignal),
      maxOutputTokens: 4_500
    }))
  })

  it('prefers a complete request-scoped BYOK configuration without mutating server configuration', async () => {
    const originalEnvironment = {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
      model: process.env.OPENAI_MODEL
    }
    const result = await generateAgentText('prompt', {
      request: byokRequest({
        apiKey: 'request-only-key',
        baseURL: 'https://api.openai.com/v1',
        model: 'request-only-model'
      })
    })

    expect(result.model).toBe('request-only-model')
    expect(sdkMocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: 'request-only-key',
      baseURL: 'https://api.openai.com/v1',
      fetch: expect.any(Function)
    })
    expect(sdkMocks.model).toHaveBeenCalledWith('request-only-model')
    expect(sdkMocks.provider).not.toHaveBeenCalled()
    expect(process.env.OPENAI_API_KEY).toBe(originalEnvironment.apiKey)
    expect(process.env.OPENAI_BASE_URL).toBe(originalEnvironment.baseURL)
    expect(process.env.OPENAI_MODEL).toBe(originalEnvironment.model)
  })

  it('falls back to server configuration when any BYOK header is missing', async () => {
    const request = byokRequest()
    request.headers.delete(AI_MODEL_HEADER)

    await generateAgentText('prompt', { request })

    expect(sdkMocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseURL: undefined,
      fetch: expect.any(Function)
    })
    expect(sdkMocks.model).toHaveBeenCalledWith('test-model')
  })

  it('treats an environment provider URL as deployer-controlled configuration', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://trusted-by-deployer.example/v1')

    await generateAgentText('prompt')

    expect(sdkMocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseURL: 'https://trusted-by-deployer.example/v1',
      fetch: expect.any(Function)
    })
  })

  it('allows exact additional provider hosts configured by the server', async () => {
    vi.stubEnv('RESUME_OS_ALLOWED_AI_HOSTS', 'gateway.example:8443, api.example')

    await generateAgentText('prompt', {
      request: byokRequest({ baseURL: 'https://gateway.example:8443/openai/v1' })
    })

    expect(sdkMocks.createOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://gateway.example:8443/openai/v1'
    }))
  })

  it('allows an HTTP loopback provider only in explicit local-only mode', async () => {
    vi.stubEnv('RESUME_OS_LOCAL_ONLY', '1')

    await generateAgentText('prompt', {
      request: byokRequest({ baseURL: 'http://127.0.0.1:11434/v1' })
    })

    expect(sdkMocks.createOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://127.0.0.1:11434/v1'
    }))
  })

  it.each([
    ['plain HTTP on a public host', 'http://api.openai.com/v1'],
    ['a lookalike host', 'https://api.openai.com.attacker.example/v1'],
    ['an unconfigured port', 'https://api.openai.com:8443/v1'],
    ['URL credentials', 'https://user:password@api.openai.com/v1'],
    ['empty URL credentials', 'https://@api.openai.com/v1'],
    ['a query string', 'https://api.openai.com/v1?tenant=secret'],
    ['an empty query string', 'https://api.openai.com/v1?'],
    ['a fragment', 'https://api.openai.com/v1#secret'],
    ['an unconfigured loopback host', 'https://127.0.0.1:8443/v1'],
    ['a malformed URL', 'not-a-url']
  ])('rejects BYOK base URLs containing %s', async (_case, baseURL) => {
    await expect(generateAgentText('prompt', {
      request: byokRequest({ baseURL })
    })).rejects.toBeInstanceOf(AgentConfigurationError)
    expect(sdkMocks.createOpenAI).not.toHaveBeenCalled()
  })

  it.each([
    ['API key', { apiKey: 'k'.repeat(4_097) }],
    ['base URL', { baseURL: `https://api.openai.com/${'x'.repeat(2_049)}` }],
    ['model', { model: 'm'.repeat(257) }]
  ])('rejects an oversized BYOK %s', async (_field, overrides) => {
    await expect(generateAgentText('prompt', {
      request: byokRequest(overrides)
    })).rejects.toBeInstanceOf(AgentConfigurationError)
    expect(sdkMocks.createOpenAI).not.toHaveBeenCalled()
  })

  it('keeps overlapping BYOK credentials isolated to their own request', async () => {
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    sdkMocks.generateText
      .mockImplementationOnce(() => new Promise<{ text: string }>((resolve) => {
        releaseFirst = () => resolve({ text: 'first' })
      }))
      .mockImplementationOnce(() => new Promise<{ text: string }>((resolve) => {
        releaseSecond = () => resolve({ text: 'second' })
      }))

    const first = generateAgentText('first', {
      request: byokRequest({ apiKey: 'request-key-a', model: 'model-a' })
    })
    const second = generateAgentText('second', {
      request: byokRequest({ apiKey: 'request-key-b', model: 'model-b' })
    })

    expect(sdkMocks.createOpenAI.mock.calls.map(([config]) => config.apiKey)).toEqual([
      'request-key-a',
      'request-key-b'
    ])
    expect(sdkMocks.model.mock.calls.map(([model]) => model)).toEqual(['model-a', 'model-b'])

    releaseSecond()
    releaseFirst()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { model: 'model-a', text: 'first' },
      { model: 'model-b', text: 'second' }
    ])
  })

  it('blocks provider redirects without forwarding credentials or prompt data to the redirect target', async () => {
    await generateAgentText('prompt')
    const providerFetch = sdkMocks.createOpenAI.mock.calls[0]?.[0].fetch as typeof fetch
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 307,
      headers: { Location: 'https://attacker.example/collect' }
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(providerFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer private-key' },
      body: 'private-prompt',
      redirect: 'follow'
    })).rejects.toThrow('AI provider redirects are not allowed')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer private-key' },
      body: 'private-prompt',
      redirect: 'manual'
    })
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('attacker.example'))).toBe(false)
  })

  it('aborts stalled provider requests at the server deadline', async () => {
    vi.useFakeTimers()
    sdkMocks.generateText.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) =>
      new Promise((_, reject) => abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true })))

    const pending = generateAgentText('prompt')
    const rejection = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS)

    await rejection
  })

  it('forwards request cancellation to the provider call', async () => {
    const controller = new AbortController()
    sdkMocks.generateText.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) =>
      new Promise((_, reject) => abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true })))

    const pending = generateAgentText('prompt', { abortSignal: controller.signal })
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await rejection
  })

  it('uses a safe default output budget', async () => {
    await generateAgentText('prompt')
    expect(sdkMocks.generateText).toHaveBeenCalledWith(expect.objectContaining({
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS
    }))
  })

  it('creates a structured stream with the same provider safeguards', async () => {
    const schema = z.object({ answer: z.string() })
    const stream = streamAgentObject('untrusted user data', schema, {
      system: 'immutable rules',
      request: byokRequest({
        apiKey: 'stream-key',
        baseURL: 'https://api.openai.com/v1',
        model: 'stream-model'
      }),
      maxOutputTokens: 1_200
    })

    expect(stream.model).toBe('stream-model')
    expect(sdkMocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: 'stream-key',
      baseURL: 'https://api.openai.com/v1',
      fetch: expect.any(Function)
    })
    expect(sdkMocks.outputObject).toHaveBeenCalledWith({ schema })
    expect(sdkMocks.streamText).toHaveBeenCalledWith(expect.objectContaining({
      model: 'model-handle',
      system: 'immutable rules',
      prompt: 'untrusted user data',
      output: 'object-output',
      abortSignal: expect.any(AbortSignal),
      maxOutputTokens: 1_200
    }))

    stream.dispose()
  })

  it('returns a stable configuration error without exposing configuration names', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = createAgentErrorResponse(new AgentConfigurationError('OPENAI_API_KEY secret detail'))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({
      error: 'AI service is not configured.',
      code: 'AI_NOT_CONFIGURED'
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('OPENAI_API_KEY')
  })

  it('sanitizes provider bodies from both the response and logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = createAgentErrorResponse(new Error('provider body with credential secret'))
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.code).toBe('AI_UNAVAILABLE')
    expect(JSON.stringify(body)).not.toContain('credential secret')
    expect(JSON.stringify(log.mock.calls)).not.toContain('credential secret')
  })

  it('distinguishes aborts without logging raw errors', async () => {
    const error = new DOMException('raw abort detail', 'AbortError')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = createAgentErrorResponse(error)

    expect(response.status).toBe(499)
    expect((await response.json()).code).toBe('REQUEST_ABORTED')
    expect(JSON.stringify(log.mock.calls)).not.toContain('raw abort detail')
  })

  it('recognizes non-DOM AbortError instances from providers', async () => {
    const error = new Error('provider abort detail')
    error.name = 'AbortError'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = createAgentErrorResponse(error)

    expect(response.status).toBe(499)
    expect((await response.json()).code).toBe('REQUEST_ABORTED')
  })
})
