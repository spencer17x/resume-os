'use client'

import { BrainCircuit, Check, RefreshCw, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { JobHistorySimulation } from '@/lib/jobs/job-history-learning'

export function JobHistoryLearningPanel({ simulation, busy, onSimulate, onApply, onDismiss }: {
  simulation: JobHistorySimulation | null
  busy: boolean
  onSimulate: () => void
  onApply: () => void
  onDismiss: () => void
}) {
  const t = useTranslations('jobRadar.historyLearning')
  return <section className="job-history-learning" aria-labelledby="job-history-learning-title">
    <header><div><BrainCircuit size={19} aria-hidden="true" /><div><h2 id="job-history-learning-title">{t('title')}</h2><p>{t('description')}</p></div></div><button type="button" className="job-button job-button--secondary" onClick={onSimulate} disabled={busy}><RefreshCw size={14} />{busy ? t('reading') : t('readHistory')}</button></header>
    <p className="job-history-learning__privacy">{t('privacy')}</p>
    {simulation ? <div className="job-history-learning__simulation">
      <header><div><strong>{t('simulationTitle')}</strong><span>{t('sampleSize', { count: simulation.sampleSize })}</span></div><button type="button" onClick={onDismiss} aria-label={t('dismiss')}><X size={14} /></button></header>
      <div className="job-history-learning__signals">
        {(['conversations', 'recruiterReplies', 'resumeRequests', 'interviewInvites', 'offers', 'rejections'] as const).map((key) => <article key={key}><strong>{simulation.signals[key]}</strong><span>{t(`signals.${key}`)}</span></article>)}
      </div>
      <dl>
        <div><dt>{t('minimumScore')}</dt><dd>{simulation.recommendedMinimumMatchScore}%</dd></div>
        <div><dt>{t('dailyLimit')}</dt><dd>{simulation.recommendedDailyContactLimit}</dd></div>
        <div><dt>{t('automation')}</dt><dd>{t(`autonomy.${simulation.recommendedAutonomy}`)}</dd></div>
        <div><dt>{t('autoResume')}</dt><dd>{simulation.recommendedAutoSendResume ? t('enabled') : t('disabled')}</dd></div>
      </dl>
      <ul>{simulation.reasonCodes.map((code) => <li key={code}>{t(`reasons.${code}`)}</li>)}</ul>
      <footer><button type="button" className="job-button job-button--primary" onClick={onApply} disabled={simulation.sampleSize === 0}><Check size={14} />{t('apply')}</button><button type="button" className="job-button job-button--secondary" onClick={onDismiss}>{t('keepCurrent')}</button></footer>
    </div> : null}
  </section>
}
