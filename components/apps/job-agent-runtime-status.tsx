'use client'

import { Clock3, History, WifiOff } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import type { BrowserJobAgentRuntime } from '@/lib/jobs/browser-agent-protocol'

export function JobAgentRuntimeStatus({ runtime }: { runtime: BrowserJobAgentRuntime | null }) {
  const locale = useLocale()
  const t = useTranslations('jobRadar.runtime')
  if (!runtime) return null
  const time = (value?: string) => value
    ? new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
    : t('never')
  return <section className="job-agent-runtime" aria-label={t('title')}>
    <article><Clock3 size={15} /><span>{t('lastRun')}</span><strong>{time(runtime.lastCompletedAt)}</strong></article>
    <article><Clock3 size={15} /><span>{t('nextRun')}</span><strong>{runtime.enabled ? time(runtime.nextRunAt) : t('paused')}</strong></article>
    <article><History size={15} /><span>{t('pending')}</span><strong>{runtime.pendingCount}</strong></article>
    <article data-warning={runtime.offlineReason !== 'none'}><WifiOff size={15} /><span>{t('runtimeState')}</span><strong>{t(`offlineReason.${runtime.offlineReason}`)}</strong></article>
    {runtime.missedRunCount > 0 ? <p>{t('catchUp', { count: runtime.missedRunCount })}</p> : null}
  </section>
}
