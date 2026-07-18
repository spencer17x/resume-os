'use client'

import { Html, RoundedBox } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { ResumeSceneNodeData } from './resume-scene'

const NODE_COLORS: Record<ResumeSceneNodeData['section'], string> = {
  experience: '#1dd6bd',
  project: '#ff927c',
  skill: '#e7c56d'
}

const VISUAL_LABEL_LENGTH = 28

export function shortVisualNodeLabel(value: string) {
  const characters = Array.from(value)
  if (characters.length <= VISUAL_LABEL_LENGTH) return value
  return `${characters.slice(0, VISUAL_LABEL_LENGTH - 3).join('')}...`
}

export function ResumeNode({
  node,
  position,
  selected,
  interactiveLabel,
  onSelect
}: {
  node: ResumeSceneNodeData
  position: [number, number, number]
  selected: boolean
  interactiveLabel: boolean
  onSelect(node: ResumeSceneNodeData): void
}) {
  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    onSelect(node)
  }

  return (
    <group position={position}>
      <RoundedBox
        args={[2.45, 0.92, 0.2]}
        radius={0.1}
        smoothness={4}
        onClick={select}
        onPointerOver={(event) => {
          event.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => { document.body.style.cursor = '' }}
        scale={selected ? 1.08 : 1}
        name={`resume-node-${node.id}`}
      >
        <meshStandardMaterial
          color={selected ? '#f4fbff' : NODE_COLORS[node.section]}
          emissive={NODE_COLORS[node.section]}
          emissiveIntensity={selected ? 0.28 : 0.08}
          metalness={0.16}
          roughness={0.4}
        />
      </RoundedBox>
      <Html center position={[0, 0, 0.28]} distanceFactor={12} occlude={false}>
        {interactiveLabel ? (
          <button
            type="button"
            className="resume-3d-node-label"
            data-node-id={node.id}
            data-selected={selected ? 'true' : 'false'}
            onClick={() => onSelect(node)}
            aria-label={node.label}
          >
            <span>{node.sectionLabel}</span>
            <strong>{node.label}</strong>
          </button>
        ) : (
          <div
            className="resume-3d-node-label"
            data-node-id={node.id}
            data-selected={selected ? 'true' : 'false'}
            tabIndex={-1}
            aria-hidden="true"
          >
            <span>{node.sectionLabel}</span>
            <strong>{shortVisualNodeLabel(node.label)}</strong>
          </div>
        )}
      </Html>
    </group>
  )
}
