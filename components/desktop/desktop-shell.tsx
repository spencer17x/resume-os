'use client'

import type { ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname } from '@/i18n/navigation'
import { appIdFromPath } from '@/lib/desktop/app-registry'
import { ThemePreferenceProvider } from '@/components/theme-preference'
import { DesktopSurface } from './desktop-surface'
import { Dock } from './dock'
import { MenuBar } from './menu-bar'
import { MobileAppFrame } from './mobile-app-frame'
import { MobileHome } from './mobile-home'
import { MotionPreferenceProvider } from './motion-preference'
import { MOBILE_MEDIA_QUERY, useMediaQuery } from './use-media-query'
import { WindowManager } from './window-manager'

function DesktopLayout({ children }: { children: ReactNode }) {
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

export function DesktopShell({ children }: { children: ReactNode }) {
  const locale = useLocale()
  const pathname = usePathname()
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY)
  const mobileRoot = pathname === '/' || pathname === `/${locale}`
  const appId = mobileRoot ? null : appIdFromPath(pathname.startsWith(`/${locale}`) ? pathname : `/${locale}${pathname}`)

  return (
    <ThemePreferenceProvider>
      <MotionPreferenceProvider>
        {isMobile === null ? (
        <div className="desktop-shell desktop-shell--pending" data-testid="desktop-shell-pending" aria-busy="true">
          <div className="desktop-route-descriptors" aria-hidden="true">{children}</div>
        </div>
      ) : isMobile ? (
        <>
          {mobileRoot ? <MobileHome /> : appId ? <MobileAppFrame appId={appId} /> : null}
          <div className="desktop-route-descriptors" aria-hidden="true">{children}</div>
        </>
        ) : <DesktopLayout>{children}</DesktopLayout>}
      </MotionPreferenceProvider>
    </ThemePreferenceProvider>
  )
}
