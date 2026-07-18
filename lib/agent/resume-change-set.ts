import { z } from 'zod'
import { normalizeResumeData, type ResumeData } from '@/lib/resume-model'

export const MAX_RESUME_CHANGE_SET_BYTES = 64_000
export const MAX_RESUME_CHANGES = 50

const stableEvidenceIdSchema = z.string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim(), 'Evidence IDs must not contain surrounding whitespace')

const forbiddenSegments = new Set(['__proto__', 'prototype', 'constructor'])
const topLevelStringArrays = new Set(['certifications', 'awards', 'languages', 'openSource'])
const profileScalars = new Set([
  'name', 'englishName', 'title', 'location', 'email', 'phone'
])
const experienceScalars = new Set(['company', 'role', 'period', 'location'])
const projectScalars = new Set(['name', 'type', 'summary'])
const educationScalars = new Set(['school', 'degree', 'major', 'period'])

const boundedUnknownSchema = z.unknown().superRefine((value, context) => {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
    if (bytes > 12_000) context.addIssue({ code: 'custom', message: 'Change value is too large' })
  } catch {
    context.addIssue({ code: 'custom', message: 'Change value is not serializable' })
  }
})

export const resumeChangeEvidenceSchema = z.object({
  requirementIds: z.array(stableEvidenceIdSchema).max(100),
  factIds: z.array(stableEvidenceIdSchema).max(100),
  matchType: z.enum(['direct', 'partial', 'gap']),
  support: z.enum(['verified', 'user-confirmed', 'unsupported']),
  confidence: z.number().finite().min(0).max(1),
  transformation: z.enum(['rewrite', 'emphasize', 'remove', 'reorder', 'add-from-fact']),
  scoreImpact: z.number().finite().min(-100).max(100).optional()
}).strict().superRefine((evidence, context) => {
  addDuplicateIssues(evidence.requirementIds, context, ['requirementIds'], 'Requirement IDs must be unique')
  addDuplicateIssues(evidence.factIds, context, ['factIds'], 'Fact IDs must be unique')

  if (evidence.support !== 'unsupported') {
    if (evidence.requirementIds.length === 0) {
      context.addIssue({
        code: 'custom', path: ['requirementIds'],
        message: 'Applicable changes must reference at least one requirement'
      })
    }
    if (evidence.factIds.length === 0) {
      context.addIssue({
        code: 'custom', path: ['factIds'],
        message: 'Applicable changes must reference at least one supporting fact'
      })
    }
    if (evidence.matchType === 'gap') {
      context.addIssue({
        code: 'custom', path: ['matchType'],
        message: 'An evidence gap cannot be an applicable change'
      })
    }
  }

  if (evidence.transformation === 'add-from-fact' && evidence.support === 'unsupported') {
    context.addIssue({
      code: 'custom', path: ['support'],
      message: 'Adding content requires a verified or user-confirmed fact'
    })
  }

  if (evidence.support === 'unsupported') {
    if (evidence.matchType !== 'gap') {
      context.addIssue({
        code: 'custom', path: ['matchType'],
        message: 'Unsupported evidence must be represented as a gap'
      })
    }
    if (evidence.confidence !== 0) {
      context.addIssue({
        code: 'custom', path: ['confidence'],
        message: 'Unsupported evidence must have zero confidence'
      })
    }
    if (evidence.factIds.length > 0) {
      context.addIssue({
        code: 'custom', path: ['factIds'],
        message: 'Unsupported evidence cannot cite supporting facts'
      })
    }
  }
})

const resumeChangeFields = {
  id: z.string().trim().min(1).max(80),
  path: z.string().trim().min(1).max(160),
  original: boundedUnknownSchema,
  proposed: boundedUnknownSchema,
  reason: z.string().trim().min(1).max(1_000),
  needsConfirmation: z.boolean().default(false)
}

export const resumeChangeSchema = z.object({
  ...resumeChangeFields,
  evidence: resumeChangeEvidenceSchema
}).strict().superRefine((change, context) => {
  const stringArray = (value: unknown, maxLength: number) => (
    Array.isArray(value)
    && value.length <= maxLength
    && value.every((item) => typeof item === 'string' && item.length <= 2_000)
  )
  const transformation = change.evidence.transformation
  const validShape = transformation === 'remove'
    ? false
    : transformation === 'reorder'
    ? change.path === 'projects'
      && stringArray(change.original, 100)
      && stringArray(change.proposed, 100)
    : transformation === 'add-from-fact'
      ? isFactBackedNarrativeCollectionPath(change.path)
        && stringArray(change.original, 100)
        && stringArray(change.proposed, 101)
      : typeof change.original === 'string'
        && change.original.length <= 2_000
        && typeof change.proposed === 'string'
        && change.proposed.length <= 2_000

  if (!validShape) {
    context.addIssue({
      code: 'custom',
      message: 'Change values must match the selected operation and path'
    })
  }
})

