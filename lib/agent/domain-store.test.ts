import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createOptimizationRun } from './optimization-run'
import {
  DOMAIN_STORE_NAMES,
  DOMAIN_STORE_SCHEMA_VERSION,
  DomainStoreError,
  createDomainStore,
  type CareerFact,
  type EvidenceSource,
  type JobRequirement,
  type RequirementMatch,
  type ResumeVariant,
  type TargetJob
} from './domain-store'
import { resumeDataSchema } from '@/lib/resume-model'

const now = '2026-07-16T08:00:00.000Z'

const source: EvidenceSource = {
  id: 'source-1',
  type: 'resume-import',
  label: 'Imported resume',
  excerpt: 'Built a design system used by five product teams.',
  contentHash: 'sha256:source-1',
  createdAt: now
}

const fact: CareerFact = {
  id: 'fact-1',
  kind: 'achievement',
  text: 'Built a design system used by five product teams.',
  context: { company: 'Example Co', role: 'Staff Engineer' },
  evidenceRefs: [source.id],
  verification: 'imported',
  tags: ['design-systems'],
  createdAt: now,
  updatedAt: now
}

const targetJob: TargetJob = {
  id: 'job-1',
  title: 'Staff Frontend Engineer',
  company: 'Target Co',
  description: 'Lead design system architecture across multiple product teams.',
  locale: 'en',
  createdAt: now,
  updatedAt: now
}

const requirement: JobRequirement = {
  id: 'requirement-1',
  jobId: targetJob.id,
  text: 'Lead design system architecture.',
  category: 'experience',
  priority: 'must',
  weight: 5,
  keywords: ['design system'],
  userConfirmed: true
}

const match: RequirementMatch = {
  requirementId: requirement.id,
  factIds: [fact.id],
  status: 'direct',
  rationale: 'The fact directly demonstrates design system leadership.'
}

const variant: ResumeVariant = {
  id: 'variant-1',
  sourceDraftId: 'draft-1',
  targetJobId: targetJob.id,
  name: 'Target Co variant',
  data: resumeDataSchema.parse({
    profile: { name: 'Candidate', title: 'Staff Engineer' },
    metadata: { source: 'upload', locale: 'en', updatedAt: now }
  }),
  createdAt: now,
  updatedAt: now
}

function createTestStore() {
  const factory = new IDBFactory()
  const databaseName = `resume-os-domain-test-${crypto.randomUUID()}`
  return {
    factory,
    databaseName,
    store: createDomainStore({ databaseName, indexedDB: factory })
  }
}

async function seedRelations(
  store: ReturnType<typeof createDomainStore>,
  options: { includeMatch?: boolean; includeVariant?: boolean; includeRun?: boolean } = {}
) {
  await store.put('evidenceSources', source)
  await store.put('careerFacts', fact)
  await store.put('targetJobs', targetJob)
  await store.put('jobRequirements', requirement)
  if (options.includeMatch) await store.put('requirementMatches', match)
  if (options.includeVariant) await store.put('resumeVariants', variant)
  if (options.includeRun) {
    await store.put('optimizationRuns', createOptimizationRun({
      id: 'run-1',
      sourceDraftId: variant.sourceDraftId,
      targetJobId: targetJob.id,
      inputFingerprint: 'fingerprint-1',
      now
    }))
  }
}

