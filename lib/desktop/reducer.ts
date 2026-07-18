import { appRegistry } from './app-registry'
import type {
  AppId,
  DesktopState,
  DesktopWindowState,
  Point,
  Size
} from './types'

export type DesktopAction =
  | { type: 'open'; appId: AppId }
  | { type: 'focus'; appId: AppId }
  | { type: 'move'; appId: AppId; position: Point }
  | { type: 'resize'; appId: AppId; position: Point; size: Size }
  | { type: 'minimize'; appId: AppId }
  | { type: 'maximize'; appId: AppId }
  | { type: 'restore'; appId: AppId }
  | { type: 'close'; appId: AppId }
  | { type: 'clamp'; viewport: Size }
  | { type: 'hydrate'; state: DesktopState }
  | { type: 'completeIntro' }
  | { type: 'reset' }

function cloneWindow(window: DesktopWindowState): DesktopWindowState {
  return {
    ...window,
    position: { ...window.position },
    size: { ...window.size },
    restoreGeometry: window.restoreGeometry
      ? {
          position: { ...window.restoreGeometry.position },
          size: { ...window.restoreGeometry.size }
        }
      : undefined
  }
}

function cloneWindows(windows: DesktopState['windows']): DesktopState['windows'] {
  return Object.fromEntries(
    Object.entries(windows).map(([appId, window]) => [appId, window ? cloneWindow(window) : window])
  ) as DesktopState['windows']
}

function withRaisedFocus(state: DesktopState, appId: AppId): DesktopState {
  const window = state.windows[appId]
  if (!window || window.status === 'minimized') {
    return state
  }

  return {
    ...state,
    windows: {
      ...state.windows,
      [appId]: { ...window, zIndex: state.nextZIndex }
    },
    focusedAppId: appId,
    nextZIndex: state.nextZIndex + 1
  }
}

function highestVisibleAppId(windows: DesktopState['windows']): AppId | null {
  return Object.values(windows)
    .filter((window): window is DesktopWindowState => Boolean(window) && window.status !== 'minimized')
    .sort((left, right) => right.zIndex - left.zIndex)[0]?.appId ?? null
}

function withTopVisibleFocus(state: DesktopState): DesktopState {
  return { ...state, focusedAppId: highestVisibleAppId(state.windows) }
}

function finiteOr(value: number, fallback: number, defaultValue = 0): number {
  if (Number.isFinite(value)) return value
  return Number.isFinite(fallback) ? fallback : defaultValue
}

function assertNever(action: never): never {
  throw new Error(`Unhandled desktop action: ${JSON.stringify(action)}`)
}

export function createInitialDesktopState(): DesktopState {
  return {
    windows: {},
    focusedAppId: null,
    nextZIndex: 1,
    hasCompletedIntro: false
  }
}

export function clampWindowGeometry(
  window: DesktopWindowState,
  viewport: Size
): DesktopWindowState {
  const viewportWidth = Number.isFinite(viewport.width) ? viewport.width : 0
  const viewportHeight = Number.isFinite(viewport.height) ? Math.max(0, viewport.height) : 0
  const width = Number.isFinite(window.size.width) ? window.size.width : 0
  const height = Number.isFinite(window.size.height) ? Math.max(0, window.size.height) : 0
  const x = Number.isFinite(window.position.x) ? window.position.x : 0
  const y = Number.isFinite(window.position.y) ? window.position.y : 0
  const minX = 96 - width
  const maxX = viewportWidth - 96
  const maxY = height <= viewportHeight ? viewportHeight - height : 0
  const hasInvalidHorizontalInterval = viewportWidth < 96 || minX > maxX
  const nextX = hasInvalidHorizontalInterval ? 0 : Math.min(Math.max(x, minX), maxX)
  const nextY = Math.min(Math.max(y, 0), maxY)

  if (nextX === window.position.x && nextY === window.position.y) return window

  return {
    ...window,
    position: {
      x: nextX,
      y: nextY
    }
  }
}

function clampMaximizedRestoreGeometry(
  window: DesktopWindowState,
  viewport: Size
): DesktopWindowState {
  const restoreGeometry = window.restoreGeometry
  if (!restoreGeometry) return window

  const restoreWindow = {
    ...window,
    position: restoreGeometry.position,
    size: restoreGeometry.size
  }
  const clampedRestoreWindow = clampWindowGeometry(restoreWindow, viewport)
  if (clampedRestoreWindow === restoreWindow) return window

  return {
    ...window,
    restoreGeometry: {
      position: clampedRestoreWindow.position,
      size: restoreGeometry.size
    }
  }
}

