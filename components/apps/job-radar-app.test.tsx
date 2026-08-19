import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResumeDraftProviderCore } from '@/components/resume-draft-provider'
import { createDomainStore, type IndexedDbDomainStore } from '@/lib/agent/domain-store'
import type { JobPosting, JobSearchProfile, JobSource } from '@/lib/jobs/job-domain'
import { scoreJobRecommendation } from '@/lib/jobs/job-recommendation'
import type { JobSourceAdapter } from '@/lib/jobs/sources'
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
  it('shows the local-first empty state with only BOSS Zhipin', async () => {
    const store = createStore()
    renderRadar({ store })

    expect(await screen.findByText('Import or paste a trusted resume before matching jobs.')).toBeVisible()
    expect(screen.getByRole('list', { name: 'Agent work platforms' }).children).toHaveLength(1)
    expect(screen.queryByText('Greenhouse')).not.toBeInTheDocument()
    expect(screen.queryByText('Lever')).not.toBeInTheDocument()
  })

  it('derives the initial search and opens BOSS Zhipin search', async () => {
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
    expect(screen.getByRole('link', { name: 'Search BOSS Zhipin' })).toHaveAttribute(
      'href',
      expect.stringContaining('query=Platform+Engineer')
    )
    await user.click(screen.getByRole('button', { name: 'Run Agent now' }))

    expect(await screen.findByText('The selected platforms require official search or partner access. Open their official searches below.')).toBeVisible()
    expect(await store.list('jobSources')).toHaveLength(0)
    expect(await store.list('jobPostings')).toHaveLength(0)
    expect((await store.list('jobSearchProfiles'))[0]).toMatchObject({
      platforms: ['boss'],
      titles: ['Platform Engineer']
    })
  })

  it('defaults to zero-configuration automation and keeps unconnected messaging draft-only', async () => {
    const store = createStore()
    renderRadar({ store, storage: trustedStorage() })

    expect(await screen.findByRole('heading', { name: 'Job automation controls' })).toBeVisible()
    expect(screen.getByText('Automatic on BOSS Zhipin')).toBeVisible()
    expect(screen.getByRole('list', { name: 'Agent work platforms' }).children).toHaveLength(1)
    expect(screen.getByText(/Platforms without an authorized connector produce reviewable drafts only/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run Agent now' })).toBeDisabled()

    expect(await screen.findByDisplayValue('Platform Engineer')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run Agent now' })).toBeEnabled()
  })

  it('shows scored jobs and preserves a saved application when ignored later', async () => {
    const user = userEvent.setup()
    const store = createStore()
    await store.put('jobSources', source)
    await store.put('jobSearchProfiles', profile)
    await store.put('jobPostings', posting)
    await store.put('jobRecommendations', scoreJobRecommendation({
      posting,
      profile,
      sourceDraftId: 'ada-draft',
      facts: [],
      now
    }))
    renderRadar({ store, storage: trustedStorage() })

    expect(await screen.findByRole('heading', { name: 'Platform Engineer' })).toBeVisible()
    expect(screen.getByLabelText(/Preliminary relevance score/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await store.list('applicationRecords'))[0]?.status).toBe('saved'))
    await user.click(screen.getByRole('button', { name: 'Ignore' }))
    await waitFor(async () => expect((await store.list('jobRecommendations'))[0]?.decision).toBe('ignored'))
    expect(await store.list('applicationRecords')).toHaveLength(1)
  })

})
