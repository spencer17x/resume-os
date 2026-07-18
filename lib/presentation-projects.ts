import type { ResumeData } from '@/lib/resume-model'

type ResumeProject = ResumeData['projects'][number]

export type PresentationProject = {
  key: string
  index: number
  project: ResumeProject
}

export function createProjectPresentations(projects: ResumeProject[]): PresentationProject[] {
  const idCounts = new Map<string, number>()
  for (const project of projects) {
    const id = project.id.trim()
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  }

  const reservedIds = new Set(
    [...idCounts].filter(([, count]) => count === 1).map(([id]) => id)
  )
  const fingerprintOccurrences = new Map<string, number>()
  const usedKeys = new Set(reservedIds)

  return projects.map((project, index) => {
    const id = project.id.trim()
    if (id && idCounts.get(id) === 1) return { key: id, index, project }

    const fingerprint = projectFingerprint(project)
    const occurrence = (fingerprintOccurrences.get(fingerprint) ?? 0) + 1
    fingerprintOccurrences.set(fingerprint, occurrence)
    const base = projectFallbackKey(project, fingerprint)
    let key = occurrence === 1 ? base : `${base}-${occurrence}`
    let collision = 2
    while (usedKeys.has(key)) {
      key = `${base}-generated-${collision}`
      collision += 1
    }
    usedKeys.add(key)
    return { key, index, project }
  })
}

function projectFingerprint(project: ResumeProject) {
  return JSON.stringify([
    project.name.trim(),
    project.type.trim(),
    project.summary.trim(),
    project.tags.map((tag) => tag.trim()),
    project.highlights.map((highlight) => highlight.trim())
  ])
}

function projectFallbackKey(project: ResumeProject, fingerprint: string) {
  const slug = project.name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'untitled'
  return `project-${slug}-${hashFingerprint(fingerprint)}`
}

function hashFingerprint(value: string) {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`
}
