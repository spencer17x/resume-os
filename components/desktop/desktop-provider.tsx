'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { usePathname, useRouter } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import { appIdFromPath, pathForApp } from '@/lib/desktop/app-registry'
import {
  clearDesktopState,
  readDesktopState,
  writeDesktopState
} from '@/lib/desktop/persistence'
import {
  createInitialDesktopState,
  desktopReducer,
  type DesktopAction
} from '@/lib/desktop/reducer'
import type { AppId, DesktopState, Size } from '@/lib/desktop/types'

type DesktopStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type DesktopRouter = {
  push(path: string): void
  replace(path: string): void
  back?(): void
}

export type DesktopContextValue = {
  state: DesktopState
  openApp(appId: AppId): void
  focusApp(appId: AppId): void
  dispatch(action: DesktopAction): void
  resetDesktop(): void
  goHome(): void
  goBack(): void
}

type DesktopProviderCoreProps = {
  children: ReactNode
  locale: Locale
  pathname: string
  router: DesktopRouter
  storage?: DesktopStorage
}

const DesktopContext = createContext<DesktopContextValue | null>(null)

export const DESKTOP_MENU_HEIGHT = 30
export const DESKTOP_DOCK_HEIGHT = 82

function desktopWorkspaceSize(viewport: Size): Size {
  const width = Number.isFinite(viewport.width) ? Math.max(0, viewport.width) : 0
  const height = Number.isFinite(viewport.height) ? Math.max(0, viewport.height) : 0
  return {
    width,
    height: Math.max(0, height - DESKTOP_MENU_HEIGHT - DESKTOP_DOCK_HEIGHT)
  }
}

function browserWorkspaceSize(): Size {
  if (typeof window === 'undefined') return { width: 0, height: 0 }
  return desktopWorkspaceSize({ width: window.innerWidth, height: window.innerHeight })
}

function browserStorage(): DesktopStorage | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function canonicalDesktopPathname(pathname: string, locale: Locale): string {
  return pathname === '/' ? `/${locale}` : `/${locale}${pathname}`
}

export function internalDesktopHref(pathname: string, locale: Locale): string {
  const localePrefix = `/${locale}`
  if (pathname === localePrefix) return '/'
  return pathname.startsWith(`${localePrefix}/`)
    ? pathname.slice(localePrefix.length)
    : pathname
}

function isPathInLocale(pathname: string, locale: Locale): boolean {
  const localeRoot = `/${locale}`
  return pathname === localeRoot || pathname.startsWith(`${localeRoot}/`)
}

