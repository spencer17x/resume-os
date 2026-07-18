import { z } from 'zod'
import {
  jobRequirementSchema,
  requirementMatchSchema,
  targetJobSchema,
  type JobRequirement,
  type RequirementMatch,
  type TargetJob
} from './requirement-matrix'
import {
  optimizationRunSchema,
  type OptimizationRun
} from './optimization-run'
import { resumeDataSchema, type ResumeData } from '@/lib/resume-model'

export const DOMAIN_STORE_SCHEMA_VERSION = 1 as const
export const DEFAULT_DOMAIN_DATABASE_NAME = 'resume-os-domain'

export const DOMAIN_STORE_NAMES = [
  'evidenceSources',
  'careerFacts',
  'targetJobs',
  'jobRequirements',
  'requirementMatches',
  'resumeVariants',
  'optimizationRuns'
] as const

const stableIdSchema = z.string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim(), 'ID must not contain surrounding whitespace')

const timestampSchema = z.iso.datetime({ offset: true })
const boundedLabelSchema = z.string().trim().min(1).max(500)
const boundedTextSchema = z.string().trim().min(1).max(20_000)

function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
) {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value)) context.addIssue({ code: 'custom', path: [...path, index], message })
    seen.add(value)
  })
}

export const evidenceSourceSchema = z.object({
  id: stableIdSchema,
  type: z.enum(['resume-import', 'user-answer', 'document']),
  label: boundedLabelSchema,
  excerpt: boundedTextSchema.optional(),
  contentHash: z.string().trim().min(1).max(256).optional(),
  createdAt: timestampSchema
}).strict()

const careerFactContextSchema = z.object({
  company: boundedLabelSchema.optional(),
  role: boundedLabelSchema.optional(),
  project: boundedLabelSchema.optional()
}).strict()

