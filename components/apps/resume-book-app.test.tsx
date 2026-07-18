import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import en from '@/messages/en.json'
import { ResumeDraftProviderCore, useResumeDraft } from '@/components/resume-draft-provider'
import { MotionPreferenceProvider } from '@/components/desktop/motion-preference'
import { createResumeDraft, normalizeResumeData } from '@/lib/resume-model'
import { writeDraftState } from '@/lib/resume-store'
import { ResumeBookApp } from './resume-book-app'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function resume(name = 'Ada Lovelace') {
  return normalizeResumeData({
    profile: {
      name,
      title: 'AI Systems Engineer',
      summary: ['Builds reliable agent systems.'],
      tags: ['Agents'],
      links: []
    },
    skills: [{ group: 'Core', items: ['TypeScript', 'Three.js'] }],
    experiences: [{ company: 'Analytical Engines', role: 'Lead Engineer', period: '2024', tags: [], bullets: ['Shipped an orchestration platform.'] }],
    projects: [{ id: 'atlas', name: 'Atlas', type: 'Platform', tags: ['R3F'], summary: 'A visual resume graph.', highlights: [] }],
    education: [], certifications: [], awards: [], languages: [], openSource: [],
    metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-13T00:00:00.000Z' }
  })
}

function storageWithDrafts() {
  const storage = new MemoryStorage()
  const first = createResumeDraft(resume(), { id: 'ada', name: 'Ada Resume' })
  const second = createResumeDraft(resume('Grace Hopper'), { id: 'grace', name: 'Grace Resume' })
  writeDraftState(storage, { activeDraftId: first.id, drafts: [first, second] })
  return storage
}

function renderBook(options: { storage?: MemoryStorage; reduced?: boolean } = {}) {
  if (options.reduced) window.localStorage.setItem('resume-os-motion', 'reduced')
  const storage = options.storage ?? storageWithDrafts()
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <MotionPreferenceProvider>
        <ResumeDraftProviderCore locale="en" storage={storage}>
          <ResumeBookApp />
          <DraftSwitcher />
        </ResumeDraftProviderCore>
      </MotionPreferenceProvider>
    </NextIntlClientProvider>
  )
}

function DraftSwitcher() {
  const { setActiveDraft } = useResumeDraft()
  return <button type="button" onClick={() => setActiveDraft('grace')}>Use Grace</button>
}

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe('ResumeBookApp', () => {
  it('creates the deterministic six-page story in the required order', async () => {
    renderBook()
    const book = await screen.findByRole('region', { name: 'Resume Book' })
    const pages = within(book).getAllByTestId('book-page')

    expect(pages.map((page) => page.dataset.pageKind)).toEqual([
      'profile', 'summary', 'skills', 'experience', 'projects', 'closing'
    ])
    expect(within(book).getByText('1 / 6')).toBeVisible()
    expect(within(book).getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(within(book).getByRole('button', { name: 'Next page' })).toBeEnabled()
  })

  it('navigates with controls and scoped arrow keys without stealing editable input keys', async () => {
    const user = userEvent.setup()
    renderBook()
    const book = await screen.findByRole('region', { name: 'Resume Book' })
    const next = within(book).getByRole('button', { name: 'Next page' })
    const previous = within(book).getByRole('button', { name: 'Previous page' })

    await user.click(next)
    expect(within(book).getByText('2 / 6')).toBeVisible()
    book.focus()
    await user.keyboard('{ArrowRight}')
    expect(within(book).getByText('3 / 6')).toBeVisible()
    await user.keyboard('{ArrowLeft}')
    expect(within(book).getByText('2 / 6')).toBeVisible()

    const input = document.createElement('input')
    book.append(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(within(book).getByText('2 / 6')).toBeVisible()

    for (let index = 0; index < 4; index += 1) await user.click(next)
    expect(within(book).getByText('6 / 6')).toBeVisible()
    expect(next).toBeDisabled()
    expect(previous).toBeEnabled()
  })

  it('removes page rotation in reduced motion while preserving navigation', async () => {
    const user = userEvent.setup()
    renderBook({ reduced: true })
    const book = await screen.findByRole('region', { name: 'Resume Book' })
    expect(book).toHaveAttribute('data-motion-mode', 'reduced')
    await user.click(within(book).getByRole('button', { name: 'Next page' }))
    expect(within(book).getByText('2 / 6')).toBeVisible()
    expect(document.querySelector('.resume-book__sheet--turned')).toBeNull()
  })

  it('resets to the first page when the active draft changes', async () => {
    const user = userEvent.setup()
    const storage = storageWithDrafts()
    renderBook({ storage })
    const book = await screen.findByRole('region', { name: 'Resume Book' })
    await user.click(within(book).getByRole('button', { name: 'Next page' }))
    await user.click(within(book).getByRole('button', { name: 'Next page' }))
    expect(within(book).getByText('3 / 6')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Use Grace' }))

    await waitFor(() => expect(within(book).getByText('1 / 6')).toBeVisible())
    expect(within(book).getByText('Grace Hopper')).toBeVisible()
  })

  it('keeps all six pages usable when structured sections are empty', async () => {
    const storage = new MemoryStorage()
    const empty = createResumeDraft(normalizeResumeData({
      profile: { name: 'Empty Candidate', title: '', summary: [], tags: [], links: [] },
      skills: [], experiences: [], projects: [], education: [], certifications: [], awards: [], languages: [], openSource: [],
      metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-13T00:00:00.000Z' }
    }), { id: 'empty' })
    writeDraftState(storage, { activeDraftId: empty.id, drafts: [empty] })
    renderBook({ storage })

    const book = await screen.findByRole('region', { name: 'Resume Book' })
    expect(within(book).getAllByTestId('book-page')).toHaveLength(6)
    expect(within(book).getAllByText('Nothing added yet.').length).toBeGreaterThanOrEqual(3)
  })
})
