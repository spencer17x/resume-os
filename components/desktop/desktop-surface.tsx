'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { appRegistry } from '@/lib/desktop/app-registry'
import type { AppId } from '@/lib/desktop/types'
import { AppIcon } from './app-icon'
import { DesktopAmbient } from './desktop-ambient'
import { useDesktop } from './desktop-provider'
import { WorkflowOverview } from './workflow-overview'

const desktopApps = Object.values(appRegistry).filter((app) => app.desktop)
const launcherOrder = [
  'studio',
  'agent',
  'jd-match',
  'resume-3d',
  'book',
  'classic',
  'projects',
  'timeline',
  'terminal'
] as const satisfies ReadonlyArray<AppId>
const launcherApps = launcherOrder.map((appId) => appRegistry[appId])

export function DesktopSurface() {
  const { openApp, state } = useDesktop()
  const t = useTranslations('desktop')
  const [selectedAppId, setSelectedAppId] = useState<AppId | null>(null)

  return (
    <section className="desktop-surface" data-testid="desktop-surface" aria-label={t('desktop')}>
      <DesktopAmbient subdued={state.focusedAppId !== null} />
      <WorkflowOverview hud />
      <DesktopLauncher apps={launcherApps} selectedAppId={selectedAppId} onSelect={setSelectedAppId} onOpen={openApp} />
    </section>
  )
}

function DesktopLauncher({
  apps,
  selectedAppId,
  onSelect,
  onOpen
}: {
  apps: typeof desktopApps
  selectedAppId: AppId | null
  onSelect: (appId: AppId) => void
  onOpen: (appId: AppId) => void
}) {
  const t = useTranslations('desktop')

  return (
    <nav className="desktop-launcher" aria-label={t('applications')} data-testid="desktop-launcher">
      {apps.map((app) => (
        <button
          key={app.id}
          type="button"
          className="desktop-icon"
          aria-label={t(app.messageKey)}
          aria-pressed={selectedAppId === app.id}
          onClick={() => onSelect(app.id)}
          onDoubleClick={() => onOpen(app.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onOpen(app.id)
            }
          }}
        >
          <AppIcon app={app} size={23} />
          <span>{t(app.messageKey)}</span>
        </button>
      ))}
    </nav>
  )
}
