import {
  AI_API_KEY_HEADER,
  AI_BASE_URL_HEADER,
  AI_MODEL_HEADER
} from './provider-headers'

export const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_AI_MODEL = 'gpt-4.1-mini'
export const AI_CONFIG_STORAGE_KEY = 'resume-os-ai-config-v1'
export const AI_KEY_STORAGE_KEY = 'resume-os-ai-key'
export const AI_KEY_BINDING_STORAGE_KEY = 'resume-os-ai-key-binding-v1'

export type BrowserAiConfig = {
  baseURL: string
  model: string
  apiKey: string
  rememberApiKey: boolean
}

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type StoredAiConfig = {
  version: 1
  baseURL: string
  model: string
  rememberApiKey: boolean
}

type StoredAiKeyBinding = {
  version: 1
  baseURL: string
  model: string
}

type StorageRead = {
  available: boolean
  value: string | null
}

const ALLOWED_AI_PATHS = new Set([
  '/api/chat',
  '/api/jd-match',
  '/api/resume/generate',
  '/api/resume/parse',
  '/api/resume/plan',
  '/api/resume/optimize'
])

const DEFAULT_CONFIG: BrowserAiConfig = {
  baseURL: DEFAULT_AI_BASE_URL,
  model: DEFAULT_AI_MODEL,
  apiKey: '',
  rememberApiKey: false
}

let memoryConfig: BrowserAiConfig = { ...DEFAULT_CONFIG }
let needsMemoryFallback = false

function browserStorage(name: 'localStorage' | 'sessionStorage'): BrowserStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window[name]
  } catch {
    return null
  }
}

function readStorage(storage: BrowserStorage | null, key: string): StorageRead {
  if (!storage) return { available: false, value: null }
  try {
    return { available: true, value: storage.getItem(key) }
  } catch {
    return { available: false, value: null }
  }
}

function setStorage(storage: BrowserStorage | null, key: string, value: string): boolean {
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function removeStorage(storage: BrowserStorage | null, key: string): boolean {
  if (!storage) return false
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function normalizedHeaderValue(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maximumLength || /[\r\n]/.test(normalized)) {
    throw new TypeError(`${label} is invalid.`)
  }
  return normalized
}

function normalizedBaseURL(value: unknown): string {
  const normalized = normalizedHeaderValue(value, 'AI base URL', 2_048)
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new TypeError('AI base URL must be an absolute HTTP(S) URL.')
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new TypeError('AI base URL must be an absolute HTTP(S) URL without credentials, query, or fragment.')
  }
  return normalized
}

function normalizedApiKey(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('AI API key must be a string.')
  const normalized = value.trim()
  if (normalized.length > 4_096 || /[\r\n]/.test(normalized)) {
    throw new TypeError('AI API key is invalid.')
  }
  return normalized
}

function normalizeConfig(config: BrowserAiConfig): BrowserAiConfig {
  if (typeof config.rememberApiKey !== 'boolean') {
    throw new TypeError('AI API key persistence must be a boolean.')
  }
  return {
    baseURL: normalizedBaseURL(config.baseURL),
    model: normalizedHeaderValue(config.model, 'AI model', 200),
    apiKey: normalizedApiKey(config.apiKey),
    rememberApiKey: config.rememberApiKey
  }
}

function parseStoredConfig(serialized: string | null): Omit<BrowserAiConfig, 'apiKey'> | null {
  if (serialized === null) return null
  try {
    const value: unknown = JSON.parse(serialized)
    if (typeof value !== 'object' || value === null) return null
    const candidate = value as Partial<StoredAiConfig>
    if (candidate.version !== 1 || typeof candidate.rememberApiKey !== 'boolean') return null
    return {
      baseURL: normalizedBaseURL(candidate.baseURL),
      model: normalizedHeaderValue(candidate.model, 'AI model', 200),
      rememberApiKey: candidate.rememberApiKey
    }
  } catch {
    return null
  }
}

