import type { AiProviderKind } from './providers'

export const AI_PROVIDER_PREFERENCE_STORAGE_KEY = 'resume-os-ai-provider-preference-v1'

export type AiProviderMode = AiProviderKind | 'automatic'

export type AiProviderPreference = {
  mode: AiProviderMode
  allowCloudFallback: boolean
}

type StoredAiProviderPreference = AiProviderPreference & {
  version: 1
}

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const PROVIDER_MODES = new Set<AiProviderMode>([
  'chrome-built-in',
  'openai-compatible',
  'automatic'
])

export const DEFAULT_AI_PROVIDER_PREFERENCE: AiProviderPreference = {
  mode: 'openai-compatible',
  allowCloudFallback: false
}

let memoryPreference = { ...DEFAULT_AI_PROVIDER_PREFERENCE }
let storageWriteFailed = false

function browserStorage(): BrowserStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function normalizePreference(value: unknown): AiProviderPreference | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<StoredAiProviderPreference>
  if (
    candidate.version !== 1
    || typeof candidate.mode !== 'string'
    || !PROVIDER_MODES.has(candidate.mode as AiProviderMode)
    || typeof candidate.allowCloudFallback !== 'boolean'
  ) {
    return null
  }

  const mode = candidate.mode as AiProviderMode
  return {
    mode,
    allowCloudFallback: mode === 'automatic' && candidate.allowCloudFallback
  }
}

export function readAiProviderPreference(): AiProviderPreference {
  const storage = browserStorage()
  if (!storage) return { ...memoryPreference }

  try {
    const serialized = storage.getItem(AI_PROVIDER_PREFERENCE_STORAGE_KEY)
    if (serialized === null) {
      return storageWriteFailed
        ? { ...memoryPreference }
        : { ...DEFAULT_AI_PROVIDER_PREFERENCE }
    }
    const preference = normalizePreference(JSON.parse(serialized))
    return preference ?? { ...DEFAULT_AI_PROVIDER_PREFERENCE }
  } catch {
    return { ...memoryPreference }
  }
}

export function hasExplicitCloudProviderConsent(
  preference: AiProviderPreference = readAiProviderPreference()
) {
  return preference.mode === 'openai-compatible'
    || (preference.mode === 'automatic' && preference.allowCloudFallback)
}

export function saveAiProviderPreference(preference: AiProviderPreference): void {
  const normalized = normalizePreference({ version: 1, ...preference })
  if (!normalized) throw new TypeError('AI provider preference is invalid.')

  memoryPreference = normalized
  const storage = browserStorage()
  if (!storage) return
  try {
    const stored: StoredAiProviderPreference = { version: 1, ...normalized }
    storage.setItem(AI_PROVIDER_PREFERENCE_STORAGE_KEY, JSON.stringify(stored))
    storageWriteFailed = false
  } catch {
    storageWriteFailed = true
    // Keep the preference in memory when browser persistence is restricted.
  }
}

export function clearAiProviderPreference(): void {
  memoryPreference = { ...DEFAULT_AI_PROVIDER_PREFERENCE }
  storageWriteFailed = false
  const storage = browserStorage()
  if (!storage) return
  try {
    storage.removeItem(AI_PROVIDER_PREFERENCE_STORAGE_KEY)
  } catch {
    // The in-memory default is still applied when browser persistence is restricted.
  }
}
