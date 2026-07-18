import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResumeDraft, normalizeResumeData, type ResumeDraftState } from './resume-model'
import {
  RESUME_DRAFT_STORAGE_KEY,
  addDraft,
  createDraftDocument,
  deleteDraft,
  draftDocumentsEqual,
  evolveDraftDocument,
  inspectDraftState,
  mergeDraftDocuments,
  mergeDraftStates,
  readDraftState,
  renameDraft,
  setActiveDraft,
  updateDraftData,
  writeDraftDocument,
  writeDraftState
} from './resume-store'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

class ThrowingStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  getItem(): string | null {
    throw new Error('Storage unavailable')
  }

  setItem(): void {
    throw new Error('Storage unavailable')
  }
}

const initialState: ResumeDraftState = { activeDraftId: null, drafts: [] }

function resume(name = 'Ada') {
  return normalizeResumeData({
    profile: { name, title: 'Engineer', summary: [], tags: [] },
    skills: [],
    experiences: [],
    projects: [],
    openSource: [],
    metadata: { source: 'sample', locale: 'en', updatedAt: '2026-07-06T00:00:00.000Z' }
  })
}

function draft(id: string, name = id, updatedAt = '2026-07-06T00:00:00.000Z') {
  return createResumeDraft(resume(name), { id, name, now: updatedAt })
}

function draftWithSnapshots(id: string, count = 21) {
  return {
    ...draft(id),
    snapshots: Array.from({ length: count }, (_, index) => ({
      id: `snapshot-${index + 1}`,
      createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      reason: 'manual' as const,
      data: resume(`Version ${index + 1}`)
    }))
  }
}

