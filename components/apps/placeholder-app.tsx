'use client'

import { useTranslations } from 'next-intl'
import { appRegistry } from '@/lib/desktop/app-registry'
import type { AppId } from '@/lib/desktop/types'

export function PlaceholderApp({ appId }: { appId: AppId }) {
  const t = useTranslations('desktop')
  const app = appRegistry[appId]

  return (
    <section className="desktop-placeholder" aria-label={t('placeholderRegion', { app: t(app.messageKey) })}>
      <p className="desktop-placeholder__eyebrow">{t(app.messageKey)}</p>
      <p className="desktop-placeholder__status">{t('placeholder')}</p>
    </section>
  )
}
