import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import zh from '@/messages/zh.json'
import { MotionPreferenceProvider } from '@/components/desktop/motion-preference'
import { ThemePreferenceProvider } from '@/components/theme-preference'
import { DESKTOP_STORAGE_KEY } from '@/lib/desktop/persistence'
import { RESUME_DRAFT_STORAGE_KEY } from '@/lib/resume-store'
import { readBrowserAiConfig, saveBrowserAiConfig } from '@/lib/agent/browser-config'
import {
  AI_PROVIDER_PREFERENCE_STORAGE_KEY,
  clearAiProviderPreference,
  readAiProviderPreference,
  saveAiProviderPreference
} from '@/lib/agent/provider-preference'
import {
  AI_API_KEY_HEADER,
  AI_BASE_URL_HEADER,
  AI_MODEL_HEADER
} from '@/lib/agent/provider-headers'
import { SettingsApp } from './settings-app'

const routerReplace = vi.fn()
const resetDesktop = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/settings',
  useRouter: () => ({ replace: routerReplace })
}))

vi.mock('@/components/desktop/desktop-provider', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/desktop/desktop-provider')>()
  return { ...original, useOptionalDesktop: () => ({ resetDesktop }) }
})

function renderSettings(locale: 'zh' | 'en' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'zh' ? zh : en}>
      <ThemePreferenceProvider>
        <MotionPreferenceProvider>
          <SettingsApp appId="settings" />
        </MotionPreferenceProvider>
      </ThemePreferenceProvider>
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  routerReplace.mockReset()
  resetDesktop.mockReset()
  window.localStorage.clear()
  window.sessionStorage.clear()
  clearAiProviderPreference()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    })
  })
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SettingsApp', () => {
  it('exposes persisted theme, language, and motion segmented controls', () => {
    renderSettings()

    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(window.localStorage.getItem('resume-os-theme')).toBe('light')

    fireEvent.click(screen.getByRole('radio', { name: 'Reduced motion' }))
    expect(window.localStorage.getItem('resume-os-motion')).toBe('reduced')

    fireEvent.click(screen.getByRole('radio', { name: '中文' }))
    expect(routerReplace).toHaveBeenCalledWith('/settings', { locale: 'zh' })
  })

  it('requires explicit confirmation and preserves resume drafts when resetting layout', () => {
    window.localStorage.setItem(DESKTOP_STORAGE_KEY, 'desktop-layout')
    window.localStorage.setItem(RESUME_DRAFT_STORAGE_KEY, 'resume-drafts')
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'Reset desktop layout' }))
    expect(resetDesktop).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Confirm desktop layout reset' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm reset' }))
    expect(resetDesktop).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem(RESUME_DRAFT_STORAGE_KEY)).toBe('resume-drafts')
  })

  it('persists provider selection and exposes cloud fallback only in automatic mode', async () => {
    saveBrowserAiConfig({
      baseURL: 'https://gateway.example.com/v1',
      model: 'example-model',
      apiKey: 'existing-secret',
      rememberApiKey: false
    })
    renderSettings()
    await waitFor(() => expect(screen.getByRole('radio', { name: /Local Chrome AI/ })).toBeChecked())

    expect(screen.queryByRole('checkbox', { name: /Allow explicit cloud fallback/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Self-configured AI/ }))
    expect(screen.getByLabelText('API Key')).toHaveValue('existing-secret')
    fireEvent.click(screen.getByRole('radio', { name: /^Automatic selection/ }))

    const fallback = screen.getByRole('checkbox', { name: /Allow explicit cloud fallback/ })
    expect(fallback).not.toBeChecked()
    fireEvent.click(fallback)
    expect(readAiProviderPreference()).toEqual({
      mode: 'automatic',
      allowCloudFallback: true
    })
    expect(JSON.parse(window.localStorage.getItem(AI_PROVIDER_PREFERENCE_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      mode: 'automatic',
      allowCloudFallback: true
    })

    fireEvent.click(screen.getByRole('radio', { name: /Local Chrome AI/ }))
    expect(screen.queryByRole('checkbox', { name: /Allow explicit cloud fallback/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
    expect(readAiProviderPreference()).toEqual({
      mode: 'chrome-built-in',
      allowCloudFallback: false
    })
    expect(readBrowserAiConfig()).toEqual({
      baseURL: 'https://gateway.example.com/v1',
      model: 'example-model',
      apiKey: 'existing-secret',
      rememberApiKey: false
    })
  })

  it('runs a real local prompt when Local Chrome AI is selected', async () => {
    const availability = vi.fn().mockResolvedValue('available')
    const prompt = vi.fn().mockResolvedValue('{"status":"ok"}')
    const destroy = vi.fn()
    const create = vi.fn().mockResolvedValue({
      contextUsage: 0,
      contextWindow: 1024,
      measureContextUsage: vi.fn().mockResolvedValue(12),
      prompt,
      destroy
    })
    vi.stubGlobal('LanguageModel', { availability, create })
    renderSettings()

    fireEvent.click(screen.getByRole('radio', { name: /Local Chrome AI/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Check selected AI' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Local Chrome AI (Beta) · browser-managed'))
    expect(availability).toHaveBeenCalledWith({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }]
    })
    expect(create).toHaveBeenCalledOnce()
    expect(prompt).toHaveBeenCalledWith('Return {"status":"ok"}.', expect.objectContaining({
      responseConstraint: expect.objectContaining({ type: 'object' })
    }))
    expect(destroy).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('runs Chinese locally in best-effort mode without claiming official language support', async () => {
    const availability = vi.fn().mockResolvedValue('available')
    const prompt = vi.fn().mockResolvedValue('{"status":"ok"}')
    const create = vi.fn().mockResolvedValue({
      contextUsage: 0,
      contextWindow: 1024,
      measureContextUsage: vi.fn().mockResolvedValue(12),
      prompt,
      destroy: vi.fn()
    })
    vi.stubGlobal('LanguageModel', { availability, create })
    renderSettings('zh')

    fireEvent.click(screen.getByRole('radio', { name: /本地 Chrome AI/ }))
    fireEvent.click(screen.getByRole('button', { name: '检查当前 AI' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      '实验性中文本地检查成功'
    ))
    expect(availability.mock.calls).toEqual([[]])
    const createOptions = create.mock.calls[0]?.[0]
    expect(createOptions).not.toHaveProperty('expectedInputs')
    expect(createOptions).not.toHaveProperty('expectedOutputs')
    expect(createOptions).toMatchObject({
      initialPrompts: [{
        role: 'system',
        content: '你是本地 AI 连接诊断器。只能返回符合 JSON Schema 的结果。'
      }]
    })
    expect(prompt).toHaveBeenCalledWith('返回 {"status":"ok"}。', expect.objectContaining({
      responseConstraint: expect.objectContaining({ type: 'object' })
    }))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('distinguishes a missing Chrome Prompt API from language or model unavailability', async () => {
    renderSettings()

    fireEvent.click(screen.getByRole('radio', { name: /Local Chrome AI/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Check selected AI' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'does not expose the built-in Prompt API'
    ))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('runs diagnostics with the saved provider preference and reports its model', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ answer: 'ready', model: 'qwen-plus' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
    saveAiProviderPreference({ mode: 'openai-compatible', allowCloudFallback: false })
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'Check selected AI' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('qwen-plus'))
    expect(fetch).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
      method: 'POST',
      signal: expect.any(AbortSignal)
    }))
  })

  it('saves a BYOK configuration locally and sends it only with AI diagnostics', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ answer: 'ready', model: 'deepseek-chat' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
    renderSettings()

    fireEvent.click(screen.getByRole('radio', { name: /Self-configured AI/ }))
    fireEvent.change(screen.getByLabelText('API Base URL'), {
      target: { value: 'https://api.deepseek.com' }
    })
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'deepseek-chat' }
    })
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'user-owned-key' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save AI configuration' }))

    expect(screen.getByRole('status')).toHaveTextContent('this session')
    expect(readBrowserAiConfig()).toEqual({
      apiKey: 'user-owned-key',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      rememberApiKey: false
    })

    fireEvent.click(screen.getByRole('button', { name: 'Check selected AI' }))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const headers = new Headers(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.headers)
    expect(headers.get(AI_API_KEY_HEADER)).toBe('user-owned-key')
    expect(headers.get(AI_BASE_URL_HEADER)).toBe('https://api.deepseek.com')
    expect(headers.get(AI_MODEL_HEADER)).toBe('deepseek-chat')
  })
})
