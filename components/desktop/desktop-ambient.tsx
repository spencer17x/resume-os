'use client'

import { Sparkles } from 'lucide-react'
import { useEffect, useRef, type CSSProperties } from 'react'
import { appRegistry } from '@/lib/desktop/app-registry'
import type { AppId } from '@/lib/desktop/types'
import { AppIcon } from './app-icon'
import { useMotionPreference } from './motion-preference'

type AmbientAgent = {
  appId: AppId
  storyRole: 'evidence' | 'jd' | 'retrieve' | 'rank' | 'synthesize' | 'verify'
  number: string
  label: string
  status: string
  x: number
  y: number
  color: string
  labelSide: 'left' | 'right'
  routeAngle: number
  routeLength: number
  routeArc: number
  delay: number
}

const ambientAgents = [
  { appId: 'studio', storyRole: 'evidence', number: '01', label: 'Resume Studio', status: 'Analyze', x: 28, y: 17, color: 'var(--desktop-agent-studio)', labelSide: 'left', routeAngle: -145, routeLength: 31, routeArc: 54, delay: -1.8 },
  { appId: 'agent', storyRole: 'retrieve', number: '02', label: 'Resume Agent', status: 'Retrieve', x: 70, y: 14, color: 'var(--desktop-agent-agent)', labelSide: 'right', routeAngle: -45, routeLength: 29, routeArc: 66, delay: -4.4 },
  { appId: 'jd-match', storyRole: 'jd', number: '03', label: 'JD Match', status: 'Match', x: 88, y: 43, color: 'var(--desktop-agent-match)', labelSide: 'right', routeAngle: 0, routeLength: 38, routeArc: 48, delay: -2.7 },
  { appId: 'resume-3d', storyRole: 'synthesize', number: '04', label: 'Resume 3D', status: 'Draft', x: 70, y: 70, color: 'var(--desktop-agent-resume-3d)', labelSide: 'right', routeAngle: 45, routeLength: 29, routeArc: 60, delay: -5.1 },
  { appId: 'projects', storyRole: 'rank', number: '05', label: 'Projects', status: 'Verify', x: 25, y: 70, color: 'var(--desktop-agent-projects)', labelSide: 'left', routeAngle: 145, routeLength: 32, routeArc: 54, delay: -3.5 },
  { appId: 'timeline', storyRole: 'verify', number: '06', label: 'Timeline', status: 'Ready', x: 10, y: 43, color: 'var(--desktop-agent-timeline)', labelSide: 'left', routeAngle: 180, routeLength: 40, routeArc: 44, delay: -0.8 }
] as const satisfies ReadonlyArray<AmbientAgent>

const storyDelays = {
  evidence: 0.84,
  jd: 1.4,
  retrieve: 2.8,
  rank: 5.04,
  synthesize: 7.14,
  verify: 9.52
} as const

const storyStatuses = [
  { id: 'ready', label: 'Local agent ready', delay: 0 },
  { id: 'inputs', label: 'Evidence + JD ingesting', delay: 0.84 },
  { id: 'retrieve', label: 'Retrieve · grounded facts', delay: 2.8 },
  { id: 'rank', label: 'Rank · role fit', delay: 5.04 },
  { id: 'synthesize', label: 'Synthesize · evidence-bound draft', delay: 7.14 },
  { id: 'verify', label: 'Verify · claim traceability', delay: 9.52 },
  { id: 'variant', label: 'Resume variant ready · master unchanged', delay: 11.62 }
] as const

const phases = [
  { id: 'retrieve', label: 'Retrieve', color: 'var(--desktop-phase-retrieve)', delay: 2.8 },
  { id: 'rank', label: 'Rank', color: 'var(--desktop-phase-rank)', delay: 5.04 },
  { id: 'synthesize', label: 'Synthesize', color: 'var(--desktop-phase-synthesize)', delay: 7.14 },
  { id: 'verify', label: 'Verify', color: 'var(--desktop-phase-verify)', delay: 9.52 }
] as const

const particles = [
  [8, 25, 2, -2.2, 8.2], [14, 67, 1, -5.1, 10.4], [20, 38, 1, -1.7, 7.8], [24, 12, 2, -6.4, 9.6],
  [31, 82, 1, -3.9, 11.2], [37, 28, 1, -7.3, 8.8], [42, 64, 2, -4.6, 10.8], [47, 9, 1, -2.9, 9.4],
  [53, 75, 1, -8.1, 12.1], [59, 22, 2, -1.2, 8.6], [64, 58, 1, -5.8, 9.9], [69, 86, 1, -4.1, 11.6],
  [74, 31, 2, -7.7, 10.2], [79, 69, 1, -3.2, 8.4], [84, 16, 1, -6.9, 12.4], [89, 52, 2, -2.4, 9.2],
  [94, 78, 1, -5.4, 10.7], [5, 88, 1, -7.1, 11.4], [57, 43, 1, -0.9, 7.6], [34, 51, 1, -4.8, 9.8]
] as const

