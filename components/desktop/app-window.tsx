'use client'

import { Rnd } from 'react-rnd'
import { useTranslations } from 'next-intl'
import { appRegistry } from '@/lib/desktop/app-registry'
import type { DesktopWindowState } from '@/lib/desktop/types'
import { AppErrorBoundary } from './app-error-boundary'
import { AppLoader } from './app-loader'
import { useDesktop } from './desktop-provider'

function focusDockButton(appId: DesktopWindowState['appId']) {
  if (typeof document === 'undefined') return
  const focus = () => document.getElementById(`desktop-dock-${appId}`)?.focus()

  if (typeof queueMicrotask === 'function') {
    queueMicrotask(focus)
  } else if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(focus)
  } else {
    focus()
  }
}

export function AppWindow({ window }: { window: DesktopWindowState }) {
  const { dispatch, focusApp } = useDesktop()
  const t = useTranslations('desktop')
  const app = appRegistry[window.appId]
  const appName = t(app.messageKey)
  const isMaximized = window.status === 'maximized'
  const maximizeLabel = isMaximized ? t('restore') : t('maximize')
  const focusWindow = () => focusApp(window.appId)

  return (
    <Rnd
      className={`desktop-window${isMaximized ? ' desktop-window--maximized' : ''}`}
      bounds="parent"
      dragHandleClassName="desktop-window__titlebar"
      cancel={'button, input, textarea, select, a, canvas, [data-no-drag], [contenteditable="true"]'}
      minWidth={app.minSize.width}
      minHeight={app.minSize.height}
      position={isMaximized ? { x: 0, y: 0 } : window.position}
      size={isMaximized ? { width: '100%', height: '100%' } : window.size}
      disableDragging={isMaximized}
      enableResizing={!isMaximized}
      resizeHandleClasses={{ bottomRight: 'desktop-window__resize-handle desktop-window__resize-handle--se' }}
      role="application"
      tabIndex={0}
      aria-label={appName}
      data-material="window"
      data-window-status={window.status}
      onFocusCapture={focusWindow}
      onPointerDown={focusWindow}
      onDragStop={(_event, position) => dispatch({ type: 'move', appId: window.appId, position })}
      onResizeStop={(_event, _direction, element, _delta, position) => dispatch({
        type: 'resize',
        appId: window.appId,
        position,
        size: { width: element.offsetWidth, height: element.offsetHeight }
      })}
    >
      <header className="desktop-window__titlebar">
        <div className="desktop-window__controls" data-no-drag>
          <button type="button" className="desktop-window__control desktop-window__control--close" aria-label={`${t('close')} ${appName}`} onClick={() => dispatch({ type: 'close', appId: window.appId })}><span aria-hidden="true" /></button>
          <button
            type="button"
            className="desktop-window__control desktop-window__control--minimize"
            aria-label={`${t('minimize')} ${appName}`}
            onClick={() => {
              dispatch({ type: 'minimize', appId: window.appId })
              focusDockButton(window.appId)
            }}
          ><span aria-hidden="true" /></button>
          <button type="button" className="desktop-window__control desktop-window__control--maximize" aria-label={`${maximizeLabel} ${appName}`} onClick={() => dispatch({ type: isMaximized ? 'restore' : 'maximize', appId: window.appId })}><span aria-hidden="true" /></button>
        </div>
        <span className="desktop-window__title">{appName}</span>
      </header>
      <AppErrorBoundary appId={window.appId} appName={appName} onClose={() => dispatch({ type: 'close', appId: window.appId })}>
        <AppLoader appId={window.appId} />
      </AppErrorBoundary>
    </Rnd>
  )
}
