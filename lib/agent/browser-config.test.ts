import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_API_KEY_HEADER,
  AI_BASE_URL_HEADER,
  AI_MODEL_HEADER
} from './provider-headers'
import {
  AI_CONFIG_STORAGE_KEY,
  AI_KEY_BINDING_STORAGE_KEY,
  AI_KEY_STORAGE_KEY,
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  aiFetch,
  clearBrowserAiConfig,
  readBrowserAiConfig,
  saveBrowserAiConfig
} from './browser-config'

const fetchMock = vi.fn<typeof fetch>()

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value))
  }
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  clearBrowserAiConfig()
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('browser AI configuration', () => {
  it('uses safe OpenAI-compatible defaults without inventing an API key', () => {
    expect(readBrowserAiConfig()).toEqual({
      baseURL: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
      apiKey: '',
      rememberApiKey: false
    })
  })

  it('stores non-secret configuration locally and keeps the key in this session by default', () => {
    saveBrowserAiConfig({
      baseURL: 'https://gateway.example.com/v1',
      model: 'example-model',
      apiKey: 'session-secret',
      rememberApiKey: false
    })

    expect(JSON.parse(window.localStorage.getItem(AI_CONFIG_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      baseURL: 'https://gateway.example.com/v1',
      model: 'example-model',
      rememberApiKey: false
    })
    expect(window.localStorage.getItem(AI_KEY_STORAGE_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(AI_KEY_STORAGE_KEY)).toBe('session-secret')
    expect(JSON.parse(window.sessionStorage.getItem(AI_KEY_BINDING_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      baseURL: 'https://gateway.example.com/v1',
      model: 'example-model'
    })
    expect(readBrowserAiConfig().apiKey).toBe('session-secret')
  })

  it('moves a remembered key between storage areas without leaving another copy', () => {
    saveBrowserAiConfig({
      baseURL: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
      apiKey: 'remembered-secret',
      rememberApiKey: true
    })

    expect(window.localStorage.getItem(AI_KEY_STORAGE_KEY)).toBe('remembered-secret')
    expect(window.localStorage.getItem(AI_KEY_BINDING_STORAGE_KEY)).not.toBeNull()
    expect(window.sessionStorage.getItem(AI_KEY_STORAGE_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(AI_KEY_BINDING_STORAGE_KEY)).toBeNull()
    expect(readBrowserAiConfig().apiKey).toBe('remembered-secret')

    saveBrowserAiConfig({
      baseURL: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
      apiKey: 'session-secret',
      rememberApiKey: false
    })

    expect(window.localStorage.getItem(AI_KEY_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(AI_KEY_BINDING_STORAGE_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(AI_KEY_STORAGE_KEY)).toBe('session-secret')
    expect(window.sessionStorage.getItem(AI_KEY_BINDING_STORAGE_KEY)).not.toBeNull()
  })

  it('never pairs an old tab session key with public configuration changed by another tab', async () => {
    const tabOneSession = new MemoryStorage()
    const tabTwoSession = new MemoryStorage()
    const sessionStorage = vi.spyOn(window, 'sessionStorage', 'get')

    sessionStorage.mockReturnValue(tabOneSession)
    saveBrowserAiConfig({
      baseURL: 'https://provider-one.example/v1',
      model: 'model-one',
      apiKey: 'tab-one-secret',
      rememberApiKey: false
    })

    sessionStorage.mockReturnValue(tabTwoSession)
    saveBrowserAiConfig({
      baseURL: 'https://provider-two.example/v1',
      model: 'model-two',
      apiKey: 'tab-two-secret',
      rememberApiKey: false
    })

    sessionStorage.mockReturnValue(tabOneSession)
    expect(readBrowserAiConfig()).toEqual({
      baseURL: 'https://provider-two.example/v1',
      model: 'model-two',
      apiKey: '',
      rememberApiKey: false
    })
    expect(tabOneSession.getItem(AI_KEY_STORAGE_KEY)).toBeNull()
    expect(tabOneSession.getItem(AI_KEY_BINDING_STORAGE_KEY)).toBeNull()

    await aiFetch('/api/chat')
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.has(AI_API_KEY_HEADER)).toBe(false)
    expect(headers.get(AI_BASE_URL_HEADER)).toBe('https://provider-two.example/v1')
    expect(headers.get(AI_MODEL_HEADER)).toBe('model-two')
  })

  it('migrates a legacy remembered key by binding it to its shared provider config', () => {
    window.localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 1,
      baseURL: 'https://legacy.example/v1',
      model: 'legacy-model',
      rememberApiKey: true
    }))
    window.localStorage.setItem(AI_KEY_STORAGE_KEY, 'legacy-secret')

    expect(readBrowserAiConfig().apiKey).toBe('legacy-secret')
    expect(JSON.parse(window.localStorage.getItem(AI_KEY_BINDING_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      baseURL: 'https://legacy.example/v1',
      model: 'legacy-model'
    })
  })

  it('discards an unbound legacy session key because its provider cannot be proven', () => {
    window.localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 1,
      baseURL: 'https://current.example/v1',
      model: 'current-model',
      rememberApiKey: false
    }))
    window.sessionStorage.setItem(AI_KEY_STORAGE_KEY, 'unbound-session-secret')

    expect(readBrowserAiConfig().apiKey).toBe('')
    expect(window.sessionStorage.getItem(AI_KEY_STORAGE_KEY)).toBeNull()
  })

  it('clears the public configuration and both possible key locations', () => {
    saveBrowserAiConfig({
      baseURL: 'https://gateway.example.com/v1',
      model: 'example-model',
      apiKey: 'secret',
      rememberApiKey: true
    })
    window.sessionStorage.setItem(AI_KEY_STORAGE_KEY, 'stale-session-secret')

    clearBrowserAiConfig()

    expect(window.localStorage.getItem(AI_CONFIG_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(AI_KEY_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(AI_KEY_BINDING_STORAGE_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(AI_KEY_STORAGE_KEY)).toBeNull()
    expect(window.sessionStorage.getItem(AI_KEY_BINDING_STORAGE_KEY)).toBeNull()
    expect(readBrowserAiConfig()).toEqual({
      baseURL: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
      apiKey: '',
      rememberApiKey: false
    })
  })

  it('ignores malformed persisted configuration', () => {
    window.localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 1,
      baseURL: 'javascript:alert(1)',
      model: 'bad\nmodel',
      rememberApiKey: true
    }))
    window.localStorage.setItem(AI_KEY_STORAGE_KEY, 'must-not-be-read')

    expect(readBrowserAiConfig()).toEqual({
      baseURL: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
      apiKey: '',
      rememberApiKey: false
    })
  })

  it.each([
    'https://api.openai.com/v1?tenant=secret',
    'https://api.openai.com/v1#secret',
    'https://user:password@api.openai.com/v1'
  ])('does not persist an unsafe base URL %s', (baseURL) => {
    expect(() => saveBrowserAiConfig({
      baseURL,
      model: DEFAULT_AI_MODEL,
      apiKey: 'secret',
      rememberApiKey: false
    })).toThrow('without credentials, query, or fragment')
  })

  it('falls back to in-memory configuration when browser storage is restricted', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })

    expect(() => saveBrowserAiConfig({
      baseURL: 'http://127.0.0.1:11434/v1',
      model: 'local-model',
      apiKey: 'memory-secret',
      rememberApiKey: false
    })).not.toThrow()
    expect(readBrowserAiConfig()).toEqual({
      baseURL: 'http://127.0.0.1:11434/v1',
      model: 'local-model',
      apiKey: 'memory-secret',
      rememberApiKey: false
    })
  })
})