function sameStoredConfig(
  left: Omit<BrowserAiConfig, 'apiKey'>,
  right: Omit<BrowserAiConfig, 'apiKey'>
): boolean {
  return left.baseURL === right.baseURL
    && left.model === right.model
    && left.rememberApiKey === right.rememberApiKey
}

function serializeKeyBinding(config: Pick<BrowserAiConfig, 'baseURL' | 'model'>): string {
  const binding: StoredAiKeyBinding = {
    version: 1,
    baseURL: config.baseURL,
    model: config.model
  }
  return JSON.stringify(binding)
}

function parseKeyBinding(serialized: string | null): StoredAiKeyBinding | null {
  if (serialized === null) return null
  try {
    const value: unknown = JSON.parse(serialized)
    if (typeof value !== 'object' || value === null) return null
    const candidate = value as Partial<StoredAiKeyBinding>
    if (candidate.version !== 1) return null
    return {
      version: 1,
      baseURL: normalizedBaseURL(candidate.baseURL),
      model: normalizedHeaderValue(candidate.model, 'AI model', 200)
    }
  } catch {
    return null
  }
}

function keyBindingMatches(
  binding: StoredAiKeyBinding | null,
  config: Pick<BrowserAiConfig, 'baseURL' | 'model'>
): boolean {
  return binding?.baseURL === config.baseURL && binding.model === config.model
}

export function readBrowserAiConfig(): BrowserAiConfig {
  const localStorage = browserStorage('localStorage')
  const sessionStorage = browserStorage('sessionStorage')
  const storedConfigRead = readStorage(localStorage, AI_CONFIG_STORAGE_KEY)
  const storedConfig = parseStoredConfig(storedConfigRead.value)
  const memoryPublicConfig = {
    baseURL: memoryConfig.baseURL,
    model: memoryConfig.model,
    rememberApiKey: memoryConfig.rememberApiKey
  }
  const canUseMemoryFallback = needsMemoryFallback
    && (!storedConfig || sameStoredConfig(storedConfig, memoryPublicConfig))
  const publicUsesMemory = storedConfig === null
    && (canUseMemoryFallback || !storedConfigRead.available)
  const publicConfig = storedConfig
    ?? (publicUsesMemory ? memoryPublicConfig : {
      baseURL: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
      rememberApiKey: false
    })
  const keyStorage = publicConfig.rememberApiKey ? localStorage : sessionStorage
  const keyRead = readStorage(keyStorage, AI_KEY_STORAGE_KEY)
  const bindingRead = readStorage(keyStorage, AI_KEY_BINDING_STORAGE_KEY)
  const binding = parseKeyBinding(bindingRead.value)
  const publicMatchesMemory = sameStoredConfig(publicConfig, memoryPublicConfig)
  const canUseMemoryKey = publicMatchesMemory
    && (canUseMemoryFallback || !keyRead.available || !bindingRead.available)
  let apiKey = ''
  let credentialUsesMemory = false
  if (keyRead.value !== null) {
    try {
      const storedApiKey = normalizedApiKey(keyRead.value)
      if (keyBindingMatches(binding, publicConfig)) {
        apiKey = storedApiKey
      } else if (canUseMemoryKey) {
        apiKey = memoryConfig.apiKey
        credentialUsesMemory = true
      } else if (publicConfig.rememberApiKey && bindingRead.available && bindingRead.value === null) {
        // Remembered keys from the previous format lived beside their shared config.
        // Bind them on first read; unbound tab-local keys are discarded below.
        apiKey = storedApiKey
        setStorage(keyStorage, AI_KEY_BINDING_STORAGE_KEY, serializeKeyBinding(publicConfig))
      } else if (!publicConfig.rememberApiKey) {
        removeStorage(sessionStorage, AI_KEY_STORAGE_KEY)
        removeStorage(sessionStorage, AI_KEY_BINDING_STORAGE_KEY)
      }
    } catch {
      apiKey = ''
    }
  } else if (canUseMemoryKey) {
    apiKey = memoryConfig.apiKey
    credentialUsesMemory = true
  } else if (!publicConfig.rememberApiKey && bindingRead.value !== null) {
    removeStorage(sessionStorage, AI_KEY_BINDING_STORAGE_KEY)
  }

  memoryConfig = { ...publicConfig, apiKey }
  needsMemoryFallback = publicUsesMemory || credentialUsesMemory
  return { ...memoryConfig }
}

