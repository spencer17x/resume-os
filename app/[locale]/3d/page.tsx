import { setRequestLocale } from 'next-intl/server'
import { DesktopRoute } from '@/components/desktop/desktop-route'
import type { Locale } from '@/i18n/routing'

export default async function Resume3DPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <DesktopRoute appId="resume-3d" />
}
