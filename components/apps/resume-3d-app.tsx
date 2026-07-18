'use client'

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useResumeDraft } from '@/components/resume-draft-provider'
import { useMotionPreference } from '@/components/desktop/motion-preference'
import { MOBILE_MEDIA_QUERY, useMediaQuery } from '@/components/desktop/use-media-query'
import type { Locale } from '@/i18n/routing'
import {
  createResumeSceneIdentitySession,
  createResumeSceneRawNodes,
  reconcileResumeSceneNodes,
  resolveResumeSceneSelection,
  ResumeScene,
  type ResumeSceneIdentitySession,
  type ResumeSceneNodeData,
  type ResumeSceneRawNodeData
} from '@/components/resume-3d/resume-scene'
import type { AppId } from '@/lib/desktop/types'

export function Resume3DApp(_props: { appId?: AppId } = {}) {
  const locale = useLocale() as Locale
  const t = useTranslations('resume3d')
  const { activeDraft, activeResume } = useResumeDraft()
  const { resolvedReducedMotion } = useMotionPreference()
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY)
  const activeDocumentId = activeDraft?.id ?? 'sample'
  const rawNodes = useMemo(() => createResumeSceneRawNodes(activeResume, locale), [activeResume, locale])
  const nodes = useStableResumeSceneNodes(activeDocumentId, rawNodes)
  const sceneDensity = nodes.length > 12 ? 'dense' : 'standard'
  const showNavigator = nodes.length > 0 && (sceneDensity === 'dense' || isMobile === true)
  const [selection, setSelection] = useState<{ documentId: string; nodeId: string | null }>({
    documentId: activeDocumentId,
    nodeId: null
  })
  const [sceneFailed, setSceneFailed] = useState(() => !supportsWebGL())
  const [ready, setReady] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const rootRef = useRef<HTMLElement>(null)
  const renderActive = useAppLifecycleVisibility(rootRef)
  const requestedSelection = selection.documentId === activeDocumentId ? selection.nodeId : null
  const selectedId = resolveResumeSceneSelection(nodes, requestedSelection)
  const selected = nodes.find((node) => node.id === selectedId) ?? null
  const selectNode = (nodeId: string) => setSelection({ documentId: activeDocumentId, nodeId })

  const failScene = useCallback(() => {
    setReady(false)
    setSceneFailed(true)
  }, [])
  const retry = () => {
    setSceneFailed(!supportsWebGL())
    setReady(false)
    setRetryKey((current) => current + 1)
  }

  return (
    <section
      ref={rootRef}
      className="resume-3d"
      role="region"
      aria-label={t('title')}
      data-density={sceneDensity}
      data-render-active={renderActive ? 'true' : 'false'}
    >
      <header className="resume-3d__header">
        <div><span>{activeDraft?.name ?? t('sampleResume')}</span><h1>{activeResume.profile.name || t('untitled')}</h1></div>
      </header>

      {showNavigator && (
        <nav className="resume-3d__node-nav" aria-label={t('nodeNavigation')}>
          {nodes.map((node) => (
            <button key={node.id} type="button" aria-pressed={selected?.id === node.id} onClick={() => selectNode(node.id)}>
              <span>{node.sectionLabel}</span><strong>{node.label}</strong>
            </button>
          ))}
        </nav>
      )}

      <div className="resume-3d__viewport">
        {sceneFailed || nodes.length === 0 ? (
          <Resume3DFallback nodes={nodes} onRetry={nodes.length > 0 ? retry : undefined} />
        ) : (
          <SceneErrorBoundary key={retryKey} onError={failScene}>
            {!ready && <div className="resume-3d__loading" role="status">{t('loading')}</div>}
            <ResumeScene
              nodes={nodes}
              selectedId={selected?.id ?? null}
              active={renderActive}
              reducedMotion={resolvedReducedMotion}
              automaticCamera={!resolvedReducedMotion && isMobile === false}
              compact={isMobile === true}
              interactiveLabels={!showNavigator}
              sceneLabel={t('sceneLabel')}
              onSelect={(node) => selectNode(node.id)}
              onReady={() => setReady(true)}
              onContextLost={failScene}
            />
          </SceneErrorBoundary>
        )}
      </div>

      {!sceneFailed && nodes.length > 0 && (
        <aside className="resume-3d__inspector" aria-live="polite" aria-atomic="true">
          {selected && <><span>{selected.sectionLabel}</span><h2>{selected.label}</h2>{selected.meta && <p>{selected.meta}</p>}<p>{selected.detail}</p></>}
        </aside>
      )}
    </section>
  )
}

type ResumeSceneAllocationState = {
  documentId: string
  rawNodes: ResumeSceneRawNodeData[]
  session: ResumeSceneIdentitySession
  nodes: ResumeSceneNodeData[]
}

function useStableResumeSceneNodes(documentId: string, rawNodes: ResumeSceneRawNodeData[]) {
  const [allocation, setAllocation] = useState<ResumeSceneAllocationState>(() => {
    const result = reconcileResumeSceneNodes(createResumeSceneIdentitySession(), documentId, rawNodes)
    return { documentId, rawNodes, session: result.session, nodes: result.nodes }
  })

  if (allocation.documentId === documentId && allocation.rawNodes === rawNodes) return allocation.nodes

  const result = reconcileResumeSceneNodes(allocation.session, documentId, rawNodes)
  const next = { documentId, rawNodes, session: result.session, nodes: result.nodes }
  setAllocation(next)
  return next.nodes
}

function Resume3DFallback({
  nodes,
  onRetry
}: {
  nodes: ResumeSceneNodeData[]
  onRetry?: () => void
}) {
  const t = useTranslations('resume3d')
  const sections = ['experience', 'project', 'skill'] as const
  return (
    <div className="resume-3d__fallback" role="group" aria-label={t('fallback')}>
      <div className="resume-3d__fallback-heading">
        <p>{nodes.length > 0 ? t('fallbackDescription') : t('empty')}</p>
        {onRetry && <button type="button" onClick={onRetry}><RotateCcw size={16} aria-hidden="true" />{t('retry')}</button>}
      </div>
      <div className="resume-3d__fallback-sections">
        {sections.map((section) => {
          const sectionNodes = nodes.filter((node) => node.section === section)
          return (
            <section key={section}>
              <h2>{t(`sections.${section}`)}</h2>
              {sectionNodes.length > 0 ? <ul>{sectionNodes.map((node) => <li key={node.id}><article><strong>{node.label}</strong><span>{node.meta || node.detail}</span></article></li>)}</ul> : <p>{t('sectionEmpty')}</p>}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function useAppLifecycleVisibility(rootRef: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    const update = () => {
      const windowElement = rootRef.current?.closest<HTMLElement>('.desktop-window')
      setVisible(document.visibilityState !== 'hidden' && windowElement?.dataset.windowStatus !== 'minimized')
    }
    update()
    document.addEventListener('visibilitychange', update)
    const windowElement = rootRef.current?.closest<HTMLElement>('.desktop-window')
    const observer = windowElement ? new MutationObserver(update) : null
    if (windowElement) observer?.observe(windowElement, { attributes: true, attributeFilter: ['data-window-status'] })
    return () => {
      document.removeEventListener('visibilitychange', update)
      observer?.disconnect()
    }
  }, [rootRef])
  return visible
}

class SceneErrorBoundary extends Component<{ children: ReactNode; onError(): void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError() }
  render() { return this.state.failed ? null : this.props.children }
}

function supportsWebGL() {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!context) return false
    context.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}
