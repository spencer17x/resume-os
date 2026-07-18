import { setRequestLocale } from 'next-intl/server'
import { DesktopRoute } from '@/components/desktop/desktop-route'
import type { Locale } from '@/i18n/routing'

export default async function SettingsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <DesktopRoute appId="settings" />
}
