'use client'

import { House, ChevronLeft } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { appRegistry } from '@/lib/desktop/app-registry'
import type { AppId } from '@/lib/desktop/types'
import { AppErrorBoundary } from './app-error-boundary'
import { AppLoader } from './app-loader'
import { useDesktop } from './desktop-provider'
import { useMotionPreference } from './motion-preference'

export function MobileAppFrame({ appId }: { appId: AppId }) {
  const { goBack, goHome } = useDesktop()
  const desktop = useTranslations('desktop')
  const t = useTranslations('mobile')
  const { resolvedReducedMotion } = useMotionPreference()
  const app = appRegistry[appId]
  const appName = desktop(app.messageKey)
  const initial = resolvedReducedMotion ? { opacity: 0 } : { opacity: 0, y: 12 }

  return (
    <motion.main
      className="mobile-app-frame"
      data-design-system="macos-tahoe"
      data-testid="mobile-app-frame"
      data-motion-mode={resolvedReducedMotion ? 'reduced' : 'full'}
      initial={initial}
      animate={resolvedReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: resolvedReducedMotion ? 0.12 : 0.22, ease: 'easeOut' }}
      aria-label={appName}
    >
      <header className="mobile-app-frame__bar">
        <button type="button" className="mobile-app-frame__control" aria-label={t('back')} title={t('back')} onClick={goBack}>
          <ChevronLeft aria-hidden="true" size={22} />
        </button>
        <div className="mobile-app-frame__title">
          <strong>{appName}</strong>
          <span>{t('open')}</span>
        </div>
        <button type="button" className="mobile-app-frame__control" aria-label={t('home')} title={t('home')} onClick={goHome}>
          <House aria-hidden="true" size={20} />
        </button>
      </header>
      <div key={appId} className="mobile-app-frame__content">
        <AppErrorBoundary key={appId} appId={appId} appName={appName} onClose={goHome}>
          <AppLoader appId={appId} />
        </AppErrorBoundary>
      </div>
    </motion.main>
  )
}
