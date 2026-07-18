'use client'

import { Languages } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { usePathname, useRouter } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import { ThemeModeControl } from '@/components/theme-preference'

export function AppControls() {
  const t = useTranslations('controls')
  const locale = useLocale() as Locale
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  function switchLocale() {
    const nextLocale: Locale = locale === 'zh' ? 'en' : 'zh'
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale })
    })
  }

  return (
    <div className="flex items-center gap-2">
      <ThemeModeControl compact />

      <button
        type="button"
        aria-label={t('languageLabel')}
        disabled={isPending}
        onClick={switchLocale}
        className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-panel/55 px-3 text-sm font-medium text-fog transition hover:border-accent/45 hover:text-accent-soft disabled:cursor-wait disabled:opacity-60"
      >
        <Languages size={15} />
        {t('language')}
      </button>
    </div>
  )
}
