'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AppControls } from '@/components/app-controls'
import { appRegistry } from '@/lib/desktop/app-registry'
import type { Locale } from '@/i18n/routing'
import { useDesktop } from './desktop-provider'

function useClock(locale: Locale) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now)
}

export function MenuBar() {
  const { state } = useDesktop()
  const t = useTranslations('desktop')
  const locale = useLocale() as Locale
  const focusedApp = state.focusedAppId ? appRegistry[state.focusedAppId] : null
  const clock = useClock(locale)

  return (
    <header className="desktop-menu-bar" data-material="clear" data-testid="menu-bar">
      <div className="desktop-menu-bar__identity">
        <strong>{t('brand')}</strong>
        <span className="desktop-menu-bar__separator" aria-hidden="true">›</span>
        <span
          key={focusedApp?.id ?? 'desktop'}
          className="desktop-menu-bar__active-label"
          data-testid="focused-app"
        >
          {focusedApp ? t(focusedApp.messageKey) : t('desktop')}
        </span>
      </div>
      <div className="desktop-menu-bar__tools">
        <time className="desktop-menu-bar__clock">{clock}</time>
        <AppControls />
      </div>
    </header>
  )
}
