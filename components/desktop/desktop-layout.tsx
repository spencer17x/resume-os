'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { DesktopSurface } from './desktop-surface'
import { Dock } from './dock'
import { MenuBar } from './menu-bar'
import { WindowManager } from './window-manager'

export function DesktopLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('desktop')

  return (
    <div
      className="desktop-shell"
      data-design-system="macos-tahoe"
      data-testid="desktop-shell"
      aria-label={t('landmark')}
      role="main"
    >
      <MenuBar />
      <DesktopSurface />
      <WindowManager />
      <Dock />
      <div className="desktop-route-descriptors" aria-hidden="true">{children}</div>
    </div>
  )
}
