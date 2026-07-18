import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { MotionPreferenceProvider, useMotionPreference } from './motion-preference'

type MediaChangeListener = (event: MediaQueryListEvent) => void

const media = {
  matches: false,
  listeners: new Set<MediaChangeListener>()
}

function MotionProbe() {
  const { mode, resolvedReducedMotion, setMode } = useMotionPreference()

  return (
    <div>
      <output data-testid="mode">{mode}</output>
      <output data-testid="reduced">{String(resolvedReducedMotion)}</output>
      <button type="button" onClick={() => setMode('full')}>Full</button>
      <button type="button" onClick={() => setMode('reduced')}>Reduced</button>
      <button type="button" onClick={() => setMode('system')}>System</button>
    </div>
  )
}

function renderPreference() {
  return render(<MotionPreferenceProvider><MotionProbe /></MotionPreferenceProvider>)
}

function setMediaPreference(matches: boolean) {
  media.matches = matches
  for (const listener of media.listeners) listener({ matches } as MediaQueryListEvent)
}

beforeEach(() => {
  media.matches = false
  media.listeners.clear()
  window.localStorage.clear()
  window.sessionStorage.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      get matches() { return media.matches },
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: (_type: 'change', listener: MediaChangeListener) => media.listeners.add(listener),
      removeEventListener: (_type: 'change', listener: MediaChangeListener) => media.listeners.delete(listener),
      addListener: (listener: MediaChangeListener) => media.listeners.add(listener),
      removeListener: (listener: MediaChangeListener) => media.listeners.delete(listener),
      dispatchEvent: () => true
    })
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MotionPreferenceProvider', () => {
  it('gives explicit full and reduced modes precedence over the system media preference', async () => {
    media.matches = true
    renderPreference()

    await waitFor(() => expect(screen.getByTestId('reduced')).toHaveTextContent('true'))
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    expect(screen.getByTestId('mode')).toHaveTextContent('full')
    expect(screen.getByTestId('reduced')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'Reduced' }))
    expect(screen.getByTestId('mode')).toHaveTextContent('reduced')
    expect(screen.getByTestId('reduced')).toHaveTextContent('true')
  })

  it('tracks media preference changes while in system mode', async () => {
    renderPreference()

    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('system'))
    expect(screen.getByTestId('reduced')).toHaveTextContent('false')
    act(() => setMediaPreference(true))
    expect(screen.getByTestId('reduced')).toHaveTextContent('true')
    act(() => setMediaPreference(false))
    expect(screen.getByTestId('reduced')).toHaveTextContent('false')
  })

  it('falls back to legacy media query listeners and removes them on unmount', () => {
    const addListener = vi.fn((listener: MediaChangeListener) => media.listeners.add(listener))
    const removeListener = vi.fn((listener: MediaChangeListener) => media.listeners.delete(listener))
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        get matches() { return media.matches },
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addListener,
        removeListener,
        dispatchEvent: () => true
      })
    })

    const view = renderPreference()
    expect(addListener).toHaveBeenCalledOnce()
    act(() => setMediaPreference(true))
    expect(screen.getByTestId('reduced')).toHaveTextContent('true')

    view.unmount()
    expect(removeListener).toHaveBeenCalledOnce()
  })

  it('persists changes and applies storage and same-tab preference events', async () => {
    renderPreference()
    fireEvent.click(screen.getByRole('button', { name: 'Reduced' }))
    expect(window.localStorage.getItem('resume-os-motion')).toBe('reduced')
    expect(document.documentElement.dataset.motion).toBe('reduced')

    window.localStorage.setItem('resume-os-motion', 'full')
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: 'resume-os-motion',
      newValue: 'full',
      storageArea: window.localStorage
    })))
    expect(screen.getByTestId('mode')).toHaveTextContent('full')

    act(() => window.dispatchEvent(new CustomEvent('resume-os-motion-change', { detail: 'system' })))
    expect(screen.getByTestId('mode')).toHaveTextContent('system')
    expect(document.documentElement.dataset.motion).toBe('system')
  })

  it('keeps motion changes in memory when local storage is restricted', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('restricted') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('restricted') })
    renderPreference()

    fireEvent.click(screen.getByRole('button', { name: 'Reduced' }))

    expect(screen.getByTestId('mode')).toHaveTextContent('reduced')
    expect(screen.getByTestId('reduced')).toHaveTextContent('true')
    expect(document.documentElement.dataset.motion).toBe('reduced')
  })

  it('treats local storage removal as system and ignores foreign storage events', () => {
    renderPreference()
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))

    window.sessionStorage.setItem('resume-os-motion', 'reduced')
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: 'resume-os-motion',
      newValue: 'reduced',
      storageArea: window.sessionStorage
    })))
    expect(screen.getByTestId('mode')).toHaveTextContent('full')
    expect(window.localStorage.getItem('resume-os-motion')).toBe('full')

    window.localStorage.removeItem('resume-os-motion')
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: 'resume-os-motion',
      newValue: null,
      storageArea: window.localStorage
    })))
    expect(screen.getByTestId('mode')).toHaveTextContent('system')
    expect(window.localStorage.getItem('resume-os-motion')).toBeNull()
  })

  it('does not overwrite a newer concurrent storage value with stale event data', () => {
    renderPreference()
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))

    window.localStorage.setItem('resume-os-motion', 'reduced')
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: 'resume-os-motion',
      newValue: 'full',
      storageArea: window.localStorage
    })))

    expect(window.localStorage.getItem('resume-os-motion')).toBe('reduced')
    expect(screen.getByTestId('mode')).toHaveTextContent('reduced')
  })

  it('exports a localized radio control with click and arrow-key selection', async () => {
    const motionModule = await import('./motion-preference')
    const Control = Reflect.get(motionModule, 'MotionModeControl') as ComponentType | undefined
    expect(Control).toBeTypeOf('function')
    if (!Control) return

    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <MotionPreferenceProvider><Control /></MotionPreferenceProvider>
      </NextIntlClientProvider>
    )

    const group = screen.getByRole('radiogroup', { name: 'Motion preference' })
    const system = screen.getByRole('radio', { name: 'System' })
    const full = screen.getByRole('radio', { name: 'Full motion' })
    const reduced = screen.getByRole('radio', { name: 'Reduced motion' })
    expect(within(group).getAllByRole('radio')).toHaveLength(3)
    expect(system).toHaveAttribute('aria-checked', 'true')

    fireEvent.keyDown(system, { key: 'ArrowRight' })
    expect(full).toHaveAttribute('aria-checked', 'true')
    expect(full).toHaveFocus()
    expect(window.localStorage.getItem('resume-os-motion')).toBe('full')

    fireEvent.click(reduced)
    expect(reduced).toHaveAttribute('aria-checked', 'true')
    expect(window.localStorage.getItem('resume-os-motion')).toBe('reduced')
  })

  it('keeps the server snapshot stable before browser effects hydrate it', async () => {
    vi.stubGlobal('window', undefined)
    const markup = renderToString(<MotionPreferenceProvider><MotionProbe /></MotionPreferenceProvider>)
    vi.unstubAllGlobals()

    const container = document.createElement('div')
    container.innerHTML = markup
    document.body.append(container)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      hydrateRoot(container, <MotionPreferenceProvider><MotionProbe /></MotionPreferenceProvider>)
      await Promise.resolve()
    })

    expect(container.textContent).toContain('system')
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Hydration'))
    container.remove()
  })
})
