import { describe, expect, it } from 'vitest'
import { desktopReducer } from './reducer'
import type { DesktopState } from './types'
import {
  DESKTOP_STORAGE_KEY,
  clearDesktopState,
  readDesktopState,
  writeDesktopState
} from './persistence'

class MapStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

class RecordingStorage implements Pick<Storage, 'setItem' | 'removeItem'> {
  readonly setCalls: Array<[string, string]> = []
  readonly removeCalls: string[] = []

  setItem(key: string, value: string): void {
    this.setCalls.push([key, value])
  }

  removeItem(key: string): void {
    this.removeCalls.push(key)
  }
}

function stateWithWindows(): DesktopState {
  return {
    windows: {
      studio: {
        appId: 'studio',
        status: 'open',
        position: { x: 5000, y: -900 },
        size: { width: 980, height: 680 },
        restoreGeometry: {
          position: { x: -400, y: 1200 },
          size: { width: 800, height: 600 }
        },
        zIndex: 4
      },
      agent: {
        appId: 'agent',
        status: 'maximized',
        position: { x: 160, y: 90 },
        size: { width: 920, height: 650 },
        zIndex: 9
      }
    },
    focusedAppId: 'studio',
    nextZIndex: 2,
    hasCompletedIntro: true
  }
}

function put(storage: MapStorage, value: unknown): void {
  storage.setItem(DESKTOP_STORAGE_KEY, JSON.stringify(value))
}

function containsNonFiniteNumber(value: unknown): boolean {
  if (typeof value === 'number' && !Number.isFinite(value)) return true
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).some(containsNonFiniteNumber)
}

