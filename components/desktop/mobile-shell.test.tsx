import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import zh from '@/messages/zh.json'
import { appRegistry } from '@/lib/desktop/app-registry'
import type { AppId } from '@/lib/desktop/types'
import type { Locale } from '@/i18n/routing'
import { ResumeDraftProvider } from '@/components/resume-draft-provider'
import { DesktopRoute } from './desktop-route'
import { DesktopProviderCore, type DesktopRouter } from './desktop-provider'
import { DesktopShell } from './desktop-shell'

let pathname = '/'
let mobile = true
const mediaListeners = new Set<() => void>()
const appLoaderMock = vi.hoisted(() => ({ throwAppId: null as AppId | null }))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })
}))

vi.mock('react-rnd', () => ({
  Rnd: ({
    children,
    className,
    role,
    tabIndex,
    'aria-label': ariaLabel,
    'data-window-status': windowStatus
  }: { children: React.ReactNode; 'data-window-status'?: string } & React.HTMLAttributes<HTMLDivElement>) => (
    <div
      data-testid="rnd"
      className={className}
      role={role}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      data-window-status={windowStatus}
    >{children}</div>
  )
}))

vi.mock('./app-loader', () => ({
  AppLoader: ({ appId }: { appId: AppId }) => {
    if (appLoaderMock.throwAppId === appId) throw new Error('mobile app failed')
    return <p>Loaded {appId}</p>
  }
}))

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private readonly values = new Map<string, string>()

  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function createRouter() {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn()
  } satisfies DesktopRouter
}

function installMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(max-width: 767px)' ? mobile : false,
      media: query,
      addEventListener: (_event: string, listener: () => void) => mediaListeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => mediaListeners.delete(listener)
    }))
  })
}

function emitMediaChange() {
  act(() => mediaListeners.forEach((listener) => listener()))
}

function renderShell({
  locale = 'en',
  descriptor = null
}: {
  locale?: Locale
  descriptor?: AppId | null
} = {}) {
  const router = createRouter()
  const messages = locale === 'en' ? en : zh
  const view = render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DesktopProviderCore
        locale={locale}
        pathname={pathname === '/' ? `/${locale}` : `/${locale}${pathname}`}
        router={router}
        storage={new MemoryStorage()}
      >
        <ResumeDraftProvider locale={locale}>
          <DesktopShell>{descriptor ? <DesktopRoute appId={descriptor} desktopOnly={pathname === '/'} /> : null}</DesktopShell>
        </ResumeDraftProvider>
      </DesktopProviderCore>
    </NextIntlClientProvider>
  )

  return { ...view, router }
}

