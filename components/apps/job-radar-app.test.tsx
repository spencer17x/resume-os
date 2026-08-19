import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResumeDraftProviderCore } from '@/components/resume-draft-provider'
import { createDomainStore, type IndexedDbDomainStore } from '@/lib/agent/domain-store'
import type { JobPosting, JobSearchProfile, JobSource } from '@/lib/jobs/job-domain'
import { JobSourceError, type JobSourceAdapter } from '@/lib/jobs/sources'
import { createResumeDraft, normalizeResumeData } from '@/lib/resume-model'
import { writeDraftState } from '@/lib/resume-store'
import en from '@/messages/en.json'
import { JobRadarApp } from './job-radar-app'

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })
}))

const now = '2026-08-01T08:00:00.000Z'
const stores: IndexedDbDomainStore[] = []

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const resume = normalizeResumeData({
  profile: { name: 'Ada Candidate', title: 'Platform Engineer', summary: [], tags: ['TypeScript'], links: [] },
  skills: [{ category: 'Engineering', items: ['TypeScript'] }],
  experiences: [], projects: [], education: [], certifications: [], awards: [], languages: [], openSource: [],
  metadata: { source: 'paste', locale: 'en', updatedAt: now }
})

const source: JobSource = {
  id: 'job-source-example', kind: 'greenhouse', label: 'Example', sourceKey: 'example',
  enabled: true, createdAt: now, updatedAt: now
}

const profile: JobSearchProfile = {
  id: 'job-profile-platform', name: 'Platform roles', titles: ['Platform Engineer'],
  adjacentTitles: [], locations: [], excludedLocations: [], workplaceTypes: [], employmentTypes: [],
  requiredTerms: [], preferredTerms: ['TypeScript'], excludedTerms: [], maximumAgeDays: 30,
  createdAt: now, updatedAt: now
}

const posting: JobPosting = {
  id: 'job-posting-example-1', sourceId: source.id, externalId: '1',
  canonicalUrl: 'https://boards.greenhouse.io/example/jobs/1',
  applyUrl: 'https://boards.greenhouse.io/example/jobs/1',
  title: 'Platform Engineer', company: 'Example Co', description: 'Build TypeScript platforms.',
  locale: 'en', location: 'Remote', workplaceType: 'remote',
  firstSeenAt: now, lastCheckedAt: now, status: 'open', contentHash: 'hash:example-1'
}

function createStore() {
  const store = createDomainStore({
    databaseName: `job-radar-component-${crypto.randomUUID()}`,
    indexedDB: new IDBFactory()
  })
  stores.push(store)
  return store
}

function trustedStorage() {
  const storage = new MemoryStorage()
  const draft = createResumeDraft(resume, { id: 'ada-draft', name: 'Ada Resume', source: 'paste' })
  writeDraftState(storage, { activeDraftId: draft.id, drafts: [draft] })
  return storage
}

function renderRadar(options: {
  store: IndexedDbDomainStore
  storage?: MemoryStorage | null
  createAdapter?: (kind: 'greenhouse' | 'lever') => JobSourceAdapter
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ResumeDraftProviderCore locale="en" storage={options.storage ?? null}>
        <JobRadarApp store={options.store} createAdapter={options.createAdapter} />
      </ResumeDraftProviderCore>
    </NextIntlClientProvider>
  )
}

afterEach(async () => {
  cleanup()
  await Promise.all(stores.splice(0).map((store) => store.close()))
})