export function DesktopProviderCore({
  children,
  locale,
  pathname,
  router,
  storage
}: DesktopProviderCoreProps) {
  const [state, reducerDispatch] = useReducer(
    desktopReducer,
    undefined,
    createInitialDesktopState
  )
  const stateRef = useRef(state)
  const dispatch = useCallback((action: DesktopAction) => {
    const previousState = stateRef.current
    const nextState = desktopReducer(previousState, action)
    if (nextState === previousState) return

    stateRef.current = nextState
    reducerDispatch(action)
  }, [])
  const [hydrated, setHydrated] = useState(false)
  const storageRef = useRef<DesktopStorage | null>(storage ?? browserStorage())
  const hydrationStartedRef = useRef(false)
  const skipNextPersistenceRef = useRef(false)
  const effectivePathnameRef = useRef(pathname)
  const inAppPredecessorRef = useRef<string | null>(null)
  const navigationLocaleRef = useRef(locale)
  const previousFocusedAppIdRef = useRef(state.focusedAppId)

  useLayoutEffect(() => {
    if (navigationLocaleRef.current !== locale || !isPathInLocale(pathname, locale)) {
      navigationLocaleRef.current = locale
      inAppPredecessorRef.current = null
    }
    effectivePathnameRef.current = pathname
  }, [locale, pathname])

  useLayoutEffect(() => {
    if (hydrationStartedRef.current) return
    hydrationStartedRef.current = true

    const savedState = storageRef.current ? readDesktopState(storageRef.current) : null
    if (savedState) {
      const restoredState = pathname === `/${locale}`
        ? { ...createInitialDesktopState(), hasCompletedIntro: savedState.hasCompletedIntro }
        : savedState
      const clampedState = desktopReducer(restoredState, {
        type: 'clamp',
        viewport: browserWorkspaceSize()
      })
      previousFocusedAppIdRef.current = clampedState.focusedAppId
      dispatch({ type: 'hydrate', state: clampedState })
    }
    setHydrated(true)
  }, [dispatch, locale, pathname])

  useEffect(() => {
    if (!hydrated || !storageRef.current) return
    if (skipNextPersistenceRef.current) {
      skipNextPersistenceRef.current = false
      return
    }

    writeDesktopState(storageRef.current, state)
  }, [hydrated, state])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const clampWindows = () => {
      dispatch({
        type: 'clamp',
        viewport: browserWorkspaceSize()
      })
    }

    window.addEventListener('resize', clampWindows)
    return () => window.removeEventListener('resize', clampWindows)
  }, [dispatch])

  const navigate = useCallback((
    method: 'push' | 'replace',
    target: string,
    recordPredecessor = method === 'push'
  ) => {
    if (effectivePathnameRef.current === target) return

    if (method === 'push') {
      const current = effectivePathnameRef.current
      inAppPredecessorRef.current = recordPredecessor
        && isPathInLocale(current, locale)
        && isPathInLocale(target, locale)
        ? current
        : null
    }

    effectivePathnameRef.current = target
    router[method](target)
  }, [locale, router])

  const openApp = useCallback((appId: AppId) => {
    const currentState = stateRef.current
    const currentWindow = currentState.windows[appId]
    if (
      appIdFromPath(effectivePathnameRef.current) === appId &&
      currentState.focusedAppId === appId &&
      currentWindow &&
      currentWindow.status !== 'minimized'
    ) {
      return
    }

    dispatch({ type: 'open', appId })
    if (appIdFromPath(effectivePathnameRef.current) !== appId) {
      navigate('push', pathForApp(appId, locale))
    }
  }, [dispatch, locale, navigate])

  const focusApp = useCallback((appId: AppId) => {
    if (stateRef.current.focusedAppId !== appId) {
      dispatch({ type: 'focus', appId })
    }
    if (appIdFromPath(effectivePathnameRef.current) !== appId) {
      navigate('replace', pathForApp(appId, locale))
    }
  }, [dispatch, locale, navigate])

  const resetDesktop = useCallback(() => {
    skipNextPersistenceRef.current = true
    if (storageRef.current) clearDesktopState(storageRef.current)
    dispatch({ type: 'reset' })
  }, [dispatch])

  const goHome = useCallback(() => {
    inAppPredecessorRef.current = null
    navigate('push', `/${locale}`, false)
  }, [locale, navigate])

  const goBack = useCallback(() => {
    const current = effectivePathnameRef.current
    const predecessor = inAppPredecessorRef.current
    inAppPredecessorRef.current = null

    if (
      router.back
      && predecessor
      && predecessor !== current
      && isPathInLocale(current, locale)
      && isPathInLocale(predecessor, locale)
    ) {
      router.back()
      return
    }

    navigate('replace', `/${locale}`, false)
  }, [locale, navigate, router])

  useEffect(() => {
    if (!hydrated || state.focusedAppId === previousFocusedAppIdRef.current) return
    previousFocusedAppIdRef.current = state.focusedAppId

    if (appIdFromPath(effectivePathnameRef.current) === state.focusedAppId) return
    const target = state.focusedAppId
      ? pathForApp(state.focusedAppId, locale)
      : `/${locale}`
    navigate('replace', target)
  }, [hydrated, locale, navigate, state.focusedAppId])

  const value = useMemo<DesktopContextValue>(() => ({
    state,
    openApp,
    focusApp,
    dispatch,
    resetDesktop,
    goHome,
    goBack
  }), [dispatch, focusApp, goBack, goHome, openApp, resetDesktop, state])

  return <DesktopContext.Provider value={value}>{children}</DesktopContext.Provider>
}

export function DesktopProvider({
  children,
  locale
}: {
  children: ReactNode
  locale: Locale
}) {
  const internalPathname = usePathname()
  const router = useRouter()
  const pathname = canonicalDesktopPathname(internalPathname, locale)
  const desktopRouter = useMemo<DesktopRouter>(() => ({
    push(target) {
      router.push(internalDesktopHref(target, locale), { locale })
    },
    replace(target) {
      router.replace(internalDesktopHref(target, locale), { locale })
    },
    back() {
      router.back()
    }
  }), [locale, router])

  return (
    <DesktopProviderCore locale={locale} pathname={pathname} router={desktopRouter}>
      {children}
    </DesktopProviderCore>
  )
}

export function useDesktop(): DesktopContextValue {
  const context = useContext(DesktopContext)
  if (!context) throw new Error('useDesktop must be used within DesktopProvider')
  return context
}

export function useOptionalDesktop(): DesktopContextValue | null {
  return useContext(DesktopContext)
}
