'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useResumeDraft } from '@/components/resume-draft-provider'
import { useMotionPreference } from '@/components/desktop/motion-preference'
import type { ResumeData } from '@/lib/resume-model'

type BookPageKind = 'profile' | 'summary' | 'skills' | 'experience' | 'projects' | 'closing'

type BookPage = {
  kind: BookPageKind
  title: string
  content: ReactNode
}

const EMPTY_ITEMS: readonly never[] = []

export function ResumeBookApp() {
  const t = useTranslations('book')
  const { activeDraft, activeResume } = useResumeDraft()
  const { resolvedReducedMotion } = useMotionPreference()
  const pages = useMemo(() => createBookPages(activeResume, t), [activeResume, t])
  const activeDocumentId = activeDraft?.id ?? 'sample'
  const [navigation, setNavigation] = useState({ documentId: activeDocumentId, pageIndex: 0 })
  const pageIndex = navigation.documentId === activeDocumentId
    ? Math.min(navigation.pageIndex, pages.length - 1)
    : 0
  const setCurrentPage = (nextIndex: number) => setNavigation({
    documentId: activeDocumentId,
    pageIndex: Math.max(0, Math.min(pages.length - 1, nextIndex))
  })
  const previous = () => setCurrentPage(pageIndex - 1)
  const next = () => setCurrentPage(pageIndex + 1)
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isEditableTarget(event.target)) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      previous()
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      next()
    }
  }

  return (
    <section
      className="resume-book"
      role="region"
      aria-label={t('title')}
      data-motion-mode={resolvedReducedMotion ? 'reduced' : 'full'}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <header className="resume-book__header">
        <div>
          <span>{activeDraft?.name ?? t('sampleResume')}</span>
          <h1>{t('title')}</h1>
        </div>
        <p>{t('subtitle', { name: activeResume.profile.name || t('untitled') })}</p>
      </header>

      <div className="resume-book__stage" aria-label={t('reader')}>
        <div className="resume-book__cover" aria-hidden="true" />
        {pages.map((page, index) => {
          const turned = !resolvedReducedMotion && index < pageIndex
          const active = index === pageIndex
          return (
            <article
              key={page.kind}
              className={`resume-book__sheet${turned ? ' resume-book__sheet--turned' : ''}${active ? ' resume-book__sheet--active' : ''}`}
              data-testid="book-page"
              data-page-kind={page.kind}
              data-page-state={index < pageIndex ? 'past' : active ? 'current' : 'future'}
              aria-hidden={!active}
              style={{ '--book-page-index': index, '--book-page-z': pages.length - index } as React.CSSProperties}
            >
              <div className="resume-book__face resume-book__face--front">
                <span className="resume-book__chapter">{t('chapter', { current: index + 1, total: pages.length })}</span>
                <h2>{page.title}</h2>
                <div className="resume-book__page-content">{page.content}</div>
              </div>
              <div className="resume-book__face resume-book__face--back" aria-hidden="true">
                <span>{index + 1}</span>
              </div>
            </article>
          )
        })}
      </div>

      <footer className="resume-book__controls">
        <button type="button" onClick={previous} disabled={pageIndex === 0} aria-label={t('previous')}>
          <ChevronLeft size={18} aria-hidden="true" /><span>{t('previousLabel')}</span>
        </button>
        <output aria-live="polite" aria-atomic="true">{pageIndex + 1} / {pages.length}</output>
        <button type="button" onClick={next} disabled={pageIndex === pages.length - 1} aria-label={t('next')}>
          <span>{t('nextLabel')}</span><ChevronRight size={18} aria-hidden="true" />
        </button>
      </footer>
    </section>
  )
}

function createBookPages(data: ResumeData, t: ReturnType<typeof useTranslations<'book'>>): BookPage[] {
  const empty = <p className="resume-book__empty">{t('empty')}</p>
  const summary = data.profile.summary.length > 0 ? data.profile.summary : EMPTY_ITEMS

  return [
    {
      kind: 'profile',
      title: t('pages.profile'),
      content: (
        <div className="resume-book__profile">
          <p>{data.profile.name || t('untitled')}</p>
          <strong>{data.profile.title || data.targetRole || t('openRole')}</strong>
          {data.profile.location && <span>{data.profile.location}</span>}
          <div>{data.profile.tags.map((tag, index) => <span key={`profile-tag-${index}`}>{tag}</span>)}</div>
        </div>
      )
    },
    {
      kind: 'summary',
      title: t('pages.summary'),
      content: summary.length > 0
        ? <div className="resume-book__prose">{summary.map((item, index) => <p key={`summary-${index}`}>{item}</p>)}</div>
        : empty
    },
    {
      kind: 'skills',
      title: t('pages.skills'),
      content: data.skills.length > 0 ? (
        <dl className="resume-book__list">
          {data.skills.map((group, index) => <div key={`skill-${index}`}><dt>{group.group || t('untitled')}</dt><dd>{group.items.join(' · ') || t('empty')}</dd></div>)}
        </dl>
      ) : empty
    },
    {
      kind: 'experience',
      title: t('pages.experience'),
      content: data.experiences.length > 0 ? (
        <div className="resume-book__entries">
          {data.experiences.map((item, index) => (
            <section key={`experience-${index}`}><span>{item.period}</span><h3>{item.company || t('untitled')}</h3><p>{item.role}</p><ul>{item.bullets.map((bullet, bulletIndex) => <li key={`experience-${index}-${bulletIndex}`}>{bullet}</li>)}</ul></section>
          ))}
        </div>
      ) : empty
    },
    {
      kind: 'projects',
      title: t('pages.projects'),
      content: data.projects.length > 0 ? (
        <div className="resume-book__entries">
          {data.projects.map((project, index) => <section key={`project-${index}`}><h3>{project.name || t('untitled')}</h3><p>{project.summary}</p><span>{project.tags.join(' · ')}</span></section>)}
        </div>
      ) : empty
    },
    {
      kind: 'closing',
      title: t('pages.closing'),
      content: (
        <div className="resume-book__closing">
          <p>{t('closing', { name: data.profile.name || t('untitled') })}</p>
          <span>{[data.profile.email, data.profile.phone].filter(Boolean).join(' · ') || t('contactEmpty')}</span>
        </div>
      )
    }
  ]
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.matches('input, textarea, select, [contenteditable="true"]')
}
