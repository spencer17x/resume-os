import type { Metadata } from 'next'
import { hasLocale } from 'next-intl'
import { NextIntlClientProvider } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { DesktopProvider } from '@/components/desktop/desktop-provider'
import { DesktopShell } from '@/components/desktop/desktop-shell'
import { ResumeDraftProvider } from '@/components/resume-draft-provider'
import { ThemeScript } from '@/components/theme-script'
import { routing } from '@/i18n/routing'
import '../globals.css'

export const metadata: Metadata = {
  title: 'Resume OS — Evidence-Grounded Resume Agent',
  description: 'A local-first agent for tailoring resumes with traceable career evidence.'
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  setRequestLocale(locale)

  return (
    <html lang={locale} data-theme="dark" data-motion="system" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <NextIntlClientProvider>
          <DesktopProvider locale={locale}>
            <ResumeDraftProvider locale={locale}>
              <DesktopShell>{children}</DesktopShell>
            </ResumeDraftProvider>
          </DesktopProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