const legacyCompatibleResumeChangeSchema = z.object({
  ...resumeChangeFields,
  evidence: resumeChangeEvidenceSchema.optional()
}).strict()

export const resumeChangeSetSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  changes: z.array(legacyCompatibleResumeChangeSchema).max(MAX_RESUME_CHANGES),
  questions: z.array(z.string().trim().min(1).max(500)).max(20).default([])
}).strict()

export const modelResumeChangeSetSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  changes: z.array(resumeChangeSchema).max(MAX_RESUME_CHANGES),
  questions: z.array(z.string().trim().min(1).max(500)).max(20).default([])
}).strict()

export const RESUME_CHANGE_SET_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'changes', 'questions'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 2_000 },
    changes: {
      type: 'array',
      maxItems: MAX_RESUME_CHANGES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'path', 'original', 'proposed', 'reason', 'needsConfirmation', 'evidence'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 80 },
          path: { type: 'string', minLength: 1, maxLength: 160 },
          original: {
            oneOf: [
              { type: 'string', maxLength: 2_000 },
              { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 2_000 } }
            ]
          },
          proposed: {
            oneOf: [
              { type: 'string', maxLength: 2_000 },
              { type: 'array', maxItems: 101, items: { type: 'string', maxLength: 2_000 } }
            ]
          },
          reason: { type: 'string', minLength: 1, maxLength: 1_000 },
          needsConfirmation: { type: 'boolean' },
          evidence: {
            type: 'object',
            additionalProperties: false,
            required: ['requirementIds', 'factIds', 'matchType', 'support', 'confidence', 'transformation'],
            properties: {
              requirementIds: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 160 } },
              factIds: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 160 } },
              matchType: { type: 'string', enum: ['direct', 'partial', 'gap'] },
              support: { type: 'string', enum: ['verified', 'user-confirmed', 'unsupported'] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              transformation: { type: 'string', enum: ['rewrite', 'emphasize', 'reorder', 'add-from-fact'] }
            }
          }
        }
      }
    },
    questions: {
      type: 'array', maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 500 }
    }
  }
} satisfies Record<string, unknown>

export const LOCAL_RESUME_REWRITE_JSON_SCHEMA = {
  ...RESUME_CHANGE_SET_JSON_SCHEMA,
  properties: {
    ...RESUME_CHANGE_SET_JSON_SCHEMA.properties,
    changes: {
      ...RESUME_CHANGE_SET_JSON_SCHEMA.properties.changes,
      maxItems: 1
    },
    questions: {
      ...RESUME_CHANGE_SET_JSON_SCHEMA.properties.questions,
      maxItems: 1
    }
  }
} satisfies Record<string, unknown>

export function localResumeRewriteJsonSchema(input: {
  path: string
  original: string
  transformation: 'rewrite' | 'emphasize'
}) {
  const changeItem = RESUME_CHANGE_SET_JSON_SCHEMA.properties.changes.items
  return {
    ...LOCAL_RESUME_REWRITE_JSON_SCHEMA,
    properties: {
      ...LOCAL_RESUME_REWRITE_JSON_SCHEMA.properties,
      changes: {
        ...LOCAL_RESUME_REWRITE_JSON_SCHEMA.properties.changes,
        items: {
          ...changeItem,
          properties: {
            ...changeItem.properties,
            path: { ...changeItem.properties.path, enum: [input.path] },
            original: { type: 'string', enum: [input.original] },
            proposed: { type: 'string' },
            evidence: {
              ...changeItem.properties.evidence,
              properties: {
                ...changeItem.properties.evidence.properties,
                transformation: {
                  ...changeItem.properties.evidence.properties.transformation,
                  enum: [input.transformation]
                }
              }
            }
          }
        }
      }
    }
  } satisfies Record<string, unknown>
}

export type ResumeChange = z.infer<typeof resumeChangeSchema>
export type ResumeChangeEvidence = z.infer<typeof resumeChangeEvidenceSchema>
export type ResumeChangeSet = z.infer<typeof modelResumeChangeSetSchema>
export type ResumeChangeFact = {
  id: string
  text: string
  verification: 'imported' | 'user-confirmed' | 'document-backed'
}
export type ResumeChangeRequirement = { id: string }
export type ResumeChangeValidationContext = {
  facts?: readonly ResumeChangeFact[]
  requirements?: readonly ResumeChangeRequirement[]
}
export type ResumeChangePlan = {
  approvedAt?: string
  items: Array<{
    requirementIds: string[]
    factIds: string[]
    transformation: ResumeChangeEvidence['transformation']
  }>
}
export type ResumeChangeRequirementMatch = {
  requirementId: string
  factIds: string[]
  status: ResumeChangeEvidence['matchType']
}
export type ResumeChangeBlockReason =
  | 'UNSUPPORTED_EVIDENCE'
  | 'PROTECTED_FIELD'
  | 'UNSTABLE_REORDER'
  | 'INVALID_ADD_FROM_FACT'
  | 'UNSAFE_REMOVE'