beforeEach(() => {
  pathname = '/'
  mobile = true
  appLoaderMock.throwAppId = null
  mediaListeners.clear()
  installMatchMedia()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('mobile shell', () => {
  it('renders the mobile grid at the locale root without desktop windows or controls', async () => {
    renderShell({ descriptor: 'studio' })

    const home = await screen.findByRole('main', { name: 'Resume OS' })
    expect(home).toBeVisible()
    expect(within(within(home).getByRole('region', { name: 'Applications' })).getAllByRole('button')).toHaveLength(Object.keys(appRegistry).length)
    expect(within(within(home).getByRole('navigation', { name: 'Pinned applications' })).getAllByRole('button')).toHaveLength(Object.values(appRegistry).filter((app) => app.pinned).length)
    expect(within(screen.getByTestId('workflow-overview-mobile')).getByRole('button')).toBeVisible()
    expect(within(home).getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(within(screen.getByTestId('workflow-overview-mobile')).getByRole('heading', { level: 2, name: 'Tailor with facts, not guesses' })).toBeVisible()
    expect(screen.queryByTestId('desktop-surface')).not.toBeInTheDocument()
    expect(screen.getByTestId('desktop-ambient')).toHaveAttribute('data-story-duration', '14000')
    expect(screen.getByTestId('desktop-ambient').querySelector('[data-agent-core]')).toBeInTheDocument()
    expect(screen.queryByTestId('rnd')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /minimize|maximize|close/i })).not.toBeInTheDocument()
  })

  it('opens Agent with one tap and shows its full-screen frame on the route', async () => {
    const view = renderShell()

    const home = await screen.findByRole('main', { name: 'Resume OS' })
    const agent = within(home).getAllByRole('button', { name: 'Resume Agent' })
      .find((button) => button.classList.contains('mobile-home__app'))
    if (!agent) throw new Error('Expected mobile Agent icon')
    fireEvent.click(agent)
    expect(view.router.push).toHaveBeenCalledWith('/en/agent')

    pathname = '/agent'
    view.rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <DesktopProviderCore locale="en" pathname="/en/agent" router={view.router} storage={new MemoryStorage()}>
          <ResumeDraftProvider locale="en"><DesktopShell><DesktopRoute appId="agent" /></DesktopShell></ResumeDraftProvider>
        </DesktopProviderCore>
      </NextIntlClientProvider>
    )

    expect(await screen.findByRole('main', { name: 'Resume Agent' })).toBeInTheDocument()
    expect(screen.queryByTestId('rnd')).not.toBeInTheDocument()
  })

  it('shows Studio in a full frame and returns to the grid with Home', async () => {
    pathname = '/studio'
    const view = renderShell({ descriptor: 'studio' })

    expect(await screen.findByRole('main', { name: 'Resume Studio' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(view.router.push).toHaveBeenCalledWith('/en')

    pathname = '/'
    view.rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <DesktopProviderCore locale="en" pathname="/en" router={view.router} storage={new MemoryStorage()}>
          <ResumeDraftProvider locale="en"><DesktopShell><DesktopRoute appId="studio" desktopOnly /></DesktopShell></ResumeDraftProvider>
        </DesktopProviderCore>
      </NextIntlClientProvider>
    )
    expect(await screen.findByRole('main', { name: 'Resume OS' })).toBeVisible()
  })

  it('falls back to the locale root on direct entry even when browser history is longer than one', async () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(4)
    pathname = '/agent'
    const view = renderShell({ descriptor: 'agent' })

    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(view.router.back).not.toHaveBeenCalled()
    expect(view.router.replace).toHaveBeenCalledWith('/en')
  })

  it('uses router back once after an internal Home-to-Agent navigation', async () => {
    const view = renderShell()
    const home = await screen.findByRole('main', { name: 'Resume OS' })
    const agent = within(home).getAllByRole('button', { name: 'Resume Agent' })
      .find((button) => button.classList.contains('mobile-home__app'))
    if (!agent) throw new Error('Expected mobile Agent icon')
    fireEvent.click(agent)
    expect(view.router.push).toHaveBeenCalledWith('/en/agent')

    pathname = '/agent'
    view.rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <DesktopProviderCore locale="en" pathname="/en/agent" router={view.router} storage={new MemoryStorage()}>
          <ResumeDraftProvider locale="en"><DesktopShell><DesktopRoute appId="agent" /></DesktopShell></ResumeDraftProvider>
        </DesktopProviderCore>
      </NextIntlClientProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(view.router.back).toHaveBeenCalledOnce()
    expect(view.router.replace).not.toHaveBeenCalled()
  })

  it('clears the in-app predecessor when the locale changes', async () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(4)
    const view = renderShell()
    const home = await screen.findByRole('main', { name: 'Resume OS' })
    const agent = within(home).getAllByRole('button', { name: 'Resume Agent' })
      .find((button) => button.classList.contains('mobile-home__app'))
    if (!agent) throw new Error('Expected mobile Agent icon')
    fireEvent.click(agent)

    pathname = '/agent'
    view.rerender(
      <NextIntlClientProvider locale="zh" messages={zh}>
        <DesktopProviderCore locale="zh" pathname="/zh/agent" router={view.router} storage={new MemoryStorage()}>
          <ResumeDraftProvider locale="zh"><DesktopShell><DesktopRoute appId="agent" /></DesktopShell></ResumeDraftProvider>
        </DesktopProviderCore>
      </NextIntlClientProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: '返回' }))
    expect(view.router.back).not.toHaveBeenCalled()
    expect(view.router.replace).toHaveBeenCalledWith('/zh')
  })

  it('keeps app icons accessible touch targets with safe-area styling', async () => {
    renderShell()

    const home = await screen.findByRole('main', { name: 'Resume OS' })
    for (const app of Object.values(appRegistry)) {
      expect(within(home).getAllByRole('button', { name: en.desktop.apps[app.id] })
        .some((button) => button.classList.contains('mobile-home__app'))).toBe(true)
    }

    const css = readFileSync('app/globals.css', 'utf8')
    expect(css).toMatch(/\.mobile-home__app\s*{[^}]*min-height:\s*44px/)
    expect(css).toContain('env(safe-area-inset-top)')
    expect(css).toContain('env(safe-area-inset-bottom)')
  })

  it('describes Dock running state without marking multiple apps as the current page', async () => {
    const view = renderShell()
    const home = await screen.findByRole('main', { name: 'Resume OS' })
    const agent = within(home).getAllByRole('button', { name: 'Resume Agent' })
      .find((button) => button.classList.contains('mobile-home__app'))
    if (!agent) throw new Error('Expected mobile Agent icon')
    fireEvent.click(agent)
    expect(view.router.push).toHaveBeenCalledWith('/en/agent')

    const dock = within(home).getByRole('navigation', { name: 'Pinned applications' })
    for (const button of within(dock).getAllByRole('button')) {
      expect(button).not.toHaveAttribute('aria-current')
    }
    const dockAgent = within(dock).getByRole('button', { name: 'Resume Agent' })
    const statusId = dockAgent.getAttribute('aria-describedby')
    expect(statusId).toBeTruthy()
    expect(document.getElementById(statusId ?? '')).toHaveTextContent('Running')
  })

  it('keeps the wide layout on the desktop shell and opens Studio there', async () => {
    mobile = false
    renderShell({ descriptor: 'studio' })
    emitMediaChange()

    expect(await screen.findByTestId('desktop-surface')).toBeVisible()
    expect(await screen.findByRole('application', { name: 'Resume Studio' })).toBeInTheDocument()
    expect(screen.queryByRole('main', { name: 'Resume OS' })).not.toBeInTheDocument()
  })

  it('hydrates from an unresolved snapshot without rendering desktop controls before mobile', async () => {
    const router = createRouter()
    const tree = (
      <NextIntlClientProvider locale="en" messages={en}>
        <DesktopProviderCore locale="en" pathname="/en" router={router} storage={new MemoryStorage()}>
          <ResumeDraftProvider locale="en"><DesktopShell><DesktopRoute appId="studio" desktopOnly /></DesktopShell></ResumeDraftProvider>
        </DesktopProviderCore>
      </NextIntlClientProvider>
    )
    const serverMarkup = renderToString(tree)
    expect(serverMarkup).not.toContain('desktop-surface')
    expect(serverMarkup).not.toContain('desktop-window-manager')

    const container = document.createElement('div')
    container.innerHTML = serverMarkup
    document.body.append(container)
    let root: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(container, tree)
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="desktop-surface"]')).toBeNull()

    await waitFor(() => expect(within(container).getByRole('main', { name: 'Resume OS' })).toBeInTheDocument())
    root!.unmount()
    container.remove()
  })

  it.each([
    ['en', 'Resume OS', 'Settings'],
    ['zh', 'Resume OS', '设置']
  ] satisfies Array<[Locale, string, string]>)('localizes %s mobile labels', async (locale, homeName, settingsName) => {
    renderShell({ locale })
    expect(await screen.findByRole('main', { name: homeName })).toBeVisible()
    expect(within(screen.getByRole('main', { name: homeName }))
      .getAllByRole('button', { name: settingsName })
      .some((button) => button.classList.contains('mobile-home__app'))).toBe(true)
  })

  it('isolates an app loader failure inside the mobile frame', async () => {
    pathname = '/agent'
    appLoaderMock.throwAppId = 'agent'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = renderShell({ descriptor: 'agent' })

    expect(await screen.findByRole('alert')).toHaveTextContent('This application could not be loaded.')
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close Resume Agent' }))
    expect(view.router.push).toHaveBeenCalledWith('/en')
    consoleError.mockRestore()
  })

  it('resets app error state when the mobile route changes to another app', async () => {
    pathname = '/agent'
    appLoaderMock.throwAppId = 'agent'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = renderShell({ descriptor: 'agent' })
    expect(await screen.findByRole('alert')).toHaveTextContent('This application could not be loaded.')

    pathname = '/book'
    view.rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <DesktopProviderCore locale="en" pathname="/en/book" router={view.router} storage={new MemoryStorage()}>
          <ResumeDraftProvider locale="en"><DesktopShell><DesktopRoute appId="book" /></DesktopShell></ResumeDraftProvider>
        </DesktopProviderCore>
      </NextIntlClientProvider>
    )

    expect(await screen.findByRole('main', { name: 'Resume Book' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Loaded book')).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