describe('resume draft store', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('adds a cloned draft and makes it active', () => {
    const input = draft('draft-1')
    const state = addDraft(initialState, input)

    expect(state).toEqual({ activeDraftId: 'draft-1', drafts: [input] })
    expect(state.drafts[0]).not.toBe(input)
    expect(state.drafts[0].data).not.toBe(input.data)
  })

  it('keeps the newest twenty snapshots when adding a draft', () => {
    const input = draftWithSnapshots('draft-1')

    const state = addDraft(initialState, input)

    expect(state.drafts[0].snapshots.map((snapshot) => snapshot.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `snapshot-${index + 2}`)
    )
    expect(input.snapshots).toHaveLength(21)
  })

  it('sorts persisted snapshots chronologically before retaining the latest twenty', () => {
    const input = draftWithSnapshots('draft-1')
    input.snapshots.reverse()

    const state = addDraft(initialState, input)

    expect(state.drafts[0].snapshots.map((snapshot) => snapshot.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `snapshot-${index + 2}`)
    )
  })

  it('uses snapshot ids as a deterministic tie-break for equal timestamps', () => {
    const input = draft('draft-1')
    const timestamp = '2026-07-08T00:00:00.000Z'
    input.snapshots = ['c', 'a', 'b'].map((id) => ({
      id,
      createdAt: timestamp,
      reason: 'manual',
      data: resume(id)
    }))

    expect(addDraft(initialState, input).drafts[0].snapshots.map(({ id }) => id)).toEqual(['a', 'b', 'c'])
  })

  it('rejects persisted snapshots with non-ISO timestamps', () => {
    const storage = new MemoryStorage()
    const input = draft('draft-1')
    input.snapshots = [{
      id: 'snapshot-1',
      createdAt: 'not-a-timestamp',
      reason: 'manual',
      data: resume()
    }]
    storage.setItem(RESUME_DRAFT_STORAGE_KEY, JSON.stringify({
      version: 1,
      state: { activeDraftId: 'draft-1', drafts: [input] }
    }))

    expect(readDraftState(storage)).toBeNull()
  })

  it('returns the original state when a prototype-like draft id is duplicated', () => {
    let state = addDraft(initialState, draft('__proto__'))
    state = addDraft(state, draft('constructor'))

    const next = addDraft(state, draft('__proto__', 'Replacement'))

    expect(next).toBe(state)
    expect(next.activeDraftId).toBe('constructor')
    expect(next.drafts.map((item) => item.id)).toEqual(['__proto__', 'constructor'])
    expect(next.drafts[0].name).toBe('__proto__')
  })

  it('renames a draft with trimmed non-empty text', () => {
    const state = addDraft(initialState, draft('draft-1'))

    expect(renameDraft(state, 'draft-1', '  Senior Resume  ').drafts[0].name).toBe('Senior Resume')
    expect(renameDraft(state, 'draft-1', '   ')).toBe(state)
    expect(renameDraft(state, 'missing', 'Resume')).toBe(state)
  })

  it('advances updatedAt when renaming a draft', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'))
    const state = addDraft(initialState, draft('draft-1'))

    const next = renameDraft(state, 'draft-1', 'Updated Resume')

    expect(next.drafts[0].updatedAt).toBe('2026-07-10T00:00:00.000Z')
    vi.useRealTimers()
  })

  it('keeps rename timestamps strictly monotonic when the supplied clock is stale', () => {
    const state = addDraft(initialState, draft('draft-1', 'Original', '2026-07-10T00:00:00.000Z'))

    const next = renameDraft(state, 'draft-1', 'Updated', {
      now: '2026-07-09T00:00:00.000Z'
    })

    expect(next.drafts[0].updatedAt).toBe('2026-07-10T00:00:00.001Z')
  })

  it('resolves equal-timestamp draft conflicts deterministically', () => {
    const timestamp = '2026-07-10T00:00:00.000Z'
    const ada = draft('shared', 'Ada', timestamp)
    const grace = draft('shared', 'Grace', timestamp)
    const left = { activeDraftId: 'shared', drafts: [ada] }
    const right = { activeDraftId: 'shared', drafts: [grace] }

    expect(mergeDraftStates(left, right)).toEqual(mergeDraftStates(right, left))
  })

  it('selects only existing drafts as active', () => {
    const state = addDraft(addDraft(initialState, draft('draft-1')), draft('draft-2'))

    expect(setActiveDraft(state, 'draft-1').activeDraftId).toBe('draft-1')
    expect(setActiveDraft(state, 'missing')).toBe(state)
  })

  it('selects the most recently updated remaining draft after deleting the active draft', () => {
    let state = addDraft(initialState, draft('older', 'Older', '2026-07-06T00:00:00.000Z'))
    state = addDraft(state, draft('newer', 'Newer', '2026-07-07T00:00:00.000Z'))
    state = setActiveDraft(state, 'older')

    const next = deleteDraft(state, 'older')

    expect(next.activeDraftId).toBe('newer')
    expect(deleteDraft(next, 'missing')).toBe(next)
  })

  it('retains deletion knowledge beyond one hundred deletes and rejects id reuse', () => {
    let state = initialState
    for (let index = 0; index < 101; index += 1) {
      state = addDraft(state, draft(`draft-${index}`))
    }
    const offlineDocument = createDraftDocument(state)
    let document = createDraftDocument(state)

    for (const item of state.drafts) {
      document = evolveDraftDocument(document, deleteDraft(document.state, item.id), 'test-tab')
    }

    expect(document.sync.tombstones).toHaveLength(101)
    expect(document.sync.tombstones.map((item) => item.id)).toContain('draft-0')
    const merged = mergeDraftDocuments(document, offlineDocument)
    expect(merged.state.drafts).toEqual([])

    const attemptedReuse = addDraft(merged.state, draft('draft-0', 'Reused'))
    const afterReuse = evolveDraftDocument(merged, attemptedReuse, 'test-tab')
    expect(afterReuse.state.drafts).toEqual([])

    const storage = new MemoryStorage()
    writeDraftDocument(storage, afterReuse)
    const reloaded = inspectDraftState(storage)
    expect(reloaded.status).toBe('valid')
    if (reloaded.status !== 'valid') throw new Error('Expected valid persisted document')
    const afterOfflineMerge = mergeDraftDocuments(reloaded.document, offlineDocument)
    expect(afterOfflineMerge.state.drafts).toEqual([])
    writeDraftDocument(storage, afterOfflineMerge)
    const finalReload = inspectDraftState(storage)
    expect(finalReload.status).toBe('valid')
    if (finalReload.status !== 'valid') throw new Error('Expected valid converged document')
    expect(finalReload.state.drafts).toEqual([])
    expect(finalReload.document.sync.tombstones.map((item) => item.id)).toContain('draft-0')
  })

  it('merges active selection by its own clock instead of draft content clocks', () => {
    let state = addDraft(initialState, draft('a', 'A'))
    state = addDraft(state, draft('b', 'B'))
    let base = createDraftDocument(state)
    base = evolveDraftDocument(base, setActiveDraft(base.state, 'a'), 'base-tab')
    const olderSelection = evolveDraftDocument(base, setActiveDraft(base.state, 'b'), 'older-tab')
    const newerSelection = evolveDraftDocument(olderSelection, setActiveDraft(olderSelection.state, 'a'), 'newer-tab')
    let contentAhead = updateDraftData(olderSelection.state, 'b', resume('B updated once'), {
      now: '2026-07-08T00:00:00.000Z'
    })
    let contentDocument = evolveDraftDocument(olderSelection, contentAhead, 'content-tab')
    contentAhead = updateDraftData(contentDocument.state, 'b', resume('B updated twice'), {
      now: '2026-07-09T00:00:00.000Z'
    })
    contentDocument = evolveDraftDocument(contentDocument, contentAhead, 'content-tab')

    const merged = mergeDraftDocuments(newerSelection, contentDocument)
    const newerActive = newerSelection.sync.active
    const olderActive = olderSelection.sync.active
    expect(merged.state.activeDraftId).toBe('a')
    expect(newerActive.counter).toBeGreaterThan(olderActive.counter)
    expect(contentDocument.sync.active).toEqual(olderActive)

    const afterDelete = evolveDraftDocument(olderSelection, deleteDraft(olderSelection.state, 'b'), 'delete-tab')
    const deleteActive = afterDelete.sync.active
    expect(afterDelete.state.activeDraftId).toBe('a')
    expect(deleteActive.counter).toBeGreaterThan(olderActive.counter)
    expect(deleteActive.draftId).toBe('a')

    const storage = new MemoryStorage()
    writeDraftDocument(storage, newerSelection)
    const reloaded = inspectDraftState(storage)
    expect(reloaded.status).toBe('valid')
    if (reloaded.status !== 'valid') throw new Error('Expected active selection to persist')
    expect(reloaded.document.sync.active).toEqual(newerActive)
  })

  it('falls back from a newer selection whose draft was concurrently deleted', () => {
    let state = addDraft(initialState, draft('survivor', 'Survivor', '2026-07-10T00:00:00.000Z'))
    state = addDraft(state, draft('deleted', 'Deleted', '2026-07-11T00:00:00.000Z'))
    let base = createDraftDocument(state)
    base = evolveDraftDocument(base, setActiveDraft(base.state, 'survivor'), 'base-tab')
    const deletion = evolveDraftDocument(base, deleteDraft(base.state, 'deleted'), 'delete-tab')
    const changed = updateDraftData(base.state, 'survivor', resume('Survivor updated'), {
      now: '2026-07-12T00:00:00.000Z'
    })
    const selectionPrelude = evolveDraftDocument(base, changed, 'selection-tab')
    const newerDeletedSelection = evolveDraftDocument(
      selectionPrelude,
      setActiveDraft(selectionPrelude.state, 'deleted'),
      'selection-tab'
    )

    const leftFirst = mergeDraftDocuments(deletion, newerDeletedSelection)
    const rightFirst = mergeDraftDocuments(newerDeletedSelection, deletion)

    expect(newerDeletedSelection.sync.active.counter).toBeGreaterThan(deletion.sync.active.counter)
    expect(leftFirst.state.activeDraftId).toBe('survivor')
    expect(rightFirst.state.activeDraftId).toBe('survivor')
    expect(draftDocumentsEqual(leftFirst, rightFirst)).toBe(true)

    const storage = new MemoryStorage()
    writeDraftDocument(storage, leftFirst)
    const reloaded = inspectDraftState(storage)
    expect(reloaded.status).toBe('valid')
    if (reloaded.status !== 'valid') throw new Error('Expected fallback selection to persist')
    expect(reloaded.state.activeDraftId).toBe('survivor')
    expect(reloaded.document.sync.active).toEqual(leftFirst.sync.active)
  })

  it('chooses a deterministic live draft when every selection candidate is deleted', () => {
    let state = addDraft(initialState, draft('fallback-z', 'Fallback Z', '2026-07-10T00:00:00.000Z'))
    state = addDraft(state, draft('fallback-a', 'Fallback A', '2026-07-10T00:00:00.000Z'))
    state = addDraft(state, draft('left-selected', 'Left'))
    state = addDraft(state, draft('right-selected', 'Right'))
    const base = createDraftDocument(state)
    let left = evolveDraftDocument(base, setActiveDraft(base.state, 'left-selected'), 'left-tab')
    left = evolveDraftDocument(left, deleteDraft(left.state, 'right-selected'), 'left-tab')
    let right = evolveDraftDocument(base, setActiveDraft(base.state, 'right-selected'), 'right-tab')
    right = evolveDraftDocument(right, deleteDraft(right.state, 'left-selected'), 'right-tab')

    const leftFirst = mergeDraftDocuments(left, right)
    const rightFirst = mergeDraftDocuments(right, left)

    expect(leftFirst.state.activeDraftId).toBe('fallback-a')
    expect(rightFirst.state.activeDraftId).toBe('fallback-a')
    expect(draftDocumentsEqual(leftFirst, rightFirst)).toBe(true)
  })

  it('migrates v1 offset timestamps by chronological instant', () => {
    const lexicallyLaterButEarlier = draft('shared', 'Earlier instant', '2026-01-01T01:00:00+02:00')
    const lexicallyEarlierButLater = draft('shared', 'Later instant', '2025-12-31T23:30:00Z')
    const earlierDocument = createDraftDocument({ activeDraftId: 'shared', drafts: [lexicallyLaterButEarlier] })
    const laterDocument = createDraftDocument({ activeDraftId: 'shared', drafts: [lexicallyEarlierButLater] })

    const merged = mergeDraftDocuments(earlierDocument, laterDocument)

    expect(earlierDocument.state.drafts[0].updatedAt).toBe('2025-12-31T23:00:00.000Z')
    expect(merged.state.drafts[0].name).toBe('Later instant')
  })

  it('migrates and syncs prototype-shaped ids without object-key metadata', () => {
    const ids = ['__proto__', 'constructor', 'prototype']
    const state = ids.reduce(
      (current, id) => addDraft(current, draft(id)),
      initialState
    )
    const storage = new MemoryStorage()
    storage.setItem(RESUME_DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, state }))

    const migrated = inspectDraftState(storage)
    expect(migrated.status).toBe('valid')
    if (migrated.status !== 'valid') throw new Error('Expected valid v1 migration')
    expect(migrated.state.drafts.map((item) => item.id)).toEqual(ids)
    expect(Array.isArray(migrated.document.sync.entries)).toBe(true)

    let evolved = evolveDraftDocument(
      migrated.document,
      renameDraft(migrated.state, '__proto__', 'Safe Prototype', { now: '2026-07-10T00:00:00.000Z' }),
      'prototype-tab'
    )
    evolved = evolveDraftDocument(evolved, deleteDraft(evolved.state, 'constructor'), 'prototype-tab')
    const merged = mergeDraftDocuments(evolved, migrated.document)
    writeDraftDocument(storage, merged)
    const serialized = JSON.parse(storage.getItem(RESUME_DRAFT_STORAGE_KEY) ?? '')
    expect(serialized.version).toBe(3)
    expect(Array.isArray(serialized.sync.entries)).toBe(true)

    const reloaded = inspectDraftState(storage)
    expect(reloaded.status).toBe('valid')
    if (reloaded.status !== 'valid') throw new Error('Expected valid synced document')
    expect(reloaded.state.drafts.map((item) => item.id).sort()).toEqual(['__proto__', 'prototype'])
    expect(reloaded.state.drafts.find((item) => item.id === '__proto__')?.name).toBe('Safe Prototype')
    expect(reloaded.document.sync.tombstones.map((item) => item.id)).toContain('constructor')
    expect(Object.prototype).not.toHaveProperty('polluted')
  })

  it('updates normalized data and snapshots the previous data when requested', () => {
    const state = addDraft(initialState, draft('draft-1'))
    const next = updateDraftData(state, 'draft-1', resume('Grace'), {
      snapshotReason: 'agent-change',
      now: '2026-07-08T00:00:00.000Z',
      snapshotId: 'snapshot-1'
    })
    const updated = next.drafts[0]

    expect(updated.updatedAt).toBe('2026-07-08T00:00:00.000Z')
    expect(updated.source).toBe('sample')
    expect(updated.data.metadata).toMatchObject({ source: 'sample', updatedAt: '2026-07-08T00:00:00.000Z' })
    expect(updated.data.profile.name).toBe('Grace')
    expect(updated.snapshots).toMatchObject([{
      id: 'snapshot-1',
      createdAt: '2026-07-08T00:00:00.000Z',
      reason: 'agent-change',
      data: { profile: { name: 'draft-1' } }
    }])
    expect(updated.snapshots[0].data).not.toBe(state.drafts[0].data)
    expect(state.drafts[0].data.profile.name).toBe('draft-1')
  })

  it('generates distinct snapshot ids when randomUUID fails at the same timestamp', () => {
    vi.stubGlobal('crypto', { randomUUID: () => { throw new Error('Unavailable') } })
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    let state = addDraft(initialState, draft('draft-1'))

    state = updateDraftData(state, 'draft-1', resume('Grace'), {
      snapshotReason: 'manual',
      now: '2026-07-08T00:00:00.000Z'
    })
    state = updateDraftData(state, 'draft-1', resume('Lin'), {
      snapshotReason: 'manual',
      now: '2026-07-09T00:00:00.000Z'
    })

    const ids = state.drafts[0].snapshots.map((snapshot) => snapshot.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => id.startsWith('snapshot-1234-'))).toBe(true)
  })

  it('replaces a blank caller-provided snapshot id', () => {
    const state = addDraft(initialState, draft('draft-1'))

    const next = updateDraftData(state, 'draft-1', resume('Grace'), {
      snapshotReason: 'manual',
      snapshotId: '   '
    })

    expect(next.drafts[0].snapshots[0].id.trim()).toBe(next.drafts[0].snapshots[0].id)
    expect(next.drafts[0].snapshots[0].id).toBeTruthy()
  })

  it('keeps the newest twenty snapshots', () => {
    let state = addDraft(initialState, draft('draft-1'))

    for (let index = 1; index <= 21; index += 1) {
      state = updateDraftData(state, 'draft-1', resume(`Version ${index}`), {
        snapshotReason: 'manual',
        now: `2026-07-${String(index).padStart(2, '0')}T00:00:00.000Z`,
        snapshotId: `snapshot-${index}`
      })
    }

    expect(state.drafts[0].snapshots).toHaveLength(20)
    expect(state.drafts[0].snapshots[0].id).toBe('snapshot-2')
    expect(state.drafts[0].snapshots[19].id).toBe('snapshot-21')
  })

  it('normalizes existing snapshots during an update without a new snapshot', () => {
    const state: ResumeDraftState = {
      activeDraftId: 'draft-1',
      drafts: [draftWithSnapshots('draft-1')]
    }

    const next = updateDraftData(state, 'draft-1', resume('Grace'), {
      now: '2026-07-08T00:00:00.000Z'
    })

    expect(next.drafts[0].snapshots).toHaveLength(20)
    expect(next.drafts[0].snapshots[0].id).toBe('snapshot-2')
    expect(state.drafts[0].snapshots).toHaveLength(21)
  })

  it('round-trips a versioned state without retaining aliases', () => {
    const storage = new MemoryStorage()
    const state = addDraft(initialState, draft('draft-1'))

    writeDraftState(storage, state)
    const loaded = readDraftState(storage)

    expect(loaded).toEqual(state)
    expect(loaded).not.toBe(state)
    expect(loaded?.drafts[0]).not.toBe(state.drafts[0])
    expect(JSON.parse(storage.getItem(RESUME_DRAFT_STORAGE_KEY) ?? '')).toMatchObject({ version: 1, state })
  })

  it('reads the previous v2 object-entry envelope without losing drafts', () => {
    const storage = new MemoryStorage()
    const state = addDraft(initialState, draft('legacy-v2'))
    const document = createDraftDocument(state)
    const entries = { 'legacy-v2': { counter: 0, actor: 'legacy:old-v2' } }
    storage.setItem(RESUME_DRAFT_STORAGE_KEY, JSON.stringify({
      version: 2,
      state: document.state,
      sync: { clock: 0, entries, tombstones: [] }
    }))

    const loaded = inspectDraftState(storage)

    expect(loaded.status).toBe('valid')
    if (loaded.status !== 'valid') throw new Error('Expected valid v2 migration')
    expect(loaded.state.drafts.map((item) => item.id)).toEqual(['legacy-v2'])
    expect(Array.isArray(loaded.document.sync.entries)).toBe(true)
    expect(loaded.document.sync.entries[0].counter).toBe(Date.parse(state.drafts[0].updatedAt))
  })

  it('loads oversized persisted drafts with only the newest twenty snapshots', () => {
    const storage = new MemoryStorage()
    storage.setItem(RESUME_DRAFT_STORAGE_KEY, JSON.stringify({
      version: 1,
      state: { activeDraftId: 'draft-1', drafts: [draftWithSnapshots('draft-1')] }
    }))

    const loaded = readDraftState(storage)

    expect(loaded?.drafts[0].snapshots).toHaveLength(20)
    expect(loaded?.drafts[0].snapshots[0].id).toBe('snapshot-2')
    expect(loaded?.drafts[0].snapshots[19].id).toBe('snapshot-21')
  })

  it('writes oversized drafts with only the newest twenty snapshots', () => {
    const storage = new MemoryStorage()
    const state: ResumeDraftState = {
      activeDraftId: 'draft-1',
      drafts: [draftWithSnapshots('draft-1')]
    }

    writeDraftState(storage, state)

    const persisted = JSON.parse(storage.getItem(RESUME_DRAFT_STORAGE_KEY) ?? '')
    expect(persisted.state.drafts[0].snapshots).toHaveLength(20)
    expect(persisted.state.drafts[0].snapshots[0].id).toBe('snapshot-2')
  })

  it('returns null for malformed, unsupported, or partially invalid storage', () => {
    const storage = new MemoryStorage()
    storage.setItem(RESUME_DRAFT_STORAGE_KEY, '{bad json')
    expect(readDraftState(storage)).toBeNull()

    storage.setItem(RESUME_DRAFT_STORAGE_KEY, JSON.stringify({ version: 2, state: initialState }))
    expect(readDraftState(storage)).toBeNull()

    storage.setItem(RESUME_DRAFT_STORAGE_KEY, JSON.stringify({
      version: 1,
      state: { activeDraftId: null, drafts: [{ id: 'broken' }] }
    }))
    expect(readDraftState(storage)).toBeNull()
  })

  it('rejects drafts with malformed createdAt or updatedAt timestamps', () => {
    const storage = new MemoryStorage()
    const invalidCreatedAt = { ...draft('draft-1'), createdAt: 'not-a-date' }
    storage.setItem(RESUME_DRAFT_STORAGE_KEY, JSON.stringify({
      version: 1,
      state: { activeDraftId: 'draft-1', drafts: [invalidCreatedAt] }
    }))
    expect(readDraftState(storage)).toBeNull()

    const invalidUpdatedAt = { ...draft('draft-1'), updatedAt: 'tomorrow-ish' }
    storage.setItem(RESUME_DRAFT_STORAGE_KEY, JSON.stringify({
      version: 1,
      state: { activeDraftId: 'draft-1', drafts: [invalidUpdatedAt] }
    }))
    expect(readDraftState(storage)).toBeNull()
  })

  it('contains storage failures and prototype-shaped input', () => {
    const storage = new ThrowingStorage()
    const poisonous = JSON.parse('{"version":1,"state":{"activeDraftId":null,"drafts":[],"__proto__":{"polluted":true}}}')
    const memory = new MemoryStorage()
    memory.setItem(RESUME_DRAFT_STORAGE_KEY, JSON.stringify(poisonous))

    expect(readDraftState(storage)).toBeNull()
    expect(() => writeDraftState(storage, initialState)).not.toThrow()
    expect(readDraftState(memory)).toEqual(initialState)
    expect(Object.prototype).not.toHaveProperty('polluted')
  })
})