export type ResumeChangeSetErrorCode =
  | 'INVALID_CHANGE_SET'
  | 'CHANGE_SET_TOO_LARGE'
  | 'UNSUPPORTED_PATH'
  | 'DUPLICATE_CHANGE'
  | 'ORIGINAL_MISMATCH'
  | 'INVALID_VALUE'
  | 'UNSUPPORTED_EVIDENCE'
  | 'PROTECTED_FIELD'
  | 'UNSUPPORTED_TRANSFORMATION'
  | 'EVIDENCE_REFERENCE_INVALID'
  | 'HIDDEN_NORMALIZATION_CHANGE'

export class ResumeChangeSetError extends Error {
  constructor(readonly code: ResumeChangeSetErrorCode) {
    super(code)
    this.name = 'ResumeChangeSetError'
  }
}

export function parseResumeChangeSet(input: unknown): ResumeChangeSet {
  ensureSerializedSize(input)
  const parsed = resumeChangeSetSchema.safeParse(input)
  if (!parsed.success) throw new ResumeChangeSetError('INVALID_CHANGE_SET')

  return validateParsedChangeSet({
    ...parsed.data,
    changes: parsed.data.changes.map((change) => ({
      ...change,
      evidence: change.evidence ?? legacyUnsupportedEvidence()
    }))
  })
}

export function parseModelResumeChangeSet(input: unknown): ResumeChangeSet {
  ensureSerializedSize(input)
  if (containsModelAuthoredScoreImpact(input)) {
    throw new ResumeChangeSetError('INVALID_CHANGE_SET')
  }
  const parsed = modelResumeChangeSetSchema.safeParse(input)
  if (!parsed.success) throw new ResumeChangeSetError('INVALID_CHANGE_SET')
  return validateParsedChangeSet(parsed.data)
}

function containsModelAuthoredScoreImpact(input: unknown) {
  if (!input || typeof input !== 'object' || !('changes' in input)) return false
  const changes = (input as { changes?: unknown }).changes
  return Array.isArray(changes) && changes.some((change) => {
    if (!change || typeof change !== 'object' || !('evidence' in change)) return false
    const evidence = (change as { evidence?: unknown }).evidence
    return Boolean(
      evidence
      && typeof evidence === 'object'
      && Object.prototype.hasOwnProperty.call(evidence, 'scoreImpact')
    )
  })
}

function validateParsedChangeSet(parsed: ResumeChangeSet): ResumeChangeSet {

  const ids = new Set<string>()
  const paths = new Set<string>()
  for (const change of parsed.changes) {
    if (!parseAllowedPath(change.path)) throw new ResumeChangeSetError('UNSUPPORTED_PATH')
    if (
      ids.has(change.id)
      || paths.has(change.path)
      || [...paths].some((path) => pathsConflict(path, change.path))
    ) {
      throw new ResumeChangeSetError('DUPLICATE_CHANGE')
    }
    ids.add(change.id)
    paths.add(change.path)
  }

  return parsed
}

function pathsConflict(first: string, second: string) {
  return first.startsWith(`${second}.`) || second.startsWith(`${first}.`)
}

export function requireResumeChangeConfirmation(changeSet: ResumeChangeSet): ResumeChangeSet {
  return {
    ...changeSet,
    changes: changeSet.changes.map((change) => ({ ...change, needsConfirmation: true }))
  }
}

export function resumeChangeBlockReason(change: ResumeChange): ResumeChangeBlockReason | null {
  if (change.evidence.support === 'unsupported') return 'UNSUPPORTED_EVIDENCE'
  if (isProtectedPath(change.path)) return 'PROTECTED_FIELD'
  if (change.evidence.transformation === 'remove') return 'UNSAFE_REMOVE'
  if (
    change.evidence.transformation === 'reorder'
    && change.path !== 'projects'
  ) return 'UNSTABLE_REORDER'
  if (
    change.evidence.transformation === 'add-from-fact'
    && !isFactBackedNarrativeCollectionPath(change.path)
  ) {
    return 'INVALID_ADD_FROM_FACT'
  }
  return null
}

