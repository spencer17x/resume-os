import { act, cleanup, render, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createResumeDraft, normalizeResumeData, type ResumeData, type ResumeDraftState } from '@/lib/resume-model'
import {
  RESUME_DRAFT_STORAGE_KEY,
  createDraftDocument,
  deleteDraft,
  evolveDraftDocument,
  setActiveDraft,
  writeDraftDocument
} from '@/lib/resume-store'
import {
  ResumeDraftProvider,
  ResumeDraftProviderCore,
  type ResumeDraftContextValue,
  useResumeDraft
} from './resume-draft-provider'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  readonly setCalls: Array<[string, string]> = []
  getCalls = 0
  constructor(private readonly values = new Map<string, string>()) {}

  getItem(key: string) {
    this.getCalls += 1
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.setCalls.push([key, value])
    this.values.set(key, value)
  }

  seed(state: ResumeDraftState) {
    this.values.set(RESUME_DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, state }))
  }

  seedRaw(value: string) {
    this.values.set(RESUME_DRAFT_STORAGE_KEY, value)
  }

  raw() {
    return this.values.get(RESUME_DRAFT_STORAGE_KEY) ?? null
  }
}

class ThrowingStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  setCalls = 0

  getItem(): string | null {
    throw new Error('Storage unavailable')
  }

  setItem(): void {
    this.setCalls += 1
    throw new Error('Storage unavailable')
  }
}

function resume(name = 'Ada'): ResumeData {
  return normalizeResumeData({
    profile: { name, title: 'Engineer', summary: [], tags: [] },
    skills: [],
    experiences: [],
    projects: [],
    openSource: [],
    metadata: { source: 'sample', locale: 'en', updatedAt: '2026-07-06T00:00:00.000Z' }
  })
}

function Probe({ onChange }: { onChange: (value: ResumeDraftContextValue) => void }) {
  const value = useResumeDraft()
  onChange(value)
  return <output data-testid="resume-state">{JSON.stringify(value.state)}</output>
}

function renderProvider({
  locale = 'en',
  storage = new MemoryStorage(),
  strict = false
}: {
  locale?: 'zh' | 'en'
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  strict?: boolean
} = {}) {
  let resumeDraft: ResumeDraftContextValue | null = null
  let currentStorage = storage
  const capture = (value: ResumeDraftContextValue) => {
    resumeDraft = value
  }
  const tree = (nextLocale = locale) => {
    const provider = <ResumeDraftProviderCore locale={nextLocale} storage={currentStorage}>
      <Probe onChange={capture} />
    </ResumeDraftProviderCore>
    return strict ? <StrictMode>{provider}</StrictMode> : provider
  }
  const view = render(tree())

  return {
    ...view,
    rerenderProvider(nextLocale: 'zh' | 'en') {
      view.rerender(tree(nextLocale))
    },
    rerenderStorage(nextStorage: Pick<Storage, 'getItem' | 'setItem'> | null) {
      currentStorage = nextStorage
      view.rerender(tree())
    },
    resumeDraft() {
      if (!resumeDraft) throw new Error('Resume draft context was not rendered')
      return resumeDraft
    },
    storage
  }
}

function dispatchStorage(storage: Pick<Storage, 'getItem' | 'setItem'>, newValue: string | null) {
  const event = new Event('storage')
  Object.defineProperties(event, {
    key: { value: RESUME_DRAFT_STORAGE_KEY },
    newValue: { value: newValue },
    storageArea: { value: storage }
  })
  window.dispatchEvent(event)
}

afterEach(() => {
  cleanup()
})