export function desktopReducer(state: DesktopState, action: DesktopAction): DesktopState {
  switch (action.type) {
    case 'open': {
      const definition = appRegistry[action.appId]
      const existing = state.windows[action.appId]
      const window = existing
        ? { ...existing, status: existing.status === 'minimized' ? 'open' : existing.status }
        : {
            appId: action.appId,
            status: 'open' as const,
            position: { ...definition.defaultPosition },
            size: { ...definition.defaultSize },
            zIndex: state.nextZIndex
          }
      const nextState = {
        ...state,
        windows: { ...state.windows, [action.appId]: window }
      }
      return withRaisedFocus(nextState, action.appId)
    }

    case 'focus':
      return withRaisedFocus(state, action.appId)

    case 'move': {
      const window = state.windows[action.appId]
      if (!window || window.status === 'maximized') return state
      return {
        ...state,
        windows: {
          ...state.windows,
          [action.appId]: { ...window, position: { ...action.position } }
        }
      }
    }

    case 'resize': {
      const window = state.windows[action.appId]
      if (!window || window.status === 'maximized') return state
      const minSize = appRegistry[action.appId].minSize
      const width = finiteOr(action.size.width, window.size.width, minSize.width)
      const height = finiteOr(action.size.height, window.size.height, minSize.height)
      return {
        ...state,
        windows: {
          ...state.windows,
          [action.appId]: {
            ...window,
            position: {
              x: finiteOr(action.position.x, window.position.x),
              y: finiteOr(action.position.y, window.position.y)
            },
            size: {
              width: Math.max(width, minSize.width),
              height: Math.max(height, minSize.height)
            }
          }
        }
      }
    }

    case 'minimize': {
      const window = state.windows[action.appId]
      if (!window) return state
      const nextState = {
        ...state,
        windows: {
          ...state.windows,
          [action.appId]: { ...window, status: 'minimized' as const }
        }
      }
      return withTopVisibleFocus(nextState)
    }

    case 'maximize': {
      const window = state.windows[action.appId]
      if (!window) return state
      const maximized = window.status === 'maximized'
        ? { ...window }
        : {
            ...window,
            status: 'maximized' as const,
            restoreGeometry: {
              position: { ...window.position },
              size: { ...window.size }
            }
          }
      return withRaisedFocus({
        ...state,
        windows: { ...state.windows, [action.appId]: maximized }
      }, action.appId)
    }

    case 'restore': {
      const window = state.windows[action.appId]
      if (!window) return state
      const restored = window.status === 'minimized' && window.restoreGeometry
        ? { ...window, status: 'maximized' as const }
        : window.status === 'maximized' && window.restoreGeometry
          ? {
              ...window,
              status: 'open' as const,
              position: { ...window.restoreGeometry.position },
              size: { ...window.restoreGeometry.size },
              restoreGeometry: undefined
            }
          : { ...window, status: 'open' as const, restoreGeometry: undefined }
      return withRaisedFocus({
        ...state,
        windows: { ...state.windows, [action.appId]: restored }
      }, action.appId)
    }

    case 'close': {
      if (!state.windows[action.appId]) return state
      const windows = { ...state.windows }
      delete windows[action.appId]
      return withTopVisibleFocus({ ...state, windows })
    }

    case 'clamp': {
      let changed = false
      const windows = Object.fromEntries(
        Object.entries(state.windows).map(([appId, window]) => {
          const clamped = !window
            ? window
            : window.status === 'maximized'
              ? clampMaximizedRestoreGeometry(window, action.viewport)
              : clampWindowGeometry(window, action.viewport)
          if (clamped !== window) changed = true
          return [appId, clamped]
        })
      ) as DesktopState['windows']
      return changed ? { ...state, windows } : state
    }

    case 'hydrate':
      return { ...action.state, windows: cloneWindows(action.state.windows) }

    case 'completeIntro':
      return { ...state, hasCompletedIntro: true }

    case 'reset':
      return createInitialDesktopState()

    default:
      return assertNever(action)
  }
}
