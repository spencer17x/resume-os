import { isLocale, type Locale } from '@/i18n/routing'
import type { AppId, DesktopAppDefinition } from './types'

export const appRegistry = {
  studio: {
    id: 'studio',
    route: '/studio',
    messageKey: 'apps.studio',
    icon: 'sparkles',
    iconTone: 'teal',
    defaultSize: { width: 980, height: 680 },
    minSize: { width: 720, height: 520 },
    defaultPosition: { x: 80, y: 70 },
    group: 'workflow',
    pinned: true,
    desktop: true
  },
  'jd-match': {
    id: 'jd-match',
    route: '/jd-match',
    messageKey: 'apps.jd-match',
    icon: 'file-search',
    iconTone: 'gold',
    defaultSize: { width: 820, height: 620 },
    minSize: { width: 600, height: 450 },
    defaultPosition: { x: 220, y: 110 },
    group: 'workflow',
    pinned: true,
    desktop: true
  },
  agent: {
    id: 'agent',
    route: '/agent',
    messageKey: 'apps.agent',
    icon: 'bot',
    iconTone: 'coral',
    defaultSize: { width: 920, height: 650 },
    minSize: { width: 640, height: 480 },
    defaultPosition: { x: 160, y: 90 },
    group: 'workflow',
    pinned: true,
    desktop: true
  },
  classic: {
    id: 'classic',
    route: '/classic',
    messageKey: 'apps.classic',
    icon: 'layout-template',
    iconTone: 'neutral',
    defaultSize: { width: 820, height: 700 },
    minSize: { width: 600, height: 520 },
    defaultPosition: { x: 240, y: 45 },
    group: 'workflow',
    pinned: true,
    desktop: true
  },
  settings: {
    id: 'settings',
    route: '/settings',
    messageKey: 'apps.settings',
    icon: 'settings-2',
    iconTone: 'neutral',
    defaultSize: { width: 680, height: 520 },
    minSize: { width: 520, height: 400 },
    defaultPosition: { x: 300, y: 120 },
    group: 'workflow',
    pinned: true,
    desktop: false
  },
  'resume-3d': {
    id: 'resume-3d',
    route: '/3d',
    messageKey: 'apps.resume-3d',
    icon: 'orbit',
    iconTone: 'blue',
    defaultSize: { width: 1040, height: 700 },
    minSize: { width: 720, height: 520 },
    defaultPosition: { x: 100, y: 50 },
    group: 'showcase',
    pinned: false,
    desktop: true
  },
  book: {
    id: 'book',
    route: '/book',
    messageKey: 'apps.book',
    icon: 'book-open',
    iconTone: 'gold',
    defaultSize: { width: 960, height: 680 },
    minSize: { width: 680, height: 520 },
    defaultPosition: { x: 180, y: 60 },
    group: 'showcase',
    pinned: false,
    desktop: true
  },
  projects: {
    id: 'projects',
    route: '/projects',
    messageKey: 'apps.projects',
    icon: 'folder-kanban',
    iconTone: 'teal',
    defaultSize: { width: 940, height: 650 },
    minSize: { width: 660, height: 480 },
    defaultPosition: { x: 130, y: 100 },
    group: 'showcase',
    pinned: false,
    desktop: true
  },
  timeline: {
    id: 'timeline',
    route: '/timeline',
    messageKey: 'apps.timeline',
    icon: 'milestone',
    iconTone: 'blue',
    defaultSize: { width: 820, height: 660 },
    minSize: { width: 600, height: 480 },
    defaultPosition: { x: 260, y: 80 },
    group: 'showcase',
    pinned: false,
    desktop: true
  },
  terminal: {
    id: 'terminal',
    route: '/terminal',
    messageKey: 'apps.terminal',
    icon: 'terminal',
    iconTone: 'neutral',
    defaultSize: { width: 820, height: 560 },
    minSize: { width: 600, height: 400 },
    defaultPosition: { x: 200, y: 140 },
    group: 'showcase',
    pinned: false,
    desktop: true
  }
} as const satisfies { readonly [K in AppId]: DesktopAppDefinition & { readonly id: K } }

export function appIdFromPath(pathname: string): AppId | null {
  const normalizedPath = pathname.replace(/[?#].*$/, '').replace(/\/+$/, '')

  if (!normalizedPath.startsWith('/')) {
    return null
  }

  const segments = normalizedPath.slice(1).split('/')
  const locale = segments[0]

  if (!isLocale(locale)) {
    return null
  }

  if (segments.length === 1) {
    return null
  }

  if (segments.length === 3) {
    return segments[1] === 'projects' && Boolean(segments[2]) ? 'projects' : null
  }

  if (segments.length !== 2 || !segments[1]) {
    return null
  }

  const route = `/${segments[1]}`
  return Object.values(appRegistry).find((definition) => definition.route === route)?.id ?? null
}

export function pathForApp(appId: AppId, locale: Locale): string {
  return `/${locale}${appRegistry[appId].route}`
}