describe('aiFetch', () => {
  it('preserves Request and init headers while attaching the configured BYOK headers', async () => {
    saveBrowserAiConfig({
      baseURL: 'https://gateway.example.com/v1',
      model: 'example-model',
      apiKey: 'user-secret',
      rememberApiKey: false
    })
    const request = new Request(`${window.location.origin}/api/resume/optimize`, {
      method: 'POST',
      headers: new Headers({ Accept: 'application/json', 'X-Request-Header': 'request' })
    })
    const initHeaders = new Headers({ 'Content-Type': 'application/json', 'X-Init-Header': 'init' })

    await aiFetch(request, { headers: initHeaders })

    const init = fetchMock.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('X-Request-Header')).toBe('request')
    expect(headers.get('X-Init-Header')).toBe('init')
    expect(headers.get(AI_API_KEY_HEADER)).toBe('user-secret')
    expect(headers.get(AI_BASE_URL_HEADER)).toBe('https://gateway.example.com/v1')
    expect(headers.get(AI_MODEL_HEADER)).toBe('example-model')
    expect(initHeaders.has(AI_API_KEY_HEADER)).toBe(false)
  })

  it('omits an empty key header and allows every approved same-origin AI route', async () => {
    for (const path of [
      '/api/chat',
      '/api/jd-match',
      '/api/resume/generate',
      '/api/resume/parse',
      '/api/resume/plan',
      '/api/resume/optimize'
    ]) {
      await aiFetch(`${path}?test=1`, { headers: { 'X-Existing': 'kept' } })
      const headers = new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers)
      expect(headers.has(AI_API_KEY_HEADER)).toBe(false)
      expect(headers.get(AI_BASE_URL_HEADER)).toBe(DEFAULT_AI_BASE_URL)
      expect(headers.get(AI_MODEL_HEADER)).toBe(DEFAULT_AI_MODEL)
      expect(headers.get('X-Existing')).toBe('kept')
    }
  })

  it.each([
    ['/api/resume/extract-text'],
    ['/api/not-an-ai-route'],
    ['https://example.com/api/chat']
  ])('rejects disallowed request target %s before calling fetch', (target) => {
    expect(() => aiFetch(target)).toThrow('approved same-origin API routes')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
