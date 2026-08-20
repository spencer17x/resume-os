import { setRequestLocale } from 'next-intl/server'
import type { Locale } from '@/i18n/routing'
import { redirect } from '@/i18n/navigation'

export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  redirect({ href: '/jobs', locale })
}
