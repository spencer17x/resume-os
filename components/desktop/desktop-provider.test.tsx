import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_STORAGE_KEY } from '@/lib/desktop/persistence'
import { createInitialDesktopState, desktopReducer } from '@/lib/desktop/reducer'
import type { DesktopState } from '@/lib/desktop/types'
import {
  canonicalDesktopPathname,
  DESKTOP_DOCK_HEIGHT,
  DESKTOP_MENU_HEIGHT,
  DesktopProviderCore,
  internalDesktopHref,
  type DesktopContextValue,
  type DesktopRouter,
  useDesktop
} from './desktop-provider'
import { DesktopRoute } from './desktop-route'

vi.mock('@/i18n/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn()
}))

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  readonly setCalls: Array<[string, string]> = []
  readonly removeCalls: string[] = []
  getCalls = 0
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    this.getCalls += 1
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.setCalls.push([key, value])
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.removeCalls.push(key)
    this.values.delete(key)
  }

  seed(state: DesktopState): void {
    this.values.set(DESKTOP_STORAGE_KEY, JSON.stringify({ version: 1, state }))
  }
}

class ThrowingStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  getItem(): string | null {
    throw new Error('Storage is unavailable')
  }

  setItem(): void {
    throw new Error('Storage is unavailable')
  }

  removeItem(): void {
    throw new Error('Storage is unavailable')
  }
}

function createRouter() {
  return {
    push: vi.fn<(path: string) => void>(),
    replace: vi.fn<(path: string) => void>()
  } satisfies DesktopRouter
}

type TestRouter = ReturnType<typeof createRouter>

function stateWithOpenApp(appId: 'agent' | 'book' | 'studio', position?: { x: number; y: number }) {
  let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId })
  if (position) state = desktopReducer(state, { type: 'move', appId, position })
  return state
}

function DesktopProbe({ onChange }: { onChange: (desktop: DesktopContextValue) => void }) {
  const desktop = useDesktop()
  onChange(desktop)
  return <output data-testid="desktop-state">{JSON.stringify(desktop.state)}</output>
}

function renderCore({
  children,
  pathname = '/zh',
  router = createRouter(),
  storage = new MemoryStorage(),
  strict = false
}: {
  children?: ReactNode
  pathname?: string
  router?: TestRouter
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  strict?: boolean
}) {
  let desktop: DesktopContextValue | null = null
  const observedStates: DesktopState[] = []
  const captureDesktop = (value: DesktopContextValue) => {
    desktop = value
    observedStates.push(value.state)
  }
  const renderTree = (nextPathname: string, nextChildren?: ReactNode) => {
    const provider = (
    <DesktopProviderCore locale="zh" pathname={nextPathname} router={router} storage={storage}>
      <DesktopProbe onChange={captureDesktop} />
      {nextChildren}
    </DesktopProviderCore>
    )
    return strict ? <StrictMode>{provider}</StrictMode> : provider
  }
  const view = render(renderTree(pathname, children))

  return {
    ...view,
    rerenderCore(nextChildren?: ReactNode, nextPathname = pathname) {
      view.rerender(renderTree(nextPathname, nextChildren))
    },
    desktop: () => {
      if (!desktop) throw new Error('Desktop context was not rendered')
      return desktop
    },
    router,
    storage,
    observedStates
  }
}

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<() => void>()
  const matchMedia = vi.fn().mockImplementation(() => ({
    get matches() {
      return matches
    },
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener)
  }))

  Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia })

  return {
    setMatches(nextMatches: boolean) {
      matches = nextMatches
      listeners.forEach((listener) => listener())
    },
    matchMedia
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  installMatchMedia(false)
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
})

describe('locale navigation adapter', () => {
  it('converts internal pathnames to canonical locale-prefixed paths', () => {
    expect(canonicalDesktopPathname('/', 'zh')).toBe('/zh')
    expect(canonicalDesktopPathname('/book', 'zh')).toBe('/zh/book')
  })

  it('strips exactly the current locale prefix from canonical targets', () => {
    expect(internalDesktopHref('/zh', 'zh')).toBe('/')
    expect(internalDesktopHref('/zh/book', 'zh')).toBe('/book')
    expect(internalDesktopHref('/en/book', 'zh')).toBe('/en/book')
  })
})

