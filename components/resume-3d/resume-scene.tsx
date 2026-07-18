'use client'

import { Environment, Lightformer, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import type { Locale } from '@/i18n/routing'
import type { ResumeData } from '@/lib/resume-model'
import { ResumeNode } from './resume-node'

export type ResumeSceneSection = 'experience' | 'project' | 'skill'

export type ResumeSceneNodeData = {
  id: string
  section: ResumeSceneSection
  sectionLabel: string
  label: string
  detail: string
  meta: string
}

export type ResumeSceneRawNodeData = Omit<ResumeSceneNodeData, 'id'> & {
  sourceIndex: number
  stableSignature: string
}

type ResumeSceneIdentityRecord = {
  id: string
  section: ResumeSceneSection
  sourceIndex: number
  stableSignature: string
}

export type ResumeSceneIdentitySession = {
  nextId: number
  documents: ReadonlyMap<string, ResumeSceneIdentityRecord[]>
}

type Point3 = [number, number, number]

export type ResumeSceneLayout = {
  items: Array<{ node: ResumeSceneNodeData; position: Point3 }>
  bounds: { min: Point3; max: Point3; center: Point3; size: Point3 }
  camera: { position: Point3; target: Point3; fov: number; near: number; far: number; distance: number }
}

const SECTION_ORDER: ResumeSceneSection[] = ['experience', 'project', 'skill']
const SECTION_DEPTH: Record<ResumeSceneSection, number> = { experience: 0.3, project: 0, skill: -0.3 }
const NODE_BOUNDS = { width: 3.8, height: 1.35, depth: 0.3 }
const NODE_STEP = { x: 4.2, y: 1.65 }
const SECTION_GAP = 2.4
const CAMERA_FOV = 48

export function createResumeSceneRawNodes(data: ResumeData, locale: Locale): ResumeSceneRawNodeData[] {
  const sectionLabels = locale === 'zh'
    ? { experience: '经历', project: '项目', skill: '技能' }
    : { experience: 'Experience', project: 'Project', skill: 'Skill' }
  const untitled = locale === 'zh' ? '未命名' : 'Untitled'
  const nodes: ResumeSceneRawNodeData[] = []

  data.experiences.forEach((item, index) => nodes.push({
    section: 'experience',
    sourceIndex: index,
    stableSignature: stableNodeSignature('experience', item),
    sectionLabel: sectionLabels.experience,
    label: [item.company, item.role].filter(Boolean).join(' · ') || untitled,
    detail: item.bullets.join(' ') || (locale === 'zh' ? '暂无经历详情。' : 'No experience details yet.'),
    meta: [item.period, item.location].filter(Boolean).join(' · ')
  }))
  data.projects.forEach((item, index) => nodes.push({
    section: 'project',
    sourceIndex: index,
    stableSignature: stableNodeSignature('project', item),
    sectionLabel: sectionLabels.project,
    label: item.name || untitled,
    detail: item.summary || item.highlights.join(' ') || (locale === 'zh' ? '暂无项目详情。' : 'No project details yet.'),
    meta: [item.type, ...item.tags].filter(Boolean).join(' · ')
  }))
  data.skills.forEach((group, index) => nodes.push({
    section: 'skill',
    sourceIndex: index,
    stableSignature: stableNodeSignature('skill', group),
    sectionLabel: sectionLabels.skill,
    label: group.group || untitled,
    detail: group.items.filter(Boolean).join(' · ') || (locale === 'zh' ? '暂无技能项。' : 'No skill items yet.'),
    meta: group.items.slice(0, 3).filter(Boolean).join(' · ')
  }))

  return nodes
}

export function createResumeSceneIdentitySession(): ResumeSceneIdentitySession {
  return { nextId: 1, documents: new Map() }
}

export function reconcileResumeSceneNodes(
  session: ResumeSceneIdentitySession,
  documentId: string,
  rawNodes: ResumeSceneRawNodeData[]
): { session: ResumeSceneIdentitySession; nodes: ResumeSceneNodeData[] } {
  const previous = session.documents.get(documentId) ?? []
  const assignments: Array<string | undefined> = new Array(rawNodes.length)
  const matchedPrevious = new Set<number>()

  matchPreviousNodes(rawNodes, previous, assignments, matchedPrevious, (raw, record) => (
    raw.section === record.section && raw.stableSignature === record.stableSignature
  ))
  matchPreviousNodes(rawNodes, previous, assignments, matchedPrevious, (raw, record) => (
    raw.section === record.section && raw.sourceIndex === record.sourceIndex
  ))

  const usedIds = new Set([...session.documents.values()].flatMap((records) => records.map((record) => record.id)))
  let nextId = session.nextId
  for (let index = 0; index < assignments.length; index += 1) {
    if (assignments[index]) continue
    let id = `node-${nextId}`
    nextId += 1
    while (usedIds.has(id)) {
      id = `node-${nextId}`
      nextId += 1
    }
    assignments[index] = id
    usedIds.add(id)
  }

  const records = rawNodes.map((raw, index) => ({
    id: assignments[index] as string,
    section: raw.section,
    sourceIndex: raw.sourceIndex,
    stableSignature: raw.stableSignature
  }))
  const documents = new Map(session.documents)
  documents.set(documentId, records)
  const nodes = rawNodes.map((raw, index) => {
    const { sourceIndex: _sourceIndex, stableSignature: _stableSignature, ...node } = raw
    return { ...node, id: assignments[index] as string }
  })

  return { session: { nextId, documents }, nodes }
}

export function resolveResumeSceneSelection(nodes: ResumeSceneNodeData[], requestedId: string | null) {
  if (requestedId && nodes.some((node) => node.id === requestedId)) return requestedId
  return nodes[0]?.id ?? null
}

function matchPreviousNodes(
  rawNodes: ResumeSceneRawNodeData[],
  previous: ResumeSceneIdentityRecord[],
  assignments: Array<string | undefined>,
  matchedPrevious: Set<number>,
  matches: (raw: ResumeSceneRawNodeData, record: ResumeSceneIdentityRecord) => boolean
) {
  rawNodes.forEach((raw, rawIndex) => {
    if (assignments[rawIndex]) return
    const previousIndex = previous.findIndex((record, index) => !matchedPrevious.has(index) && matches(raw, record))
    if (previousIndex < 0) return
    assignments[rawIndex] = previous[previousIndex].id
    matchedPrevious.add(previousIndex)
  })
}

function stableNodeSignature(section: ResumeSceneSection, value: unknown) {
  return `${section}\u0000${JSON.stringify(value)}`
}

export function layoutResumeSceneNodes(
  nodes: ResumeSceneNodeData[],
  options: { aspect: number; compact: boolean }
): ResumeSceneLayout {
  const sections = SECTION_ORDER.map((section) => {
    const sectionNodes = nodes.filter((node) => node.section === section)
    const columns = Math.max(1, Math.min(3, sectionNodes.length))
    const rows = Math.max(1, Math.ceil(sectionNodes.length / columns))
    return {
      section,
      nodes: sectionNodes,
      columns,
      rows,
      width: (columns - 1) * NODE_STEP.x + NODE_BOUNDS.width,
      height: (rows - 1) * NODE_STEP.y + NODE_BOUNDS.height
    }
  }).filter((section) => section.nodes.length > 0)

  const sectionCenters = new Map<ResumeSceneSection, Point3>()
  let cursor = 0
  for (const section of sections) {
    const extent = options.compact ? section.height : section.width
    const center = cursor + extent / 2
    sectionCenters.set(section.section, options.compact
      ? [0, -center, SECTION_DEPTH[section.section]]
      : [center, 0, SECTION_DEPTH[section.section]])
    cursor += extent + SECTION_GAP
  }
  const occupiedExtent = Math.max(0, cursor - SECTION_GAP)
  const centerOffset = occupiedExtent / 2

  const items = sections.flatMap((section) => {
    const sectionCenter = sectionCenters.get(section.section) ?? [0, 0, 0]
    return section.nodes.map((node, index) => {
      const column = index % section.columns
      const row = Math.floor(index / section.columns)
      const localX = (column - (section.columns - 1) / 2) * NODE_STEP.x
      const localY = ((section.rows - 1) / 2 - row) * NODE_STEP.y
      return {
        node,
        position: [
          sectionCenter[0] + localX - (options.compact ? 0 : centerOffset),
          sectionCenter[1] + localY + (options.compact ? centerOffset : 0),
          sectionCenter[2]
        ] as Point3
      }
    })
  })

  const bounds = sceneBounds(items.map((item) => item.position))
  const aspect = Math.max(0.25, Math.min(4, options.aspect || 1))
  const verticalHalfFov = CAMERA_FOV * Math.PI / 360
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect)
  const horizontalDistance = (bounds.size[0] / 2 + 1.2) / Math.tan(horizontalHalfFov)
  const verticalDistance = (bounds.size[1] / 2 + 1.2) / Math.tan(verticalHalfFov)
  const distance = Math.max(horizontalDistance, verticalDistance) + bounds.size[2] / 2 + 1
  const target = bounds.center
  const position: Point3 = [target[0], target[1], bounds.max[2] + distance]

  return {
    items,
    bounds,
    camera: {
      position,
      target,
      fov: CAMERA_FOV,
      near: 0.1,
      far: Math.max(80, distance + bounds.size[2] + 30),
      distance
    }
  }
}

