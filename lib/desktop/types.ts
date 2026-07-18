import type { Locale } from '@/i18n/routing'

export type AppId =
  | 'studio' | 'agent' | 'jd-match' | 'resume-3d' | 'book'
  | 'classic' | 'projects' | 'timeline' | 'terminal' | 'settings'

export type DesktopAppMessageKey = `apps.${AppId}`
export type DesktopAppGroup = 'workflow' | 'showcase'

export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type WindowStatus = 'open' | 'minimized' | 'maximized'

export type DesktopAppDefinition = {
  readonly id: AppId
  readonly route: string
  readonly messageKey: DesktopAppMessageKey
  readonly icon: string
  readonly iconTone: 'teal' | 'coral' | 'gold' | 'blue' | 'neutral'
  readonly defaultSize: Readonly<Size>
  readonly minSize: Readonly<Size>
  readonly defaultPosition: Readonly<Point>
  readonly group: DesktopAppGroup
  readonly pinned: boolean
  readonly desktop: boolean
}

export type DesktopWindowState = {
  appId: AppId
  status: WindowStatus
  position: Point
  size: Size
  restoreGeometry?: { position: Point; size: Size }
  zIndex: number
}

export type DesktopState = {
  windows: Partial<Record<AppId, DesktopWindowState>>
  focusedAppId: AppId | null
  nextZIndex: number
  hasCompletedIntro: boolean
}

export type AppPath = { appId: AppId; locale: Locale }
