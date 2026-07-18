import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { readFileSync } from 'node:fs'
import { useEffect, type HTMLAttributes, type PropsWithChildren } from 'react'
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
import { AppErrorBoundary } from './app-error-boundary'
import { AppLoader } from './app-loader'
import { MotionPreferenceProvider } from './motion-preference'

type RndHarness = {
  bounds: unknown
  disableDragging: unknown
  enableResizing: unknown
  drag(position: { x: number; y: number }): void
  resize(geometry: { width: number; height: number; x: number; y: number }): void
}

const componentMocks = vi.hoisted(() => ({
  rnd: new Map<string, RndHarness>(),
  motionComplete: new Map<string, () => void>(),
  windowContentUnmounts: new Map<string, number>()
}))

function EffectCleanupSentinel({ label }: { label: string }) {
  useEffect(() => () => {
    componentMocks.windowContentUnmounts.set(
      label,
      (componentMocks.windowContentUnmounts.get(label) ?? 0) + 1
    )
  }, [label])

  return null
}

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: vi.fn() })
}))

vi.mock('react-rnd', () => ({
  Rnd: ({
    children,
    dragHandleClassName: _dragHandleClassName,
    minWidth,
    minHeight,
    disableDragging,
    enableResizing,
    onDragStop,
    onResizeStop,
    position,
    size,
    bounds,
    cancel: _cancel,
    ...props
  }: PropsWithChildren<Record<string, unknown>>) => {
    const label = String(props['aria-label'])
    const dragStop = onDragStop as ((event: MouseEvent, data: { x: number; y: number }) => void) | undefined
    const resizeStop = onResizeStop as ((event: MouseEvent, direction: string, element: HTMLElement, delta: { width: number; height: number }, position: { x: number; y: number }) => void) | undefined
    componentMocks.rnd.set(label, {
      bounds,
      disableDragging,
      enableResizing,
      drag(nextPosition) {
        dragStop?.(new MouseEvent('mouseup'), nextPosition)
      },
      resize(geometry) {
        const element = document.createElement('div')
        Object.defineProperty(element, 'offsetWidth', { value: geometry.width })
        Object.defineProperty(element, 'offsetHeight', { value: geometry.height })
        resizeStop?.(
          new MouseEvent('mouseup'),
          'bottomRight',
          element,
          { width: 0, height: 0 },
          { x: geometry.x, y: geometry.y }
        )
      }
    })
    return (
      <>
        <EffectCleanupSentinel label={label} />
        <div
          data-testid="rnd"
          data-bounds={String(bounds)}
          data-disable-dragging={String(disableDragging)}
          data-enable-resizing={String(enableResizing)}
          data-min-height={String(minHeight)}
          data-min-width={String(minWidth)}
          data-position={JSON.stringify(position)}
          data-size={JSON.stringify(size)}
          {...props}
        >
          {children}
        </div>
      </>
    )
  }
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: PropsWithChildren) => <>{children}</>,
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      onAnimationComplete: _onAnimationComplete,
      ...props
    }: PropsWithChildren<HTMLAttributes<HTMLDivElement> & Record<string, unknown>>) => {
      const appId = String(props['data-app-id'] ?? '')
      if (appId) {
        componentMocks.motionComplete.set(appId, () => {
          (_onAnimationComplete as (() => void) | undefined)?.()
        })
      }

      return (
        <div
          data-motion-animate={JSON.stringify(_animate)}
          data-motion-exit={JSON.stringify(_exit)}
          data-motion-initial={JSON.stringify(_initial)}
          data-motion-transition={JSON.stringify(_transition)}
          {...props}
        >
          {children}
        </div>
      )
    }
  }
}))

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private readonly values = new Map<string, string>()

  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function createRouter() {
  return { push: vi.fn(), replace: vi.fn() } satisfies DesktopRouter
}

function renderDesktop({
  descriptor = 'studio',
  locale = 'en',
  root = false
}: {
  descriptor?: AppId | null
  locale?: Locale
  root?: boolean
} = {}) {
  const router = createRouter()
  const messages = locale === 'en' ? en : zh
  const view = render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DesktopProviderCore locale={locale} pathname={root || !descriptor ? `/${locale}` : `/${locale}${appRegistry[descriptor].route}`} router={router} storage={new MemoryStorage()}>
        <ResumeDraftProvider locale={locale}>
          <DesktopShell>{descriptor && !root ? <DesktopRoute appId={descriptor} /> : null}</DesktopShell>
        </ResumeDraftProvider>
      </DesktopProviderCore>
    </NextIntlClientProvider>
  )

  return { ...view, router }
}