export function saveBrowserAiConfig(config: BrowserAiConfig): void {
  const normalized = normalizeConfig(config)
  const localStorage = browserStorage('localStorage')
  const sessionStorage = browserStorage('sessionStorage')
  const storedConfig: StoredAiConfig = {
    version: 1,
    baseURL: normalized.baseURL,
    model: normalized.model,
    rememberApiKey: normalized.rememberApiKey
  }

  memoryConfig = normalized
  const configSaved = setStorage(localStorage, AI_CONFIG_STORAGE_KEY, JSON.stringify(storedConfig))
  const keyStorage = normalized.rememberApiKey ? localStorage : sessionStorage
  const otherKeyStorage = normalized.rememberApiKey ? sessionStorage : localStorage
  removeStorage(otherKeyStorage, AI_KEY_STORAGE_KEY)
  removeStorage(otherKeyStorage, AI_KEY_BINDING_STORAGE_KEY)
  const keySaved = normalized.apiKey
    ? setStorage(keyStorage, AI_KEY_STORAGE_KEY, normalized.apiKey)
      && setStorage(keyStorage, AI_KEY_BINDING_STORAGE_KEY, serializeKeyBinding(normalized))
    : removeStorage(keyStorage, AI_KEY_STORAGE_KEY)
      && removeStorage(keyStorage, AI_KEY_BINDING_STORAGE_KEY)
  needsMemoryFallback = !configSaved || !keySaved
}

export function clearBrowserAiConfig(): void {
  const localStorage = browserStorage('localStorage')
  const sessionStorage = browserStorage('sessionStorage')
  removeStorage(localStorage, AI_CONFIG_STORAGE_KEY)
  removeStorage(localStorage, AI_KEY_STORAGE_KEY)
  removeStorage(localStorage, AI_KEY_BINDING_STORAGE_KEY)
  removeStorage(sessionStorage, AI_KEY_STORAGE_KEY)
  removeStorage(sessionStorage, AI_KEY_BINDING_STORAGE_KEY)
  memoryConfig = { ...DEFAULT_CONFIG }
  needsMemoryFallback = false
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request
}

function assertAllowedAiRequest(input: RequestInfo | URL): void {
  if (typeof window === 'undefined') {
    throw new TypeError('AI requests can only be sent from the browser.')
  }
  const rawURL = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url
  let url: URL
  try {
    url = new URL(rawURL, window.location.href)
  } catch {
    throw new TypeError('AI request URL is invalid.')
  }
  if (url.origin !== window.location.origin || !ALLOWED_AI_PATHS.has(url.pathname)) {
    throw new TypeError('AI requests are restricted to approved same-origin API routes.')
  }
}

export function aiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  assertAllowedAiRequest(input)

  const headers = new Headers(isRequest(input) ? input.headers : undefined)
  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  }

  headers.delete(AI_API_KEY_HEADER)
  headers.delete(AI_BASE_URL_HEADER)
  headers.delete(AI_MODEL_HEADER)

  const config = readBrowserAiConfig()
  if (config.apiKey) headers.set(AI_API_KEY_HEADER, config.apiKey)
  if (config.baseURL) headers.set(AI_BASE_URL_HEADER, config.baseURL)
  if (config.model) headers.set(AI_MODEL_HEADER, config.model)

  return fetch(input, { ...init, headers })
}
