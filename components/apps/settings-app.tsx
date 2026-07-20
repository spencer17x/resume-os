'use client'

import { Activity, Check, Cpu, KeyRound, Languages, RotateCcw, Save, Settings2, Trash2, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState, useTransition, type KeyboardEvent } from 'react'
import { usePathname, useRouter } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import type { AppId } from '@/lib/desktop/types'
import { MotionModeControl, MotionPreferenceProvider } from '@/components/desktop/motion-preference'
import { useOptionalDesktop } from '@/components/desktop/desktop-provider'
import { ThemeModeControl, ThemePreferenceProvider } from '@/components/theme-preference'
import {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  aiFetch,
  clearBrowserAiConfig,
  readBrowserAiConfig,
  saveBrowserAiConfig,
  type BrowserAiConfig
} from '@/lib/agent/browser-config'
import {
  DEFAULT_AI_PROVIDER_PREFERENCE,
  readAiProviderPreference,
  saveAiProviderPreference,
  type AiProviderMode,
  type AiProviderPreference
} from '@/lib/agent/provider-preference'
import {
  ChromeBuiltInAiError,
  ChromeBuiltInAiProvider,
  ProviderRoutingError,
  localLanguagePolicyForLocale,
  runPreferredProviderTask,
  type StructuredTaskInput,
  type StructuredTaskResult
} from '@/lib/agent/providers'
import { clearDesktopState } from '@/lib/desktop/persistence'

const locales: readonly Locale[] = ['zh', 'en']
const providerOptions = [
  { mode: 'chrome-built-in', messageKey: 'chromeBuiltIn' },
  { mode: 'openai-compatible', messageKey: 'openAiCompatible' },
  { mode: 'automatic', messageKey: 'automatic' }
] as const satisfies readonly { mode: AiProviderMode; messageKey: string }[]
const DIAGNOSTIC_TIMEOUT_MS = 65_000
const AI_DIAGNOSTIC_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ok'] }
  },
  required: ['status']
}

type AiDiagnosticResult = { status: 'ok' }

export function SettingsApp(_props: { appId: AppId }) {
  return <ThemePreferenceProvider>
    <MotionPreferenceProvider>
      <SettingsContent />
    </MotionPreferenceProvider>
  </ThemePreferenceProvider>
}