export function isResumeChangeApplicable(change: ResumeChange) {
  return resumeChangeBlockReason(change) === null
}

export function validateResumeChangesAgainstApprovedPlan(
  changeSetInput: unknown,
  plan: ResumeChangePlan,
  requirementMatches: readonly ResumeChangeRequirementMatch[]
) {
  const changeSet = parseModelResumeChangeSet(changeSetInput)
  if (!plan.approvedAt) throw new ResumeChangeSetError('INVALID_CHANGE_SET')

  for (const change of changeSet.changes) {
    const referencedMatches = change.evidence.requirementIds.map((requirementId) => (
      requirementMatches.filter((match) => match.requirementId === requirementId)
    ))
    if (referencedMatches.some((matches) => matches.length !== 1)) {
      throw new ResumeChangeSetError('INVALID_CHANGE_SET')
    }
    const matches = referencedMatches.flat()
    const weakestMatchType = matches.reduce<ResumeChangeEvidence['matchType']>(
      (weakest, match) => weakerMatchType(weakest, match.status),
      'direct'
    )
    const followsOnePlanItem = plan.items.some((item) => (
      item.transformation === change.evidence.transformation
      && change.evidence.requirementIds.every((id) => item.requirementIds.includes(id))
      && change.evidence.factIds.every((id) => item.factIds.includes(id))
    ))
    const matchedFacts = new Set(
      requirementMatches
        .filter((match) => change.evidence.requirementIds.includes(match.requirementId))
        .flatMap((match) => match.factIds)
    )
    const everyRequirementHasCitedEvidence = matches.every((match) => (
      change.evidence.factIds.some((factId) => match.factIds.includes(factId))
    ))
    if (
      change.evidence.requirementIds.length === 0
      || change.evidence.matchType !== weakestMatchType
      || (weakestMatchType === 'gap' && change.evidence.support !== 'unsupported')
      || !followsOnePlanItem
      || change.evidence.factIds.some((id) => !matchedFacts.has(id))
      || (
        change.evidence.support !== 'unsupported'
        && !everyRequirementHasCitedEvidence
      )
    ) {
      throw new ResumeChangeSetError('INVALID_CHANGE_SET')
    }
  }
  return changeSet
}

function weakerMatchType(
  first: ResumeChangeEvidence['matchType'],
  second: ResumeChangeEvidence['matchType']
) {
  const rank: Record<ResumeChangeEvidence['matchType'], number> = {
    direct: 0,
    partial: 1,
    gap: 2
  }
  return rank[first] >= rank[second] ? first : second
}

export function applyResumeChanges(
  resume: ResumeData,
  changeSet: unknown,
  acceptedIds: Iterable<string>,
  context: ResumeChangeValidationContext = {}
) {
  return validateResumeChanges(resume, changeSet, acceptedIds, context)
}

export function validateResumeChanges(
  resume: ResumeData,
  changeSet: unknown,
  acceptedIds: Iterable<string>,
  context: ResumeChangeValidationContext = {}
) {
  const validated = parseResumeChangeSet(changeSet)
  const next = applyValidatedResumeChanges(resume, validated, acceptedIds, true)
  validateResumeChangeEvidence(validated, context)
  return next
}

export function validateResumeChangeCandidates(
  resume: ResumeData,
  changeSet: unknown
) {
  const validated = parseResumeChangeSet(changeSet)
  applyValidatedResumeChanges(
    resume,
    validated,
    validated.changes.map(({ id }) => id),
    false
  )
  return validated
}

export function validateResumeChangeEvidence(
  changeSet: unknown,
  context: ResumeChangeValidationContext = {}
) {
  const validated = parseResumeChangeSet(changeSet)
  const hasApplicableChanges = validated.changes.some(
    (change) => change.evidence.support !== 'unsupported'
  )
  if (
    hasApplicableChanges
    && (context.facts === undefined || context.requirements === undefined)
  ) {
    throw new ResumeChangeSetError('EVIDENCE_REFERENCE_INVALID')
  }
  if (!hasApplicableChanges) return validated

  const factsById = new Map(context.facts!.map((fact) => [fact.id, fact]))
  const requirementIds = new Set(context.requirements!.map(({ id }) => id))
  for (const change of validated.changes) {
    if (change.evidence.support === 'unsupported') continue
    if (
      change.evidence.requirementIds.some((id) => !requirementIds.has(id))
    ) {
      throw new ResumeChangeSetError('EVIDENCE_REFERENCE_INVALID')
    }
    const citedFacts: ResumeChangeFact[] = []
    for (const factId of change.evidence.factIds) {
      const fact = factsById.get(factId)
      if (!fact || !factSupportsChange(fact, change.evidence.support)) {
        throw new ResumeChangeSetError('EVIDENCE_REFERENCE_INVALID')
      }
      citedFacts.push(fact)
    }
    if (!hasClaimContentSupport(change, citedFacts)) {
      throw new ResumeChangeSetError('EVIDENCE_REFERENCE_INVALID')
    }
  }
  return validated
}

