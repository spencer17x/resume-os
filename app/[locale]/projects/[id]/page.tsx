import { setRequestLocale } from 'next-intl/server'
import { DesktopRoute } from '@/components/desktop/desktop-route'
import { routing, type Locale } from '@/i18n/routing'
import { getProjectIds } from '@/lib/resume'

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => getProjectIds().map((id) => ({ locale, id })))
}

export default async function ProjectDetailPage({
  params
}: {
  params: Promise<{ id: string; locale: Locale }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  return <DesktopRoute appId="projects" />
}
