'use client'

import { Milestone } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useResumeDraft } from '@/components/resume-draft-provider'
import { useMotionPreference } from '@/components/desktop/motion-preference'

export function TimelineApp() {
  const t = useTranslations('timeline')
  const { activeDraft, activeResume } = useResumeDraft()
  const { resolvedReducedMotion } = useMotionPreference()

  return (
    <section
      className="timeline-app"
      role="region"
      aria-label={t('title')}
      data-motion-mode={resolvedReducedMotion ? 'reduced' : 'full'}
    >
      <header className="timeline-app__heading">
        <span><Milestone size={15} aria-hidden="true" />{activeDraft?.name ?? t('sampleResume')}</span>
        <h1>{t('title')}</h1>
        <p>{activeResume.profile.name} · {t('description')}</p>
      </header>
      {activeResume.experiences.length > 0 ? (
        <ol className="timeline-app__track">
          {activeResume.experiences.map((experience, index) => (
            <li key={`experience-${index}`}>
              <span className="timeline-app__marker" aria-hidden="true" />
              <article className="timeline-app__entry" style={{ '--reveal-index': index } as React.CSSProperties}>
                <header><div><h2>{experience.company}</h2><p>{experience.role}</p></div><time>{experience.period}</time></header>
                {experience.location && <p className="timeline-app__location">{experience.location}</p>}
                <div className="timeline-app__tags">{experience.tags.map((tag, tagIndex) => <span key={`experience-${index}-tag-${tagIndex}`}>{tag}</span>)}</div>
                <ul>{experience.bullets.map((bullet, bulletIndex) => <li key={`experience-${index}-bullet-${bulletIndex}`}>{bullet}</li>)}</ul>
              </article>
            </li>
          ))}
        </ol>
      ) : <p className="timeline-app__empty">{t('empty')}</p>}
    </section>
  )
}