describe('DesktopProvider', () => {
  it('shares workspace dimensions with the documented shell regions', () => {
    expect(DESKTOP_MENU_HEIGHT).toBe(30)
    expect(DESKTOP_DOCK_HEIGHT).toBe(82)
  })

  it('hydrates exactly once and exposes the saved desktop state', async () => {
    const storage = new MemoryStorage()
    const saved = stateWithOpenApp('agent')
    storage.seed(saved)

    const { desktop } = renderCore({ pathname: '/zh/agent', storage })

    await waitFor(() => expect(desktop().state).toEqual(saved))
    expect(storage.getCalls).toBe(1)
  })

  it('does not persist the empty initial state before hydration', async () => {
    const storage = new MemoryStorage()
    const saved = stateWithOpenApp('agent')
    storage.seed(saved)

    renderCore({ pathname: '/zh/agent', storage })

    await waitFor(() => expect(storage.setCalls).not.toHaveLength(0))
    const persistedStates = storage.setCalls.map(([, serialized]) => JSON.parse(serialized).state)
    expect(persistedStates).toEqual([saved])
  })

  it('opens the Agent descriptor without pushing a duplicate deep link', async () => {
    const router = createRouter()
    const { desktop } = renderCore({
      pathname: '/zh/agent',
      router,
      children: <DesktopRoute appId="agent" />
    })

    await waitFor(() => expect(desktop().state.focusedAppId).toBe('agent'))
    expect(router.push).not.toHaveBeenCalled()
  })

  it('pushes the explicit Studio route when launching it from the desktop root', async () => {
    const router = createRouter()
    const { desktop } = renderCore({
      pathname: '/zh',
      router,
      children: <DesktopRoute appId="studio" />
    })

    await waitFor(() => expect(desktop().state.focusedAppId).toBe('studio'))
    expect(router.push).toHaveBeenCalledWith('/zh/studio')
  })

  it('starts the locale root with no windows even when a workspace was persisted', async () => {
    const storage = new MemoryStorage()
    storage.seed(stateWithOpenApp('agent'))
    const { desktop, router } = renderCore({ pathname: '/zh', storage })

    await waitFor(() => expect(desktop().state.windows).toEqual({}))
    expect(desktop().state.focusedAppId).toBeNull()
    expect(router.replace).not.toHaveBeenCalled()
    await waitFor(() => expect(storage.setCalls).not.toHaveLength(0))
    expect(JSON.parse(storage.setCalls.at(-1)?.[1] ?? '{}').state.windows).toEqual({})
  })

  it('pushes the Book route when launching Book', async () => {
    const router = createRouter()
    const { desktop } = renderCore({ pathname: '/zh/agent', router })

    await waitFor(() => expect(desktop().state).toEqual(createInitialDesktopState()))
    act(() => desktop().openApp('book'))

    expect(router.push).toHaveBeenCalledWith('/zh/book')
    expect(desktop().state.focusedAppId).toBe('book')
  })

  it('focuses an existing app and replaces the route', async () => {
    const storage = new MemoryStorage()
    storage.seed(stateWithOpenApp('book'))
    const router = createRouter()
    const { desktop } = renderCore({ pathname: '/zh/agent', router, storage })

    await waitFor(() => expect(desktop().state.focusedAppId).toBe('book'))
    act(() => desktop().focusApp('book'))

    expect(router.replace).toHaveBeenCalledWith('/zh/book')
    expect(desktop().state.focusedAppId).toBe('book')
  })

  it('does not raise an already focused visible app again', async () => {
    const storage = new MemoryStorage()
    storage.seed(stateWithOpenApp('agent'))
    const { desktop } = renderCore({ pathname: '/zh/agent', storage })

    await waitFor(() => expect(desktop().state.focusedAppId).toBe('agent'))
    const stateBeforeFocus = desktop().state
    act(() => desktop().focusApp('agent'))

    expect(desktop().state).toBe(stateBeforeFocus)
    expect(desktop().state.nextZIndex).toBe(stateBeforeFocus.nextZIndex)
    expect(desktop().state.windows.agent?.zIndex).toBe(stateBeforeFocus.windows.agent?.zIndex)
  })

  it('replaces the route with the next visible app and then the locale root after close', async () => {
    const router = createRouter()
    const { desktop } = renderCore({ pathname: '/zh', router })

    await waitFor(() => expect(desktop().state).toEqual(createInitialDesktopState()))
    act(() => {
      desktop().openApp('studio')
      desktop().openApp('agent')
    })
    act(() => desktop().dispatch({ type: 'close', appId: 'agent' }))

    await waitFor(() => expect(router.replace).toHaveBeenLastCalledWith('/zh/studio'))
    act(() => desktop().dispatch({ type: 'close', appId: 'studio' }))

    await waitFor(() => expect(router.replace).toHaveBeenLastCalledWith('/zh'))
  })

  it('clears persistence and restores the initial desktop state', async () => {
    const storage = new MemoryStorage()
    storage.seed(stateWithOpenApp('agent'))
    const { desktop } = renderCore({ pathname: '/zh/agent', storage })

    await waitFor(() => expect(desktop().state.focusedAppId).toBe('agent'))
    act(() => desktop().resetDesktop())

    expect(storage.removeCalls).toEqual([DESKTOP_STORAGE_KEY])
    expect(storage.getItem(DESKTOP_STORAGE_KEY)).toBeNull()
    expect(desktop().state).toEqual(createInitialDesktopState())
  })

  it('clamps offscreen persisted geometry before exposure and persistence', async () => {
    const storage = new MemoryStorage()
    storage.seed(stateWithOpenApp('studio', { x: 5000, y: 5000 }))
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    const { desktop, observedStates } = renderCore({ pathname: '/zh/studio', storage })

    await waitFor(() => expect(desktop().state.windows.studio?.position).toEqual({ x: 1184, y: 8 }))
    const exposedStudioStates = observedStates.filter((state) => state.windows.studio)
    expect(exposedStudioStates).not.toHaveLength(0)
    expect(exposedStudioStates.every((state) => state.windows.studio?.position.x === 1184)).toBe(true)
    expect(exposedStudioStates.every((state) => state.windows.studio?.position.y === 8)).toBe(true)
    await waitFor(() => expect(storage.setCalls).not.toHaveLength(0))
    const persisted = storage.setCalls.map(([, value]) => JSON.parse(value).state as DesktopState)
    expect(persisted.every((state) => state.windows.studio?.position.x === 1184)).toBe(true)
    expect(persisted.every((state) => state.windows.studio?.position.y === 8)).toBe(true)
  })

  it('clamps windows to the resized desktop workspace', async () => {
    const storage = new MemoryStorage()
    let saved = stateWithOpenApp('agent', { x: 1000, y: 100 })
    saved = desktopReducer(saved, {
      type: 'resize',
      appId: 'agent',
      position: { x: 1000, y: 100 },
      size: { width: 640, height: 480 }
    })
    storage.seed(saved)
    const { desktop } = renderCore({ pathname: '/zh/agent', storage })

    await waitFor(() => expect(desktop().state.windows.agent?.position).toEqual({ x: 1000, y: 100 }))
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    fireEvent(window, new Event('resize'))

    await waitFor(() => {
      expect(desktop().state.windows.agent?.position).toEqual({ x: 704, y: 8 })
    })
  })

  it('does not update state or persist again when resize geometry is unchanged', async () => {
    const storage = new MemoryStorage()
    storage.seed(stateWithOpenApp('studio'))
    const { desktop } = renderCore({ pathname: '/zh/studio', storage })

    await waitFor(() => expect(storage.setCalls).toHaveLength(1))
    const stateBeforeResize = desktop().state
    fireEvent(window, new Event('resize'))
    await act(async () => undefined)

    expect(desktop().state).toBe(stateBeforeResize)
    expect(storage.setCalls).toHaveLength(1)
  })

  it('keeps desktop-only descriptors inactive on mobile and opens them on desktop', async () => {
    const media = installMatchMedia(true)
    const { desktop } = renderCore({ children: <DesktopRoute appId="studio" desktopOnly /> })

    await waitFor(() => expect(desktop().state).toEqual(createInitialDesktopState()))
    act(() => media.setMatches(false))

    await waitFor(() => expect(desktop().state.focusedAppId).toBe('studio'))
  })

  it('does not open a desktop-only route while hydrating on mobile', async () => {
    const media = installMatchMedia(true)
    const router = createRouter()
    const storage = new MemoryStorage()
    const desktop = { current: null as DesktopContextValue | null }
    const captureDesktop = (value: DesktopContextValue) => { desktop.current = value }
    const tree = (
      <DesktopProviderCore locale="zh" pathname="/zh" router={router} storage={storage}>
        <DesktopProbe onChange={captureDesktop} />
        <DesktopRoute appId="studio" desktopOnly />
      </DesktopProviderCore>
    )
    const container = document.createElement('div')
    container.innerHTML = renderToString(tree)
    document.body.append(container)
    let root: Root | null = null

    try {
      await act(async () => {
        root = hydrateRoot(container, tree)
      })
      await waitFor(() => expect(media.matchMedia).toHaveBeenCalled())

      expect(desktop.current?.state.windows.studio).toBeUndefined()
      expect(router.push).not.toHaveBeenCalled()
    } finally {
      if (root) await act(async () => root?.unmount())
      container.remove()
    }
  })

  it('registers a current descriptor once during StrictMode effect replay', async () => {
    const router = createRouter()
    const storage = new MemoryStorage()
    const { desktop } = renderCore({
      pathname: '/zh/agent',
      router,
      storage,
      strict: true,
      children: <DesktopRoute appId="agent" />
    })

    await waitFor(() => expect(desktop().state.focusedAppId).toBe('agent'))
    await waitFor(() => expect(storage.setCalls).not.toHaveLength(0))

    expect(desktop().state.windows.agent?.zIndex).toBe(1)
    expect(desktop().state.nextZIndex).toBe(2)
    expect(storage.setCalls).toHaveLength(1)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('does not register an app again when its descriptor mounts after navigation', async () => {
    const router = createRouter()
    const storage = new MemoryStorage()
    const view = renderCore({ pathname: '/zh/agent', router, storage })

    await waitFor(() => expect(storage.setCalls).not.toHaveLength(0))
    act(() => view.desktop().openApp('book'))
    await waitFor(() => expect(view.desktop().state.focusedAppId).toBe('book'))
    await waitFor(() => expect(storage.setCalls).toHaveLength(2))
    const zIndex = view.desktop().state.windows.book?.zIndex
    const nextZIndex = view.desktop().state.nextZIndex
    const writeCount = storage.setCalls.length

    view.rerenderCore(<DesktopRoute appId="book" />, '/zh/book')
    await act(async () => undefined)

    expect(view.desktop().state.windows.book?.zIndex).toBe(zIndex)
    expect(view.desktop().state.nextZIndex).toBe(nextZIndex)
    expect(storage.setCalls).toHaveLength(writeCount)
    expect(router.push).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith('/zh/book')
  })

  it('keeps openApp stable across unchanged rerenders', async () => {
    const router = createRouter()
    const storage = new MemoryStorage()
    const view = renderCore({
      pathname: '/zh',
      router,
      storage,
      children: <DesktopRoute appId="studio" />
    })

    await waitFor(() => expect(view.desktop().state.nextZIndex).toBe(2))
    const firstOpenApp = view.desktop().openApp
    view.rerenderCore(<DesktopRoute appId="studio" />)

    expect(view.desktop().openApp).toBe(firstOpenApp)
    expect(view.desktop().state.nextZIndex).toBe(2)
  })

  it('continues when storage operations throw', async () => {
    const router = createRouter()
    const { desktop } = renderCore({ pathname: '/zh', router, storage: new ThrowingStorage() })

    await waitFor(() => expect(desktop().state).toEqual(createInitialDesktopState()))
    expect(() => {
      act(() => desktop().openApp('agent'))
      act(() => desktop().resetDesktop())
    }).not.toThrow()
  })
})
