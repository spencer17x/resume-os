'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { appRegistry } from '@/lib/desktop/app-registry'
import { AppIcon } from './app-icon'
import { DesktopAmbient } from './desktop-ambient'
import { useDesktop } from './desktop-provider'
import { WorkflowOverview } from './workflow-overview'

const mobileApps = Object.values(appRegistry)
const pinnedApps = mobileApps.filter((app) => app.pinned)
const workflowApps = mobileApps.filter((app) => app.group === 'workflow')
const showcaseApps = mobileApps.filter((app) => app.group === 'showcase')

function useMobileTime() {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    const update = () => setNow(new Date())
    update()
    const interval = window.setInterval(update, 30_000)
    return () => window.clearInterval(interval)
  }, [])

  return now
}

export function MobileHome() {
  const { openApp, state } = useDesktop()
  const locale = useLocale()
  const t = useTranslations('mobile')
  const desktop = useTranslations('desktop')
  const now = useMobileTime()
  const time = now
    ? new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(now)
    : '--:--'

  return (
    <main className="mobile-home" data-testid="mobile-home" aria-label={t('homeTitle')}>
      <header className="mobile-status-area">
        <time className="mobile-status-area__time">{time}</time>
        <span className="mobile-status-area__status">{t('status')}</span>
      </header>
      <div className="mobile-home__heading">
        <p>{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
      </div>
      <section className="mobile-home__cinematic" aria-label={desktop('workflow.eyebrow')}>
        <DesktopAmbient subdued={false} />
      </section>
      <WorkflowOverview compact hud />
      <section className="mobile-home__applications" aria-label={t('applications')}>
        <MobileAppGroup label={desktop('workflow.eyebrow')} apps={workflowApps} />
        <MobileAppGroup label={desktop('showcase')} apps={showcaseApps} />
      </section>
      <nav className="mobile-home__dock" aria-label={t('dock')}>
        {pinnedApps.map((app) => {
          const appName = desktop(app.messageKey)
          const running = Boolean(state.windows[app.id])
          const statusId = `mobile-dock-status-${app.id}`

          return (
            <button
              key={app.id}
              type="button"
              className="mobile-home__dock-app"
              aria-label={appName}
              aria-describedby={statusId}
              onClick={() => openApp(app.id)}
            >
              <AppIcon app={app} size={22} />
              <span id={statusId} className="sr-only">{running ? t('running') : t('notRunning')}</span>
            </button>
          )
        })}
      </nav>
    </main>
  )

  function MobileAppGroup({ label, apps }: { label: string; apps: typeof mobileApps }) {
    return <section className="mobile-home__app-group" aria-label={label}>
      <h2>{label}</h2>
      <div className="mobile-home__grid">
        {apps.map((app) => {
          const appName = desktop(app.messageKey)
          const running = Boolean(state.windows[app.id])
          const statusId = `mobile-app-status-${app.id}`

          return (
            <button
              key={app.id}
              type="button"
              className="mobile-home__app"
              aria-label={appName}
              aria-describedby={statusId}
              onClick={() => openApp(app.id)}
            >
              <AppIcon app={app} size={26} />
              <span className="mobile-home__app-label">{appName}</span>
              <span id={statusId} className="sr-only">{running ? t('running') : t('notRunning')}</span>
              {running ? <span className="mobile-home__running" aria-hidden="true" /> : null}
            </button>
          )
        })}
      </div>
    </section>
  }
}
