'use client'

import { Download, FileText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { IndexedDbDomainStore, ResumeVariant } from '@/lib/agent/domain-store'
import type { TargetJob } from '@/lib/agent/requirement-matrix'
import type { ResumeData } from '@/lib/resume-model'
import { classifyResumeStrategy, classifyRoleTitle, createStrategyResume, RESUME_STRATEGY_KEYS } from '@/lib/jobs/resume-strategy'
import { renderResumeMarkdown, resumeMarkdownFileName } from '@/lib/resume-markdown'
import { renderResumePdf, resumePdfFileName } from '@/lib/resume-pdf'

type LibraryItem = {
  id: string
  name: string
  data: ResumeData
  updatedAt: string
  targetLabel: string
  planned: boolean
}

export function ResumeVariantLibrary({ store, sourceDraftId, baseResume, plannedTitles = [] }: {
  store: IndexedDbDomainStore
  sourceDraftId?: string
  baseResume?: ResumeData
  plannedTitles?: string[]
}) {
  const t = useTranslations('jobRadar.resumeLibrary')
  const [variants, setVariants] = useState<ResumeVariant[]>([])
  const [targets, setTargets] = useState<TargetJob[]>([])

  useEffect(() => {
    let active = true
    if (!sourceDraftId) return () => { active = false }
    void Promise.all([store.list('resumeVariants'), store.list('targetJobs')]).then(([nextVariants, nextTargets]) => {
      if (!active) return
      setVariants(nextVariants.filter((variant) => variant.sourceDraftId === sourceDraftId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)))
      setTargets(nextTargets)
    }).catch(() => {
      if (active) { setVariants([]); setTargets([]) }
    })
    return () => { active = false }
  }, [sourceDraftId, store])

  const targetById = useMemo(() => new Map(targets.map((target) => [target.id, target])), [targets])
  const groups = useMemo(() => RESUME_STRATEGY_KEYS.map((strategy) => {
    const variantItems: LibraryItem[] = variants.filter((variant) => classifyResumeStrategy(
      targetById.get(variant.targetJobId)?.title ?? variant.name,
      variant.data
    ) === strategy).map((variant) => {
      const target = targetById.get(variant.targetJobId)
      return {
        id: variant.id,
        name: variant.name,
        data: variant.data,
        updatedAt: variant.updatedAt,
        targetLabel: target ? `${target.title} · ${target.company}` : variant.data.targetRole || variant.data.profile.title,
        planned: false
      }
    })
    const representativeTitle = plannedTitles.find((title) => classifyRoleTitle(title) === strategy)
    const plannedItems: LibraryItem[] = baseResume && representativeTitle && variantItems.length === 0
      ? [{
          id: `planned-${strategy}`,
          name: t('plannedName', { strategy: t(`strategy.${strategy}`) }),
          data: createStrategyResume(baseResume, strategy, representativeTitle),
          updatedAt: baseResume.metadata.updatedAt,
          targetLabel: representativeTitle,
          planned: true
        }]
      : []
    return { strategy, items: [...variantItems, ...plannedItems] }
  }).filter((group) => group.items.length > 0), [baseResume, plannedTitles, t, targetById, variants])
  const totalCount = groups.reduce((total, group) => total + group.items.length, 0)

  return <section className="resume-variant-library" aria-labelledby="resume-variant-library-title">
    <header><div><h2 id="resume-variant-library-title">{t('title')}</h2><p>{t('description')}</p></div><span>{t('count', { count: totalCount })}</span></header>
    <p className="resume-variant-library__boundary">{t('evidenceBoundary')}</p>
    {groups.length === 0 ? <p className="job-workspace__empty">{t('empty')}</p> : groups.map((group) => <section key={group.strategy}>
      <header><h3>{t(`strategy.${group.strategy}`)}</h3><span>{group.items.length}</span></header>
      <div className="resume-variant-library__grid">{group.items.map((item) => {
        const markdown = renderResumeMarkdown(item.data)
        const fitCount = plannedTitles.filter((title) => classifyRoleTitle(title) === group.strategy).length
        const keySkills = item.data.skills.flatMap((skillGroup) => skillGroup.items).slice(0, 6)
        return <article key={item.id}>
          <div><FileText size={18} aria-hidden="true" /><div><strong>{item.name}</strong><span>{item.targetLabel}</span></div></div>
          <small>{item.planned ? t('planned') : t('updated', { value: new Date(item.updatedAt) })}</small>
          <div className="resume-variant-library__meta"><span>{t('fitCount', { count: Math.max(1, fitCount) })}</span><span>{item.planned ? t('differenceReordered') : t('differenceOptimized')}</span></div>
          {keySkills.length > 0 ? <div className="resume-variant-library__skills" aria-label={t('keySkills')}>{keySkills.map((skill) => <b key={skill}>{skill}</b>)}</div> : null}
          <details><summary>{t('preview')}</summary><pre>{markdown}</pre></details>
          <footer>
            <button type="button" onClick={() => downloadBytes(renderResumePdf(item.data), 'application/pdf', resumePdfFileName(item.data, item.name))}><Download size={13} />PDF</button>
            <button type="button" onClick={() => downloadText(markdown, resumeMarkdownFileName(item.data, item.name))}><Download size={13} />Markdown</button>
          </footer>
        </article>
      })}</div>
    </section>)}
  </section>
}

function downloadBytes(bytes: Uint8Array, mimeType: string, fileName: string) {
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName)
}

function downloadText(value: string, fileName: string) {
  downloadBlob(new Blob([value], { type: 'text/markdown;charset=utf-8' }), fileName)
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
