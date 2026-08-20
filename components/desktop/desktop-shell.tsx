'use client'

import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname } from '@/i18n/navigation'
import { appIdFromPath } from '@/lib/desktop/app-registry'
import { ThemePreferenceProvider } from '@/components/theme-preference'
import { MotionPreferenceProvider } from './motion-preference'
import { MOBILE_MEDIA_QUERY, useMediaQuery } from './use-media-query'
import { AppLoader } from './app-loader'

const LazyDesktopLayout = dynamic(
  () => import('./desktop-layout').then((module) => module.DesktopLayout),
  { loading: ShellLoading }
)
const LazyMobileAppFrame = dynamic(
  () => import('./mobile-app-frame').then((module) => module.MobileAppFrame),
  { loading: ShellLoading }
)
const LazyMobileHome = dynamic(
  () => import('./mobile-home').then((module) => module.MobileHome),
  { loading: ShellLoading }
)

function ShellLoading() {
  return <div className="desktop-shell desktop-shell--pending" data-testid="desktop-shell-pending" aria-busy="true" />
}

export function DesktopShell({ children }: { children: ReactNode }) {
  const locale = useLocale()
  const desktop = useTranslations('desktop')
  const pathname = usePathname()
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY)
  const mobileRoot = pathname === '/' || pathname === `/${locale}`
  const appId = mobileRoot ? null : appIdFromPath(pathname.startsWith(`/${locale}`) ? pathname : `/${locale}${pathname}`)

  return (
    <ThemePreferenceProvider>
      <MotionPreferenceProvider>
        {appId === 'jobs' ? (
        <main className="job-standalone-frame" role="application" aria-label={desktop('apps.jobs')}>
          <AppLoader appId="jobs" />
          <div className="desktop-route-descriptors" aria-hidden="true">{children}</div>
        </main>
        ) : isMobile === null ? (
        <div className="desktop-shell desktop-shell--pending" data-testid="desktop-shell-pending" aria-busy="true">
          <div className="desktop-route-descriptors" aria-hidden="true">{children}</div>
        </div>
      ) : isMobile ? (
        <>
          {mobileRoot ? <LazyMobileHome /> : appId ? <LazyMobileAppFrame appId={appId} /> : null}
          <div className="desktop-route-descriptors" aria-hidden="true">{children}</div>
        </>
        ) : <LazyDesktopLayout>{children}</LazyDesktopLayout>}
      </MotionPreferenceProvider>
    </ThemePreferenceProvider>
  )
}