function sceneBounds(positions: Point3[]): ResumeSceneLayout['bounds'] {
  if (positions.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], size: [0, 0, 0] }
  }
  const min: Point3 = [Infinity, Infinity, Infinity]
  const max: Point3 = [-Infinity, -Infinity, -Infinity]
  for (const position of positions) {
    min[0] = Math.min(min[0], position[0] - NODE_BOUNDS.width / 2)
    min[1] = Math.min(min[1], position[1] - NODE_BOUNDS.height / 2)
    min[2] = Math.min(min[2], position[2] - NODE_BOUNDS.depth / 2)
    max[0] = Math.max(max[0], position[0] + NODE_BOUNDS.width / 2)
    max[1] = Math.max(max[1], position[1] + NODE_BOUNDS.height / 2)
    max[2] = Math.max(max[2], position[2] + NODE_BOUNDS.depth / 2)
  }
  const size: Point3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const center: Point3 = [min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2]
  return { min, max, center, size }
}

export function ResumeScene({
  nodes,
  selectedId,
  active,
  reducedMotion,
  automaticCamera,
  compact,
  interactiveLabels,
  sceneLabel,
  onSelect,
  onReady,
  onContextLost
}: {
  nodes: ResumeSceneNodeData[]
  selectedId: string | null
  active: boolean
  reducedMotion: boolean
  automaticCamera: boolean
  compact: boolean
  interactiveLabels: boolean
  sceneLabel: string
  onSelect(node: ResumeSceneNodeData): void
  onReady(): void
  onContextLost(): void
}) {
  const shouldAnimate = active && !reducedMotion && !compact && automaticCamera
  const frameLoop = shouldAnimate ? 'always' : active ? 'demand' : 'never'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  return (
    <Canvas
      className="resume-3d__canvas"
      dpr={[1, 1.75]}
      frameloop={frameLoop}
      gl={{ alpha: false, antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        canvasRef.current = gl.domElement
        gl.setClearColor('#07111c', 1)
        gl.domElement.dataset.frameCount = '0'
        gl.domElement.dataset.drawCalls = '0'
        gl.domElement.dataset.frameLoop = frameLoop
        onReady()
      }}
      data-frame-loop={frameLoop}
      data-auto-rotate={shouldAnimate ? 'true' : 'false'}
      aria-label={sceneLabel}
    >
      <ContextLossListener onContextLost={onContextLost} />
      <FrameMonitor canvasRef={canvasRef} frameLoop={frameLoop} />
      <SceneContent
        nodes={nodes}
        selectedId={selectedId}
        active={active}
        shouldAnimate={shouldAnimate}
        compact={compact}
        interactiveLabels={interactiveLabels}
        onSelect={onSelect}
      />
    </Canvas>
  )
}

