import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeResumeData } from '@/lib/resume-model'
import {
  createResumeSceneIdentitySession,
  createResumeSceneRawNodes,
  layoutResumeSceneNodes,
  reconcileResumeSceneNodes,
  resolveResumeSceneSelection,
  type ResumeSceneNodeData
} from '@/components/resume-3d/resume-scene'
import { shortVisualNodeLabel } from '@/components/resume-3d/resume-node'

const REQUIRED_CARD_BOUNDS = { width: 3.8, height: 1.35, depth: 0.3 }

function denseNodes(): ResumeSceneNodeData[] {
  return (['experience', 'project', 'skill'] as const).flatMap((section) => (
    Array.from({ length: 12 }, (_, index) => ({
      id: `${section}-${index}`,
      section,
      sectionLabel: section,
      label: `${section} ${index}`,
      detail: `Detailed ${section} ${index}`,
      meta: `Meta ${index}`
    }))
  ))
}

function expectCollisionFree(layout: ReturnType<typeof layoutResumeSceneNodes>) {
  for (let leftIndex = 0; leftIndex < layout.items.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < layout.items.length; rightIndex += 1) {
      const left = layout.items[leftIndex].position
      const right = layout.items[rightIndex].position
      const separated = (
        Math.abs(left[0] - right[0]) >= REQUIRED_CARD_BOUNDS.width
        || Math.abs(left[1] - right[1]) >= REQUIRED_CARD_BOUNDS.height
        || Math.abs(left[2] - right[2]) >= REQUIRED_CARD_BOUNDS.depth
      )
      expect(separated, `${layout.items[leftIndex].node.id} overlaps ${layout.items[rightIndex].node.id}`).toBe(true)
    }
  }
}

function expectInitiallyFramed(layout: ReturnType<typeof layoutResumeSceneNodes>, aspect: number) {
  const verticalHalfFov = layout.camera.fov * Math.PI / 360
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect)
  for (const item of layout.items) {
    const depth = layout.camera.position[2] - item.position[2]
    const maxX = depth * Math.tan(horizontalHalfFov)
    const maxY = depth * Math.tan(verticalHalfFov)
    expect(Math.abs(item.position[0] - layout.camera.target[0]) + REQUIRED_CARD_BOUNDS.width / 2).toBeLessThanOrEqual(maxX)
    expect(Math.abs(item.position[1] - layout.camera.target[1]) + REQUIRED_CARD_BOUNDS.height / 2).toBeLessThanOrEqual(maxY)
  }
}

function resumeWithDuplicateData() {
  return normalizeResumeData({
    profile: { name: 'Ada', title: 'Engineer', summary: [], tags: [], links: [] },
    skills: [
      { group: '', items: ['TypeScript', 'TypeScript'] },
      { group: '', items: [] }
    ],
    experiences: [
      { company: '', role: 'Engineer', period: '', tags: [], bullets: [] },
      { company: '', role: 'Engineer', period: '', tags: [], bullets: [] }
    ],
    projects: [
      { id: '', name: '', type: '', tags: [], summary: 'First', highlights: [] },
      { id: '', name: '', type: '', tags: [], summary: 'Second', highlights: [] }
    ],
    education: [], certifications: [], awards: [], languages: [], openSource: [],
    metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-13T00:00:00.000Z' }
  })
}

