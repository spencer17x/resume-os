import { z } from 'zod'
import {
  createResumeId,
  normalizeResumeData,
  resumeDataSchema,
  resumeSourceSchema,
  type ResumeData,
  type ResumeDraft,
  type ResumeDraftState,
  type ResumeSnapshot
} from './resume-model'

export const RESUME_DRAFT_STORAGE_KEY = 'resume-os-drafts-v1'
export const MAX_RESUME_SNAPSHOTS = 20

const isoTimestampSchema = z.iso.datetime({ offset: true })

const resumeSnapshotSchema = z.object({
  id: z.string().min(1),
  createdAt: isoTimestampSchema,
  reason: z.enum(['manual', 'agent-change']),
  data: resumeDataSchema
})

const resumeDraftSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: resumeSourceSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  data: resumeDataSchema,
  snapshots: z.array(resumeSnapshotSchema)
}).superRefine((draft, context) => {
  if (draft.source !== draft.data.metadata.source) {
    context.addIssue({ code: 'custom', message: 'Draft source must match resume metadata source' })
  }
})

const resumeDraftStateSchema = z.object({
  activeDraftId: z.string().min(1).nullable(),
  drafts: z.array(resumeDraftSchema)
}).superRefine((state, context) => {
  const ids = new Set<string>()

  for (const draft of state.drafts) {
    if (ids.has(draft.id)) {
      context.addIssue({ code: 'custom', message: 'Draft ids must be unique' })
    }
    ids.add(draft.id)
  }

  if (state.activeDraftId && !ids.has(state.activeDraftId)) {
    context.addIssue({ code: 'custom', message: 'Active draft must exist' })
  }
})

const resumeDraftEnvelopeSchema = z.object({
  version: z.literal(1),
  state: resumeDraftStateSchema
})

const syncStampSchema = z.object({
  counter: z.number().int().nonnegative(),
  actor: z.string().min(1)
})

const resumeSyncEntrySchema = syncStampSchema.extend({ id: z.string().min(1) })
const resumeTombstoneSchema = resumeSyncEntrySchema
const activeSelectionSchema = syncStampSchema.extend({ draftId: z.string().min(1).nullable() })

const resumeDraftSyncSchema = z.object({
  clock: z.number().int().nonnegative(),
  entries: z.array(resumeSyncEntrySchema),
  tombstones: z.array(resumeTombstoneSchema),
  active: activeSelectionSchema
})

const resumeDraftEnvelopeV3Schema = z.object({
  version: z.literal(3),
  state: resumeDraftStateSchema,
  sync: resumeDraftSyncSchema
}).superRefine((envelope, context) => {
  const draftIds = new Set(envelope.state.drafts.map((draft) => draft.id))
  const entryIds = new Set<string>()
  const tombstoneIds = new Set<string>()

  for (const entry of envelope.sync.entries) {
    if (!draftIds.has(entry.id) || entryIds.has(entry.id)) {
      context.addIssue({ code: 'custom', message: 'Sync entries must uniquely match draft ids' })
    }
    entryIds.add(entry.id)
  }
  if (entryIds.size !== draftIds.size) {
    context.addIssue({ code: 'custom', message: 'Every draft must have one sync entry' })
  }

  for (const tombstone of envelope.sync.tombstones) {
    if (draftIds.has(tombstone.id) || tombstoneIds.has(tombstone.id)) {
      context.addIssue({ code: 'custom', message: 'Tombstones must be unique and exclude live drafts' })
    }
    tombstoneIds.add(tombstone.id)
  }

  const counters = [
    ...envelope.sync.entries.map((entry) => entry.counter),
    ...envelope.sync.tombstones.map((tombstone) => tombstone.counter),
    envelope.sync.active.counter
  ]
  if (counters.some((counter) => counter > envelope.sync.clock)) {
    context.addIssue({ code: 'custom', message: 'Sync clock must cover every change' })
  }

  if (envelope.sync.active.draftId !== envelope.state.activeDraftId) {
    context.addIssue({ code: 'custom', message: 'Active selection metadata must match state' })
  }
})

