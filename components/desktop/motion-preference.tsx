'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { useTranslations } from 'next-intl'

export type MotionMode = 'system' | 'full' | 'reduced'

type MotionPreferenceContextValue = {
  mode: MotionMode
  resolvedReducedMotion: boolean
  setMode(mode: MotionMode): void
}

const STORAGE_KEY = 'resume-os-motion'
const CHANGE_EVENT = 'resume-os-motion-change'
const MEDIA_QUERY = '(prefers-reduced-motion: reduce)'
const SERVER_MODE: MotionMode = 'system'
const MOTION_MODES: readonly MotionMode[] = ['system', 'full', 'reduced']
const MotionPreferenceContext = createContext<MotionPreferenceContextValue | null>(null)
let memoryMode: MotionMode = SERVER_MODE

function isMotionMode(value: unknown): value is MotionMode {
  return value === 'system' || value === 'full' || value === 'reduced'
}

function readStoredMode(): MotionMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    memoryMode = isMotionMode(value) ? value : SERVER_MODE
    return memoryMode
  } catch {
    return memoryMode
  }
}

function subscribeToMode(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return

    try {
      const storage = window.localStorage
      if (event.storageArea !== null && event.storageArea !== storage) return
      if (event.newValue !== null && !isMotionMode(event.newValue)) return
    } catch {
      return
    }
    onStoreChange()
  }
  const onChange = (event: Event) => {
    const mode = (event as CustomEvent<unknown>).detail
    if (!isMotionMode(mode)) return
    memoryMode = mode
    try {
      window.localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // Ignore storage failures from restricted browser contexts.
    }
    onStoreChange()
  }

  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

function subscribeToSystemMotion(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia?.(MEDIA_QUERY)
  if (!mediaQuery) return () => {}

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', onStoreChange)
    return () => mediaQuery.removeEventListener('change', onStoreChange)
  }

  mediaQuery.addListener?.(onStoreChange)
  return () => mediaQuery.removeListener?.(onStoreChange)
}

function readSystemMotion(): boolean {
  return window.matchMedia?.(MEDIA_QUERY).matches ?? false
}

export function MotionPreferenceProvider({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(subscribeToMode, readStoredMode, () => SERVER_MODE)
  const systemReducedMotion = useSyncExternalStore(subscribeToSystemMotion, readSystemMotion, () => false)

  useEffect(() => {
    document.documentElement.dataset.motion = mode
  }, [mode])

  const setMode = useCallback((nextMode: MotionMode) => {
    memoryMode = nextMode
    try {
      window.localStorage.setItem(STORAGE_KEY, nextMode)
    } catch {
      // Preference remains available for this session when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: nextMode }))
  }, [])

  const value = useMemo<MotionPreferenceContextValue>(() => ({
    mode,
    resolvedReducedMotion: mode === 'reduced' || (mode === 'system' && systemReducedMotion),
    setMode
  }), [mode, setMode, systemReducedMotion])

  return <MotionPreferenceContext.Provider value={value}>{children}</MotionPreferenceContext.Provider>
}

export function useMotionPreference(): MotionPreferenceContextValue {
  const context = useContext(MotionPreferenceContext)
  if (!context) throw new Error('useMotionPreference must be used within MotionPreferenceProvider')
  return context
}

export function MotionModeControl({ compact = false }: { compact?: boolean } = {}) {
  const { mode, setMode } = useMotionPreference()
  const t = useTranslations('desktop.motion')
  const buttonRefs = useRef<Partial<Record<MotionMode, HTMLButtonElement>>>({})

  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, currentMode: MotionMode) => {
    const currentIndex = MOTION_MODES.indexOf(currentMode)
    let nextMode: MotionMode | undefined

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextMode = MOTION_MODES[(currentIndex + 1) % MOTION_MODES.length]
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextMode = MOTION_MODES[(currentIndex - 1 + MOTION_MODES.length) % MOTION_MODES.length]
    } else if (event.key === 'Home') {
      nextMode = MOTION_MODES[0]
    } else if (event.key === 'End') {
      nextMode = MOTION_MODES[MOTION_MODES.length - 1]
    }

    if (!nextMode) return
    event.preventDefault()
    setMode(nextMode)
    buttonRefs.current[nextMode]?.focus()
  }

  return (
    <div
      className={`motion-mode-control${compact ? ' motion-mode-control--compact' : ''}`}
      role="radiogroup"
      aria-label={t('label')}
    >
      {MOTION_MODES.map((option) => (
        <button
          key={option}
          ref={(element) => { buttonRefs.current[option] = element ?? undefined }}
          type="button"
          className="motion-mode-control__option"
          role="radio"
          aria-checked={mode === option}
          tabIndex={mode === option ? 0 : -1}
          onClick={() => setMode(option)}
          onKeyDown={(event) => selectFromKeyboard(event, option)}
        >
          {t(option)}
        </button>
      ))}
    </div>
  )
}
