'use client'

import { Bot, CheckCircle2, Send, XCircle } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import type { Locale } from '@/i18n/routing'
import { aiFetch } from '@/lib/agent/browser-config'
import { parseRetryAfter } from '@/lib/retry-after'
import { hasExplicitCloudProviderConsent } from '@/lib/agent/provider-preference'

type RequestState = 'idle' | 'loading' | 'success' | 'error'

const LOCALIZED_ERROR_CODES = new Set([
  'AI_PUBLIC_ACCESS_DISABLED',
  'AI_ACCESS_MISCONFIGURED',
  'FORBIDDEN',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INVALID_REQUEST',
  'AI_NOT_CONFIGURED',
  'AI_UNAVAILABLE',
  'REQUEST_ABORTED',
  'CLOUD_PROVIDER_CONSENT_REQUIRED'
])

export function AIServiceTest() {
  const t = useTranslations('home')
  const locale = useLocale() as Locale
  const prompts = t.raw('quickPrompts') as string[]
  const [message, setMessage] = useState(prompts[0] ?? '')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [state, setState] = useState<RequestState>('idle')
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0)

  useEffect(() => {
    if (retryAfterSeconds <= 0) return
    const timer = window.setInterval(() => {
      setRetryAfterSeconds((current) => Math.max(0, current - 1))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [retryAfterSeconds])

  const statusLabel = useMemo(() => {
    if (state === 'loading') return t('quickTestLoading')
    if (state === 'success') return t('quickTestSuccess')
    if (state === 'error') return t('quickTestError')
    return t('agentOnline')
  }, [state, t])

  async function testService() {
    const trimmedMessage = message.trim()
    if (!trimmedMessage) {
      setState('error')
      setError(t('quickTestEmpty'))
      setAnswer('')
      return
    }

    setState('loading')
    setError('')
    setAnswer('')

    if (!hasExplicitCloudProviderConsent()) {
      setError(t('errors.CLOUD_PROVIDER_CONSENT_REQUIRED'))
      setState('error')
      return
    }

    try {
      const response = await aiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale, message: trimmedMessage })
      })
      const data = await response.json().catch(() => ({})) as {
        answer?: unknown
        code?: unknown
        error?: { code?: unknown; message?: unknown } | string
      }

      if (!response.ok) {
        const nestedCode = typeof data.error === 'object' && data.error !== null
          ? data.error.code
          : undefined
        const code = typeof data.code === 'string' ? data.code : nestedCode
        const retryAfter = parseRetryAfter(response.headers?.get('Retry-After'))
        if (code === 'RATE_LIMITED' && retryAfter > 0) {
          setRetryAfterSeconds(retryAfter)
          setError(t('errors.RATE_LIMITED_RETRY', { seconds: retryAfter }))
        } else {
          setError(typeof code === 'string' && LOCALIZED_ERROR_CODES.has(code)
            ? t(`errors.${code}`)
            : t('quickTestError'))
        }
        setState('error')
        return
      }

      setAnswer(typeof data.answer === 'string' ? data.answer : '')
      setState('success')
    } catch {
      setError(t('quickTestError'))
      setState('error')
    }
  }

  return (
    <div className="resume-card rounded-3xl p-6 shadow-glow">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-accent/12 p-3 text-accent-soft">
            <Bot size={24} />
          </div>
          <div>
            <h2 className="font-semibold text-fog">{t('agentPanelTitle')}</h2>
            <p className="text-sm text-accent">{t('agentPanelStatus')}</p>
          </div>
        </div>
        <div
          className={[
            'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
            state === 'success'
              ? 'border-accent/25 text-accent'
              : state === 'error'
                ? 'border-red-400/30 text-red-300'
                : 'border-line text-muted'
          ].join(' ')}
        >
          {state === 'success' ? <CheckCircle2 size={14} /> : state === 'error' ? <XCircle size={14} /> : null}
          {statusLabel}
        </div>
      </div>

      <div className="space-y-3">
        <label className="block text-sm font-medium text-fog" htmlFor="ai-service-test">
          {t('quickTestInputLabel')}
        </label>
        <textarea
          id="ai-service-test"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="min-h-28 w-full resize-y rounded-2xl border border-line bg-panel-strong/70 px-4 py-3 text-sm leading-6 text-fog outline-none transition placeholder:text-muted focus:border-accent/55 focus:ring-2 focus:ring-accent/15"
          placeholder={t('quickTestPlaceholder')}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => setMessage(prompt)}
            className="rounded-full border border-line bg-panel/30 px-3 py-1.5 text-xs text-muted transition hover:border-accent/45 hover:text-accent-soft"
          >
            {prompt}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={testService}
          disabled={state === 'loading' || retryAfterSeconds > 0}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-ink shadow-glow transition hover:bg-accent-soft disabled:cursor-wait disabled:opacity-70"
        >
          <Send size={16} />
          {state === 'loading' ? t('quickTestLoading') : t('quickTestButton')}
        </button>
        <p className="max-w-md text-xs leading-5 text-muted">{t('agentEvidence')}</p>
      </div>

      {answer ? (
        <div className="mt-5 max-h-64 overflow-auto rounded-2xl border border-accent/10 bg-accent/8 p-4 text-sm leading-6 text-fog">
          {answer}
        </div>
      ) : null}

      {error ? (
        <div className="mt-5 max-h-40 overflow-auto rounded-2xl border border-red-400/20 bg-red-400/8 p-4 text-sm leading-6 text-red-200">
          {error}
        </div>
      ) : null}
    </div>
  )
}