const resumeDraftEnvelopeV2Schema = z.object({
  version: z.literal(2),
  state: resumeDraftStateSchema,
  sync: z.object({
    clock: z.number().int().nonnegative(),
    entries: z.unknown(),
    tombstones: z.array(resumeTombstoneSchema)
  })
})

type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>

export type ResumeDraftSyncStamp = z.infer<typeof syncStampSchema>
export type ResumeDraftSyncEntry = z.infer<typeof resumeSyncEntrySchema>
export type ResumeDraftTombstone = z.infer<typeof resumeTombstoneSchema>
export type ResumeDraftActiveSelection = z.infer<typeof activeSelectionSchema>
export type ResumeDraftDocument = {
  state: ResumeDraftState
  sync: {
    clock: number
    entries: ResumeDraftSyncEntry[]
    tombstones: ResumeDraftTombstone[]
    active: ResumeDraftActiveSelection
  }
}

export type DraftStateReadResult =
  | { status: 'empty' }
  | { status: 'valid'; state: ResumeDraftState; document: ResumeDraftDocument }
  | { status: 'invalid' }

export const emptyDraftState: ResumeDraftState = { activeDraftId: null, drafts: [] }
export const emptyDraftDocument: ResumeDraftDocument = {
  state: emptyDraftState,
  sync: {
    clock: 0,
    entries: [],
    tombstones: [],
    active: { counter: 0, actor: 'initial', draftId: null }
  }
}

export function parseDraftState(serialized: string | null): DraftStateReadResult {
  try {
    if (serialized === null) return { status: 'empty' }

    const value: unknown = JSON.parse(serialized)
    const current = resumeDraftEnvelopeV3Schema.safeParse(value)
    if (current.success) {
      const document = normalizeDocument({ state: current.data.state, sync: current.data.sync })
      return { status: 'valid', state: document.state, document }
    }

    const previous = resumeDraftEnvelopeV2Schema.safeParse(value)
    if (previous.success) {
      const state = normalizeState(previous.data.state)
      const parsedEntries = parseLegacyV2Entries(previous.data.sync.entries)
      if (!parsedEntries) return { status: 'invalid' }
      const entries = upgradeLegacyV2Entries(state, parsedEntries)
      const document = normalizeDocument({
        state,
        sync: {
          clock: Math.max(
            previous.data.sync.clock,
            ...entries.map((entry) => entry.counter),
            ...previous.data.sync.tombstones.map((tombstone) => tombstone.counter)
          ),
          entries,
          tombstones: previous.data.sync.tombstones,
          active: legacyActiveSelection(state, entries)
        }
      })
      return { status: 'valid', state: document.state, document }
    }

    const legacy = resumeDraftEnvelopeSchema.safeParse(value)
    if (!legacy.success) return { status: 'invalid' }

    const document = createDraftDocument(legacy.data.state)
    return { status: 'valid', state: document.state, document }
  } catch {
    return { status: 'invalid' }
  }
}

export function inspectDraftState(storage: Pick<Storage, 'getItem'>): DraftStateReadResult {
  try {
    return parseDraftState(storage.getItem(RESUME_DRAFT_STORAGE_KEY))
  } catch {
    return { status: 'invalid' }
  }
}

export function readDraftState(storage: Pick<Storage, 'getItem'>): ResumeDraftState | null {
  const result = inspectDraftState(storage)
  return result.status === 'valid' ? result.state : null
}

export function writeDraftState(storage: DraftStorage, state: ResumeDraftState): void {
  try {
    const parsed = resumeDraftStateSchema.safeParse(state)
    if (!parsed.success) return

    const normalizedState = {
      ...parsed.data,
      drafts: parsed.data.drafts.map(normalizeDraft)
    }
    storage.setItem(RESUME_DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, state: normalizedState }))
  } catch {
    // Local storage is optional. The in-memory provider state remains usable.
  }
}

export function writeDraftDocument(storage: DraftStorage, document: ResumeDraftDocument): void {
  try {
    const normalized = normalizeDocument(document)
    storage.setItem(RESUME_DRAFT_STORAGE_KEY, JSON.stringify({
      version: 3,
      state: normalized.state,
      sync: normalized.sync
    }))
  } catch {
    // Local storage is optional. The in-memory provider state remains usable.
  }
}