function ThrowOnce({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('app failed')
  return <p>Recovered content</p>
}

beforeEach(() => {
  componentMocks.rnd.clear()
  componentMocks.motionComplete.clear()
  componentMocks.windowContentUnmounts.clear()
  window.localStorage.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DesktopShell', () => {
  it('passes desktop descendants through the locale draft provider', () => {
    render(<ResumeDraftProvider locale="en"><span>Draft child</span></ResumeDraftProvider>)

    expect(screen.getByText('Draft child')).toBeVisible()
  })

  it('nests the draft provider between the desktop provider and shell in the locale layout', () => {
    const layout = readFileSync('app/[locale]/layout.tsx', 'utf8')

    expect(layout).toMatch(/<DesktopProvider locale={locale}>\s*<ResumeDraftProvider locale={locale}>\s*<DesktopShell>/)
    expect(layout).toContain("title: 'Resume OS — Evidence-Grounded Resume Agent'")
    expect(layout).not.toContain("title: 'Resume Agent OS'")
  })

  it('defines stable desktop system variables and theme wallpaper layers', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    const variables = [
      '--desktop-menu-height: 30px',
      '--desktop-dock-height: 82px',
      '--system-blur:',
      '--system-window-radius:',
      '--z-desktop:',
      '--z-window:',
      '--z-dock:',
      '--z-menu:',
      '--system-focus-ring:',
      '--desktop-wallpaper-background-dark:',
      '--desktop-wallpaper-overlay-dark:',
      '--desktop-wallpaper-background-light:',
      '--desktop-wallpaper-overlay-light:'
    ]

    for (const variable of variables) expect(css).toContain(variable)
    expect(css).toContain('z-index: var(--z-menu)')
    expect(css).toContain('border-radius: var(--system-window-radius)')
  })

  it('ships the original dark and light WebP wallpapers and references both variants', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    const wallpapers = [
      'public/wallpapers/resume-os-dark.webp',
      'public/wallpapers/resume-os-light.webp'
    ]

    for (const wallpaper of wallpapers) {
      const contents = readFileSync(wallpaper)
      expect(contents.subarray(0, 4).toString('ascii')).toBe('RIFF')
      expect(contents.subarray(8, 12).toString('ascii')).toBe('WEBP')
      expect(contents.subarray(12, 16).toString('ascii')).toBe('VP8X')
      expect(contents.byteLength).toBeGreaterThan(100_000)
      expect(contents.readUIntLE(24, 3) + 1).toBeGreaterThanOrEqual(2560)
      expect(contents.readUIntLE(27, 3) + 1).toBeGreaterThanOrEqual(1600)
    }

    expect(css).toContain('/wallpapers/resume-os-dark.webp')
    expect(css).toContain('/wallpapers/resume-os-light.webp')
    expect(css).toContain('image-set(')
  })

  it('localizes the window manager region label', () => {
    renderDesktop({ descriptor: null, locale: 'zh' })

    expect(screen.getByRole('region', { name: '应用程序' })).toBeVisible()
  })

  it('shows only the desktop on the locale root', async () => {
    renderDesktop({ root: true })

    await waitFor(() => expect(screen.queryByRole('application')).not.toBeInTheDocument())
    expect(screen.getByTestId('desktop-surface')).toBeVisible()
    const ambient = screen.getByTestId('desktop-ambient')
    const phases = [...ambient.querySelectorAll<HTMLElement>('[data-agent-phase]')]
      .map((element) => element.dataset.agentPhase)

    expect(ambient).toHaveAttribute('aria-hidden', 'true')
    expect(ambient).toHaveAttribute('data-scene', 'agent-constellation')
    expect(ambient).toHaveAttribute('data-story-duration', '14000')
    expect(ambient).toHaveAttribute('data-story-mode', 'sequence')
    expect(ambient).toHaveAttribute('data-subdued', 'false')
    expect(ambient.querySelector('[data-agent-core]')).toBeInTheDocument()
    expect(ambient.querySelectorAll('[data-agent-node]').length).toBeGreaterThanOrEqual(6)
    expect(phases).toEqual(['retrieve', 'rank', 'synthesize', 'verify'])
    expect(ambient.querySelector('[data-story-output="resume-variant"]')).toBeInTheDocument()
    expect(ambient.querySelectorAll('[data-story-status]').length).toBe(7)
    expect(within(screen.getByTestId('workflow-overview')).getByRole('heading', { name: 'Tailor with facts, not guesses' })).toBeVisible()
    const launcher = within(screen.getByRole('navigation', { name: 'Applications' }))
    expect(launcher.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Resume Studio',
      'Resume Agent',
      'JD Match',
      'Resume 3D',
      'Resume Book',
      'Review & Export',
      'Projects',
      'Career Timeline',
      'Terminal'
    ])
    expect(screen.queryByRole('region', { name: 'Evidence-driven workflow' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Showcase' })).not.toBeInTheDocument()
  })

  it('stops constellation parallax when reduced motion is selected', async () => {
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(71)
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    renderDesktop({ root: true })

    const surface = screen.getByTestId('desktop-surface')
    const ambient = screen.getByTestId('desktop-ambient')
    fireEvent.pointerMove(surface, { clientX: 120, clientY: 80 })
    expect(ambient).toHaveAttribute('data-pointer', 'true')

    const scheduledFrames = requestFrame.mock.calls.length
    fireEvent.click(within(screen.getByTestId('menu-bar')).getByRole('radio', { name: 'Reduced motion' }))

    await waitFor(() => expect(ambient).toHaveAttribute('data-reduced-motion', 'true'))
    expect(ambient).toHaveAttribute('data-story-mode', 'poster')
    expect(cancelFrame).toHaveBeenCalledWith(71)
    expect(requestFrame).toHaveBeenCalledTimes(scheduledFrames)

    fireEvent.pointerMove(surface, { clientX: 180, clientY: 120 })
    expect(ambient).toHaveAttribute('data-pointer', 'false')
  })

  it('cleans up constellation frames and pointer listeners on unmount', () => {
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(83)
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const view = renderDesktop({ root: true })

    const surface = screen.getByTestId('desktop-surface')
    const ambient = screen.getByTestId('desktop-ambient')
    fireEvent.pointerMove(surface, { clientX: 100, clientY: 60 })
    expect(ambient).toHaveAttribute('data-pointer', 'true')
    expect(requestFrame).toHaveBeenCalled()

    view.unmount()
    expect(cancelFrame).toHaveBeenCalledWith(83)

    ambient.dataset.pointer = 'false'
    fireEvent.pointerMove(surface, { clientX: 200, clientY: 120 })
    expect(ambient).toHaveAttribute('data-pointer', 'false')
  })

  it('shows concurrent application windows opened through desktop actions', async () => {
    renderDesktop()
    await screen.findByRole('application', { name: 'Resume Studio' })

    const surface = within(screen.getByTestId('desktop-surface'))
    fireEvent.doubleClick(surface.getByRole('button', { name: 'Resume Agent' }))
    fireEvent.doubleClick(surface.getByRole('button', { name: 'Resume Book' }))
    fireEvent.doubleClick(surface.getByRole('button', { name: 'Career Timeline' }))

    expect(await screen.findAllByRole('application')).toHaveLength(4)
    expect(screen.getByTestId('desktop-ambient')).toHaveAttribute('data-subdued', 'true')
  })

  it('closes, minimizes, and maximizes windows with traffic controls', async () => {
    renderDesktop()
    const studio = await screen.findByRole('application', { name: 'Resume Studio' })

    fireEvent.click(within(studio).getByRole('button', { name: 'Maximize Resume Studio' }))
    expect(studio).toHaveAttribute('data-window-status', 'maximized')
    fireEvent.click(within(studio).getByRole('button', { name: 'Restore Resume Studio' }))
    expect(studio).toHaveAttribute('data-window-status', 'open')
    fireEvent.click(within(studio).getByRole('button', { name: 'Minimize Resume Studio' }))
    await waitFor(() => expect(screen.queryByRole('application', { name: 'Resume Studio' })).not.toBeInTheDocument())

    fireEvent.click(within(screen.getByTestId('dock')).getByRole('button', { name: 'Resume Studio' }))
    const restored = await screen.findByRole('application', { name: 'Resume Studio' })
    fireEvent.click(within(restored).getByRole('button', { name: 'Close Resume Studio' }))
    await waitFor(() => expect(screen.queryByRole('application', { name: 'Resume Studio' })).not.toBeInTheDocument())
  })

  it('restores a minimized Studio window from the Dock', async () => {
    renderDesktop()
    const studio = await screen.findByRole('application', { name: 'Resume Studio' })
    fireEvent.click(within(studio).getByRole('button', { name: 'Minimize Resume Studio' }))

    fireEvent.click(within(screen.getByTestId('dock')).getByRole('button', { name: 'Resume Studio' }))
    expect(await screen.findByRole('application', { name: 'Resume Studio' })).toBeVisible()
  })

  it('describes desktop Dock running state without relying on its color marker', async () => {
    renderDesktop()
    const dock = screen.getByRole('navigation', { name: 'Dock' })
    const studio = await within(dock).findByRole('button', { name: 'Resume Studio' })
    const statusId = studio.getAttribute('aria-describedby')

    expect(statusId).toBeTruthy()
    expect(document.getElementById(statusId ?? '')).toHaveTextContent('Running')
    expect(studio).toHaveAttribute('data-running', 'true')
  })

  it('focuses a clicked window and updates the focused menu marker', async () => {
    renderDesktop()
    await screen.findByRole('application', { name: 'Resume Studio' })
    fireEvent.doubleClick(within(screen.getByTestId('desktop-surface')).getByRole('button', { name: 'Resume Agent' }))
    const studio = screen.getByRole('application', { name: 'Resume Studio' })
    fireEvent.pointerDown(studio)

    await waitFor(() => expect(screen.getByTestId('focused-app')).toHaveTextContent('Resume Studio'))
    expect(within(screen.getByTestId('dock')).getByRole('button', { name: 'Resume Studio' })).toHaveAttribute('aria-current', 'page')
  })

  it('mounts the compact motion control in the production menu bar', () => {
    renderDesktop({ descriptor: null })
    const menuBar = within(screen.getByTestId('menu-bar'))
    const motionControl = menuBar.getByRole('radiogroup', { name: 'Motion preference' })

    expect(motionControl).toBeVisible()
    expect(motionControl).toHaveClass('motion-mode-control--compact')
    expect(menuBar.getAllByRole('radio')).toHaveLength(3)
  })

  it('animates the active menu label and removes vertical movement for reduced motion', () => {
    const css = readFileSync('app/globals.css', 'utf8')

    expect(css).toContain('.desktop-menu-bar__active-label')
    expect(css).toMatch(/@keyframes desktop-menu-label-in\s*{[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(3px\)/)
    expect(css).toContain("data-motion='reduced'] .desktop-menu-bar__active-label")
    expect(css).toMatch(/@keyframes desktop-menu-label-fade\s*{[^}]*opacity:\s*0;/)
  })

  it('starts server-rendered HTML in system motion mode for first-paint media CSS', () => {
    const layout = readFileSync('app/[locale]/layout.tsx', 'utf8')
    const css = readFileSync('app/globals.css', 'utf8')

    expect(layout).toMatch(/<html[^>]*data-motion="system"/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*:root\[data-motion='system'\]/)
  })

  it('raises and routes a window when keyboard focus enters without raising again inside it', async () => {
    const user = userEvent.setup()
    const { router } = renderDesktop()
    const studio = await screen.findByRole('application', { name: 'Resume Studio' })
    const surface = within(screen.getByTestId('desktop-surface'))
    fireEvent.doubleClick(surface.getByRole('button', { name: 'Resume Agent' }))
    await waitFor(() => expect(screen.getByTestId('focused-app')).toHaveTextContent('Resume Agent'))
    const zBefore = Number(studio.parentElement?.style.zIndex)

    surface.getByRole('button', { name: 'Terminal' }).focus()
    await user.tab()

    expect(studio).toHaveFocus()
    expect(studio).toHaveAttribute('tabindex', '0')
    await waitFor(() => expect(screen.getByTestId('focused-app')).toHaveTextContent('Resume Studio'))
    const raisedZ = Number(studio.parentElement?.style.zIndex)
    expect(raisedZ).toBeGreaterThan(zBefore)
    expect(router.replace).toHaveBeenCalledWith('/en/studio')

    await user.tab()
    expect(within(studio).getByRole('button', { name: 'Close Resume Studio' })).toHaveFocus()
    expect(Number(studio.parentElement?.style.zIndex)).toBe(raisedZ)
  })

  it('applies reduced window motion without scale or movement', async () => {
    window.localStorage.setItem('resume-os-motion', 'reduced')
    renderDesktop()
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'))
    const studio = await screen.findByRole('application', { name: 'Resume Studio' })
    const motion = studio.parentElement
    const initial = JSON.parse(motion?.dataset.motionInitial ?? '{}') as Record<string, number>
    const animate = JSON.parse(motion?.dataset.motionAnimate ?? '{}') as Record<string, number>
    const exit = JSON.parse(motion?.dataset.motionExit ?? '{}') as Record<string, number>
    const transition = JSON.parse(motion?.dataset.motionTransition ?? '{}') as Record<string, number>

    for (const state of [initial, animate, exit]) {
      expect(state).not.toHaveProperty('scale')
      expect(state).not.toHaveProperty('x')
      expect(state).not.toHaveProperty('y')
    }
    expect(transition.duration).toBeLessThanOrEqual(0.12)

    fireEvent.click(within(studio).getByRole('button', { name: 'Minimize Resume Studio' }))
    await waitFor(() => expect(document.querySelector('[data-app-id="studio"]')).not.toBeInTheDocument())
    expect(componentMocks.windowContentUnmounts.get('Resume Studio')).toBe(1)
  })

  it('keeps minimized windows inert while animating toward their per-app Dock origin', async () => {
    renderDesktop()
    const studio = await screen.findByRole('application', { name: 'Resume Studio' })
    const motion = studio.parentElement
    if (!motion) throw new Error('Expected Studio motion wrapper')

    await waitFor(() => expect(motion).toHaveAttribute('data-motion-origin', 'dock'))
    expect(motion.style.transformOrigin).not.toBe('570px 410px')
    const closeExit = JSON.parse(motion.dataset.motionExit ?? '{}') as Record<string, number>

    fireEvent.click(within(studio).getByRole('button', { name: 'Minimize Resume Studio' }))
    const minimized = JSON.parse(motion.dataset.motionAnimate ?? '{}') as Record<string, number>
    expect(motion).toHaveAttribute('data-window-motion-status', 'minimized')
    expect(motion).toHaveAttribute('aria-hidden', 'true')
    expect(motion).toHaveAttribute('inert')
    expect(minimized.y).toBeGreaterThan(0)
    expect(minimized.scale).toBeLessThan(closeExit.scale)
    expect(closeExit).not.toHaveProperty('y')

    fireEvent.click(within(screen.getByTestId('dock')).getByRole('button', { name: 'Resume Studio' }))
    expect(motion).toHaveAttribute('data-window-motion-status', 'open')
    expect(JSON.parse(motion.dataset.motionAnimate ?? '{}')).toMatchObject({ opacity: 1, scale: 1, x: 0, y: 0 })
  })

  it('unmounts minimized window content after animation and remounts it on restore', async () => {
    renderDesktop()
    const studio = await screen.findByRole('application', { name: 'Resume Studio' })
    fireEvent.click(within(studio).getByRole('button', { name: 'Minimize Resume Studio' }))
    expect(document.querySelector('[data-app-id="studio"]')).toBeInTheDocument()
    expect(componentMocks.windowContentUnmounts.get('Resume Studio')).toBeUndefined()

    act(() => componentMocks.motionComplete.get('studio')?.())
    await waitFor(() => expect(document.querySelector('[data-app-id="studio"]')).not.toBeInTheDocument())
    expect(componentMocks.windowContentUnmounts.get('Resume Studio')).toBe(1)

    fireEvent.click(within(screen.getByTestId('dock')).getByRole('button', { name: 'Resume Studio' }))
    const restored = await screen.findByRole('application', { name: 'Resume Studio' })
    expect(restored.parentElement).toHaveAttribute('data-window-motion-status', 'open')
  })

  it('moves focus to the matching Dock button when a window minimizes', async () => {
    renderDesktop()
    const studio = await screen.findByRole('application', { name: 'Resume Studio' })
    const dockButton = within(screen.getByTestId('dock')).getByRole('button', { name: 'Resume Studio' })
    expect(dockButton).toHaveAttribute('id', 'desktop-dock-studio')

    fireEvent.click(within(studio).getByRole('button', { name: 'Minimize Resume Studio' }))
    await waitFor(() => expect(dockButton).toHaveFocus())

    fireEvent.click(dockButton)
    expect(await screen.findByRole('application', { name: 'Resume Studio' })).toBeVisible()
  })

  it('keeps Dock slots fixed while only the icon visual magnifies and presses', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    const dockRule = [...css.matchAll(/\.desktop-dock-item\s*{[^}]*}/g)].at(-1)?.[0]

    expect(dockRule).toContain('width: 42px')
    expect(dockRule).toContain('flex: 0 0 42px')
    expect(css).toMatch(/\.desktop-dock-item__icon\s*{[^}]*transform:/)
    expect(css).toContain('.desktop-dock-item:hover .desktop-dock-item__icon')
    expect(css).toContain('.desktop-dock-item:active .desktop-dock-item__icon')
  })

  it('wires parent bounds and finite drag and resize geometry through the reducer', async () => {
    renderDesktop()
    let studio = await screen.findByRole('application', { name: 'Resume Studio' })
    let harness = componentMocks.rnd.get('Resume Studio')
    if (!harness) throw new Error('Expected Studio Rnd harness')

    expect(studio).toHaveAttribute('data-bounds', 'parent')
    expect(studio).toHaveAttribute('data-min-width', '720')
    expect(studio).toHaveAttribute('data-min-height', '520')
    expect(studio).toHaveAttribute('data-disable-dragging', 'false')
    expect(studio).toHaveAttribute('data-enable-resizing', 'true')

    act(() => harness?.drag({ x: 310, y: 140 }))
    await waitFor(() => expect(screen.getByRole('application', { name: 'Resume Studio' })).toHaveAttribute('data-position', JSON.stringify({ x: 310, y: 140 })))

    harness = componentMocks.rnd.get('Resume Studio')
    act(() => harness?.resize({ width: 100, height: 100, x: 40, y: 50 }))
    studio = screen.getByRole('application', { name: 'Resume Studio' })
    await waitFor(() => expect(studio).toHaveAttribute('data-size', JSON.stringify({ width: 720, height: 520 })))
    const position = JSON.parse(studio.dataset.position ?? '{}') as { x: number; y: number }
    const size = JSON.parse(studio.dataset.size ?? '{}') as { width: number; height: number }
    expect(Object.values({ ...position, ...size }).every(Number.isFinite)).toBe(true)

    fireEvent.click(within(studio).getByRole('button', { name: 'Maximize Resume Studio' }))
    studio = screen.getByRole('application', { name: 'Resume Studio' })
    expect(studio).toHaveAttribute('data-disable-dragging', 'true')
    expect(studio).toHaveAttribute('data-enable-resizing', 'false')
  })

  it('selects desktop icons before opening by pointer or keyboard', async () => {
    renderDesktop({ descriptor: null })
    const surface = within(screen.getByTestId('desktop-surface'))
    const agent = surface.getByRole('button', { name: 'Resume Agent' })
    fireEvent.click(agent)
    expect(agent).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('application', { name: 'Resume Agent' })).not.toBeInTheDocument()

    fireEvent.doubleClick(agent)
    expect(await screen.findByRole('application', { name: 'Resume Agent' })).toBeVisible()

    const timeline = surface.getByRole('button', { name: 'Career Timeline' })
    fireEvent.keyDown(timeline, { key: 'Enter' })
    expect(await screen.findByRole('application', { name: 'Career Timeline' })).toBeVisible()
  })

  it('keeps one responsive Dock slot for every app and marks running supplemental apps', async () => {
    renderDesktop({ descriptor: null })
    const timeline = within(screen.getByTestId('desktop-surface')).getByRole('button', { name: 'Career Timeline' })
    fireEvent.doubleClick(timeline)
    await screen.findByRole('application', { name: 'Career Timeline' })

    expect(screen.getAllByRole('button', { name: 'Career Timeline' })).toHaveLength(2)
    const dock = within(screen.getByTestId('dock'))
    expect(dock.getAllByRole('button')).toHaveLength(10)
    expect(dock.getByRole('button', { name: 'Career Timeline' })).toHaveAttribute('data-running', 'true')
  })

  it('contains failures within one app and retries with a remount', () => {
    let shouldThrow = true
    const close = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <>
          <AppErrorBoundary appId="agent" appName="Resume Agent" onClose={close}>
            <ThrowOnce shouldThrow={shouldThrow} />
          </AppErrorBoundary>
          <p>Other application</p>
        </>
      </NextIntlClientProvider>
    )

    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
    expect(screen.getByText('Other application')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close Resume Agent' }))
    expect(close).toHaveBeenCalledOnce()
    shouldThrow = false
    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <>
          <AppErrorBoundary appId="agent" appName="Resume Agent" onClose={close}>
            <ThrowOnce shouldThrow={shouldThrow} />
          </AppErrorBoundary>
          <p>Other application</p>
        </>
      </NextIntlClientProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByText('Recovered content')).toBeVisible()
    consoleError.mockRestore()

    rerender(<div />)
  })

  it('gives traffic lights accessible localized names', async () => {
    renderDesktop()
    const studio = await screen.findByRole('application', { name: 'Resume Studio' })
    const controls = [
      within(studio).getByRole('button', { name: 'Close Resume Studio' }),
      within(studio).getByRole('button', { name: 'Minimize Resume Studio' }),
      within(studio).getByRole('button', { name: 'Maximize Resume Studio' })
    ]
    for (const control of controls) {
      expect(control).toBeVisible()
      expect(control.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
    }
    const css = readFileSync('app/globals.css', 'utf8')
    expect(css).toMatch(/\.desktop-window__control\s*{[^}]*width:\s*28px;[^}]*height:\s*28px;/)
  })

  it('keeps fixed shell regions and loads every registered application', () => {
    renderDesktop({ descriptor: null })
    expect(screen.getByTestId('desktop-shell')).toBeVisible()
    expect(screen.getByTestId('menu-bar')).toBeVisible()
    expect(screen.getByTestId('desktop-surface')).toBeVisible()
    expect(screen.getByTestId('dock')).toBeVisible()

    for (const appId of Object.keys(appRegistry) as AppId[]) {
      const view = render(
        <NextIntlClientProvider locale="en" messages={en}>
          <MotionPreferenceProvider>
            <ResumeDraftProvider locale="en">
              <AppLoader appId={appId} />
            </ResumeDraftProvider>
          </MotionPreferenceProvider>
        </NextIntlClientProvider>
      )
      if (appId === 'studio') {
        expect(view.getByRole('region', { name: 'Resume Studio' })).toBeVisible()
      } else if (appId === 'agent' || appId === 'jd-match') {
        expect(view.getByRole('heading', { name: 'Create a resume draft first' })).toBeVisible()
        expect(view.getByRole('link', { name: 'Open Resume Studio' })).toBeVisible()
      } else if (appId === 'classic') {
        expect(view.getByRole('heading', { name: 'Import a verified resume to review' })).toBeVisible()
        expect(view.getByRole('link', { name: 'Open Resume Studio' })).toBeVisible()
      } else if (appId === 'projects') {
        expect(view.getByRole('region', { name: 'Project Explorer' })).toBeVisible()
      } else if (appId === 'timeline') {
        expect(view.getByRole('region', { name: 'Career Timeline' })).toBeVisible()
      } else if (appId === 'terminal') {
        expect(view.getByRole('region', { name: 'Resume terminal' })).toBeVisible()
      } else if (appId === 'book') {
        expect(view.getByRole('region', { name: 'Resume Book' })).toBeVisible()
      } else if (appId === 'resume-3d') {
        expect(view.getByRole('status', { name: 'Loading Resume 3D' })).toBeVisible()
      } else if (appId === 'settings') {
        expect(view.getByRole('heading', { name: 'Settings' })).toBeVisible()
      } else {
        expect(view.getByText('Application is ready.')).toBeVisible()
      }
      view.unmount()
    }
  })
})