function ambientStyle(values: Record<string, string | number>): CSSProperties {
  return values as CSSProperties
}

export function DesktopAmbient({ subdued }: { subdued: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const { resolvedReducedMotion } = useMotionPreference()

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(([entry]) => {
      root.dataset.offscreen = String(!entry?.isIntersecting)
    }, { threshold: 0.05 })
    observer.observe(root)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const root = rootRef.current
    const stage = stageRef.current
    const surface = root?.parentElement
    if (!root || !stage || !surface) return

    let frame = 0
    let targetX = 0
    let targetY = 0
    let smoothX = 0
    let smoothY = 0
    let bounds = surface.getBoundingClientRect()

    const refreshBounds = () => {
      bounds = surface.getBoundingClientRect()
    }

    const render = () => {
      frame = 0
      smoothX += (targetX - smoothX) * 0.09
      smoothY += (targetY - smoothY) * 0.09
      stage.style.setProperty('--ambient-shift-x', `${smoothX * 18}px`)
      stage.style.setProperty('--ambient-shift-y', `${smoothY * 12}px`)
      stage.style.setProperty('--ambient-tilt-x', `${smoothY * -2.2}deg`)
      stage.style.setProperty('--ambient-tilt-y', `${smoothX * 2.8}deg`)

      const unsettled = Math.abs(targetX - smoothX) > 0.002 || Math.abs(targetY - smoothY) > 0.002
      if (unsettled && !document.hidden) frame = requestAnimationFrame(render)
    }

    const scheduleRender = () => {
      if (!frame && !resolvedReducedMotion && !document.hidden) frame = requestAnimationFrame(render)
    }

    const onPointerMove = (event: PointerEvent) => {
      const width = Math.max(1, bounds.width)
      const height = Math.max(1, bounds.height)
      const cursorX = event.clientX - bounds.left
      const cursorY = event.clientY - bounds.top
      targetX = cursorX / width * 2 - 1
      targetY = cursorY / height * 2 - 1
      root.style.setProperty('--ambient-cursor-x', `${cursorX}px`)
      root.style.setProperty('--ambient-cursor-y', `${cursorY}px`)
      root.dataset.pointer = 'true'
      scheduleRender()
    }

    const onPointerLeave = () => {
      targetX = 0
      targetY = 0
      root.dataset.pointer = 'false'
      scheduleRender()
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame)
        frame = 0
      } else {
        scheduleRender()
      }
    }

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(refreshBounds)

    if (resolvedReducedMotion || subdued) {
      stage.style.setProperty('--ambient-shift-x', '0px')
      stage.style.setProperty('--ambient-shift-y', '0px')
      stage.style.setProperty('--ambient-tilt-x', '0deg')
      stage.style.setProperty('--ambient-tilt-y', '0deg')
      root.dataset.pointer = 'false'
    } else {
      surface.addEventListener('pointermove', onPointerMove)
      surface.addEventListener('pointerleave', onPointerLeave)
      document.addEventListener('visibilitychange', onVisibilityChange)
      resizeObserver?.observe(surface)
    }

    return () => {
      cancelAnimationFrame(frame)
      surface.removeEventListener('pointermove', onPointerMove)
      surface.removeEventListener('pointerleave', onPointerLeave)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      resizeObserver?.disconnect()
      root.dataset.pointer = 'false'
    }
  }, [resolvedReducedMotion, subdued])

  return (
    <div
      ref={rootRef}
      className="desktop-ambient"
      data-pointer="false"
      data-scene="agent-constellation"
      data-cinematic-cycle="14000"
      data-offscreen="false"
      data-story-duration="14000"
      data-story-mode={resolvedReducedMotion ? 'poster' : 'sequence'}
      data-subdued={subdued}
      data-reduced-motion={resolvedReducedMotion}
      data-testid="desktop-ambient"
      aria-hidden="true"
    >
      <span className="desktop-ambient__backdrop" />
      <span className="desktop-ambient__cursor-glow" />
      <div ref={stageRef} className="desktop-ambient__stage">
        <span className="desktop-ambient__grid" />
        <span className="desktop-ambient__sweep" />
        <span className="desktop-ambient__ring desktop-ambient__ring--outer" />
        <span className="desktop-ambient__ring desktop-ambient__ring--middle" />
        <span className="desktop-ambient__ring desktop-ambient__ring--inner" />

        <span className="desktop-ambient__story" data-agent-story>
          <span className="desktop-ambient__story-token desktop-ambient__story-token--evidence" data-story-step="evidence">
            <i />Evidence
          </span>
          <span className="desktop-ambient__story-token desktop-ambient__story-token--jd" data-story-step="jd">
            <i />Target JD
          </span>
          <span
            className="desktop-ambient__story-token desktop-ambient__story-token--variant"
            data-story-step="resume-variant"
            data-story-output="resume-variant"
          >
            <span className="desktop-ambient__variant-document"><i /><i /><i /></span>
            <strong>Resume Variant</strong>
            <small>Master unchanged</small>
          </span>
        </span>

        <span className="desktop-ambient__story-status" data-story-statuses>
          {storyStatuses.map((status) => (
            <span
              key={status.id}
              data-story-status={status.id}
              style={ambientStyle({ '--story-status-delay': `${status.delay}s` })}
            >{status.label}</span>
          ))}
        </span>

        {particles.map(([x, y, size, delay, duration]) => (
          <span
            key={`${x}-${y}`}
            className="desktop-ambient__particle"
            style={ambientStyle({
              '--particle-x': `${x}%`,
              '--particle-y': `${y}%`,
              '--particle-size': `${size}px`,
              '--particle-delay': `${delay}s`,
              '--particle-duration': `${duration}s`
            })}
          />
        ))}

        {ambientAgents.map((agent) => (
          <span
            key={`route-${agent.appId}`}
            className="desktop-ambient__route"
            data-story-route={agent.storyRole}
            style={ambientStyle({
              '--route-angle': `${agent.routeAngle}deg`,
              '--route-length': `${agent.routeLength}%`,
              '--route-arc': `${agent.routeArc}px`,
              '--route-color': agent.color,
              '--route-delay': `${agent.delay}s`,
              '--story-delay': `${storyDelays[agent.storyRole]}s`
            })}
          >
            <span className="desktop-ambient__route-stream" />
            <span className="desktop-ambient__packet desktop-ambient__packet--lead" />
            <span className="desktop-ambient__packet desktop-ambient__packet--trail" />
          </span>
        ))}

        <span className="desktop-ambient__core" data-agent-core>
          <span className="desktop-ambient__core-ring desktop-ambient__core-ring--one" />
          <span className="desktop-ambient__core-ring desktop-ambient__core-ring--two" />
          <span className="desktop-ambient__core-ring desktop-ambient__core-ring--three" />
          <span className="desktop-ambient__core-inner">
            <Sparkles size={29} strokeWidth={1.5} />
          </span>
        </span>

        {ambientAgents.map((agent) => (
          <span
            key={agent.appId}
            className="desktop-ambient__agent"
            data-agent-node
            data-ambient-app={agent.appId}
            data-story-role={agent.storyRole}
            data-label-side={agent.labelSide}
            style={ambientStyle({
              '--agent-x': `${agent.x}%`,
              '--agent-y': `${agent.y}%`,
              '--agent-color': agent.color,
              '--agent-delay': `${agent.delay}s`,
              '--story-delay': `${storyDelays[agent.storyRole]}s`
            })}
          >
            <span className="desktop-ambient__agent-body">
              <span className="desktop-ambient__agent-halo" />
              <AppIcon app={appRegistry[agent.appId]} size={19} />
            </span>
            <span className="desktop-ambient__agent-copy">
              <span className="desktop-ambient__agent-heading">
                <span>{agent.number}</span>
                <strong>{agent.label}</strong>
              </span>
              <small><i />{agent.status}</small>
            </span>
          </span>
        ))}

        <div className="desktop-ambient__pipeline" data-agent-phase-rail>
          <ol>
            {phases.map((phase, index) => (
              <li
                key={phase.id}
                data-agent-phase={phase.id}
                data-story-index={index}
                style={ambientStyle({
                  '--phase-color': phase.color,
                  '--phase-delay': `${phase.delay}s`
                })}
              >
                <span>{phase.label}</span>
                <i />
              </li>
            ))}
          </ol>
          <p><span>Orchestration active</span><i /><span>6 agents online</span></p>
        </div>
      </div>
    </div>
  )
}