export function createDraftDocument(state: ResumeDraftState): ResumeDraftDocument {
  const normalizedState = normalizeState(state)
  const entries = normalizedState.drafts.map(legacyEntry)
  const active = legacyActiveSelection(normalizedState, entries)
  return {
    state: normalizedState,
    sync: {
      clock: Math.max(active.counter, 0, ...entries.map((entry) => entry.counter)),
      entries,
      tombstones: [],
      active
    }
  }
}

export function evolveDraftDocument(
  current: ResumeDraftDocument,
  nextState: ResumeDraftState,
  actor: string
): ResumeDraftDocument {
  const normalizedCurrent = normalizeDocument(current)
  const normalizedNextState = excludeRetiredIds(normalizedCurrent, normalizeState(nextState))
  if (statesEqual(normalizedCurrent.state, normalizedNextState)) return normalizedCurrent

  const counter = normalizedCurrent.sync.clock + 1
  const stamp = { counter, actor: actor.trim() || 'anonymous' }
  const currentDrafts = new Map(normalizedCurrent.state.drafts.map((draft) => [draft.id, draft]))
  const nextDrafts = new Map(normalizedNextState.drafts.map((draft) => [draft.id, draft]))
  const currentEntries = new Map(normalizedCurrent.sync.entries.map((entry) => [entry.id, entry]))
  const entries: ResumeDraftSyncEntry[] = []
  // Draft ids are permanently retired after deletion; tombstones are never removed or reused.
  const tombstones = new Map(normalizedCurrent.sync.tombstones.map((item) => [item.id, item]))

  for (const draft of normalizedNextState.drafts) {
    const previous = currentDrafts.get(draft.id)
    const entry = !previous || canonicalDraft(previous) !== canonicalDraft(draft)
      ? { id: draft.id, ...stamp }
      : currentEntries.get(draft.id) ?? legacyEntry(draft)
    entries.push(entry)
  }

  for (const id of currentDrafts.keys()) {
    if (!nextDrafts.has(id)) {
      tombstones.set(id, { id, ...stamp })
    }
  }

  return normalizeDocument({
    state: normalizedNextState,
    sync: {
      clock: counter,
      entries,
      tombstones: [...tombstones.values()],
      active: normalizedCurrent.state.activeDraftId !== normalizedNextState.activeDraftId
        ? { ...stamp, draftId: normalizedNextState.activeDraftId }
        : normalizedCurrent.sync.active
    }
  })
}

export function mergeDraftDocuments(
  current: ResumeDraftDocument,
  incoming: ResumeDraftDocument
): ResumeDraftDocument {
  const left = normalizeDocument(current)
  const right = normalizeDocument(incoming)
  const leftEntries = new Map(left.sync.entries.map((entry) => [entry.id, entry]))
  const rightEntries = new Map(right.sync.entries.map((entry) => [entry.id, entry]))
  const leftDrafts = new Map(left.state.drafts.map((draft) => [draft.id, draft]))
  const rightDrafts = new Map(right.state.drafts.map((draft) => [draft.id, draft]))
  const leftTombstones = new Map(left.sync.tombstones.map((item) => [item.id, item]))
  const rightTombstones = new Map(right.sync.tombstones.map((item) => [item.id, item]))
  const ids = new Set([
    ...leftDrafts.keys(),
    ...rightDrafts.keys(),
    ...leftTombstones.keys(),
    ...rightTombstones.keys()
  ])
  const drafts: ResumeDraft[] = []
  const entries: ResumeDraftSyncEntry[] = []
  const tombstones: ResumeDraftTombstone[] = []

  for (const id of [...ids].sort()) {
    const candidates: SyncCandidate[] = []
    const leftDraft = leftDrafts.get(id)
    const rightDraft = rightDrafts.get(id)
    const leftTombstone = leftTombstones.get(id)
    const rightTombstone = rightTombstones.get(id)
    if (leftDraft) candidates.push({ kind: 'draft', draft: leftDraft, stamp: leftEntries.get(id)! })
    if (rightDraft) candidates.push({ kind: 'draft', draft: rightDraft, stamp: rightEntries.get(id)! })
    if (leftTombstone) candidates.push({ kind: 'deleted', stamp: leftTombstone })
    if (rightTombstone) candidates.push({ kind: 'deleted', stamp: rightTombstone })

    const deletionCandidates = candidates.filter((candidate) => candidate.kind === 'deleted')
    if (deletionCandidates.length > 0) {
      const winner = deletionCandidates.reduce((newest, candidate) =>
        compareStamps(candidate.stamp, newest.stamp) > 0 ? candidate : newest
      )
      tombstones.push({ id, ...winner.stamp })
    } else {
      const winner = candidates.reduce(selectNewerCandidate)
      if (winner.kind === 'deleted') throw new Error('Unexpected deletion candidate')
      drafts.push(winner.draft)
      entries.push({ id, ...winner.stamp })
    }
  }

  const active = resolveActiveSelection(left.sync.active, right.sync.active, drafts)
  return normalizeDocument({
    state: { activeDraftId: active.draftId, drafts },
    sync: {
      clock: Math.max(left.sync.clock, right.sync.clock),
      entries,
      tombstones,
      active
    }
  })
}