describe('JobRadarApp', () => {
  it('shows the local-first empty state and adds an authorized source without refreshing it', async () => {
    const user = userEvent.setup()
    const store = createStore()
    renderRadar({ store })

    expect(await screen.findByText('Import or paste a trusted resume before matching jobs.')).toBeVisible()
    expect(screen.getByRole('group', { name: 'Platforms to search' })).toBeVisible()
    await user.click(screen.getByText('Advanced: add a company board'))
    await user.type(screen.getByLabelText('Public board identifier'), 'example')
    await user.click(screen.getByRole('button', { name: 'Add source' }))

    expect(await screen.findByText('Source added. Refresh it when you are ready.')).toBeVisible()
    expect(await store.list('jobPostings')).toEqual([])
    expect(screen.getByRole('button', { name: 'Refresh example' })).toBeVisible()
  })

  it('derives the initial search from the resume and searches selected automatic marketplaces', async () => {
    const user = userEvent.setup()
    const store = createStore()
    const createAdapter = (kind: 'greenhouse' | 'lever'): JobSourceAdapter => ({
      kind,
      validateSourceKey: (value) => value,
      recognizeUrl: () => null,
      async refresh({ source }) {
        return {
          sourceId: source.id,
          completeness: 'complete',
          checkedAt: now,
          postings: [{
            ...posting,
            id: `posting-${source.id}`,
            sourceId: source.id,
            externalId: `external-${source.sourceKey}`,
            title: `${source.label} Platform Engineer`,
            company: source.label,
            contentHash: `hash:${source.id}`
          }],
          warnings: []
        }
      }
    })
    renderRadar({ store, storage: trustedStorage(), createAdapter })

    expect(await screen.findByDisplayValue('Platform Engineer')).toBeVisible()
    expect(within(screen.getByRole('group', { name: 'Platforms to search' })).getByRole('checkbox', { name: /BOSS Zhipin/ })).toBeChecked()
    expect(screen.getByRole('link', { name: 'Search BOSS Zhipin' })).toHaveAttribute(
      'href',
      expect.stringContaining('query=Platform+Engineer')
    )
    await user.click(screen.getByRole('button', { name: 'Search selected platforms' }))

    expect(await screen.findByText(/Market search complete: 8 automatic sources/, {}, { timeout: 10_000 })).toHaveTextContent(
      '0 source failures'
    )
    expect(await store.list('jobSources')).toHaveLength(8)
    expect(await store.list('jobPostings')).toHaveLength(8)
    expect((await store.list('jobSearchProfiles'))[0]).toMatchObject({
      platforms: ['greenhouse', 'lever', 'boss', '51job', '58'],
      titles: ['Platform Engineer']
    })
  })

  it('defaults to zero-configuration automation and keeps unconnected messaging draft-only', async () => {
    const store = createStore()
    renderRadar({ store, storage: trustedStorage() })

    expect(await screen.findByRole('heading', { name: 'Job automation controls' })).toBeVisible()
    expect(screen.getByText('Automatic on every platform')).toBeVisible()
    expect(screen.getByRole('list', { name: 'Agent work platforms' }).children).toHaveLength(9)
    expect(screen.getByText(/Platforms without an authorized connector produce reviewable drafts only/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run Agent now' })).toBeDisabled()

    expect(await screen.findByDisplayValue('Platform Engineer')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run Agent now' })).toBeEnabled()
  })

  it('surfaces partial refreshes, scores jobs, and preserves a saved application when ignored later', async () => {
    const user = userEvent.setup()
    const store = createStore()
    await store.put('jobSources', source)
    await store.put('jobSearchProfiles', profile)
    const adapter: JobSourceAdapter = {
      kind: 'greenhouse', validateSourceKey: (value) => value, recognizeUrl: () => null,
      refresh: async () => ({
        sourceId: source.id, completeness: 'partial', checkedAt: now,
        postings: [posting], warnings: ['synthetic partial response']
      })
    }
    renderRadar({ store, storage: trustedStorage(), createAdapter: () => adapter })

    await user.click(await screen.findByRole('button', { name: 'Refresh Example' }))
    expect(await screen.findByText(/Partial refresh: 1 new/)).toBeVisible()
    expect(await screen.findByRole('heading', { name: 'Platform Engineer' })).toBeVisible()
    expect(screen.getByLabelText(/Preliminary relevance score/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await store.list('applicationRecords'))[0]?.status).toBe('saved'))
    await user.click(screen.getByRole('button', { name: 'Ignore' }))
    await waitFor(async () => expect((await store.list('jobRecommendations'))[0]?.decision).toBe('ignored'))
    expect(await store.list('applicationRecords')).toHaveLength(1)
  })

  it('cancels an in-flight refresh without committing partial postings', async () => {
    const user = userEvent.setup()
    const store = createStore()
    await store.put('jobSources', source)
    const adapter: JobSourceAdapter = {
      kind: 'greenhouse', validateSourceKey: (value) => value, recognizeUrl: () => null,
      refresh: ({ signal }) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new JobSourceError('REQUEST_ABORTED')), { once: true })
      })
    }
    renderRadar({ store, storage: trustedStorage(), createAdapter: () => adapter })

    await user.click(await screen.findByRole('button', { name: 'Refresh Example' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel refresh' }))
    expect(await screen.findByText('Refresh canceled; no partial source state was committed.')).toBeVisible()
    expect(await store.list('jobPostings')).toEqual([])
  })
})