describe('ResumeDraftProvider', () => {
  it('is safe to render on the server', () => {
    expect(() => renderToString(<ResumeDraftProvider locale="en"><span>Resume</span></ResumeDraftProvider>)).not.toThrow()
  })

  it('hydrates once and does not prewrite an empty state', async () => {
    const storage = new MemoryStorage()
    const savedDraft = createResumeDraft(resume(), { id: 'draft-1', now: '2026-07-06T00:00:00.000Z' })
    storage.seed({ activeDraftId: 'draft-1', drafts: [savedDraft] })

    const { resumeDraft } = renderProvider({ storage })

    await waitFor(() => expect(resumeDraft().activeDraft?.id).toBe('draft-1'))
    expect(storage.getCalls).toBe(1)
    expect(storage.setCalls.map(([, value]) => JSON.parse(value).state)).toEqual([
      { activeDraftId: 'draft-1', drafts: [savedDraft] }
    ])
  })

  it.each([
    ['malformed JSON', '{bad json'],
    ['a future schema version', JSON.stringify({ version: 2, state: { activeDraftId: null, drafts: [] } })],
    ['an invalid state', JSON.stringify({ version: 1, state: { activeDraftId: null, drafts: [{ id: 'broken' }] } })]
  ])('does not overwrite %s during hydration or rerender', async (_label, raw) => {
    const storage = new MemoryStorage()
    storage.seedRaw(raw)
    const { rerenderProvider, resumeDraft } = renderProvider({ storage })

    await waitFor(() => expect(resumeDraft().state).toEqual({ activeDraftId: null, drafts: [] }))
    rerenderProvider('zh')

    expect(storage.raw()).toBe(raw)
    expect(storage.setCalls).toHaveLength(0)
  })

  it('does not write after storage read errors during hydration or rerender', async () => {
    const storage = new ThrowingStorage()
    const { rerenderProvider, resumeDraft } = renderProvider({ storage })

    await waitFor(() => expect(resumeDraft().state).toEqual({ activeDraftId: null, drafts: [] }))
    rerenderProvider('zh')

    expect(storage.setCalls).toBe(0)
  })

  it('merges valid external changes and converges storage once', async () => {
    const storage = new MemoryStorage()
    const localOnly = createResumeDraft(resume('Local'), { id: 'local', now: '2026-07-08T00:00:00.000Z' })
    const localShared = createResumeDraft(resume('Local Shared'), { id: 'shared', now: '2026-07-09T00:00:00.000Z' })
    storage.seed({ activeDraftId: 'shared', drafts: [localOnly, localShared] })
    const { resumeDraft } = renderProvider({ storage })
    await waitFor(() => expect(resumeDraft().state.drafts).toHaveLength(2))
    const writesBeforeEvent = storage.setCalls.length
    const remoteShared = createResumeDraft(resume('Stale Shared'), { id: 'shared', now: '2026-07-07T00:00:00.000Z' })
    const remoteOnly = createResumeDraft(resume('Remote'), { id: 'remote', now: '2026-07-10T00:00:00.000Z' })
    const external = { activeDraftId: 'remote', drafts: [remoteShared, remoteOnly] }

    act(() => dispatchStorage(storage, JSON.stringify({ version: 1, state: external })))

    await waitFor(() => expect(resumeDraft().state.drafts).toHaveLength(3))
    expect(resumeDraft().state.drafts.find((item) => item.id === 'shared')?.data.profile.name).toBe('Local Shared')
    expect(resumeDraft().activeDraft?.id).toBe('remote')
    expect(storage.setCalls).toHaveLength(writesBeforeEvent + 1)
    expect(JSON.parse(storage.raw() ?? '').state.drafts).toHaveLength(3)
  })

  it('propagates an ordinary draft deletion envelope to another tab', async () => {
    const values = new Map<string, string>()
    const firstStorage = new MemoryStorage(values)
    const secondStorage = new MemoryStorage(values)
    const shared = createResumeDraft(resume('Shared'), { id: 'shared' })
    firstStorage.seed({ activeDraftId: 'shared', drafts: [shared] })
    const firstTab = renderProvider({ storage: firstStorage })
    const secondTab = renderProvider({ storage: secondStorage })
    await waitFor(() => expect(secondTab.resumeDraft().activeDraft?.id).toBe('shared'))

    act(() => firstTab.resumeDraft().deleteDraft('shared'))
    await waitFor(() => expect(firstTab.resumeDraft().activeDraft).toBeNull())
    const deletionEnvelope = firstStorage.raw()
    act(() => dispatchStorage(secondStorage, deletionEnvelope))

    await waitFor(() => expect(secondTab.resumeDraft().activeDraft).toBeNull())
  })

  it('converges concurrent additions to durable storage and preserves them after reload', async () => {
    const values = new Map<string, string>()
    const firstStorage = new MemoryStorage(values)
    const secondStorage = new MemoryStorage(values)
    const firstTab = renderProvider({ storage: firstStorage })
    const secondTab = renderProvider({ storage: secondStorage })
    await waitFor(() => expect(secondTab.resumeDraft().state.drafts).toHaveLength(0))

    act(() => firstTab.resumeDraft().createDraft(resume('First'), { name: 'First' }))
    await waitFor(() => expect(firstTab.resumeDraft().state.drafts).toHaveLength(1))
    act(() => secondTab.resumeDraft().createDraft(resume('Second'), { name: 'Second' }))
    await waitFor(() => expect(secondTab.resumeDraft().state.drafts).toHaveLength(1))
    const lastWriterEnvelope = secondStorage.raw()

    act(() => dispatchStorage(firstStorage, lastWriterEnvelope))
    await waitFor(() => expect(firstTab.resumeDraft().state.drafts).toHaveLength(2))
    const convergedEnvelope = firstStorage.raw()
    const secondWritesBeforeConvergence = secondStorage.setCalls.length
    act(() => dispatchStorage(secondStorage, convergedEnvelope))
    await waitFor(() => expect(secondTab.resumeDraft().state.drafts).toHaveLength(2))
    expect(secondStorage.setCalls).toHaveLength(secondWritesBeforeConvergence)

    firstTab.unmount()
    secondTab.unmount()
    const reloaded = renderProvider({ storage: new MemoryStorage(values) })
    await waitFor(() => expect(reloaded.resumeDraft().state.drafts).toHaveLength(2))
    expect(reloaded.resumeDraft().state.drafts.map((item) => item.name).sort()).toEqual(['First', 'Second'])
  })

  it('does not resurrect a deleted draft after a stale tab writes another change', async () => {
    const values = new Map<string, string>()
    const firstStorage = new MemoryStorage(values)
    const secondStorage = new MemoryStorage(values)
    const shared = createResumeDraft(resume('Shared'), { id: 'shared' })
    firstStorage.seed({ activeDraftId: 'shared', drafts: [shared] })
    const firstTab = renderProvider({ storage: firstStorage })
    const staleTab = renderProvider({ storage: secondStorage })
    await waitFor(() => expect(staleTab.resumeDraft().activeDraft?.id).toBe('shared'))

    act(() => firstTab.resumeDraft().deleteDraft('shared'))
    await waitFor(() => expect(firstTab.resumeDraft().activeDraft).toBeNull())
    const deletionEnvelope = firstStorage.raw()
    act(() => staleTab.resumeDraft().createDraft(resume('Unique'), { name: 'Unique' }))
    await waitFor(() => expect(staleTab.resumeDraft().state.drafts).toHaveLength(2))
    const staleEnvelope = secondStorage.raw()

    act(() => dispatchStorage(firstStorage, staleEnvelope))
    await waitFor(() => expect(firstTab.resumeDraft().state.drafts.map((item) => item.name)).toEqual(['Unique']))
    const convergedEnvelope = firstStorage.raw()
    act(() => dispatchStorage(secondStorage, convergedEnvelope))
    await waitFor(() => expect(staleTab.resumeDraft().state.drafts.map((item) => item.name)).toEqual(['Unique']))

    firstTab.unmount()
    staleTab.unmount()
    const reloaded = renderProvider({ storage: new MemoryStorage(values) })
    await waitFor(() => expect(reloaded.resumeDraft().state.drafts.map((item) => item.name)).toEqual(['Unique']))
    expect(deletionEnvelope).not.toBe(staleEnvelope)
  })

  it('restores durable tombstones when a stale writer only republishes a deleted draft', async () => {
    const storage = new MemoryStorage()
    const shared = createResumeDraft(resume('Shared'), { id: 'shared' })
    storage.seed({ activeDraftId: 'shared', drafts: [shared] })
    const staleEnvelope = storage.raw()
    const tab = renderProvider({ storage })
    await waitFor(() => expect(tab.resumeDraft().activeDraft?.id).toBe('shared'))

    act(() => tab.resumeDraft().deleteDraft('shared'))
    await waitFor(() => expect(tab.resumeDraft().activeDraft).toBeNull())
    const writesBeforeStaleEvent = storage.setCalls.length
    storage.seedRaw(staleEnvelope ?? '')

    act(() => dispatchStorage(storage, staleEnvelope))

    await waitFor(() => expect(storage.setCalls).toHaveLength(writesBeforeStaleEvent + 1))
    expect(JSON.parse(storage.raw() ?? '').state.drafts).toEqual([])
    tab.unmount()
    const reloaded = renderProvider({ storage })
    await waitFor(() => expect(reloaded.resumeDraft().activeDraft).toBeNull())
  })

  it('keeps the fallback active draft stable after the converged storage event repeats', async () => {
    const survivor = createResumeDraft(resume('Survivor'), { id: 'survivor' })
    const removed = createResumeDraft(resume('Removed'), { id: 'removed' })
    let state: ResumeDraftState = { activeDraftId: 'survivor', drafts: [survivor, removed] }
    const base = createDraftDocument(state)
    const deletion = evolveDraftDocument(base, deleteDraft(base.state, 'removed'), 'delete-tab')
    state = setActiveDraft(base.state, 'removed')
    const staleSelection = evolveDraftDocument(base, state, 'selection-tab')
    const storage = new MemoryStorage()
    writeDraftDocument(storage, deletion)
    const tab = renderProvider({ storage })
    await waitFor(() => expect(tab.resumeDraft().activeDraft?.id).toBe('survivor'))
    const staleStorage = new MemoryStorage()
    writeDraftDocument(staleStorage, staleSelection)
    const staleEnvelope = staleStorage.raw()
    const writesBeforeConflict = storage.setCalls.length
    storage.seedRaw(staleEnvelope ?? '')

    act(() => dispatchStorage(storage, staleEnvelope))

    await waitFor(() => expect(storage.setCalls).toHaveLength(writesBeforeConflict + 1))
    expect(tab.resumeDraft().activeDraft?.id).toBe('survivor')
    const convergedEnvelope = storage.raw()
    const writesAfterConvergence = storage.setCalls.length

    act(() => dispatchStorage(storage, convergedEnvelope))

    expect(tab.resumeDraft().activeDraft?.id).toBe('survivor')
    expect(storage.setCalls).toHaveLength(writesAfterConvergence)
  })

  it('applies external removal and ignores invalid external payloads without rewriting', async () => {
    const storage = new MemoryStorage()
    storage.seed({ activeDraftId: 'draft-1', drafts: [createResumeDraft(resume(), { id: 'draft-1' })] })
    const { resumeDraft } = renderProvider({ storage })
    await waitFor(() => expect(resumeDraft().activeDraft?.id).toBe('draft-1'))
    const writesBeforeEvent = storage.setCalls.length

    act(() => dispatchStorage(storage, '{bad json'))
    expect(resumeDraft().activeDraft?.id).toBe('draft-1')
    act(() => dispatchStorage(storage, null))

    await waitFor(() => expect(resumeDraft().state).toEqual({ activeDraftId: null, drafts: [] }))
    expect(storage.setCalls).toHaveLength(writesBeforeEvent)
  })

  it('ignores storage events from a different storage area', async () => {
    const storage = new MemoryStorage()
    const otherStorage = new MemoryStorage()
    const { resumeDraft } = renderProvider({ storage })
    await waitFor(() => expect(resumeDraft().activeDraft).toBeNull())
    const external = { activeDraftId: 'draft-1', drafts: [createResumeDraft(resume(), { id: 'draft-1' })] }

    act(() => dispatchStorage(otherStorage, JSON.stringify({ version: 1, state: external })))

    expect(resumeDraft().activeDraft).toBeNull()
  })

  it('rehydrates a changed storage once and sends future writes only to it in StrictMode', async () => {
    const firstStorage = new MemoryStorage()
    const secondStorage = new MemoryStorage()
    firstStorage.seed({ activeDraftId: 'first', drafts: [createResumeDraft(resume('First'), { id: 'first' })] })
    secondStorage.seed({ activeDraftId: 'second', drafts: [createResumeDraft(resume('Second'), { id: 'second' })] })
    const { rerenderStorage, resumeDraft } = renderProvider({ storage: firstStorage, strict: true })
    await waitFor(() => expect(resumeDraft().activeDraft?.id).toBe('first'))
    const firstWrites = firstStorage.setCalls.length

    rerenderStorage(secondStorage)
    await waitFor(() => expect(resumeDraft().activeDraft?.id).toBe('second'))
    expect(firstStorage.getCalls).toBe(1)
    expect(secondStorage.getCalls).toBe(1)
    expect(firstStorage.setCalls).toHaveLength(firstWrites)

    const staleFirstState = {
      activeDraftId: 'stale-first',
      drafts: [createResumeDraft(resume('Stale First'), { id: 'stale-first' })]
    }
    act(() => dispatchStorage(firstStorage, JSON.stringify({ version: 1, state: staleFirstState })))
    expect(resumeDraft().activeDraft?.id).toBe('second')

    act(() => resumeDraft().renameDraft('second', 'Second Updated'))
    await waitFor(() => expect(secondStorage.setCalls.length).toBeGreaterThan(0))
    expect(firstStorage.setCalls).toHaveLength(firstWrites)
  })

  it('uses a localized empty placeholder when no stored draft is active', async () => {
    const { resumeDraft, rerenderProvider } = renderProvider({ locale: 'en' })

    await waitFor(() => expect(resumeDraft().activeDraft).toBeNull())
    expect(resumeDraft().activeResume.metadata).toMatchObject({ source: 'sample', locale: 'en' })
    expect(resumeDraft().activeResume.profile.name).toBe('')
    expect(resumeDraft().activeResume.projects).toEqual([])

    rerenderProvider('zh')
    expect(resumeDraft().activeResume.metadata).toMatchObject({ source: 'sample', locale: 'zh' })
    expect(resumeDraft().activeResume.profile.name).toBe('')
  })

  it('creates a draft and returns its id', async () => {
    const { resumeDraft } = renderProvider()
    await waitFor(() => expect(resumeDraft().state).toEqual({ activeDraftId: null, drafts: [] }))

    let id = ''
    act(() => {
      id = resumeDraft().createDraft(resume('Grace'), { name: 'Grace Resume', source: 'ai-generated' })
    })

    expect(id).toBeTruthy()
    expect(resumeDraft().activeDraft).toMatchObject({ id, name: 'Grace Resume', source: 'ai-generated' })
    expect(resumeDraft().activeResume.metadata.source).toBe('ai-generated')
  })

  it('updates the active draft with an optional snapshot', async () => {
    const { resumeDraft } = renderProvider()
    await waitFor(() => expect(resumeDraft().activeDraft).toBeNull())

    act(() => {
      resumeDraft().createDraft(resume('Ada'), { name: 'Ada Resume' })
      resumeDraft().updateActiveResume(resume('Grace'), { snapshotReason: 'manual' })
    })

    expect(resumeDraft().activeResume.profile.name).toBe('Grace')
    expect(resumeDraft().activeDraft?.snapshots).toHaveLength(1)
    expect(resumeDraft().activeDraft?.snapshots[0]).toMatchObject({ reason: 'manual', data: { profile: { name: 'Ada' } } })
  })

  it('renames, switches, and deletes drafts', async () => {
    const { resumeDraft } = renderProvider()
    await waitFor(() => expect(resumeDraft().activeDraft).toBeNull())
    let first = ''
    let second = ''

    act(() => {
      first = resumeDraft().createDraft(resume('Ada'))
      second = resumeDraft().createDraft(resume('Grace'))
      resumeDraft().renameDraft(first, '  Ada Resume  ')
      resumeDraft().setActiveDraft(first)
    })

    expect(resumeDraft().activeDraft).toMatchObject({ id: first, name: 'Ada Resume' })
    act(() => resumeDraft().deleteDraft(first))

    expect(resumeDraft().activeDraft?.id).toBe(second)
    expect(resumeDraft().state.drafts.map((draft) => draft.id)).toEqual([second])
  })

  it('keeps stored drafts unchanged when the locale changes', async () => {
    const storage = new MemoryStorage()
    const savedDraft = createResumeDraft(resume('Ada'), { id: 'draft-1', now: '2026-07-06T00:00:00.000Z' })
    storage.seed({ activeDraftId: 'draft-1', drafts: [savedDraft] })
    const { resumeDraft, rerenderProvider } = renderProvider({ locale: 'en', storage })

    await waitFor(() => expect(resumeDraft().activeDraft?.id).toBe('draft-1'))
    rerenderProvider('zh')

    expect(resumeDraft().activeResume.metadata.locale).toBe('en')
    expect(resumeDraft().activeDraft?.data).toEqual(savedDraft.data)
  })

  it('contains storage errors and keeps working in memory', async () => {
    const { resumeDraft } = renderProvider({ storage: new ThrowingStorage() })
    await waitFor(() => expect(resumeDraft().activeDraft).toBeNull())

    act(() => resumeDraft().createDraft(resume('Ada')))

    expect(resumeDraft().activeDraft?.data.profile.name).toBe('Ada')
  })

  it('keeps callbacks and the context value stable across an unchanged rerender', async () => {
    const { resumeDraft, rerenderProvider } = renderProvider()
    await waitFor(() => expect(resumeDraft().activeDraft).toBeNull())
    const previous = resumeDraft()

    rerenderProvider('en')

    expect(resumeDraft()).toBe(previous)
    expect(resumeDraft().createDraft).toBe(previous.createDraft)
    expect(resumeDraft().updateActiveResume).toBe(previous.updateActiveResume)
  })
})