function applyValidatedResumeChanges(
  resume: ResumeData,
  validated: ResumeChangeSet,
  acceptedIds: Iterable<string>,
  enforceApplicability: boolean
) {
  const accepted = new Set(acceptedIds)
  const acceptedPaths = new Set<string>()
  const acceptedStructuralChanges: ResumeChange[] = []
  const next = structuredClone(resume)

  for (const change of validated.changes) {
    if (!accepted.has(change.id)) continue
    const segments = parseAllowedPath(change.path)
    if (!segments) throw new ResumeChangeSetError('UNSUPPORTED_PATH')

    if (change.evidence.transformation === 'reorder') {
      if (enforceApplicability) throwIfResumeChangeBlocked(change)
      applyStableProjectReorder(next, change)
      acceptedPaths.add(change.path)
      acceptedStructuralChanges.push(change)
      continue
    }

    const target = resolveParent(next, segments)
    if (!target) throw new ResumeChangeSetError('UNSUPPORTED_PATH')

    if (enforceApplicability) throwIfResumeChangeBlocked(change)

    const current = readTarget(target)
    if (change.evidence.transformation === 'add-from-fact') {
      applyFactBackedInsertion(current, target, change)
      acceptedPaths.add(change.path)
      acceptedStructuralChanges.push(change)
      continue
    }
    if (
      typeof current !== 'string'
      || typeof change.original !== 'string'
      || typeof change.proposed !== 'string'
    ) {
      throw new ResumeChangeSetError('INVALID_VALUE')
    }
    if (!deepEqual(current, change.original)) {
      throw new ResumeChangeSetError('ORIGINAL_MISMATCH')
    }
    if (!change.proposed.trim()) {
      throw new ResumeChangeSetError('INVALID_VALUE')
    }
    writeTarget(target, change.proposed)
    acceptedPaths.add(change.path)
  }

  try {
    const normalized = normalizeResumeData(next)
    assertStructuralOperationsPreserved(next, normalized, acceptedStructuralChanges)
    assertOnlyAcceptedChanges(resume, normalized, acceptedPaths)
    return normalized
  } catch (error) {
    if (error instanceof ResumeChangeSetError) throw error
    throw new ResumeChangeSetError('INVALID_VALUE')
  }
}

function assertStructuralOperationsPreserved(
  expected: ResumeData,
  normalized: ResumeData,
  changes: readonly ResumeChange[]
) {
  for (const change of changes) {
    if (change.evidence.transformation === 'reorder') {
      if (!deepEqual(expected.projects, normalized.projects)) {
        throw new ResumeChangeSetError('HIDDEN_NORMALIZATION_CHANGE')
      }
      continue
    }
    const segments = parseAllowedPath(change.path)
    const expectedTarget = segments ? resolveParent(expected, segments) : null
    const normalizedTarget = segments ? resolveParent(normalized, segments) : null
    if (
      !expectedTarget
      || !normalizedTarget
      || !deepEqual(readTarget(expectedTarget), readTarget(normalizedTarget))
    ) {
      throw new ResumeChangeSetError('HIDDEN_NORMALIZATION_CHANGE')
    }
  }
}

function throwIfResumeChangeBlocked(change: ResumeChange) {
  const blocked = resumeChangeBlockReason(change)
  if (blocked === 'UNSUPPORTED_EVIDENCE') {
    throw new ResumeChangeSetError('UNSUPPORTED_EVIDENCE')
  }
  if (blocked === 'PROTECTED_FIELD') {
    throw new ResumeChangeSetError('PROTECTED_FIELD')
  }
  if (blocked) throw new ResumeChangeSetError('UNSUPPORTED_TRANSFORMATION')
}

function applyFactBackedInsertion(
  current: unknown,
  target: ChangeTarget,
  change: ResumeChange
) {
  if (!isFactBackedNarrativeCollectionPath(change.path)) {
    throw new ResumeChangeSetError('UNSUPPORTED_TRANSFORMATION')
  }
  if (
    !Array.isArray(current)
    || !current.every((value) => typeof value === 'string')
    || !Array.isArray(change.original)
    || !change.original.every((value) => typeof value === 'string')
    || !Array.isArray(change.proposed)
    || !change.proposed.every((value) => typeof value === 'string')
  ) {
    throw new ResumeChangeSetError('INVALID_VALUE')
  }
  if (!deepEqual(current, change.original)) {
    throw new ResumeChangeSetError('ORIGINAL_MISMATCH')
  }
  const inserted = insertedString(change.original, change.proposed)
  if (
    inserted === null
    || change.original.some((value) => normalizeClaimText(value) === normalizeClaimText(inserted))
  ) {
    throw new ResumeChangeSetError('INVALID_VALUE')
  }
  writeTarget(target, [...change.proposed])
}

