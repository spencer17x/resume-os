'use client'

import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef } from 'react'
import { useResumeDraft } from '@/components/resume-draft-provider'
import { usePathname, useRouter } from '@/i18n/navigation'
import { isLocale, type Locale } from '@/i18n/routing'
import { createProjectPresentations } from '@/lib/presentation-projects'

export function ProjectsApp() {
  const t = useTranslations('projects')
  const locale = useLocale() as Locale
  const pathname = usePathname()
  const router = useRouter()
  const { activeDraft, activeResume, hydrated } = useResumeDraft()
  const projects = useMemo(
    () => createProjectPresentations(activeResume.projects),
    [activeResume.projects]
  )
  const routeProjectKey = projectKeyFromPath(pathname)
  const selectedProject = routeProjectKey
    ? projects.find((presentation) => presentation.key === routeProjectKey) ?? null
    : null
  const invalidRoute = Boolean(routeProjectKey && !selectedProject)
  const correctionSignature = hydrated && invalidRoute
    ? `${activeDraft?.id ?? 'sample'}\u0000${pathname}\u0000${projects.map((project) => project.key).join('\u0000')}`
    : null
  const correctedSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    if (!correctionSignature) {
      correctedSignatureRef.current = null
      return
    }
    if (correctedSignatureRef.current === correctionSignature) return
    correctedSignatureRef.current = correctionSignature
    router.replace('/projects', { locale })
  }, [correctionSignature, locale, router])

  return (
    <section className="projects-app" role="region" aria-label={t('title')}>
      {selectedProject ? (
        <div className="projects-app__detail">
          <button className="projects-app__back" type="button" onClick={() => router.push('/projects', { locale })}>
            <ArrowLeft size={16} aria-hidden="true" />{t('backToProjects')}
          </button>
          <article>
            <header>
              <span>{selectedProject.project.type}</span>
              <h1>{selectedProject.project.name}</h1>
              <p>{selectedProject.project.summary}</p>
            </header>
            <div className="projects-app__tags" aria-label={t('technologies')}>
              {selectedProject.project.tags.map((tag, index) => <span key={`${selectedProject.key}-tag-${index}`}>{tag}</span>)}
            </div>
            <section>
              <h2>{t('highlights')}</h2>
              <ul>{selectedProject.project.highlights.map((highlight, index) => <li key={`${selectedProject.key}-highlight-${index}`}>{highlight}</li>)}</ul>
            </section>
            <aside><strong>{t('askAgent')}</strong><p>{t('askAgentHint', { name: selectedProject.project.name })}</p></aside>
          </article>
        </div>
      ) : (
        <div className="projects-app__list">
          <header className="projects-app__heading">
            <span>{activeDraft?.name ?? t('sampleResume')}</span>
            <h1>{t('title')}</h1>
            <p>{activeResume.profile.name} · {t('description')}</p>
          </header>
          {projects.length > 0 ? (
            <div className="projects-app__grid">
              {projects.map(({ key, project }) => (
                <article key={key}>
                  <span>{project.type}</span>
                  <h2>{project.name}</h2>
                  <p>{project.summary}</p>
                  <div className="projects-app__tags">{project.tags.map((tag, index) => <span key={`${key}-tag-${index}`}>{tag}</span>)}</div>
                  <button type="button" onClick={() => router.push(`/projects/${encodeURIComponent(key)}`, { locale })} aria-label={t('openProject', { name: project.name })}>
                    {t('viewProject')}<ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                </article>
              ))}
            </div>
          ) : <p className="projects-app__empty">{t('empty')}</p>}
        </div>
      )}
    </section>
  )
}

export function projectKeyFromPath(pathname: string): string | null {
  const path = pathname.replace(/[?#].*$/, '')
  const segments = path.startsWith('/') ? path.slice(1).split('/') : []
  let encodedKey: string | undefined

  if (segments.length === 2 && segments[0] === 'projects') {
    encodedKey = segments[1]
  } else if (segments.length === 3 && isLocale(segments[0]) && segments[1] === 'projects') {
    encodedKey = segments[2]
  }

  if (!encodedKey) return null
  try {
    return decodeURIComponent(encodedKey) || null
  } catch {
    return null
  }
}