export function draftDocumentsEqual(left: ResumeDraftDocument, right: ResumeDraftDocument) {
  return documentFingerprint(left) === documentFingerprint(right)
}

export function addDraft(state: ResumeDraftState, draft: ResumeDraft): ResumeDraftState {
  if (state.drafts.some((existing) => existing.id === draft.id)) return state

  const next = cloneState(state)
  next.drafts.push(normalizeDraft(draft))
  next.activeDraftId = draft.id
  return next
}

export function renameDraft(
  state: ResumeDraftState,
  id: string,
  name: string,
  options: { now?: string } = {}
): ResumeDraftState {
  const trimmedName = name.trim()
  const index = state.drafts.findIndex((draft) => draft.id === id)
  if (!trimmedName || index === -1) return state

  const next = cloneState(state)
  next.drafts[index].name = trimmedName
  const requestedTimestamp = isoTimestampSchema.parse(options.now ?? new Date().toISOString())
  const nextTimestamp = Math.max(
    Date.parse(requestedTimestamp),
    Date.parse(next.drafts[index].updatedAt) + 1
  )
  next.drafts[index].updatedAt = new Date(nextTimestamp).toISOString()
  return next
}

export function deleteDraft(state: ResumeDraftState, id: string): ResumeDraftState {
  if (!state.drafts.some((draft) => draft.id === id)) return state

  const next = cloneState(state)
  next.drafts = next.drafts.filter((draft) => draft.id !== id)

  if (next.activeDraftId === id) {
    next.activeDraftId = mostRecentlyUpdatedId(next.drafts)
  }

  return next
}

export function setActiveDraft(state: ResumeDraftState, id: string): ResumeDraftState {
  if (state.activeDraftId === id || !state.drafts.some((draft) => draft.id === id)) return state

  const next = cloneState(state)
  next.activeDraftId = id
  return next
}

export function mergeDraftStates(current: ResumeDraftState, incoming: ResumeDraftState): ResumeDraftState {
  const currentState = normalizeState(current)
  const incomingState = normalizeState(incoming)
  const drafts = new Map(currentState.drafts.map((draft) => [draft.id, draft]))

  for (const draft of incomingState.drafts) {
    const existing = drafts.get(draft.id)
    if (
      !existing ||
      draft.updatedAt > existing.updatedAt ||
      (draft.updatedAt === existing.updatedAt && canonicalDraft(draft) > canonicalDraft(existing))
    ) {
      drafts.set(draft.id, draft)
    }
  }

  const mergedDrafts = [...drafts.values()]
  const mergedIds = new Set(mergedDrafts.map((draft) => draft.id))
  const activeDraftId = incomingState.activeDraftId && mergedIds.has(incomingState.activeDraftId)
    ? incomingState.activeDraftId
    : currentState.activeDraftId && mergedIds.has(currentState.activeDraftId)
      ? currentState.activeDraftId
      : mostRecentlyUpdatedId(mergedDrafts)

  return { activeDraftId, drafts: mergedDrafts }
}