describe('IndexedDbDomainStore', () => {
  it('creates schema v1 with every required object store and relation index', async () => {
    const { factory, databaseName, store } = createTestStore()
    await store.list('evidenceSources')

    const database = await openDatabase(factory, databaseName)
    expect(database.version).toBe(DOMAIN_STORE_SCHEMA_VERSION)
    expect([...database.objectStoreNames]).toEqual([...DOMAIN_STORE_NAMES].sort())

    const transaction = database.transaction(DOMAIN_STORE_NAMES, 'readonly')
    expect([...transaction.objectStore('careerFacts').indexNames]).toContain('byEvidenceRef')
    expect([...transaction.objectStore('jobRequirements').indexNames]).toContain('byJobId')
    expect([...transaction.objectStore('resumeVariants').indexNames]).toEqual(
      expect.arrayContaining(['bySourceDraftId', 'byTargetJobId'])
    )
    database.close()
    await store.close()
  })

  it('supports typed put, get, list, and delete for every domain entity', async () => {
    const { store } = createTestStore()
    const run = createOptimizationRun({
      id: 'run-1',
      sourceDraftId: variant.sourceDraftId,
      targetJobId: targetJob.id,
      inputFingerprint: 'fingerprint-1',
      now
    })

    await store.put('evidenceSources', source)
    await store.put('careerFacts', fact)
    await store.put('targetJobs', targetJob)
    await store.put('jobRequirements', requirement)
    await store.put('requirementMatches', match)
    await store.put('resumeVariants', variant)
    await store.put('optimizationRuns', run)

    expect(await store.get('evidenceSources', source.id)).toEqual(source)
    expect(await store.get('careerFacts', fact.id)).toEqual(fact)
    expect(await store.get('targetJobs', targetJob.id)).toEqual(targetJob)
    expect(await store.get('jobRequirements', requirement.id)).toEqual(requirement)
    expect(await store.get('requirementMatches', requirement.id)).toEqual(match)
    expect(await store.get('resumeVariants', variant.id)).toEqual(variant)
    expect(await store.get('optimizationRuns', run.id)).toEqual(run)
    expect(await store.list('careerFacts')).toEqual([fact])

    await store.delete('requirementMatches', requirement.id)
    await store.delete('optimizationRuns', run.id)
    await store.delete('resumeVariants', variant.id)
    await store.delete('jobRequirements', requirement.id)
    await store.delete('targetJobs', targetJob.id)
    await store.delete('careerFacts', fact.id)
    await store.delete('evidenceSources', source.id)

    for (const storeName of DOMAIN_STORE_NAMES) {
      expect(await store.list(storeName)).toEqual([])
    }
    await store.close()
  })

  it('validates records and rejects original document bytes instead of storing them', async () => {
    const { store } = createTestStore()
    const sourceWithBytes = {
      ...source,
      bytes: new Uint8Array([1, 2, 3])
    } as EvidenceSource

    await expectErrorCode(
      store.put('evidenceSources', sourceWithBytes),
      'VALIDATION_FAILED'
    )
    expect(await store.get('evidenceSources', source.id)).toBeUndefined()
    await store.close()
  })

  it('rejects missing evidence and fact references without partial writes', async () => {
    const { store } = createTestStore()

    await expectErrorCode(store.put('careerFacts', fact), 'REFERENTIAL_INTEGRITY')
    expect(await store.get('careerFacts', fact.id)).toBeUndefined()

    await store.put('targetJobs', targetJob)
    await store.put('jobRequirements', requirement)
    await expectErrorCode(store.put('requirementMatches', match), 'REFERENTIAL_INTEGRITY')
    expect(await store.get('requirementMatches', match.requirementId)).toBeUndefined()
    await store.close()
  })

  it('atomically rolls back a multi-store transaction when relation validation fails', async () => {
    const { store } = createTestStore()
    const invalidMatch = { ...match, factIds: ['missing-fact'] }

    await expectErrorCode(
      store.transaction(
        ['targetJobs', 'jobRequirements', 'requirementMatches'],
        'readwrite',
        async (transaction) => {
          await transaction.put('targetJobs', targetJob)
          await transaction.put('jobRequirements', requirement)
          await transaction.put('requirementMatches', invalidMatch)
        }
      ),
      'REFERENTIAL_INTEGRITY'
    )

    expect(await store.get('targetJobs', targetJob.id)).toBeUndefined()
    expect(await store.get('jobRequirements', requirement.id)).toBeUndefined()
    await store.close()
  })

  it('restricts deletes that would orphan evidence, matches, jobs, or variants', async () => {
    const { store } = createTestStore()
    await seedRelations(store, { includeMatch: true, includeVariant: true, includeRun: true })

    await expectErrorCode(store.delete('evidenceSources', source.id), 'DELETE_RESTRICTED')
    await expectErrorCode(store.delete('careerFacts', fact.id), 'DELETE_RESTRICTED')
    await expectErrorCode(store.delete('jobRequirements', requirement.id), 'DELETE_RESTRICTED')
    await expectErrorCode(store.delete('targetJobs', targetJob.id), 'DELETE_RESTRICTED')
    await store.close()
  })

  it('reports source-draft dependents instead of silently cascading their deletion', async () => {
    const { store } = createTestStore()
    await seedRelations(store, { includeVariant: true, includeRun: true })

    await expect(store.sourceDraftReferences(variant.sourceDraftId)).resolves.toEqual({
      resumeVariantIds: [variant.id],
      optimizationRunIds: ['run-1']
    })
    await expectErrorCode(
      store.assertSourceDraftCanBeDeleted(variant.sourceDraftId),
      'DELETE_RESTRICTED'
    )
    await expect(store.assertSourceDraftCanBeDeleted('unreferenced-draft')).resolves.toBeUndefined()
    await store.close()
  })

  it('rejects writes requested through a readonly transaction', async () => {
    const { store } = createTestStore()
    await expectErrorCode(
      store.transaction(['evidenceSources'], 'readonly', (transaction) => {
        return transaction.put('evidenceSources', source)
      }),
      'READ_ONLY_TRANSACTION'
    )
    await store.close()
  })

  it('returns an explicit error when IndexedDB is unavailable', async () => {
    const store = createDomainStore({ indexedDB: null })
    await expectErrorCode(store.list('careerFacts'), 'INDEXEDDB_UNAVAILABLE')
  })

  it('does not open a database created with an unsupported future schema version', async () => {
    const factory = new IDBFactory()
    const databaseName = `resume-os-domain-future-${crypto.randomUUID()}`
    const future = await openDatabase(factory, databaseName, DOMAIN_STORE_SCHEMA_VERSION + 1)
    future.close()

    const store = createDomainStore({ databaseName, indexedDB: factory })
    await expectErrorCode(store.list('targetJobs'), 'OPEN_FAILED')
  })
})

async function expectErrorCode(
  operation: Promise<unknown>,
  code: DomainStoreError['code']
) {
  try {
    await operation
    throw new Error(`Expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(DomainStoreError)
    expect((error as DomainStoreError).code).toBe(code)
  }
}

function openDatabase(factory: IDBFactory, name: string, version?: number) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = version === undefined ? factory.open(name) : factory.open(name, version)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