function SceneContent({
  nodes,
  selectedId,
  active,
  shouldAnimate,
  compact,
  interactiveLabels,
  onSelect
}: {
  nodes: ResumeSceneNodeData[]
  selectedId: string | null
  active: boolean
  shouldAnimate: boolean
  compact: boolean
  interactiveLabels: boolean
  onSelect(node: ResumeSceneNodeData): void
}) {
  const size = useThree((state) => state.size)
  const invalidate = useThree((state) => state.invalidate)
  const layout = useMemo(
    () => layoutResumeSceneNodes(nodes, { aspect: size.width / Math.max(1, size.height), compact }),
    [compact, nodes, size.height, size.width]
  )
  const gridSize = Math.max(18, Math.ceil(Math.max(layout.bounds.size[0], layout.bounds.size[1]) + 6))

  useEffect(() => {
    if (active) invalidate()
  }, [active, compact, invalidate, layout, nodes, selectedId])

  return (
    <>
      <PerspectiveCamera
        makeDefault
        position={layout.camera.position}
        fov={layout.camera.fov}
        near={layout.camera.near}
        far={layout.camera.far}
      />
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 7, 8]} intensity={2.2} color="#d9f7ff" />
      <directionalLight position={[-5, 2, 4]} intensity={1.4} color="#ffb7a8" />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={2.6} position={[0, 5, -4]} scale={[10, 3, 1]} color="#b7f7ea" />
        <Lightformer form="ring" intensity={1.5} position={[-5, 0, 2]} scale={3} color="#e7c56d" />
      </Environment>
      <gridHelper
        args={[gridSize, Math.min(60, gridSize), '#26384d', '#142334']}
        position={[layout.camera.target[0], layout.bounds.min[1] - 1.6, layout.bounds.min[2] - 0.4]}
      />
      {layout.items.map(({ node, position }) => (
        <ResumeNode
          key={node.id}
          node={node}
          position={position}
          selected={selectedId === node.id}
          interactiveLabel={interactiveLabels}
          onSelect={onSelect}
        />
      ))}
      <OrbitControls
        makeDefault
        target={layout.camera.target}
        enableDamping={shouldAnimate}
        enablePan={false}
        minDistance={Math.max(5, layout.camera.distance * 0.65)}
        maxDistance={layout.camera.distance * 1.8}
        minPolarAngle={0.65}
        maxPolarAngle={2.1}
        autoRotate={shouldAnimate}
        autoRotateSpeed={0.35}
      />
    </>
  )
}

function FrameMonitor({
  canvasRef,
  frameLoop
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  frameLoop: 'always' | 'demand' | 'never'
}) {
  const invalidate = useThree((state) => state.invalidate)
  const frameCount = useRef(0)
  const drawCalls = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) canvas.dataset.frameLoop = frameLoop
    if (frameLoop !== 'never') invalidate()
  }, [canvasRef, frameLoop, invalidate])

  useFrame(({ gl }) => {
    frameCount.current += 1
    drawCalls.current += gl.info.render.calls
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.dataset.frameCount = String(frameCount.current)
    canvas.dataset.drawCalls = String(drawCalls.current)
  })

  return null
}

function ContextLossListener({ onContextLost }: { onContextLost(): void }) {
  const gl = useThree((state) => state.gl)

  useEffect(() => {
    const canvas = gl.domElement
    const handleContextLost = (event: Event) => {
      event.preventDefault()
      onContextLost()
    }
    canvas.addEventListener('webglcontextlost', handleContextLost)
    return () => canvas.removeEventListener('webglcontextlost', handleContextLost)
  }, [gl, onContextLost])

  return null
}
