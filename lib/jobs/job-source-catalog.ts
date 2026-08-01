import {
  createStableJobDomainId,
  jobSourceSchema,
  type JobSource
} from './job-domain'
import type { JobMarketplaceId } from './job-marketplace'

export type CatalogJobSource = {
  platform: Extract<JobMarketplaceId, 'greenhouse' | 'lever'>
  sourceKey: string
  label: string
}

export const CURATED_JOB_SOURCE_CATALOG: readonly CatalogJobSource[] = [
  { platform: 'greenhouse', sourceKey: 'discord', label: 'Discord' },
  { platform: 'greenhouse', sourceKey: 'webflow', label: 'Webflow' },
  { platform: 'greenhouse', sourceKey: 'cockroachlabs', label: 'Cockroach Labs' },
  { platform: 'lever', sourceKey: 'finquery', label: 'FinQuery' },
  { platform: 'lever', sourceKey: 'electric-twin', label: 'Electric Twin' },
  { platform: 'lever', sourceKey: 'employ', label: 'Employ' },
  { platform: 'lever', sourceKey: 'h1', label: 'H1' },
  { platform: 'lever', sourceKey: 'highspot', label: 'Highspot' }
] as const

export function createCatalogJobSources(input: {
  platforms: readonly JobMarketplaceId[]
  now: string
  existing?: readonly JobSource[]
}) {
  const existingById = new Map((input.existing ?? []).map((source) => [source.id, source]))
  return CURATED_JOB_SOURCE_CATALOG
    .filter((source) => input.platforms.includes(source.platform))
    .map((source) => {
      const id = createStableJobDomainId('job-source', [source.platform, source.sourceKey])
      const existing = existingById.get(id)
      return jobSourceSchema.parse({
        id,
        kind: source.platform,
        label: source.label,
        sourceKey: source.sourceKey,
        enabled: existing?.enabled ?? true,
        createdAt: existing?.createdAt ?? input.now,
        updatedAt: existing?.updatedAt ?? input.now
      })
    })
}