describe('desktop persistence', () => {
  it('returns null for empty storage', () => {
    expect(readDesktopState(new MapStorage())).toBeNull()
  })

  it('round-trips a valid state as normalized state', () => {
    const storage = new MapStorage()
    const state = stateWithWindows()

    writeDesktopState(storage, state)

    expect(readDesktopState(storage)).toEqual({ ...state, nextZIndex: 10 })
  })

  it('returns null for malformed JSON', () => {
    const storage = new MapStorage()
    storage.setItem(DESKTOP_STORAGE_KEY, '{not json')

    expect(readDesktopState(storage)).toBeNull()
  })

  it('returns null for an unknown version', () => {
    const storage = new MapStorage()
    put(storage, { version: 2, state: stateWithWindows() })

    expect(readDesktopState(storage)).toBeNull()
  })

  it('strips unknown apps while retaining known apps', () => {
    const storage = new MapStorage()
    const state = stateWithWindows()
    put(storage, {
      version: 1,
      state: { ...state, windows: { ...state.windows, unknown: state.windows.studio } }
    })

    const loaded = readDesktopState(storage)
    expect(loaded?.windows).toEqual({ studio: state.windows.studio, agent: state.windows.agent })
  })

  it('strips inherited-property-like app keys while retaining known apps', () => {
    const storage = new MapStorage()
    const state = stateWithWindows()
    put(storage, {
      version: 1,
      state: {
        ...state,
        windows: {
          studio: state.windows.studio,
          toString: null,
          constructor: 'invalid window',
          prototype: { appId: 'prototype' }
        }
      }
    })

    expect(readDesktopState(storage)?.windows).toEqual({ studio: state.windows.studio })
  })

  it('drops windows whose map key disagrees with appId', () => {
    const storage = new MapStorage()
    put(storage, {
      version: 1,
      state: { ...stateWithWindows(), windows: { studio: { ...stateWithWindows().windows.agent } } }
    })

    expect(readDesktopState(storage)?.windows).toEqual({})
  })

  it.each([
    ['status', { status: 'closed' }],
    ['position', { position: { x: null, y: 0 } }],
    ['size', { size: { width: 'wide', height: 1 } }],
    ['zIndex', { zIndex: null }],
    ['intro', { hasCompletedIntro: 'yes' }],
    ['nextZIndex', { nextZIndex: null }]
  ])('returns null for invalid %s schema', (_field, replacement) => {
    const storage = new MapStorage()
    const base = stateWithWindows()
    const state = _field === 'intro' || _field === 'nextZIndex'
      ? { ...base, ...replacement }
      : { ...base, windows: { studio: { ...base.windows.studio, ...replacement } } }
    put(storage, { version: 1, state })

    expect(readDesktopState(storage)).toBeNull()
  })

  it.each([42, { appId: 'studio' }])(
    'returns null for schema-invalid focusedAppId %j',
    (focusedAppId) => {
      const storage = new MapStorage()
      put(storage, { version: 1, state: { ...stateWithWindows(), focusedAppId } })

      expect(readDesktopState(storage)).toBeNull()
    }
  )

  it.each(['__proto__', 'constructor', 'toString'])(
    'falls back to the highest visible app for inherited focus key %s',
    (focusedAppId) => {
      const storage = new MapStorage()
      put(storage, { version: 1, state: { ...stateWithWindows(), focusedAppId } })

      expect(readDesktopState(storage)?.focusedAppId).toBe('agent')
    }
  )

  it.each([
    ['null position coordinate', { position: { x: null, y: 0 } }],
    ['string position coordinate', { position: { x: 0, y: '0' } }],
    ['null size coordinate', { size: { width: null, height: 1 } }],
    ['string size coordinate', { size: { width: 1, height: '1' } }],
    ['null zIndex', { zIndex: null }],
    ['string zIndex', { zIndex: '1' }]
  ])('returns null for raw JSON containing %s', (_case, invalidFields) => {
    const storage = new MapStorage()
    const validWindow = stateWithWindows().windows.studio
    const serialized = JSON.stringify({
      version: 1,
      state: {
        windows: { studio: { ...validWindow, ...invalidFields } },
        focusedAppId: 'studio',
        nextZIndex: 2,
        hasCompletedIntro: true
      }
    })
    storage.setItem('resume-os-desktop-v1', serialized)

    expect(readDesktopState(storage)).toBeNull()
  })

  it.each([
    [
      'position',
      '{"appId":"studio","status":"open","position":{"x":1e400,"y":0},"size":{"width":1,"height":1},"zIndex":1}'
    ],
    [
      'size',
      '{"appId":"studio","status":"open","position":{"x":0,"y":0},"size":{"width":1e400,"height":1},"zIndex":1}'
    ],
    [
      'restoreGeometry position',
      '{"appId":"studio","status":"maximized","position":{"x":0,"y":0},"size":{"width":1,"height":1},"restoreGeometry":{"position":{"x":1e400,"y":0},"size":{"width":1,"height":1}},"zIndex":1}'
    ],
    [
      'restoreGeometry size',
      '{"appId":"studio","status":"maximized","position":{"x":0,"y":0},"size":{"width":1,"height":1},"restoreGeometry":{"position":{"x":0,"y":0},"size":{"width":1e400,"height":1}},"zIndex":1}'
    ],
    [
      'zIndex',
      '{"appId":"studio","status":"open","position":{"x":0,"y":0},"size":{"width":1,"height":1},"zIndex":1e400}'
    ],
    [
      'negative position',
      '{"appId":"studio","status":"open","position":{"x":-1e400,"y":0},"size":{"width":1,"height":1},"zIndex":1}'
    ]
  ])('returns null for non-finite %s parsed from raw JSON', (_family, windowJson) => {
    const storage = new MapStorage()
    const serialized = `{"version":1,"state":{"windows":{"studio":${windowJson}},"focusedAppId":"studio","nextZIndex":2,"hasCompletedIntro":true}}`
    storage.setItem('resume-os-desktop-v1', serialized)

    expect(serialized).toContain('1e400')
    expect(containsNonFiniteNumber(JSON.parse(windowJson))).toBe(true)
    expect(readDesktopState(storage)).toBeNull()
  })

  it.each([
    ['Number.MAX_VALUE', '1.7976931348623157e308'],
    ['Number.MAX_SAFE_INTEGER', '9007199254740991'],
    ['fraction', '1.5'],
    ['negative', '-1']
  ])('returns null for invalid %s zIndex', (_case, zIndexJson) => {
    const storage = new MapStorage()
    const serialized = `{"version":1,"state":{"windows":{"studio":{"appId":"studio","status":"open","position":{"x":0,"y":0},"size":{"width":1,"height":1},"zIndex":${zIndexJson}}},"focusedAppId":"studio","nextZIndex":2,"hasCompletedIntro":true}}`
    storage.setItem('resume-os-desktop-v1', serialized)

    expect(readDesktopState(storage)).toBeNull()
  })

  it('compacts near-limit layers before reducer focus and open roundtrip', () => {
    const storage = new MapStorage()
    storage.setItem(
      'resume-os-desktop-v1',
      '{"version":1,"state":{"windows":{"studio":{"appId":"studio","status":"open","position":{"x":0,"y":0},"size":{"width":1,"height":1},"zIndex":9007199254740990},"agent":{"appId":"agent","status":"open","position":{"x":0,"y":0},"size":{"width":1,"height":1},"zIndex":9007199254740989}},"focusedAppId":"agent","nextZIndex":1,"hasCompletedIntro":true}}'
    )

    const loaded = readDesktopState(storage)
    expect(loaded).not.toBeNull()
    if (!loaded) throw new Error('Expected persisted desktop state')
    expect(loaded.windows.agent?.zIndex).toBe(1)
    expect(loaded.windows.studio?.zIndex).toBe(2)
    expect(loaded.focusedAppId).toBe('agent')
    expect(loaded.nextZIndex).toBe(3)

    let advanced = desktopReducer(loaded, { type: 'focus', appId: 'studio' })
    advanced = desktopReducer(advanced, { type: 'open', appId: 'book' })
    writeDesktopState(storage, advanced)
    const reloaded = readDesktopState(storage)

    expect(reloaded).toEqual(advanced)
    expect(reloaded?.focusedAppId).toBe('book')
    expect(reloaded?.windows.agent?.zIndex).toBeLessThan(reloaded?.windows.studio?.zIndex ?? 0)
    expect(reloaded?.windows.studio?.zIndex).toBeLessThan(reloaded?.windows.book?.zIndex ?? 0)
    for (const value of [
      reloaded?.nextZIndex,
      ...Object.values(reloaded?.windows ?? {}).map((window) => window?.zIndex)
    ]) {
      expect(Number.isSafeInteger(value)).toBe(true)
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('uses app-id order to compact equal near-limit layers deterministically', () => {
    const storage = new MapStorage()
    storage.setItem(
      'resume-os-desktop-v1',
      '{"version":1,"state":{"windows":{"studio":{"appId":"studio","status":"open","position":{"x":0,"y":0},"size":{"width":1,"height":1},"zIndex":9007199254740990},"agent":{"appId":"agent","status":"open","position":{"x":0,"y":0},"size":{"width":1,"height":1},"zIndex":9007199254740990}},"focusedAppId":"studio","nextZIndex":1,"hasCompletedIntro":true}}'
    )

    const loaded = readDesktopState(storage)
    expect(loaded?.windows.agent?.zIndex).toBe(1)
    expect(loaded?.windows.studio?.zIndex).toBe(2)
    expect(loaded?.focusedAppId).toBe('studio')
    expect(loaded?.nextZIndex).toBe(3)
  })

  it('recalculates nextZIndex from retained finite window z-indices', () => {
    const storage = new MapStorage()
    const state = stateWithWindows()
    put(storage, { version: 1, state: { ...state, nextZIndex: 999 } })

    expect(readDesktopState(storage)?.nextZIndex).toBe(10)
  })

  it('selects the highest-z non-minimized window for invalid or minimized focus', () => {
    const storage = new MapStorage()
    const state = stateWithWindows()
    state.windows.book = {
      appId: 'book',
      status: 'minimized',
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
      zIndex: 30
    }

    put(storage, { version: 1, state: { ...state, focusedAppId: 'book' } })
    expect(readDesktopState(storage)?.focusedAppId).toBe('agent')

    put(storage, { version: 1, state: { ...state, focusedAppId: 'missing' } })
    expect(readDesktopState(storage)?.focusedAppId).toBe('agent')
  })

  it('swallows storage method errors', () => {
    const throwing = {
      getItem: () => { throw new Error('read') },
      setItem: () => { throw new Error('write') },
      removeItem: () => { throw new Error('clear') }
    }

    expect(() => readDesktopState(throwing)).not.toThrow()
    expect(readDesktopState(throwing)).toBeNull()
    expect(() => writeDesktopState(throwing, stateWithWindows())).not.toThrow()
    expect(() => clearDesktopState(throwing)).not.toThrow()
  })

  it('writes and clears the exact key and versioned envelope', () => {
    const storage = new RecordingStorage()
    const state = stateWithWindows()
    const original = structuredClone(state)

    expect(DESKTOP_STORAGE_KEY).toBe('resume-os-desktop-v1')
    writeDesktopState(storage, state)

    expect(storage.setCalls).toHaveLength(1)
    expect(storage.setCalls[0]?.[0]).toBe('resume-os-desktop-v1')
    expect(JSON.parse(storage.setCalls[0]?.[1] ?? '')).toEqual({
      version: 1,
      state
    })
    expect(state).toEqual(original)

    clearDesktopState(storage)
    expect(storage.removeCalls).toEqual(['resume-os-desktop-v1'])
  })

  it('returns a fresh object graph when loading', () => {
    const storage = new MapStorage()
    const state = stateWithWindows()
    writeDesktopState(storage, state)
    const loaded = readDesktopState(storage)

    expect(loaded).not.toBe(state)
    expect(loaded?.windows).not.toBe(state.windows)
    expect(loaded?.windows.studio?.position).not.toBe(state.windows.studio?.position)
    expect(loaded?.windows.studio?.restoreGeometry).not.toBe(state.windows.studio?.restoreGeometry)
  })

  it('preserves finite out-of-bounds geometry for later clamping', () => {
    const storage = new MapStorage()
    const state = stateWithWindows()
    writeDesktopState(storage, state)

    expect(readDesktopState(storage)?.windows.studio?.position).toEqual({ x: 5000, y: -900 })
    expect(readDesktopState(storage)?.windows.studio?.restoreGeometry).toEqual({
      position: { x: -400, y: 1200 },
      size: { width: 800, height: 600 }
    })
  })
})
