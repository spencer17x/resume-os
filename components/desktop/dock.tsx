'use client'

import { useTranslations } from 'next-intl'
import { appRegistry } from '@/lib/desktop/app-registry'
import type { AppId, DesktopState } from '@/lib/desktop/types'
import { AppIcon } from './app-icon'
import { useDesktop } from './desktop-provider'

const desktopDockFavoriteIds: readonly AppId[] = [
  'studio',
  'agent',
  'resume-3d',
  'book',
  'projects',
  'settings'
]

const desktopDockSupplementalIds = (Object.keys(appRegistry) as AppId[])
  .filter((appId) => !desktopDockFavoriteIds.includes(appId))

const desktopDockAppIds: readonly AppId[] = [
  ...desktopDockFavoriteIds,
  ...desktopDockSupplementalIds
]

export function dockAppIdsForWindows(
  windows: DesktopState['windows'],
  includeAllSupplemental = false
): AppId[] {
  const supplemental = includeAllSupplemental
    ? desktopDockSupplementalIds
    : desktopDockSupplementalIds.filter((appId) => Boolean(windows[appId]))
  return [...desktopDockFavoriteIds, ...supplemental]
}

export function Dock() {
  const { state, openApp } = useDesktop()
  const t = useTranslations('desktop')
  const appIds = desktopDockAppIds

  return (
    <nav className="desktop-dock" data-testid="dock" aria-label={t('dock')}>
      <div className="desktop-dock__items">
        {appIds.map((appId) => {
          const app = appRegistry[appId]
          const window = state.windows[appId]
          const isFocused = state.focusedAppId === appId && window?.status !== 'minimized'
          const statusId = `desktop-dock-status-${appId}`
          return (
            <button
              key={appId}
              id={`desktop-dock-${appId}`}
              type="button"
              className="desktop-dock-item"
              aria-label={t(app.messageKey)}
              aria-describedby={statusId}
              aria-current={isFocused ? 'page' : undefined}
              data-running={Boolean(window)}
              data-dock-supplemental={desktopDockSupplementalIds.includes(appId) ? 'true' : undefined}
              onClick={() => openApp(appId)}
            >
              <span className="desktop-dock-item__icon" aria-hidden="true"><AppIcon app={app} size={21} /></span>
              <span id={statusId} className="sr-only">{window ? t('running') : t('notRunning')}</span>
              {window ? <span className="desktop-dock-item__running" aria-hidden="true" /> : null}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
