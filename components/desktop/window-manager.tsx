'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useState, useSyncExternalStore } from 'react'
import type { AppId, DesktopState, DesktopWindowState, Point } from '@/lib/desktop/types'
import { DESKTOP_DOCK_HEIGHT, DESKTOP_MENU_HEIGHT, useDesktop } from './desktop-provider'
import { AppWindow } from './app-window'
import { dockAppIdsForWindows } from './dock'
import { useMotionPreference } from './motion-preference'

const DOCK_SLOT_SIZE = 42
const DOCK_SLOT_GAP = 7
const DOCK_HORIZONTAL_PADDING = 10
const DOCK_BORDER_WIDTH = 2

function subscribeToViewport(onStoreChange: () => void) {
  window.addEventListener('resize', onStoreChange)
  return () => window.removeEventListener('resize', onStoreChange)
}

function readViewport(): string {
  return `${window.innerWidth}:${window.innerHeight}`
}

function dockTargetForApp(
  appId: AppId,
  windows: DesktopState['windows'],
  viewportWidth: number,
  viewportHeight: number
): Point {
  const appIds = dockAppIdsForWindows(
    windows,
    viewportWidth <= 899
  )
  const index = Math.max(0, appIds.indexOf(appId))
  const dockWidth = appIds.length * DOCK_SLOT_SIZE
    + Math.max(0, appIds.length - 1) * DOCK_SLOT_GAP
    + DOCK_HORIZONTAL_PADDING * 2
    + DOCK_BORDER_WIDTH
  const dockLeft = Math.max(16, (viewportWidth - dockWidth) / 2)

  return {
    x: dockLeft + DOCK_HORIZONTAL_PADDING + DOCK_BORDER_WIDTH / 2
      + index * (DOCK_SLOT_SIZE + DOCK_SLOT_GAP)
      + DOCK_SLOT_SIZE / 2,
    y: Math.max(0, viewportHeight - DESKTOP_MENU_HEIGHT - DESKTOP_DOCK_HEIGHT / 2)
  }
}

function windowCenter(window: DesktopWindowState): Point {
  return {
    x: window.position.x + window.size.width / 2,
    y: window.position.y + window.size.height / 2
  }
}

function WindowMotionFrame({
  window,
  windows,
  viewportWidth,
  viewportHeight,
  resolvedReducedMotion
}: {
  window: DesktopWindowState
  windows: DesktopState['windows']
  viewportWidth: number
  viewportHeight: number
  resolvedReducedMotion: boolean
}) {
  const [settledMinimizeZIndex, setSettledMinimizeZIndex] = useState<number | null>(null)
  const minimized = window.status === 'minimized'

  if (minimized && (resolvedReducedMotion || settledMinimizeZIndex === window.zIndex)) {
    return null
  }

  const dockTarget = dockTargetForApp(window.appId, windows, viewportWidth, viewportHeight)
  const center = windowCenter(window)
  const animate = resolvedReducedMotion
    ? { opacity: 1 }
    : minimized
      ? {
          opacity: 0,
          scale: 0.18,
          x: dockTarget.x - center.x,
          y: dockTarget.y - center.y
        }
      : { opacity: 1, scale: 1, x: 0, y: 0 }

  return (
    <motion.div
      className={`desktop-window-motion${minimized ? ' desktop-window-motion--minimized' : ''}`}
      initial={resolvedReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={animate}
      exit={resolvedReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      transition={resolvedReducedMotion
        ? { duration: 0.12, ease: 'easeOut' }
        : minimized
          ? { duration: 0.28, ease: [0.32, 0, 0.2, 1] }
          : { type: 'spring', duration: 0.24, bounce: 0.14 }}
      onAnimationComplete={() => {
        if (minimized) setSettledMinimizeZIndex(window.zIndex)
      }}
      style={{
        zIndex: window.zIndex,
        transformOrigin: `${dockTarget.x}px ${dockTarget.y}px`
      }}
      data-app-id={window.appId}
      data-motion-origin="dock"
      data-window-motion-status={window.status}
      aria-hidden={minimized}
      inert={minimized}
    >
      <AppWindow window={window} />
    </motion.div>
  )
}

export function WindowManager() {
  const { state } = useDesktop()
  const t = useTranslations('desktop')
  const { resolvedReducedMotion } = useMotionPreference()
  const viewport = useSyncExternalStore(subscribeToViewport, readViewport, () => '0:0')
  const [viewportWidth, viewportHeight] = viewport.split(':').map(Number)
  const windows = Object.values(state.windows)
    .filter((window): window is NonNullable<typeof window> => Boolean(window))
    .sort((left, right) => left.zIndex - right.zIndex)

  return (
    <section className="desktop-window-manager" aria-label={t('applications')}>
      <AnimatePresence initial={false}>
        {windows.map((window) => (
          <WindowMotionFrame
            key={window.appId}
            window={window}
            windows={state.windows}
            viewportWidth={viewportWidth}
            viewportHeight={viewportHeight}
            resolvedReducedMotion={resolvedReducedMotion}
          />
        ))}
      </AnimatePresence>
    </section>
  )
}