export const careerFactSchema = z.object({
  id: stableIdSchema,
  kind: z.enum(['experience', 'project', 'skill', 'achievement', 'metric']),
  text: boundedTextSchema,
  context: careerFactContextSchema.optional(),
  evidenceRefs: z.array(stableIdSchema).min(1).max(100),
  verification: z.enum(['imported', 'user-confirmed', 'document-backed']),
  tags: z.array(z.string().trim().min(1).max(120)).max(100),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((fact, context) => {
  addDuplicateIssues(fact.evidenceRefs, context, ['evidenceRefs'], 'Evidence references must be unique')
  addDuplicateIssues(fact.tags, context, ['tags'], 'Tags must be unique')
  if (Date.parse(fact.updatedAt) < Date.parse(fact.createdAt)) {
    context.addIssue({
      code: 'custom',
      path: ['updatedAt'],
      message: 'Updated timestamp cannot precede creation'
    })
  }
})

export const resumeVariantSchema = z.object({
  id: stableIdSchema,
  sourceDraftId: stableIdSchema,
  targetJobId: stableIdSchema,
  name: boundedLabelSchema,
  data: resumeDataSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((variant, context) => {
  if (Date.parse(variant.updatedAt) < Date.parse(variant.createdAt)) {
    context.addIssue({
      code: 'custom',
      path: ['updatedAt'],
      message: 'Updated timestamp cannot precede creation'
    })
  }
})

export type EvidenceSource = z.infer<typeof evidenceSourceSchema>
export type CareerFact = z.infer<typeof careerFactSchema>
export type ResumeVariant = z.infer<typeof resumeVariantSchema>

export type DomainEntityMap = {
  evidenceSources: EvidenceSource
  careerFacts: CareerFact
  targetJobs: TargetJob
  jobRequirements: JobRequirement
  requirementMatches: RequirementMatch
  resumeVariants: ResumeVariant
  optimizationRuns: OptimizationRun
}

export type DomainStoreName = keyof DomainEntityMap
export type DomainAccessMode = 'readonly' | 'readwrite'

export type DomainStoreErrorCode =
  | 'INDEXEDDB_UNAVAILABLE'
  | 'OPEN_FAILED'
  | 'SCHEMA_MIGRATION_FAILED'
  | 'VALIDATION_FAILED'
  | 'REFERENTIAL_INTEGRITY'
  | 'DELETE_RESTRICTED'
  | 'READ_ONLY_TRANSACTION'
  | 'TRANSACTION_FAILED'

export class DomainStoreError extends Error {
  constructor(
    readonly code: DomainStoreErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'DomainStoreError'
  }
}

export type SourceDraftReferences = {
  resumeVariantIds: string[]
  optimizationRunIds: string[]
}

export interface DomainStoreTransaction<AllowedStore extends DomainStoreName> {
  get<Store extends AllowedStore>(
    store: Store,
    id: string
  ): Promise<DomainEntityMap[Store] | undefined>
  list<Store extends AllowedStore>(store: Store): Promise<DomainEntityMap[Store][]>
  put<Store extends AllowedStore>(
    store: Store,
    value: DomainEntityMap[Store]
  ): Promise<DomainEntityMap[Store]>
  delete<Store extends AllowedStore>(store: Store, id: string): Promise<void>
}

export type DomainStoreOptions = {
  databaseName?: string
  indexedDB?: IDBFactory | null
}

export class IndexedDbDomainStore {
  private readonly databaseName: string
  private readonly factory: IDBFactory | null
  private databasePromise: Promise<IDBDatabase> | null = null

  constructor(options: DomainStoreOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DOMAIN_DATABASE_NAME
    this.factory = options.indexedDB === undefined ? readGlobalIndexedDb() : options.indexedDB
  }

  get<Store extends DomainStoreName>(
    store: Store,
    id: string
  ): Promise<DomainEntityMap[Store] | undefined> {
    return this.transaction([store], 'readonly', (transaction) => transaction.get(store, id))
  }

  list<Store extends DomainStoreName>(store: Store): Promise<DomainEntityMap[Store][]> {
    return this.transaction([store], 'readonly', (transaction) => transaction.list(store))
  }

  put<Store extends DomainStoreName>(
    store: Store,
    value: DomainEntityMap[Store]
  ): Promise<DomainEntityMap[Store]> {
    return this.transaction([store], 'readwrite', (transaction) => transaction.put(store, value))
  }

  delete<Store extends DomainStoreName>(store: Store, id: string): Promise<void> {
    return this.transaction([store], 'readwrite', (transaction) => transaction.delete(store, id))
  }

  async sourceDraftReferences(sourceDraftId: string): Promise<SourceDraftReferences> {
    parseStableId(sourceDraftId)
    return this.transaction(
      ['resumeVariants', 'optimizationRuns'],
      'readonly',
      async (transaction) => {
        const [variants, runs] = await Promise.all([
          transaction.list('resumeVariants'),
          transaction.list('optimizationRuns')
        ])
        return {
          resumeVariantIds: variants
            .filter((variant) => variant.sourceDraftId === sourceDraftId)
            .map((variant) => variant.id)
            .sort(compareStrings),
          optimizationRunIds: runs
            .filter((run) => run.sourceDraftId === sourceDraftId)
            .map((run) => run.id)
            .sort(compareStrings)
        }
      }
    )
  }

  async assertSourceDraftCanBeDeleted(sourceDraftId: string): Promise<void> {
    const references = await this.sourceDraftReferences(sourceDraftId)
    if (references.resumeVariantIds.length > 0 || references.optimizationRunIds.length > 0) {
      throw new DomainStoreError(
        'DELETE_RESTRICTED',
        `Source draft ${sourceDraftId} is referenced by saved agent data`
      )
    }
  }

  async transaction<
    const Stores extends readonly DomainStoreName[],
    Result
  >(
    stores: Stores,
    mode: DomainAccessMode,
    operation: (transaction: DomainStoreTransaction<Stores[number]>) => Result | Promise<Result>
  ): Promise<Result> {
    if (stores.length === 0 || stores.some((store) => !DOMAIN_STORE_NAMES.includes(store))) {
      throw new DomainStoreError('TRANSACTION_FAILED', 'A transaction requires valid object stores')
    }

    const database = await this.open()
    const scope = mode === 'readwrite' ? DOMAIN_STORE_NAMES : [...new Set(stores)]
    let nativeTransaction: IDBTransaction
    try {
      nativeTransaction = database.transaction(scope, mode)
    } catch (error) {
      throw normalizeTransactionError(error)
    }

    const completion = waitForTransaction(nativeTransaction)
    void completion.catch(() => undefined)
    const transaction = new IndexedDbTransaction(nativeTransaction, mode)

    try {
      const result = await operation(
        transaction as DomainStoreTransaction<Stores[number]>
      )
      await completion
      return result
    } catch (error) {
      abortTransaction(nativeTransaction)
      await completion.catch(() => undefined)
      if (error instanceof DomainStoreError) throw error
      throw normalizeTransactionError(error)
    }
  }

  async close(): Promise<void> {
    const pending = this.databasePromise
    this.databasePromise = null
    if (!pending) return
    try {
      const database = await pending
      database.close()
    } catch {
      // A failed open has no database handle to close.
    }
  }

  private open(): Promise<IDBDatabase> {
    if (!this.factory) {
      return Promise.reject(new DomainStoreError(
        'INDEXEDDB_UNAVAILABLE',
        'IndexedDB is unavailable in this browser context'
      ))
    }
    if (!this.databasePromise) {
      this.databasePromise = openDomainDatabase(this.factory, this.databaseName)
      void this.databasePromise.catch(() => {
        this.databasePromise = null
      })
    }
    return this.databasePromise
  }
}

export function createDomainStore(options: DomainStoreOptions = {}) {
  return new IndexedDbDomainStore(options)
}

class IndexedDbTransaction implements DomainStoreTransaction<DomainStoreName> {
  constructor(
    private readonly transaction: IDBTransaction,
    private readonly mode: DomainAccessMode
  ) {}

  async get<Store extends DomainStoreName>(
    store: Store,
    id: string
  ): Promise<DomainEntityMap[Store] | undefined> {
    parseStableId(id)
    const value = await requestResult<unknown>(this.objectStore(store).get(id))
    return value === undefined ? undefined : parseEntity(store, value)
  }

  async list<Store extends DomainStoreName>(store: Store): Promise<DomainEntityMap[Store][]> {
    const values = await requestResult<unknown[]>(this.objectStore(store).getAll())
    return values.map((value) => parseEntity(store, value))
  }

  async put<Store extends DomainStoreName>(
    store: Store,
    value: DomainEntityMap[Store]
  ): Promise<DomainEntityMap[Store]> {
    this.requireWriteAccess()
    const parsed = parseEntity(store, value)
    await this.assertRelationships(store, parsed)
    await requestResult(this.objectStore(store).put(parsed))
    return parsed
  }

  async delete<Store extends DomainStoreName>(store: Store, id: string): Promise<void> {
    this.requireWriteAccess()
    parseStableId(id)
    await this.assertDeleteAllowed(store, id)
    await requestResult(this.objectStore(store).delete(id))
  }

  private objectStore(store: DomainStoreName) {
    try {
      return this.transaction.objectStore(store)
    } catch (error) {
      throw new DomainStoreError(
        'TRANSACTION_FAILED',
        `Object store ${store} is outside the transaction scope`,
        { cause: error }
      )
    }
  }

  private requireWriteAccess() {
    if (this.mode !== 'readwrite') {
      throw new DomainStoreError('READ_ONLY_TRANSACTION', 'Cannot write in a readonly transaction')
    }
  }

  private async assertRelationships<Store extends DomainStoreName>(
    store: Store,
    value: DomainEntityMap[Store]
  ): Promise<void> {
    switch (store) {
      case 'careerFacts':
        await this.requireReferences('evidenceSources', (value as CareerFact).evidenceRefs)
        return
      case 'jobRequirements':
        await this.requireReferences('targetJobs', [(value as JobRequirement).jobId])
        return
      case 'requirementMatches': {
        const match = value as RequirementMatch
        await this.requireReferences('jobRequirements', [match.requirementId])
        await this.requireReferences('careerFacts', match.factIds)
        return
      }
      case 'resumeVariants': {
        const variant = value as ResumeVariant
        await this.requireReferences('targetJobs', [variant.targetJobId])
        return
      }
      case 'optimizationRuns':
        await this.assertOptimizationRunRelationships(value as OptimizationRun)
        return
      default:
        return
    }
  }

  private async assertOptimizationRunRelationships(run: OptimizationRun) {
    await this.requireReferences('targetJobs', [run.targetJobId])

    const requirementIds = unique([
      ...run.requirementMatches.map((match) => match.requirementId),
      ...run.questions.map((question) => question.requirementId),
      ...(run.plan?.items.flatMap((item) => item.requirementIds) ?? []),
      ...(run.changeSet?.changes.flatMap((change) => change.evidence.requirementIds) ?? []),
      ...(run.scoreBefore?.contributions.map((item) => item.requirementId) ?? []),
      ...(run.scoreAfter?.contributions.map((item) => item.requirementId) ?? [])
    ])
    const requirements = await this.requireReferences('jobRequirements', requirementIds)
    if (requirements.some((requirement) => requirement.jobId !== run.targetJobId)) {
      throw new DomainStoreError(
        'REFERENTIAL_INTEGRITY',
        `Optimization run ${run.id} references a requirement from another target job`
      )
    }

    const factIds = unique([
      ...run.requirementMatches.flatMap((match) => match.factIds),
      ...run.questions.flatMap((question) => question.factIds),
      ...(run.plan?.items.flatMap((item) => item.factIds) ?? []),
      ...(run.changeSet?.changes.flatMap((change) => change.evidence.factIds) ?? []),
      ...(run.scoreBefore?.contributions.flatMap((item) => item.evidenceRefs) ?? []),
      ...(run.scoreAfter?.contributions.flatMap((item) => item.evidenceRefs) ?? [])
    ])
    await this.requireReferences('careerFacts', factIds)

    if (run.appliedVariantId) {
      const [variant] = await this.requireReferences('resumeVariants', [run.appliedVariantId])
      if (variant.targetJobId !== run.targetJobId || variant.sourceDraftId !== run.sourceDraftId) {
        throw new DomainStoreError(
          'REFERENTIAL_INTEGRITY',
          `Optimization run ${run.id} references an unrelated resume variant`
        )
      }
    }
  }

  private async requireReferences<Store extends DomainStoreName>(
    store: Store,
    ids: readonly string[]
  ): Promise<DomainEntityMap[Store][]> {
    const results: DomainEntityMap[Store][] = []
    for (const id of unique(ids)) {
      const value = await this.get(store, id)
      if (!value) {
        throw new DomainStoreError(
          'REFERENTIAL_INTEGRITY',
          `Missing ${store} reference: ${id}`
        )
      }
      results.push(value)
    }
    return results
  }

  private async assertDeleteAllowed(store: DomainStoreName, id: string) {
    let referenced = false
    switch (store) {
      case 'evidenceSources':
        referenced = (await this.list('careerFacts')).some((fact) => fact.evidenceRefs.includes(id))
        break
      case 'careerFacts':
        referenced = (await this.list('requirementMatches')).some((match) => match.factIds.includes(id))
          || (await this.list('optimizationRuns')).some((run) => optimizationRunFactIds(run).has(id))
        break
      case 'targetJobs':
        referenced = (await this.list('jobRequirements')).some((requirement) => requirement.jobId === id)
          || (await this.list('resumeVariants')).some((variant) => variant.targetJobId === id)
          || (await this.list('optimizationRuns')).some((run) => run.targetJobId === id)
        break
      case 'jobRequirements':
        referenced = Boolean(await this.get('requirementMatches', id))
          || (await this.list('optimizationRuns')).some((run) => optimizationRunRequirementIds(run).has(id))
        break
      case 'resumeVariants':
        referenced = (await this.list('optimizationRuns')).some((run) => run.appliedVariantId === id)
        break
      default:
        break
    }

    if (referenced) {
      throw new DomainStoreError(
        'DELETE_RESTRICTED',
        `Cannot delete ${store} ${id} while dependent records exist`
      )
    }
  }
}

function openDomainDatabase(factory: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(databaseName, DOMAIN_STORE_SCHEMA_VERSION)
    } catch (error) {
      reject(new DomainStoreError('OPEN_FAILED', 'Unable to open the domain database', { cause: error }))
      return
    }

    let settled = false
    let migrationError: unknown
    const rejectOnce = (error: DomainStoreError) => {
      if (settled) return
      settled = true
      reject(error)
    }

    request.onupgradeneeded = (event) => {
      try {
        migrateDomainSchema(request.result, event.oldVersion, event.newVersion)
      } catch (error) {
        migrationError = error
        abortTransaction(request.transaction)
      }
    }
    request.onerror = () => {
      rejectOnce(migrationError instanceof DomainStoreError
        ? migrationError
        : new DomainStoreError('OPEN_FAILED', 'Unable to open the domain database', {
            cause: migrationError ?? request.error
          }))
    }
    request.onblocked = () => {
      rejectOnce(new DomainStoreError(
        'OPEN_FAILED',
        'Opening the domain database was blocked by another tab'
      ))
    }
    request.onsuccess = () => {
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}

function migrateDomainSchema(
  database: IDBDatabase,
  oldVersion: number,
  newVersion: number | null
) {
  if (newVersion !== DOMAIN_STORE_SCHEMA_VERSION || oldVersion !== 0) {
    throw new DomainStoreError(
      'SCHEMA_MIGRATION_FAILED',
      `Unsupported domain schema migration: ${oldVersion} -> ${newVersion ?? 'unknown'}`
    )
  }

  const evidenceSources = database.createObjectStore('evidenceSources', { keyPath: 'id' })
  evidenceSources.createIndex('byCreatedAt', 'createdAt')

  const careerFacts = database.createObjectStore('careerFacts', { keyPath: 'id' })
  careerFacts.createIndex('byEvidenceRef', 'evidenceRefs', { multiEntry: true })
  careerFacts.createIndex('byUpdatedAt', 'updatedAt')

  const targetJobs = database.createObjectStore('targetJobs', { keyPath: 'id' })
  targetJobs.createIndex('byUpdatedAt', 'updatedAt')

  const jobRequirements = database.createObjectStore('jobRequirements', { keyPath: 'id' })
  jobRequirements.createIndex('byJobId', 'jobId')

  const requirementMatches = database.createObjectStore('requirementMatches', {
    keyPath: 'requirementId'
  })
  requirementMatches.createIndex('byFactId', 'factIds', { multiEntry: true })

  const resumeVariants = database.createObjectStore('resumeVariants', { keyPath: 'id' })
  resumeVariants.createIndex('bySourceDraftId', 'sourceDraftId')
  resumeVariants.createIndex('byTargetJobId', 'targetJobId')
  resumeVariants.createIndex('byUpdatedAt', 'updatedAt')

  const optimizationRuns = database.createObjectStore('optimizationRuns', { keyPath: 'id' })
  optimizationRuns.createIndex('bySourceDraftId', 'sourceDraftId')
  optimizationRuns.createIndex('byTargetJobId', 'targetJobId')
  optimizationRuns.createIndex('byUpdatedAt', 'updatedAt')
}

const entitySchemas: {
  [Store in DomainStoreName]: z.ZodType<DomainEntityMap[Store]>
} = {
  evidenceSources: evidenceSourceSchema,
  careerFacts: careerFactSchema,
  targetJobs: targetJobSchema,
  jobRequirements: jobRequirementSchema,
  requirementMatches: requirementMatchSchema,
  resumeVariants: resumeVariantSchema,
  optimizationRuns: optimizationRunSchema
}

function parseEntity<Store extends DomainStoreName>(
  store: Store,
  input: unknown
): DomainEntityMap[Store] {
  const parsed = entitySchemas[store].safeParse(input)
  if (!parsed.success) {
    throw new DomainStoreError(
      'VALIDATION_FAILED',
      `Invalid record for ${store}`,
      { cause: parsed.error }
    )
  }
  return parsed.data
}

function parseStableId(id: string) {
  const parsed = stableIdSchema.safeParse(id)
  if (!parsed.success) {
    throw new DomainStoreError('VALIDATION_FAILED', 'Invalid record identifier', {
      cause: parsed.error
    })
  }
  return parsed.data
}

function optimizationRunRequirementIds(run: OptimizationRun) {
  return new Set([
    ...run.requirementMatches.map((match) => match.requirementId),
    ...run.questions.map((question) => question.requirementId),
    ...(run.plan?.items.flatMap((item) => item.requirementIds) ?? []),
    ...(run.changeSet?.changes.flatMap((change) => change.evidence.requirementIds) ?? []),
    ...(run.scoreBefore?.contributions.map((item) => item.requirementId) ?? []),
    ...(run.scoreAfter?.contributions.map((item) => item.requirementId) ?? [])
  ])
}

function optimizationRunFactIds(run: OptimizationRun) {
  return new Set([
    ...run.requirementMatches.flatMap((match) => match.factIds),
    ...run.questions.flatMap((question) => question.factIds),
    ...(run.plan?.items.flatMap((item) => item.factIds) ?? []),
    ...(run.changeSet?.changes.flatMap((change) => change.evidence.factIds) ?? []),
    ...(run.scoreBefore?.contributions.flatMap((item) => item.evidenceRefs) ?? []),
    ...(run.scoreAfter?.contributions.flatMap((item) => item.evidenceRefs) ?? [])
  ])
}

function readGlobalIndexedDb(): IDBFactory | null {
  const value = Reflect.get(globalThis, 'indexedDB') as unknown
  return value && typeof value === 'object' ? value as IDBFactory : null
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

function abortTransaction(transaction: IDBTransaction | null) {
  if (!transaction) return
  try {
    transaction.abort()
  } catch {
    // The transaction may have already completed or aborted.
  }
}

function normalizeTransactionError(error: unknown) {
  return error instanceof DomainStoreError
    ? error
    : new DomainStoreError('TRANSACTION_FAILED', 'IndexedDB transaction failed', { cause: error })
}

function unique(values: readonly string[]) {
  return [...new Set(values)]
}

function compareStrings(left: string, right: string) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export type {
  JobRequirement,
  OptimizationRun,
  RequirementMatch,
  ResumeData,
  TargetJob
}