function applyStableProjectReorder(resume: ResumeData, change: ResumeChange) {
  if (change.path !== 'projects') {
    throw new ResumeChangeSetError('UNSUPPORTED_TRANSFORMATION')
  }
  if (
    !Array.isArray(change.original)
    || !change.original.every((value) => typeof value === 'string')
    || !Array.isArray(change.proposed)
    || !change.proposed.every((value) => typeof value === 'string')
  ) {
    throw new ResumeChangeSetError('INVALID_VALUE')
  }
  const currentIds = resume.projects.map(({ id }) => id)
  if (
    currentIds.some((id) => !id.trim())
    || new Set(currentIds).size !== currentIds.length
  ) {
    throw new ResumeChangeSetError('UNSUPPORTED_TRANSFORMATION')
  }
  if (!deepEqual(currentIds, change.original)) {
    throw new ResumeChangeSetError('ORIGINAL_MISMATCH')
  }
  if (
    change.proposed.length !== currentIds.length
    || new Set(change.proposed).size !== change.proposed.length
    || change.proposed.some((id) => !currentIds.includes(id))
  ) {
    throw new ResumeChangeSetError('INVALID_VALUE')
  }
  const projectsById = new Map(resume.projects.map((project) => [project.id, project]))
  resume.projects = change.proposed.map((id) => projectsById.get(id)!)
}

function insertedString(original: string[], proposed: string[]): string | null {
  if (proposed.length !== original.length + 1) return null
  let originalIndex = 0
  let inserted: string | null = null
  for (const value of proposed) {
    if (originalIndex < original.length && value === original[originalIndex]) {
      originalIndex += 1
      continue
    }
    if (!value.trim() || inserted !== null) return null
    inserted = value
  }
  return originalIndex === original.length ? inserted : null
}

function legacyUnsupportedEvidence(): ResumeChangeEvidence {
  return {
    requirementIds: [],
    factIds: [],
    matchType: 'gap',
    support: 'unsupported',
    confidence: 0,
    transformation: 'rewrite'
  }
}

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

function factSupportsChange(
  fact: ResumeChangeFact,
  support: ResumeChangeEvidence['support']
) {
  if (support === 'verified') return fact.verification === 'document-backed'
  if (support === 'user-confirmed') {
    return fact.verification === 'user-confirmed' || fact.verification === 'document-backed'
  }
  return false
}

const claimFunctionWords = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'with', 'by',
  'from', 'as', 'at', 'is', 'are', 'was', 'were', 'be', 'been',
  '的', '了', '和', '与', '及', '或', '在', '为', '于', '由', '对'
])

function hasClaimContentSupport(
  change: ResumeChange,
  citedFacts: readonly ResumeChangeFact[]
) {
  if (change.evidence.transformation === 'reorder') return true
  if (typeof change.original === 'string' && typeof change.proposed === 'string') {
    const proposed = change.proposed
    if (!proposed.trim()) return false
    return [change.original, ...citedFacts.map(({ text }) => text)]
      .some((source) => sourceSupportsClaim(source, proposed))
  }
  if (
    change.evidence.transformation === 'add-from-fact'
    && Array.isArray(change.original)
    && change.original.every((value) => typeof value === 'string')
    && Array.isArray(change.proposed)
    && change.proposed.every((value) => typeof value === 'string')
  ) {
    const inserted = insertedString(change.original, change.proposed)
    if (inserted === null) return false
    if (change.original.some((value) => normalizeClaimText(value) === normalizeClaimText(inserted))) {
      return false
    }
    return citedFacts.some(({ text }) => sourceSupportsClaim(text, inserted))
  }
  return false
}

function sourceSupportsClaim(source: string, claim: string) {
  const claimSet = claimTokens(claim)
  if (claimSet.size === 0) return false
  const sourceSet = claimTokens(source)
  if ([...claimSet].some((token) => !sourceSet.has(token))) return false
  if (containsNegation(source) && !containsNegation(claim)) return false
  const claimSequence = claimTokenSequence(claim)
  const sourceSequence = claimTokenSequence(source)
  if (claimSequence.length === 0) return false
  for (let start = 0; start <= sourceSequence.length - claimSequence.length; start += 1) {
    if (claimSequence.every((token, index) => sourceSequence[start + index] === token)) {
      return true
    }
  }
  return false
}

