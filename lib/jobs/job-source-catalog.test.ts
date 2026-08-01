import { describe, expect, it } from 'vitest'
import { createCatalogJobSources, CURATED_JOB_SOURCE_CATALOG } from './job-source-catalog'

const now = '2026-08-01T08:00:00.000Z'

describe('curated job source catalog', () => {
  it('materializes only selected automatic platforms with stable source IDs', () => {
    const greenhouse = createCatalogJobSources({ platforms: ['greenhouse', 'boss'], now })
    expect(greenhouse).toHaveLength(
      CURATED_JOB_SOURCE_CATALOG.filter((source) => source.platform === 'greenhouse').length
    )
    expect(greenhouse.every((source) => source.kind === 'greenhouse')).toBe(true)
    expect(createCatalogJobSources({ platforms: ['greenhouse'], now })).toEqual(greenhouse)
    expect(createCatalogJobSources({ platforms: ['boss', '51job', '58'], now })).toEqual([])
  })

  it('preserves an existing source timestamp and enabled decision', () => {
    const [source] = createCatalogJobSources({ platforms: ['greenhouse'], now })
    const existing = { ...source, enabled: false, createdAt: '2026-07-01T08:00:00.000Z' }
    expect(createCatalogJobSources({ platforms: ['greenhouse'], now, existing: [existing] })[0])
      .toMatchObject({ enabled: false, createdAt: existing.createdAt })
  })
})