describe('Resume 3D data and loading contract', () => {
  it('allocates unique monotonic IDs for duplicate and adversarial legacy-hash content', () => {
    const data = resumeWithDuplicateData()
    data.projects[0].name = 'collision-1gn1ze4-14qr'
    data.projects[1].name = 'collision-4jaqmv-1ujk'
    data.projects[0].summary = 'detail'
    data.projects[1].summary = 'detail'
    data.projects[0].type = 'meta'
    data.projects[1].type = 'meta'
    const originalData = structuredClone(data)
    expect(legacyHash('project\0collision-1gn1ze4-14qr\0detail\0meta'))
      .toBe(legacyHash('project\0collision-4jaqmv-1ujk\0detail\0meta'))

    const result = reconcileResumeSceneNodes(
      createResumeSceneIdentitySession(),
      'resume-a',
      createResumeSceneRawNodes(data, 'en')
    )

    expect(new Set(result.nodes.map((node) => node.id)).size).toBe(result.nodes.length)
    expect(result.nodes.map((node) => node.section)).toEqual([
      'experience', 'experience', 'project', 'project', 'skill', 'skill'
    ])
    expect(result.nodes.map((node) => node.id)).toEqual([
      'node-1', 'node-2', 'node-3', 'node-4', 'node-5', 'node-6'
    ])
    expect(result.nodes.every((node) => node.label.trim().length > 0)).toBe(true)
    expect(data).toEqual(originalData)
  })

  it('preserves node IDs when resume sections reorder', () => {
    const data = resumeWithDuplicateData()
    data.experiences[0].company = 'Alpha'
    data.experiences[1].company = 'Beta'
    const first = reconcileResumeSceneNodes(
      createResumeSceneIdentitySession(),
      'resume-a',
      createResumeSceneRawNodes(data, 'en')
    )
    const ids = new Map(first.nodes.map((node) => [node.label, node.id]))

    data.experiences.reverse()
    const reordered = reconcileResumeSceneNodes(first.session, 'resume-a', createResumeSceneRawNodes(data, 'en'))
    expect(reordered.nodes.find((node) => node.label.startsWith('Alpha'))?.id).toBe(ids.get('Alpha · Engineer'))
    expect(reordered.nodes.find((node) => node.label.startsWith('Beta'))?.id).toBe(ids.get('Beta · Engineer'))
  })

  it('allocates a fresh ID for insertion while preserving shifted existing nodes', () => {
    const data = resumeWithDuplicateData()
    data.experiences[0].company = 'Alpha'
    data.experiences[1].company = 'Beta'
    const first = reconcileResumeSceneNodes(
      createResumeSceneIdentitySession(),
      'resume-a',
      createResumeSceneRawNodes(data, 'en')
    )
    const ids = new Map(first.nodes.map((node) => [node.label, node.id]))

    data.experiences.unshift({ company: 'Inserted', role: 'Engineer', period: '', location: '', tags: [], bullets: [] })
    const inserted = reconcileResumeSceneNodes(first.session, 'resume-a', createResumeSceneRawNodes(data, 'en'))
    expect(inserted.nodes.find((node) => node.label.startsWith('Alpha'))?.id).toBe(ids.get('Alpha · Engineer'))
    expect(inserted.nodes.find((node) => node.label.startsWith('Beta'))?.id).toBe(ids.get('Beta · Engineer'))
    const newId = inserted.nodes.find((node) => node.label.startsWith('Inserted'))?.id
    expect(newId).toBe('node-7')
    expect([...ids.values()]).not.toContain(newId)
  })

  it('preserves identity for a content edit at the same section source index', () => {
    const data = resumeWithDuplicateData()
    data.projects[0].name = 'Before edit'
    const first = reconcileResumeSceneNodes(
      createResumeSceneIdentitySession(),
      'resume-a',
      createResumeSceneRawNodes(data, 'en')
    )
    const originalId = first.nodes.find((node) => node.label === 'Before edit')?.id

    data.projects[0].name = 'After edit'
    const edited = reconcileResumeSceneNodes(first.session, 'resume-a', createResumeSceneRawNodes(data, 'en'))
    expect(edited.nodes.find((node) => node.label === 'After edit')?.id).toBe(originalId)
  })

  it('retains selection for surviving nodes and deterministically falls back after deletion', () => {
    const data = resumeWithDuplicateData()
    data.projects[1].name = 'Selected project'
    const first = reconcileResumeSceneNodes(
      createResumeSceneIdentitySession(),
      'resume-a',
      createResumeSceneRawNodes(data, 'en')
    )
    const selectedId = first.nodes.find((node) => node.label === 'Selected project')?.id ?? null
    expect(resolveResumeSceneSelection(first.nodes, selectedId)).toBe(selectedId)

    data.projects.pop()
    const deleted = reconcileResumeSceneNodes(first.session, 'resume-a', createResumeSceneRawNodes(data, 'en'))
    expect(deleted.nodes.some((node) => node.id === selectedId)).toBe(false)
    expect(resolveResumeSceneSelection(deleted.nodes, selectedId)).toBe(deleted.nodes[0]?.id)
    expect(resolveResumeSceneSelection([], selectedId)).toBeNull()

    data.projects.push({ id: '', name: 'New project', type: '', tags: [], summary: '', highlights: [] })
    const added = reconcileResumeSceneNodes(deleted.session, 'resume-a', createResumeSceneRawNodes(data, 'en'))
    expect(added.nodes.find((node) => node.label === 'New project')?.id).not.toBe(selectedId)
  })

  it('pre-truncates visual-only Canvas labels without changing short labels', () => {
    const token = `TOKEN_${'x'.repeat(314)}`
    expect(shortVisualNodeLabel('Short label')).toBe('Short label')
    expect(shortVisualNodeLabel(token)).toHaveLength(28)
    expect(shortVisualNodeLabel(token)).toMatch(/\.\.\.$/)
  })

  it('lays out twelve nodes per category without pairwise card or label collisions', () => {
    const nodes = denseNodes()
    const desktop = layoutResumeSceneNodes(nodes, { aspect: 1038 / 666, compact: false })
    const compact = layoutResumeSceneNodes(nodes, { aspect: 375 / 340, compact: true })

    expect(desktop).toEqual(layoutResumeSceneNodes(nodes, { aspect: 1038 / 666, compact: false }))
    expect(desktop.items).toHaveLength(36)
    expect(compact.items).toHaveLength(36)
    expectCollisionFree(desktop)
    expectCollisionFree(compact)
  })

  it('computes bounds, target, and camera distance that frame every dense node initially', () => {
    const nodes = denseNodes()
    for (const options of [
      { aspect: 1038 / 666, compact: false },
      { aspect: 375 / 340, compact: true }
    ]) {
      const layout = layoutResumeSceneNodes(nodes, options)
      expect(layout.camera.target).toEqual(layout.bounds.center)
      expect(layout.bounds.size[0]).toBeGreaterThan(REQUIRED_CARD_BOUNDS.width)
      expect(layout.bounds.size[1]).toBeGreaterThan(REQUIRED_CARD_BOUNDS.height)
      expectInitiallyFramed(layout, options.aspect)
    }
  })

  it('keeps Canvas out of the root AppLoader bundle and declares an ssr-free dynamic boundary', () => {
    const loader = readFileSync('components/desktop/app-loader.tsx', 'utf8')
    expect(loader).toContain("import dynamic from 'next/dynamic'")
    expect(loader).toMatch(/import\(['"]@\/components\/apps\/resume-3d-app['"]\)/)
    expect(loader).toMatch(/ssr:\s*false/)
    expect(loader).not.toMatch(/import\s+\{?\s*Resume3DApp/)
    expect(loader).not.toContain('Canvas')
  })

  it('provides explicit context-loss, visibility, frame-loop, and DOM fallback hooks', () => {
    const app = readFileSync('components/apps/resume-3d-app.tsx', 'utf8')
    const scene = readFileSync('components/resume-3d/resume-scene.tsx', 'utf8')
    expect(app).toContain('visibilitychange')
    expect(app).toContain('resume-3d__fallback')
    expect(scene).toContain('webglcontextlost')
    expect(scene).toContain("active ? 'demand' : 'never'")
    expect(scene).toContain('invalidate()')
    expect(scene).toContain('[active, compact, invalidate, layout, nodes, selectedId]')
    expect(scene).not.toContain('preserveDrawingBuffer')
    expect(scene).toContain('OrbitControls')
    expect(scene).toContain('PerspectiveCamera')
  })
})

function legacyHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