function claimTokenSequence(value: string) {
  const normalized = value.normalize('NFKC').toLowerCase()
  return (normalized.match(
    /[a-z]\+\+|[a-z]#|\.net|[a-z][a-z0-9]*(?:[./-][a-z0-9]+)+|\p{Script=Han}|[\p{L}\p{N}]+/gu
  ) ?? [])
}

function containsNegation(value: string) {
  const normalized = value.normalize('NFKC').toLowerCase().replace(/[‘’ʼ]/gu, "'")
  return /\b(?:no|not|never|without|neither|nor|cannot|can't|couldn't|didn't|doesn't|don't|isn't|wasn't|weren't|won't|wouldn't)\b/u
    .test(normalized)
    || /(?:未|不|无|非|没有|从未|并非)/u.test(normalized)
}

function normalizeClaimText(value: string) {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ')
}

function claimTokens(value: string) {
  const normalized = value.normalize('NFKC').toLowerCase()
  const tokens = new Set<string>()
  const hanRuns = normalized.match(/\p{Script=Han}+/gu) ?? []
  const words = normalized.replace(/\p{Script=Han}+/gu, ' ').match(/[\p{L}\p{N}]+/gu) ?? []

  for (const word of words) {
    if (!claimFunctionWords.has(word)) tokens.add(word)
  }
  for (const run of hanRuns) {
    const characters = [...run]
    characters.forEach((character) => {
      if (!claimFunctionWords.has(character)) tokens.add(character)
    })
    for (let index = 0; index < characters.length - 1; index += 1) {
      const pair = `${characters[index]}${characters[index + 1]}`
      if (![...pair].some((character) => claimFunctionWords.has(character))) tokens.add(pair)
    }
  }
  for (const match of normalized.matchAll(
    /(?:\b[a-z]\+\+|\b[a-z]#|\.net\b|\b[a-z][a-z0-9]*(?:[./-][a-z0-9]+)+|\b\d+(?:[.,]\d+)?(?:%|[-/]\d+(?:[.,]\d+)?%?))/giu
  )) {
    tokens.add(match[0])
  }
  return tokens
}

function isProtectedPath(path: string) {
  const segments = path.split('.')
  if (segments[0] === 'profile') {
    return ['name', 'englishName', 'title', 'email', 'phone'].includes(segments[1] ?? '')
  }
  if (segments[0] === 'experiences' && segments.length === 3) {
    return ['company', 'role', 'period'].includes(segments[2] ?? '')
  }
  if (segments[0] === 'education' && segments.length === 3) {
    return ['school', 'degree', 'major', 'period'].includes(segments[2] ?? '')
  }
  return false
}

function isFactBackedNarrativeCollectionPath(path: string) {
  return /^experiences\.(0|[1-9]\d*)\.bullets$/.test(path)
    || /^projects\.(0|[1-9]\d*)\.highlights$/.test(path)
}

function assertOnlyAcceptedChanges(
  before: unknown,
  after: unknown,
  acceptedPaths: ReadonlySet<string>,
  path = ''
): void {
  if (acceptedPaths.has(path)) return
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
      throw new ResumeChangeSetError('HIDDEN_NORMALIZATION_CHANGE')
    }
    for (let index = 0; index < before.length; index += 1) {
      assertOnlyAcceptedChanges(before[index], after[index], acceptedPaths, joinPath(path, String(index)))
    }
    return
  }

  if (isRecord(before) || isRecord(after)) {
    if (!isRecord(before) || !isRecord(after)) {
      throw new ResumeChangeSetError('HIDDEN_NORMALIZATION_CHANGE')
    }
    const beforeKeys = Object.keys(before).sort()
    const afterKeys = Object.keys(after).sort()
    if (!deepEqual(beforeKeys, afterKeys)) {
      throw new ResumeChangeSetError('HIDDEN_NORMALIZATION_CHANGE')
    }
    for (const key of beforeKeys) {
      assertOnlyAcceptedChanges(before[key], after[key], acceptedPaths, joinPath(path, key))
    }
    return
  }

  if (
    !deepEqual(before, after)
    && !acceptedPaths.has(path)
    && !allowedMetadataChanges.has(path)
  ) {
    throw new ResumeChangeSetError('HIDDEN_NORMALIZATION_CHANGE')
  }
}