function SettingsContent() {
  const t = useTranslations('settings')
  const errors = useTranslations('errors')
  const locale = useLocale() as Locale
  const pathname = usePathname()
  const router = useRouter()
  const desktop = useOptionalDesktop()
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [aiConfig, setAiConfig] = useState<BrowserAiConfig>({
    baseURL: DEFAULT_AI_BASE_URL,
    model: DEFAULT_AI_MODEL,
    apiKey: '',
    rememberApiKey: false
  })
  const [aiConfigMessage, setAiConfigMessage] = useState('')
  const [providerPreference, setProviderPreference] = useState<AiProviderPreference>(
    DEFAULT_AI_PROVIDER_PREFERENCE
  )
  const [diagnosticState, setDiagnosticState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [diagnosticMessage, setDiagnosticMessage] = useState('')
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setAiConfig(readBrowserAiConfig())
      setProviderPreference(readAiProviderPreference())
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [])

  function setLocale(nextLocale: Locale) {
    if (nextLocale === locale) return
    startTransition(() => router.replace(pathname, { locale: nextLocale }))
  }

  function selectLocaleFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, current: Locale) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = locales.indexOf(current)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? locales.length - 1
        : event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? (currentIndex + 1) % locales.length
          : (currentIndex - 1 + locales.length) % locales.length
    const next = locales[nextIndex]
    setLocale(next)
    document.getElementById(`settings-locale-${next}`)?.focus()
  }

  function confirmReset() {
    if (desktop) {
      desktop.resetDesktop()
    } else {
      clearDesktopState(window.localStorage)
    }
    setConfirmingReset(false)
  }

  function updateAiConfig(field: keyof BrowserAiConfig, value: string | boolean) {
    setAiConfig((current) => ({ ...current, [field]: value }))
    setAiConfigMessage('')
  }

  function saveAiConfig() {
    if (!aiConfig.apiKey.trim() || !aiConfig.baseURL.trim() || !aiConfig.model.trim()) {
      setAiConfigMessage(t('aiConfigInvalid'))
      return
    }

    try {
      const next = {
        ...aiConfig,
        apiKey: aiConfig.apiKey.trim(),
        baseURL: aiConfig.baseURL.trim(),
        model: aiConfig.model.trim()
      }
      saveBrowserAiConfig(next)
      setAiConfig(next)
      setAiConfigMessage(t(next.rememberApiKey ? 'aiConfigSavedDevice' : 'aiConfigSavedSession'))
      setDiagnosticMessage('')
      setDiagnosticState('idle')
    } catch {
      setAiConfigMessage(t('aiConfigInvalid'))
    }
  }

  function clearAiConfig() {
    clearBrowserAiConfig()
    setAiConfig({
      baseURL: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
      apiKey: '',
      rememberApiKey: false
    })
    setAiConfigMessage(t('aiConfigCleared'))
    setDiagnosticMessage('')
    setDiagnosticState('idle')
  }

  function selectProvider(mode: AiProviderMode) {
    const next = {
      mode,
      allowCloudFallback: mode === 'automatic'
        ? providerPreference.allowCloudFallback
        : false
    }
    saveAiProviderPreference(next)
    setProviderPreference(next)
    setDiagnosticMessage('')
    setDiagnosticState('idle')
    setDownloadProgress(null)
  }

  function setCloudFallback(allowCloudFallback: boolean) {
    if (providerPreference.mode !== 'automatic') return
    const next = { ...providerPreference, allowCloudFallback }
    saveAiProviderPreference(next)
    setProviderPreference(next)
    setDiagnosticMessage('')
    setDiagnosticState('idle')
    setDownloadProgress(null)
  }

  async function runDiagnostics() {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), DIAGNOSTIC_TIMEOUT_MS)
    const savedProviderPreference = readAiProviderPreference()
    setProviderPreference(savedProviderPreference)
    setDiagnosticState('loading')
    setDiagnosticMessage(t('diagnosticsChecking'))
    setDownloadProgress(null)
    try {
      const localCopy = locale === 'zh'
        ? {
            system: '你是本地 AI 连接诊断器。只能返回符合 JSON Schema 的结果。',
            prompt: '返回 {"status":"ok"}。'
          }
        : {
            system: 'You are a local AI connection diagnostic. Return only JSON that matches the schema.',
            prompt: 'Return {"status":"ok"}.'
          }
      const input: StructuredTaskInput<AiDiagnosticResult> = {
        task: {
          kind: 'review-resume',
          expectedInputLanguages: [locale],
          expectedOutputLanguages: [locale],
          localLanguagePolicy: localLanguagePolicyForLocale(locale)
        },
        system: localCopy.system,
        prompt: localCopy.prompt,
        jsonSchema: AI_DIAGNOSTIC_JSON_SCHEMA,
        validate(value) {
          if (
            typeof value !== 'object'
            || value === null
            || (value as { status?: unknown }).status !== 'ok'
          ) {
            throw new TypeError('Invalid AI diagnostic response.')
          }
          return { status: 'ok' }
        },
        signal: controller.signal,
        onDownloadProgress(progress) {
          setDownloadProgress(progress)
        }
      }
      const result = await runPreferredProviderTask({
        preference: savedProviderPreference,
        localProvider: new ChromeBuiltInAiProvider(),
        input,
        runCloudTask: () => runCloudDiagnostic(controller.signal)
      })
      const usedCloudProvider = result.provider === 'OpenAI-compatible'
      const provider = usedCloudProvider
        ? t('providers.openAiCompatible')
        : t('providers.chromeBuiltIn')
      setDiagnosticState('success')
      setDiagnosticMessage(t(
        !usedCloudProvider && locale === 'zh'
          ? 'diagnosticsConnectedBestEffort'
          : 'diagnosticsConnected', {
        provider,
        model: result.model
      }))
    } catch (error) {
      setDiagnosticState('error')
      setDiagnosticMessage(diagnosticError(error))
    } finally {
      window.clearTimeout(timeout)
      setDownloadProgress(null)
    }
  }

  async function runCloudDiagnostic(signal: AbortSignal): Promise<StructuredTaskResult<AiDiagnosticResult>> {
    const response = await aiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale, message: t('diagnosticsPrompt') }),
      signal
    })
    const body = await response.json().catch(() => ({})) as {
      model?: unknown
      code?: unknown
      error?: { code?: unknown }
    }
    if (!response.ok) {
      const code = typeof body.code === 'string' ? body.code : body.error?.code
      const knownCode = typeof code === 'string' && errors.has(code)
      throw new Error(knownCode ? errors(code) : t('diagnosticsError'))
    }
    if (typeof body.model !== 'string' || !body.model.trim()) {
      throw new Error(t('diagnosticsError'))
    }
    return {
      value: { status: 'ok' },
      provider: 'OpenAI-compatible',
      model: body.model
    }
  }

  function diagnosticError(error: unknown) {
    if (error instanceof ProviderRoutingError) return t('diagnosticErrors.cloudFallbackNotAllowed')
    if (error instanceof ChromeBuiltInAiError) {
      switch (error.code) {
        case 'MODEL_UNAVAILABLE':
          if (!('LanguageModel' in globalThis)) return t('diagnosticErrors.apiUnavailable')
          return t('diagnosticErrors.localModelUnavailable', { language: t(`languages.${locale}`) })
        case 'USER_ACTIVATION_REQUIRED':
          return t('diagnosticErrors.userActivationRequired')
        case 'CONTEXT_LIMIT_EXCEEDED':
          return t('diagnosticErrors.contextLimitExceeded')
        case 'INVALID_MODEL_OUTPUT':
          return t('diagnosticErrors.invalidModelOutput')
      }
    }
    return error instanceof Error ? error.message : t('diagnosticsError')
  }

  return <section className="desktop-app-content settings-app" aria-labelledby="settings-title">
    <header className="settings-app__heading">
      <span><Settings2 size={16} aria-hidden="true" />{t('eyebrow')}</span>
      <h1 id="settings-title">{t('title')}</h1>
      <p>{t('description')}</p>
    </header>

    <div className="settings-app__sections">
      <section aria-labelledby="settings-appearance">
        <div className="settings-app__section-copy">
          <h2 id="settings-appearance">{t('appearance')}</h2>
          <p>{t('appearanceDescription')}</p>
        </div>
        <ThemeModeControl />
      </section>

      <section aria-labelledby="settings-language">
        <div className="settings-app__section-copy">
          <h2 id="settings-language">{t('language')}</h2>
          <p>{t('languageDescription')}</p>
        </div>
        <div className="settings-segmented-control" role="radiogroup" aria-label={t('language')} aria-busy={isPending}>
          {locales.map((option) => <button
            key={option}
            id={`settings-locale-${option}`}
            type="button"
            role="radio"
            aria-checked={locale === option}
            tabIndex={locale === option ? 0 : -1}
            disabled={isPending}
            onClick={() => setLocale(option)}
            onKeyDown={(event) => selectLocaleFromKeyboard(event, option)}
          >
            <Languages size={16} aria-hidden="true" />
            {t(`languages.${option}`)}
          </button>)}
        </div>
      </section>

      <section aria-labelledby="settings-motion">
        <div className="settings-app__section-copy">
          <h2 id="settings-motion">{t('motion')}</h2>
          <p>{t('motionDescription')}</p>
        </div>
        <MotionModeControl />
      </section>

      <section aria-labelledby="settings-layout">
        <div className="settings-app__section-copy">
          <h2 id="settings-layout">{t('layout')}</h2>
          <p>{t('layoutDescription')}</p>
        </div>
        {confirmingReset ? <div className="settings-app__confirm" role="group" aria-label={t('resetConfirmation')}>
          <span>{t('resetWarning')}</span>
          <button type="button" onClick={confirmReset}><Check size={16} aria-hidden="true" />{t('confirmReset')}</button>
          <button type="button" onClick={() => setConfirmingReset(false)}><X size={16} aria-hidden="true" />{t('cancel')}</button>
        </div> : <button className="settings-app__command" type="button" onClick={() => setConfirmingReset(true)}>
          <RotateCcw size={16} aria-hidden="true" />{t('resetLayout')}
        </button>}
      </section>

      <section className="settings-app__provider-section" aria-labelledby="settings-provider-preference">
        <div className="settings-app__section-copy">
          <h2 id="settings-provider-preference">{t('providerPreference')}</h2>
          <p>{t('providerPreferenceDescription')}</p>
          <p className="settings-app__privacy-note"><KeyRound size={12} aria-hidden="true" />{t('providerPrivacyNote')}</p>
        </div>
        <div className="settings-app__provider-config">
          <div className="settings-app__provider-options" role="radiogroup" aria-label={t('providerPreference')}>
            {providerOptions.map((option) => <label key={option.mode} data-selected={providerPreference.mode === option.mode}>
              <input
                type="radio"
                name="ai-provider"
                value={option.mode}
                checked={providerPreference.mode === option.mode}
                onChange={() => selectProvider(option.mode)}
              />
              <span>
                <strong>{t(`providers.${option.messageKey}`)}</strong>
                <small>{t(`providerDescriptions.${option.messageKey}`)}</small>
              </span>
            </label>)}
          </div>

          {providerPreference.mode === 'automatic' ? <label className="settings-app__cloud-fallback">
            <input
              type="checkbox"
              checked={providerPreference.allowCloudFallback}
              onChange={(event) => setCloudFallback(event.target.checked)}
            />
            <span>
              <strong>{t('allowCloudFallback')}</strong>
              <small>{t('allowCloudFallbackDescription')}</small>
            </span>
          </label> : null}

          <p className="settings-app__provider-boundary">{t('chromeLanguageBoundary')}</p>
        </div>
      </section>

      {providerPreference.mode !== 'chrome-built-in' ? <section className="settings-app__ai-section" aria-labelledby="settings-ai-provider">
        <div className="settings-app__section-copy">
          <h2 id="settings-ai-provider">{t('aiProvider')}</h2>
          <p>{t('aiProviderDescription')}</p>
          <p className="settings-app__privacy-note"><KeyRound size={12} aria-hidden="true" />{t('aiPrivacyNote')}</p>
        </div>
        <div className="settings-app__ai-config">
          <div className="settings-app__adapter">
            <span>{t('aiAdapter')}</span>
            <strong>{t('aiAdapterValue')}</strong>
          </div>
          <label>
            <span>{t('aiBaseURL')}</span>
            <input
              type="url"
              value={aiConfig.baseURL}
              onChange={(event) => updateAiConfig('baseURL', event.target.value)}
              autoComplete="url"
              spellCheck={false}
            />
          </label>
          <label>
            <span>{t('aiModel')}</span>
            <input
              type="text"
              value={aiConfig.model}
              onChange={(event) => updateAiConfig('model', event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            <span>{t('aiApiKey')}</span>
            <input
              type="password"
              value={aiConfig.apiKey}
              onChange={(event) => updateAiConfig('apiKey', event.target.value)}
              placeholder={t('aiApiKeyPlaceholder')}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="settings-app__remember-key">
            <input
              type="checkbox"
              checked={aiConfig.rememberApiKey}
              onChange={(event) => updateAiConfig('rememberApiKey', event.target.checked)}
            />
            <span>{t('rememberAiKey')}</span>
          </label>
          <div className="settings-app__ai-actions">
            <button className="settings-app__command" type="button" onClick={saveAiConfig}>
              <Save size={16} aria-hidden="true" />{t('saveAiConfig')}
            </button>
            <button className="settings-app__command" type="button" onClick={clearAiConfig}>
              <Trash2 size={16} aria-hidden="true" />{t('clearAiConfig')}
            </button>
          </div>
          {aiConfigMessage ? <output role="status" aria-live="polite">{aiConfigMessage}</output> : null}
        </div>
      </section> : null}

      <section aria-labelledby="settings-diagnostics">
        <div className="settings-app__section-copy">
          <h2 id="settings-diagnostics">{t('diagnostics')}</h2>
          <p>{t('diagnosticsDescription')}</p>
        </div>
        <div className="settings-app__diagnostics">
          <button className="settings-app__command" type="button" onClick={runDiagnostics} disabled={diagnosticState === 'loading'}>
            {providerPreference.mode === 'chrome-built-in'
              ? <Cpu size={16} aria-hidden="true" />
              : <Activity size={16} aria-hidden="true" />}
            {diagnosticState === 'loading' ? t('diagnosticsChecking') : t('runDiagnostics')}
          </button>
          {downloadProgress !== null ? <span>{t('diagnosticsDownload', {
            progress: Math.round(downloadProgress * 100)
          })}</span> : null}
          {diagnosticMessage ? <output role="status" aria-live="polite" data-state={diagnosticState}>{diagnosticMessage}</output> : null}
        </div>
      </section>
    </div>
  </section>
}
