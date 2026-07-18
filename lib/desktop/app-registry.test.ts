import { describe, expect, it } from 'vitest'
import { appRegistry, appIdFromPath, pathForApp } from './app-registry'

describe('app registry', () => {
  it('round-trips every application path for every locale', () => {
    for (const app of Object.values(appRegistry)) {
      for (const locale of ['zh', 'en'] as const) {
        expect(appIdFromPath(pathForApp(app.id, locale))).toBe(app.id)
      }
    }
  })

  it('keeps locale roots on the desktop', () => {
    expect(appIdFromPath('/zh')).toBeNull()
    expect(appIdFromPath('/en')).toBeNull()
  })

  it('normalizes query strings, hashes, and trailing slashes', () => {
    expect(appIdFromPath('/zh/agent?source=dock')).toBe('agent')
    expect(appIdFromPath('/en/3d#skills')).toBe('resume-3d')
    expect(appIdFromPath('/zh/book/?page=2#experience')).toBe('book')
    expect(appIdFromPath('/en/')).toBeNull()
  })

  it('accepts one nonempty nested project id only', () => {
    expect(appIdFromPath('/zh/projects/resume-os')).toBe('projects')
    expect(appIdFromPath('/en/projects/any-future-project/')).toBe('projects')
    expect(appIdFromPath('/zh/projects/id/extra')).toBeNull()
    expect(appIdFromPath('/zh/projects//extra')).toBeNull()
  })

  it('defines valid window constraints for every app', () => {
    for (const app of Object.values(appRegistry)) {
      expect(app.defaultSize.width).toBeGreaterThanOrEqual(app.minSize.width)
      expect(app.defaultSize.height).toBeGreaterThanOrEqual(app.minSize.height)
    }
  })

  it('keeps registry keys, ids, and message keys aligned', () => {
    for (const [appId, app] of Object.entries(appRegistry)) {
      expect(app.id).toBe(appId)
      expect(app.messageKey).toBe(`apps.${appId}`)
    }
  })

  it('defines a unique route for every app', () => {
    const routes = Object.values(appRegistry).map((app) => app.route)

    expect(new Set(routes).size).toBe(routes.length)
  })

  it('prioritizes and pins the workflow without pinning showcase apps', () => {
    const apps = Object.values(appRegistry)
    const workflowIds = apps.filter((app) => app.group === 'workflow').map((app) => app.id)
    const showcaseIds = apps.filter((app) => app.group === 'showcase').map((app) => app.id)

    expect(workflowIds).toEqual(['studio', 'jd-match', 'agent', 'classic', 'settings'])
    expect(showcaseIds).toEqual(['resume-3d', 'book', 'projects', 'timeline', 'terminal'])
    expect(apps.filter((app) => app.pinned).map((app) => app.id)).toEqual(workflowIds)
  })

  it('returns null for unsupported paths', () => {
    expect(appIdFromPath('/fr/agent')).toBeNull()
    expect(appIdFromPath('/zh/unknown')).toBeNull()
    expect(appIdFromPath('/agent')).toBeNull()
    expect(appIdFromPath('/zh/agent/extra')).toBeNull()
  })
})