const allowedMetadataChanges = new Set([
  'metadata.updatedAt', 'metadata.source', 'metadata.locale'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function joinPath(parent: string, child: string) {
  return parent ? `${parent}.${child}` : child
}

function ensureSerializedSize(input: unknown) {
  try {
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_RESUME_CHANGE_SET_BYTES) {
      throw new ResumeChangeSetError('CHANGE_SET_TOO_LARGE')
    }
  } catch (error) {
    if (error instanceof ResumeChangeSetError) throw error
    throw new ResumeChangeSetError('INVALID_CHANGE_SET')
  }
}

function parseAllowedPath(path: string): string[] | null {
  if (!path || path.startsWith('.') || path.endsWith('.') || path.includes('..') || /[\[\]]/.test(path)) {
    return null
  }
  const segments = path.split('.')
  if (segments.some((segment) => !segment || forbiddenSegments.has(segment))) return null
  if (segments.some((segment) => /^\d+$/.test(segment) && !/^(0|[1-9]\d*)$/.test(segment))) return null

  if (segments.length === 1 && segments[0] === 'projects') return segments

  if (segments.length === 2 && topLevelStringArrays.has(segments[0]) && isIndex(segments[1])) return segments

  if (segments[0] === 'profile') {
    if (segments.length === 2 && profileScalars.has(segments[1])) return segments
    if (segments.length === 3 && ['summary', 'tags'].includes(segments[1]) && isIndex(segments[2])) return segments
    if (segments.length === 4 && segments[1] === 'links' && isIndex(segments[2]) && ['label', 'url'].includes(segments[3])) return segments
    return null
  }

  if (segments[0] === 'skills') {
    if (segments.length === 3 && isIndex(segments[1]) && segments[2] === 'group') return segments
    if (segments.length === 4 && isIndex(segments[1]) && segments[2] === 'items' && isIndex(segments[3])) return segments
    return null
  }

  if (segments[0] === 'experiences') {
    if (segments.length === 3 && isIndex(segments[1]) && experienceScalars.has(segments[2])) return segments
    if (segments.length === 3 && isIndex(segments[1]) && segments[2] === 'bullets') return segments
    if (segments.length === 4 && isIndex(segments[1]) && ['tags', 'bullets'].includes(segments[2]) && isIndex(segments[3])) return segments
    return null
  }

  if (segments[0] === 'projects') {
    if (segments.length === 3 && isIndex(segments[1]) && projectScalars.has(segments[2])) return segments
    if (segments.length === 3 && isIndex(segments[1]) && segments[2] === 'highlights') return segments
    if (segments.length === 4 && isIndex(segments[1]) && ['tags', 'highlights'].includes(segments[2]) && isIndex(segments[3])) return segments
    return null
  }

  if (segments[0] === 'education') {
    if (segments.length === 3 && isIndex(segments[1]) && educationScalars.has(segments[2])) return segments
    if (segments.length === 4 && isIndex(segments[1]) && segments[2] === 'details' && isIndex(segments[3])) return segments
  }

  return null
}

function isIndex(segment: string) {
  return /^(0|[1-9]\d*)$/.test(segment)
}

function resolveParent(root: ResumeData, segments: string[]): ChangeTarget | null {
  let current: unknown = root
  for (const segment of segments.slice(0, -1)) {
    if (current === null || typeof current !== 'object') return null
    if (Array.isArray(current)) {
      if (!isIndex(segment) || Number(segment) >= current.length) return null
      current = current[Number(segment)]
      continue
    }
    if (!Object.hasOwn(current, segment)) return null
    current = (current as Record<string, unknown>)[segment]
  }

  if (current === null || typeof current !== 'object') return null
  const key = segments.at(-1)!
  if (Array.isArray(current)) {
    if (!isIndex(key) || Number(key) >= current.length) return null
    return { parent: current as unknown[], key: Number(key) }
  }
  if (forbiddenSegments.has(key)) return null
  if (!Object.hasOwn(current, key) && !isOptionalStringPath(segments)) return null
  return { parent: current as Record<string, unknown>, key }
}

type ChangeTarget =
  | { parent: unknown[]; key: number }
  | { parent: Record<string, unknown>; key: string }

function readTarget(target: ChangeTarget) {
  return Array.isArray(target.parent)
    ? target.parent[target.key as number]
    : target.parent[target.key]
}

function writeTarget(target: ChangeTarget, value: unknown) {
  if (Array.isArray(target.parent)) target.parent[target.key as number] = value
  else target.parent[target.key] = value
}

function isOptionalStringPath(segments: string[]) {
  return segments.length === 2 && segments[0] === 'profile' && profileScalars.has(segments[1])
    || segments.length === 3 && segments[0] === 'experiences' && segments[2] === 'location'
    || segments.length === 3 && segments[0] === 'education' && ['degree', 'major', 'period'].includes(segments[2])
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
  }
  if (typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left as object).sort()
    const rightKeys = Object.keys(right as object).sort()
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index]
        && deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
  }
  return false
}
