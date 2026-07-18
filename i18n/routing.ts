import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['zh', 'en'],
  defaultLocale: 'zh',
  localeDetection: false
})

export type Locale = (typeof routing.locales)[number]

export function isLocale(value: string): value is Locale {
  return routing.locales.includes(value as Locale)
}