export function updateDraftData(
  state: ResumeDraftState,
  id: string,
  data: ResumeData,
  options: {
    snapshotReason?: ResumeSnapshot['reason']
    now?: string
    snapshotId?: string
  } = {}
): ResumeDraftState {
  const index = state.drafts.findIndex((draft) => draft.id === id)
  if (index === -1) return state

  const next = cloneState(state)
  const draft = next.drafts[index]
  const now = options.now ?? new Date().toISOString()
  const input = resumeDataSchema.parse(data)

  if (options.snapshotReason) {
    const requestedSnapshotId = options.snapshotId?.trim()
    const snapshot: ResumeSnapshot = {
      id: requestedSnapshotId || createResumeId('snapshot'),
      createdAt: now,
      reason: options.snapshotReason,
      data: resumeDataSchema.parse(draft.data)
    }
    draft.snapshots = [...draft.snapshots, snapshot]
  }

  draft.data = normalizeResumeData(input, {
    source: draft.source,
    locale: input.metadata.locale,
    now
  })
  draft.updatedAt = now
  next.drafts[index] = normalizeDraft(draft)

  return next
}

function cloneState(state: ResumeDraftState): ResumeDraftState {
  return normalizeState(state)
}

function normalizeState(state: ResumeDraftState): ResumeDraftState {
  const parsed = resumeDraftStateSchema.parse(state)
  return { ...parsed, drafts: parsed.drafts.map(normalizeDraft) }
}

function normalizeDocument(document: ResumeDraftDocument): ResumeDraftDocument {
  const parsed = resumeDraftEnvelopeV3Schema.parse({ version: 3, ...document })
  return {
    state: normalizeState(parsed.state),
    sync: {
      clock: parsed.sync.clock,
      entries: [...parsed.sync.entries].sort((left, right) => compareIds(left.id, right.id)),
      tombstones: [...parsed.sync.tombstones].sort((left, right) => compareIds(left.id, right.id)),
      active: parsed.sync.active
    }
  }
}

function normalizeDraft(draft: ResumeDraft): ResumeDraft {
  const parsed = resumeDraftSchema.parse(draft)
  return {
    ...parsed,
    createdAt: canonicalTimestamp(parsed.createdAt),
    updatedAt: canonicalTimestamp(parsed.updatedAt),
    snapshots: [...parsed.snapshots]
      .map((snapshot) => ({ ...snapshot, createdAt: canonicalTimestamp(snapshot.createdAt) }))
      .sort((left, right) => {
        const timeDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt)
        if (timeDifference) return timeDifference
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
      })
      .slice(-MAX_RESUME_SNAPSHOTS)
  }
}

function mostRecentlyUpdatedId(drafts: ResumeDraft[]) {
  return drafts.reduce<ResumeDraft | null>((latest, draft) => {
    if (!latest) return draft
    const timeDifference = Date.parse(draft.updatedAt) - Date.parse(latest.updatedAt)
    if (timeDifference > 0 || (timeDifference === 0 && compareIds(draft.id, latest.id) < 0)) return draft
    return latest
  }, null)?.id ?? null
}

type SyncCandidate =
  | { kind: 'draft'; draft: ResumeDraft; stamp: ResumeDraftSyncStamp }
  | { kind: 'deleted'; stamp: ResumeDraftSyncStamp }

function selectNewerCandidate(winner: SyncCandidate, candidate: SyncCandidate): SyncCandidate {
  const comparison = compareStamps(candidate.stamp, winner.stamp)
  if (comparison > 0) return candidate
  if (comparison < 0) return winner
  if (candidate.kind === 'deleted') return candidate
  if (winner.kind === 'deleted') return winner
  return canonicalDraft(candidate.draft) > canonicalDraft(winner.draft) ? candidate : winner
}

function compareStamps(left: ResumeDraftSyncStamp, right: ResumeDraftSyncStamp) {
  if (left.counter !== right.counter) return left.counter - right.counter
  return left.actor < right.actor ? -1 : left.actor > right.actor ? 1 : 0
}

