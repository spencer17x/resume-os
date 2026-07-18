import { describe, expect, it } from 'vitest'
import type { ResumeData } from '@/lib/resume-model'
import { createProjectPresentations } from './presentation-projects'

type ResumeProject = ResumeData['projects'][number]

function project(overrides: Partial<ResumeProject> = {}): ResumeProject {
  return {
    id: '',
    name: 'Agent Console',
    type: 'Platform',
    tags: ['React', 'RAG'],
    summary: 'Operates agent workflows.',
    highlights: ['Reduced response time.'],
    ...overrides
  }
}

describe('createProjectPresentations', () => {
  it('keeps fallback keys stable when unrelated projects are inserted or reordered', () => {
    const alpha = project({ id: 'duplicate', name: 'Alpha Console', summary: 'Alpha summary.' })
    const beta = project({ id: 'duplicate', name: 'Beta Console', summary: 'Beta summary.' })
    const unrelated = project({ name: 'Unrelated Tool', summary: 'Unrelated summary.' })

    const original = createProjectPresentations([alpha, beta])
    const changed = createProjectPresentations([unrelated, beta, alpha])
    const originalKeys = new Map(original.map(({ key, project: item }) => [item.name, key]))
    const changedKeys = new Map(changed.map(({ key, project: item }) => [item.name, key]))

    expect(changedKeys.get('Alpha Console')).toBe(originalKeys.get('Alpha Console'))
    expect(changedKeys.get('Beta Console')).toBe(originalKeys.get('Beta Console'))
  })

  it('prefers unique nonempty ids and disambiguates only identical content fingerprints by occurrence', () => {
    const identical = project({ name: 'Repeated Project' })
    const projects = [
      project({ id: 'kept-id', name: 'ID Project' }),
      identical,
      { ...identical },
      project({ name: 'Repeated Project', summary: 'Different stable content.' })
    ]

    const presentations = createProjectPresentations(projects)

    expect(presentations[0].key).toBe('kept-id')
    expect(presentations[1].key).toMatch(/^project-repeated-project-[a-z0-9]+$/)
    expect(presentations[2].key).toBe(`${presentations[1].key}-2`)
    expect(presentations[3].key).not.toBe(presentations[1].key)
    expect(presentations[3].key).not.toBe(`${presentations[1].key}-2`)
  })

  it('does not mutate project data while deriving presentation keys', () => {
    const projects = [project(), project({ id: 'duplicate' }), project({ id: 'duplicate' })]
    const before = structuredClone(projects)

    createProjectPresentations(projects)

    expect(projects).toEqual(before)
  })
})
