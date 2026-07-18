import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_PROVIDER_PREFERENCE_STORAGE_KEY,
  DEFAULT_AI_PROVIDER_PREFERENCE,
  clearAiProviderPreference,
  hasExplicitCloudProviderConsent,
  readAiProviderPreference,
  saveAiProviderPreference
} from './provider-preference'

beforeEach(() => {
  window.localStorage.clear()
  clearAiProviderPreference()
  vi.restoreAllMocks()
})

describe('AI provider preference', () => {
  it('defaults to the existing OpenAI-compatible path without cloud fallback', () => {
    expect(readAiProviderPreference()).toEqual(DEFAULT_AI_PROVIDER_PREFERENCE)
  })

  it('persists an explicit automatic provider and fallback consent', () => {
    saveAiProviderPreference({ mode: 'automatic', allowCloudFallback: true })

    expect(JSON.parse(window.localStorage.getItem(AI_PROVIDER_PREFERENCE_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      mode: 'automatic',
      allowCloudFallback: true
    })
    expect(readAiProviderPreference()).toEqual({
      mode: 'automatic',
      allowCloudFallback: true
    })
  })

  it.each(['chrome-built-in', 'openai-compatible'] as const)(
    'cannot enable cloud fallback while using %s',
    (mode) => {
      saveAiProviderPreference({ mode, allowCloudFallback: true })

      expect(readAiProviderPreference()).toEqual({ mode, allowCloudFallback: false })
    }
  )

  it('allows cloud-only tasks only for the cloud provider or explicit automatic fallback', () => {
    expect(hasExplicitCloudProviderConsent({
      mode: 'openai-compatible', allowCloudFallback: false
    })).toBe(true)
    expect(hasExplicitCloudProviderConsent({
      mode: 'automatic', allowCloudFallback: true
    })).toBe(true)
    expect(hasExplicitCloudProviderConsent({
      mode: 'automatic', allowCloudFallback: false
    })).toBe(false)
    expect(hasExplicitCloudProviderConsent({
      mode: 'chrome-built-in', allowCloudFallback: false
    })).toBe(false)
  })

  it('ignores malformed persisted preferences', () => {
    window.localStorage.setItem(AI_PROVIDER_PREFERENCE_STORAGE_KEY, JSON.stringify({
      version: 1,
      mode: 'automatic',
      allowCloudFallback: 'yes'
    }))

    expect(readAiProviderPreference()).toEqual(DEFAULT_AI_PROVIDER_PREFERENCE)
  })

  it('uses in-memory preferences when local storage is restricted', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })

    saveAiProviderPreference({ mode: 'chrome-built-in', allowCloudFallback: false })

    expect(readAiProviderPreference()).toEqual({
      mode: 'chrome-built-in',
      allowCloudFallback: false
    })
  })

  it('keeps the in-memory selection when only storage writes are rejected', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })

    saveAiProviderPreference({ mode: 'automatic', allowCloudFallback: true })

    expect(readAiProviderPreference()).toEqual({
      mode: 'automatic',
      allowCloudFallback: true
    })
  })
})