function resolveActiveSelection(
  left: ResumeDraftActiveSelection,
  right: ResumeDraftActiveSelection,
  drafts: ResumeDraft[]
) {
  const liveIds = new Set(drafts.map((draft) => draft.id))
  const candidates = [left, right].sort((first, second) => {
    const comparison = compareStamps(second, first)
    return comparison || compareIds(second.draftId ?? '', first.draftId ?? '')
  })
  const validSelection = candidates.find((candidate) =>
    candidate.draftId !== null && liveIds.has(candidate.draftId)
  )
  if (validSelection) return validSelection

  const winner = candidates[0]
  const fallbackId = mostRecentlyUpdatedId(drafts)
  if (!fallbackId) return { ...winner, draftId: null }

  return {
    counter: winner.counter,
    actor: `fallback:${hashString(winner.actor)}:${hashString(fallbackId)}`,
    draftId: fallbackId
  }
}

function legacyEntry(draft: ResumeDraft): ResumeDraftSyncEntry {
  const updatedAt = canonicalTimestamp(draft.updatedAt)
  return {
    id: draft.id,
    counter: Math.max(0, Date.parse(updatedAt)),
    actor: `legacy:${updatedAt}:${hashString(canonicalDraft(draft))}`
  }
}

function legacyActiveSelection(
  state: ResumeDraftState,
  entries: ResumeDraftSyncEntry[]
): ResumeDraftActiveSelection {
  const selected = entries.find((entry) => entry.id === state.activeDraftId)
  return {
    counter: selected?.counter ?? 0,
    actor: selected ? `legacy-active:${selected.actor}` : 'legacy-active:none',
    draftId: selected?.id ?? null
  }
}

function canonicalDraft(draft: ResumeDraft) {
  return JSON.stringify(normalizeDraft(draft))
}

function statesEqual(left: ResumeDraftState, right: ResumeDraftState) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function documentFingerprint(document: ResumeDraftDocument) {
  const normalized = normalizeDocument(document)
  return JSON.stringify({
    state: {
      activeDraftId: normalized.state.activeDraftId,
      drafts: [...normalized.state.drafts].sort((left, right) => compareIds(left.id, right.id))
    },
    sync: normalized.sync
  })
}

function excludeRetiredIds(document: ResumeDraftDocument, state: ResumeDraftState): ResumeDraftState {
  const retiredIds = new Set(document.sync.tombstones.map((tombstone) => tombstone.id))
  if (retiredIds.size === 0) return state

  const drafts = state.drafts.filter((draft) => !retiredIds.has(draft.id))
  const ids = new Set(drafts.map((draft) => draft.id))
  const activeDraftId = state.activeDraftId && ids.has(state.activeDraftId)
    ? state.activeDraftId
    : document.state.activeDraftId && ids.has(document.state.activeDraftId)
      ? document.state.activeDraftId
      : mostRecentlyUpdatedId(drafts)
  return { activeDraftId, drafts }
}

function parseLegacyV2Entries(value: unknown): ResumeDraftSyncEntry[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const entries: ResumeDraftSyncEntry[] = []
  for (const id of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, id)
    const stamp = syncStampSchema.safeParse(descriptor?.value)
    if (!stamp.success) return null
    entries.push({ id, ...stamp.data })
  }
  return entries
}

function upgradeLegacyV2Entries(state: ResumeDraftState, entries: ResumeDraftSyncEntry[]) {
  const drafts = new Map(state.drafts.map((draft) => [draft.id, draft]))
  return entries.map((entry) => {
    const draft = drafts.get(entry.id)
    if (!draft) return entry

    const migrated = legacyEntry(draft)
    return {
      id: entry.id,
      counter: Math.max(entry.counter, migrated.counter),
      actor: entry.counter === 0 && entry.actor.startsWith('legacy:') ? migrated.actor : entry.actor
    }
  })
}

function canonicalTimestamp(value: string) {
  return new Date(Date.parse(value)).toISOString()
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function compareIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}
