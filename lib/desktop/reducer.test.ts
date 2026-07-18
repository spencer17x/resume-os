import { describe, expect, it } from 'vitest'
import { createInitialDesktopState, desktopReducer } from './reducer'

describe('desktop reducer', () => {
  it('opens singleton apps and raises an existing window', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'agent' })
    const firstZ = state.windows.agent?.zIndex
    state = desktopReducer(state, { type: 'open', appId: 'agent' })
    expect(Object.keys(state.windows)).toEqual(['agent'])
    expect(state.windows.agent?.zIndex).toBeGreaterThan(firstZ ?? 0)
  })

  it('preserves geometry across maximize and restore', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
    const original = state.windows.studio
    state = desktopReducer(state, { type: 'maximize', appId: 'studio' })
    expect(state.windows.studio?.restoreGeometry).toEqual({
      position: original?.position,
      size: original?.size
    })
    state = desktopReducer(state, { type: 'restore', appId: 'studio' })
    expect(state.windows.studio?.position).toEqual(original?.position)
    expect(state.windows.studio?.size).toEqual(original?.size)
    expect(state.windows.studio?.restoreGeometry).toBeUndefined()
  })

  it('restores a minimized maximized window before restoring its original geometry', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
    const original = state.windows.studio
    state = desktopReducer(state, { type: 'maximize', appId: 'studio' })
    const restoreGeometry = state.windows.studio?.restoreGeometry
    state = desktopReducer(state, { type: 'minimize', appId: 'studio' })
    state = desktopReducer(state, { type: 'restore', appId: 'studio' })

    expect(state.windows.studio?.status).toBe('maximized')
    expect(state.windows.studio?.restoreGeometry).toEqual(restoreGeometry)

    state = desktopReducer(state, { type: 'restore', appId: 'studio' })
    expect(state.windows.studio?.status).toBe('open')
    expect(state.windows.studio?.position).toEqual(original?.position)
    expect(state.windows.studio?.size).toEqual(original?.size)
    expect(state.windows.studio?.restoreGeometry).toBeUndefined()
  })

  it('preserves the first restore geometry across repeated maximize actions', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
    state = desktopReducer(state, { type: 'move', appId: 'studio', position: { x: 24, y: 36 } })
    state = desktopReducer(state, { type: 'maximize', appId: 'studio' })
    const firstRestoreGeometry = state.windows.studio?.restoreGeometry
    const maximized = state.windows.studio
    if (!maximized) throw new Error('Expected studio window')
    state = {
      ...state,
      windows: {
        ...state.windows,
        studio: {
          ...maximized,
          position: { x: 900, y: 800 },
          size: { width: 1200, height: 900 }
        }
      }
    }
    state = desktopReducer(state, { type: 'maximize', appId: 'studio' })

    expect(state.windows.studio?.restoreGeometry).toEqual(firstRestoreGeometry)
  })

  it('clamps maximized restore geometry before restoring into a smaller workspace', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
    state = desktopReducer(state, {
      type: 'resize',
      appId: 'studio',
      position: { x: 1000, y: 500 },
      size: { width: 720, height: 520 }
    })
    state = desktopReducer(state, { type: 'maximize', appId: 'studio' })
    const activeGeometry = {
      position: state.windows.studio?.position,
      size: state.windows.studio?.size,
      status: state.windows.studio?.status
    }

    state = desktopReducer(state, { type: 'clamp', viewport: { width: 800, height: 600 } })

    expect(state.windows.studio?.position).toEqual(activeGeometry.position)
    expect(state.windows.studio?.size).toEqual(activeGeometry.size)
    expect(state.windows.studio?.status).toBe(activeGeometry.status)
    expect(state.windows.studio?.restoreGeometry).toEqual({
      position: { x: 704, y: 80 },
      size: { width: 720, height: 520 }
    })

    state = desktopReducer(state, { type: 'restore', appId: 'studio' })
    const restored = state.windows.studio
    expect(restored?.position).toEqual({ x: 704, y: 80 })
    expect((restored?.position.y ?? 0) + (restored?.size.height ?? 0)).toBeLessThanOrEqual(600)
    expect(restored?.position.x).toBeLessThanOrEqual(800 - 96)
    expect(restored?.position.x).toBeGreaterThanOrEqual(96 - (restored?.size.width ?? 0))
  })

  it('clamps hydrated maximized restore geometry without changing active geometry', () => {
    const supplied = {
      windows: {
        studio: {
          appId: 'studio' as const,
          status: 'maximized' as const,
          position: { x: 5000, y: 4000 },
          size: { width: 1200, height: 900 },
          restoreGeometry: {
            position: { x: -5000, y: 500 },
            size: { width: 720, height: 520 }
          },
          zIndex: 4
        }
      },
      focusedAppId: 'studio' as const,
      nextZIndex: 5,
      hasCompletedIntro: false
    }
    let state = desktopReducer(createInitialDesktopState(), { type: 'hydrate', state: supplied })
    const activePosition = state.windows.studio?.position
    const activeSize = state.windows.studio?.size

    state = desktopReducer(state, { type: 'clamp', viewport: { width: 800, height: 600 } })

    expect(state.windows.studio?.position).toEqual(activePosition)
    expect(state.windows.studio?.size).toEqual(activeSize)
    expect(state.windows.studio?.status).toBe('maximized')
    expect(state.windows.studio?.restoreGeometry?.position).toEqual({ x: -624, y: 80 })

    state = desktopReducer(state, { type: 'restore', appId: 'studio' })
    expect(state.windows.studio?.position).toEqual({ x: -624, y: 80 })
    expect((state.windows.studio?.position.y ?? 0) + (state.windows.studio?.size.height ?? 0))
      .toBeLessThanOrEqual(600)
  })

  it('keeps maximized state identity when restore geometry already fits', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
    state = desktopReducer(state, { type: 'maximize', appId: 'studio' })
    const beforeClamp = state

    const clamped = desktopReducer(state, { type: 'clamp', viewport: { width: 1440, height: 800 } })

    expect(clamped).toBe(beforeClamp)
    expect(clamped.windows.studio).toBe(beforeClamp.windows.studio)
  })

  it('focuses the top visible window after close', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
    state = desktopReducer(state, { type: 'open', appId: 'agent' })
    state = desktopReducer(state, { type: 'close', appId: 'agent' })
    expect(state.focusedAppId).toBe('studio')
  })

  it('keeps restored title bars inside the viewport', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
    state = desktopReducer(state, { type: 'move', appId: 'studio', position: { x: 5000, y: -900 } })
    state = desktopReducer(state, { type: 'clamp', viewport: { width: 1280, height: 800 } })
    expect(state.windows.studio?.position.x).toBeLessThan(1280)
    expect(state.windows.studio?.position.y).toBeGreaterThanOrEqual(0)
  })

  it('keeps a fitting window fully above the workspace bottom', () => {
    const state = {
      ...createInitialDesktopState(),
      windows: {
        studio: {
          appId: 'studio' as const,
          status: 'open' as const,
          position: { x: 80, y: 600 },
          size: { width: 700, height: 500 },
          zIndex: 1
        }
      }
    }

    const clamped = desktopReducer(state, { type: 'clamp', viewport: { width: 1280, height: 800 } })
    const studio = clamped.windows.studio

    expect(studio?.position.y).toBe(300)
    expect((studio?.position.y ?? 0) + (studio?.size.height ?? 0)).toBeLessThanOrEqual(800)
  })

  it('pins a window taller than the workspace to the top', () => {
    const state = {
      ...createInitialDesktopState(),
      windows: {
        studio: {
          appId: 'studio' as const,
          status: 'open' as const,
          position: { x: 80, y: 400 },
          size: { width: 700, height: 900 },
          zIndex: 1
        }
      }
    }

    const clamped = desktopReducer(state, { type: 'clamp', viewport: { width: 1280, height: 800 } })

    expect(clamped.windows.studio?.position.y).toBe(0)
  })

  it('returns the same state when every window already fits the workspace', () => {
    const state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })

    const clamped = desktopReducer(state, { type: 'clamp', viewport: { width: 1440, height: 800 } })

    expect(clamped).toBe(state)
    expect(clamped.windows).toBe(state.windows)
    expect(clamped.windows.studio).toBe(state.windows.studio)
  })

  it('minimizes the focused app and selects the highest-z visible app', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
    state = desktopReducer(state, { type: 'open', appId: 'agent' })
    state = desktopReducer(state, { type: 'open', appId: 'jd-match' })
    state = desktopReducer(state, { type: 'minimize', appId: 'jd-match' })
    expect(state.windows['jd-match']?.status).toBe('minimized')
    expect(state.focusedAppId).toBe('agent')

    state = desktopReducer(state, { type: 'minimize', appId: 'agent' })
    state = desktopReducer(state, { type: 'minimize', appId: 'studio' })
    expect(state.focusedAppId).toBeNull()
  })

  it('restores a minimized app as the focused top window', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
    state = desktopReducer(state, { type: 'open', appId: 'agent' })
    const nextZ = state.nextZIndex
    state = desktopReducer(state, { type: 'minimize', appId: 'agent' })
    state = desktopReducer(state, { type: 'restore', appId: 'agent' })
    expect(state.windows.agent?.status).toBe('open')
    expect(state.focusedAppId).toBe('agent')
    expect(state.windows.agent?.zIndex).toBe(nextZ)
  })

  it('updates only the target window immutably when moving and resizing', () => {
    let state = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
    state = desktopReducer(state, { type: 'open', appId: 'agent' })
    const previousState = state
    const previousStudio = state.windows.studio
    const previousAgent = state.windows.agent

    const moved = desktopReducer(state, { type: 'move', appId: 'studio', position: { x: 20, y: 30 } })
    expect(moved).not.toBe(previousState)
    expect(moved.windows).not.toBe(previousState.windows)
    expect(moved.windows.studio).not.toBe(previousStudio)
    expect(moved.windows.agent).toBe(previousAgent)
    expect(moved.windows.studio?.position).toEqual({ x: 20, y: 30 })

    const resized = desktopReducer(moved, {
      type: 'resize',
      appId: 'studio',
      position: { x: 40, y: 50 },
      size: { width: 1, height: 2 }
    })
    expect(resized.windows.studio?.position).toEqual({ x: 40, y: 50 })
    expect(resized.windows.studio?.size).toEqual({ width: 720, height: 520 })
    expect(resized.windows.agent).toBe(moved.windows.agent)
  })

  it.each([NaN, Infinity, -Infinity])(
    'preserves finite values per resize coordinate when supplied %s',
    (nonFinite) => {
      const opened = desktopReducer(createInitialDesktopState(), { type: 'open', appId: 'studio' })
      const original = opened.windows.studio
      const first = desktopReducer(opened, {
        type: 'resize',
        appId: 'studio',
        position: { x: nonFinite, y: 50 },
        size: { width: nonFinite, height: 2 }
      })

      expect(first.windows.studio?.position).toEqual({ x: original?.position.x, y: 50 })
      expect(first.windows.studio?.size).toEqual({ width: original?.size.width, height: 520 })

      const second = desktopReducer(opened, {
        type: 'resize',
        appId: 'studio',
        position: { x: 40, y: nonFinite },
        size: { width: 1, height: nonFinite }
      })

      expect(second.windows.studio?.position).toEqual({ x: 40, y: original?.position.y })
      expect(second.windows.studio?.size).toEqual({ width: 720, height: original?.size.height })
      for (const value of [
        first.windows.studio?.position.x,
        first.windows.studio?.position.y,
        first.windows.studio?.size.width,
        first.windows.studio?.size.height,
        second.windows.studio?.position.x,
        second.windows.studio?.position.y,
        second.windows.studio?.size.width,
        second.windows.studio?.size.height
      ]) {
        expect(Number.isFinite(value)).toBe(true)
      }
    }
  )

  it('hydrates, completes intro, and resets to fresh initial state', () => {
    const supplied = {
      windows: {
        studio: {
          appId: 'studio' as const,
          status: 'open' as const,
          position: { x: 1, y: 2 },
          size: { width: 3, height: 4 },
          zIndex: 8
        }
      },
      focusedAppId: 'studio' as const,
      nextZIndex: 9,
      hasCompletedIntro: false
    }
    const hydrated = desktopReducer(createInitialDesktopState(), { type: 'hydrate', state: supplied })
    expect(hydrated).not.toBe(supplied)
    expect(hydrated.windows).not.toBe(supplied.windows)
    expect(hydrated).toEqual(supplied)
    expect(desktopReducer(hydrated, { type: 'completeIntro' }).hasCompletedIntro).toBe(true)

    const reset = desktopReducer(hydrated, { type: 'reset' })
    expect(reset).toEqual(createInitialDesktopState())
    expect(reset).not.toBe(hydrated)
    expect(reset.windows).not.toBe(hydrated.windows)
  })

  it('clamps oversized windows without producing invalid geometry', () => {
    const state = createInitialDesktopState()
    const clamped = desktopReducer(
      {
        ...state,
        windows: {
          studio: {
            appId: 'studio',
            status: 'open',
            position: { x: 5000, y: -900 },
            size: { width: 2000, height: 1000 },
            zIndex: 1
          }
        }
      },
      { type: 'clamp', viewport: { width: 0, height: -1 } }
    )
    expect(Number.isFinite(clamped.windows.studio?.position.x)).toBe(true)
    expect(Number.isFinite(clamped.windows.studio?.position.y)).toBe(true)
    expect(clamped.windows.studio?.position.x).toBe(0)
    expect(clamped.windows.studio?.position.y).toBe(0)
  })

  it('uses the origin when a tiny viewport makes the clamp interval invalid', () => {
    const state = createInitialDesktopState()
    const clamped = desktopReducer(
      {
        ...state,
        windows: {
          studio: {
            appId: 'studio',
            status: 'open',
            position: { x: -5000, y: 900 },
            size: { width: 80, height: 100 },
            zIndex: 1
          }
        }
      },
      { type: 'clamp', viewport: { width: 48, height: 20 } }
    )

    expect(clamped.windows.studio?.position).toEqual({ x: 0, y: 0 })
    expect(Number.isFinite(clamped.windows.studio?.position.x)).toBe(true)
    expect(Number.isFinite(clamped.windows.studio?.position.y)).toBe(true)
  })
})
