import { z } from 'zod'
import { appRegistry } from './app-registry'
import type { AppId, DesktopState, DesktopWindowState } from './types'

export const DESKTOP_STORAGE_KEY = 'resume-os-desktop-v1'

const appIds = Object.keys(appRegistry) as [AppId, ...AppId[]]
const maxPersistedZIndex = Number.MAX_SAFE_INTEGER - 1
const finiteNumber = z.number().finite()
const zIndexSchema = z.number().int().nonnegative().max(maxPersistedZIndex)
const pointSchema = z.object({ x: finiteNumber, y: finiteNumber })
const sizeSchema = z.object({ width: finiteNumber, height: finiteNumber })
const windowSchema = z.object({
  appId: z.enum(appIds),
  status: z.enum(['open', 'minimized', 'maximized']),
  position: pointSchema,
  size: sizeSchema,
  restoreGeometry: z.object({ position: pointSchema, size: sizeSchema }).optional(),
  zIndex: zIndexSchema
})
const stateSchema = z.object({
  windows: z.record(z.string(), z.unknown()),
  focusedAppId: z.union([z.string(), z.null()]),
  nextZIndex: finiteNumber,
  hasCompletedIntro: z.boolean()
})
const envelopeSchema = z.object({ version: z.literal(1), state: z.unknown() })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function highestVisibleAppId(windows: DesktopState['windows']): AppId | null {
  return Object.values(windows)
    .filter((window): window is DesktopWindowState => Boolean(window) && window.status !== 'minimized')
    .sort((left, right) => right.zIndex - left.zIndex)[0]?.appId ?? null
}

function compactWindowZIndexes(windows: DesktopState['windows']): DesktopState['windows'] {
  const sortedWindows = Object.values(windows)
    .filter((window): window is DesktopWindowState => Boolean(window))
    .sort((left, right) => {
      const zIndexDifference = left.zIndex - right.zIndex
      if (zIndexDifference !== 0) return zIndexDifference
      return left.appId < right.appId ? -1 : left.appId > right.appId ? 1 : 0
    })

  return Object.fromEntries(
    sortedWindows.map((window, index) => [
      window.appId,
      { ...window, zIndex: index + 1 }
    ])
  ) as DesktopState['windows']
}

function normalizeState(value: unknown): DesktopState | null {
  const parsedState = stateSchema.safeParse(value)
  if (!parsedState.success) return null

  const windows: DesktopState['windows'] = {}
  for (const [key, value] of Object.entries(parsedState.data.windows)) {
    if (!Object.hasOwn(appRegistry, key)) continue
    if (isRecord(value) && 'appId' in value && value.appId !== key) continue

    const parsedWindow = windowSchema.safeParse(value)
    if (!parsedWindow.success) return null
    if (parsedWindow.data.appId !== key) continue
    windows[key as AppId] = parsedWindow.data
  }

  const highestZIndex = Object.values(windows).reduce(
    (maximum, window) => Math.max(maximum, window?.zIndex ?? 0),
    0
  )
  const shouldCompactZIndexes = highestZIndex >= maxPersistedZIndex
  const normalizedWindows = shouldCompactZIndexes ? compactWindowZIndexes(windows) : windows
  const focusedAppId = parsedState.data.focusedAppId
  const focusedWindow = focusedAppId !== null && Object.hasOwn(normalizedWindows, focusedAppId)
    ? normalizedWindows[focusedAppId as AppId]
    : undefined
  return {
    windows: normalizedWindows,
    focusedAppId: focusedWindow && focusedWindow.status !== 'minimized'
      ? focusedWindow.appId
      : highestVisibleAppId(normalizedWindows),
    nextZIndex: shouldCompactZIndexes
      ? Object.keys(normalizedWindows).length + 1
      : Math.max(1, highestZIndex + 1),
    hasCompletedIntro: parsedState.data.hasCompletedIntro
  }
}

export function readDesktopState(storage: Pick<Storage, 'getItem'>): DesktopState | null {
  try {
    const serialized = storage.getItem(DESKTOP_STORAGE_KEY)
    if (serialized === null) return null

    const parsedEnvelope = envelopeSchema.safeParse(JSON.parse(serialized))
    return parsedEnvelope.success ? normalizeState(parsedEnvelope.data.state) : null
  } catch {
    return null
  }
}

export function writeDesktopState(
  storage: Pick<Storage, 'setItem'>,
  state: DesktopState
): void {
  try {
    storage.setItem(DESKTOP_STORAGE_KEY, JSON.stringify({ version: 1, state }))
  } catch {
    // Storage can be unavailable or quota-limited; persistence is best effort.
  }
}

export function clearDesktopState(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(DESKTOP_STORAGE_KEY)
  } catch {
    // Storage can be unavailable; clearing it must not interrupt the desktop.
  }
}
