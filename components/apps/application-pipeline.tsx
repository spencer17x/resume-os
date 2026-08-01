'use client'

import { Check, ExternalLink, FileCheck2, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ApplicationPacket, ApplicationPacketCheckCode } from '@/lib/jobs/application-record'

export function ApplicationPipeline({
  packets,
  pendingId,
  onPrepare,
  onMarkApplied,
  onNotesChange
}: {
  packets: ApplicationPacket[]
  pendingId?: string
  onPrepare: (recordId: string) => void
  onMarkApplied: (recordId: string) => void
  onNotesChange: (recordId: string, notes: string) => void
}) {
  const t = useTranslations('jobRadar.application')
  if (packets.length === 0) return null
  return <section className="application-pipeline" aria-labelledby="application-pipeline-title">
    <header><div><span><FileCheck2 size={13} />{t('eyebrow')}</span><h2 id="application-pipeline-title">{t('title')}</h2></div><p>{t('description')}</p></header>
    <ul>{packets.map((packet) => {
      const submitted = packet.record.submittedAt
      const canApply = packet.ready && packet.record.status === 'ready-to-apply'
      const displayedStatus = packet.record.status === 'ready-to-apply' && !packet.ready
        ? 'preparing'
        : packet.record.status
      const final = ['applied', 'interviewing', 'offered', 'rejected', 'withdrawn', 'archived'].includes(displayedStatus)
      return <li key={packet.record.id}>
        <article>
          <header><div><strong>{packet.posting.title}</strong><span>{packet.posting.company}</span></div><b>{t(`status.${displayedStatus}`)}</b></header>
          <ul aria-label={t('checklist')}>{packet.checks.map((check) => <li key={check.code} data-passed={check.passed}>
            {check.passed ? <Check size={12} aria-hidden="true" /> : <TriangleAlert size={12} aria-hidden="true" />}
            {t(`checks.${check.code as ApplicationPacketCheckCode}`)}
          </li>)}</ul>
          <label>{t('notes')}<textarea defaultValue={packet.record.notes} maxLength={20_000} onBlur={(event) => onNotesChange(packet.record.id, event.target.value)} /></label>
          <footer>
            {!final && !canApply ? <button type="button" disabled={pendingId === packet.record.id} onClick={() => onPrepare(packet.record.id)}>{t('prepare')}</button> : null}
            {canApply ? <>
              <a href={packet.posting.applyUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />{t('openApplication')}</a>
              <button type="button" disabled={pendingId === packet.record.id} onClick={() => onMarkApplied(packet.record.id)}>{t('markApplied')}</button>
            </> : null}
            {submitted ? <span>{t('submittedAt', { value: new Date(submitted) })}</span> : null}
          </footer>
        </article>
      </li>
    })}</ul>
  </section>
}
