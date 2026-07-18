import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import postcss, { type AtRule, type Rule } from 'postcss'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import zh from '@/messages/zh.json'
import { ResumeDraftProviderCore, useResumeDraft } from '@/components/resume-draft-provider'
import { MotionPreferenceProvider } from '@/components/desktop/motion-preference'
import { createResumeDraft, normalizeResumeData, type ResumeData } from '@/lib/resume-model'
import { writeDraftState } from '@/lib/resume-store'
import { ClassicResumeApp, type ReviewVariantLoader } from './classic-resume-app'
import { projectKeyFromPath, ProjectsApp } from './projects-app'
import { TerminalApp } from './terminal-app'
import { TimelineApp } from './timeline-app'

const navigationState = vi.hoisted(() => ({
  pathname: '/projects',
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn()
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ push: navigationState.push, replace: navigationState.replace, back: navigationState.back })
}))

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function customResume(): ResumeData {
  return normalizeResumeData({
    profile: {
      name: 'Ada Custom', englishName: 'Ada C.', title: 'Systems Engineer', location: 'Shanghai',
      email: 'ada@example.test', summary: ['Builds reliable agent platforms.'], tags: ['Agent'], links: []
    },
    targetRole: 'AI Platform Engineer',
    skills: [{ group: 'Core', items: ['TypeScript', 'Rust'] }],
    experiences: [{
      company: 'Custom Systems', role: 'Staff Engineer', period: '2024 - Present', location: 'Remote',
      tags: ['Infrastructure'], bullets: ['Shipped the custom orchestration layer.']
    }],
    projects: [{
      id: 'custom-console', name: 'Custom Console', type: 'Agent Platform', tags: ['React', 'RAG'],
      summary: 'A custom operations console.', highlights: ['Reduced incident response time.']
    }, {
      id: 'second-project', name: 'Second Project', type: 'Developer Tool', tags: ['CLI'],
      summary: 'A second project for navigation.', highlights: ['Automated release checks.']
    }],
    education: [{ school: 'Custom University', degree: 'BS', major: 'Computer Science', period: '2020' }],
    certifications: [], awards: [], languages: ['English'], openSource: ['Maintains custom-toolkit'],
    metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-13T00:00:00.000Z' }
  })
}

function seededStorage(data = customResume()) {
  const storage = new MemoryStorage()
  const draft = createResumeDraft(data, { id: 'custom', name: 'Custom Resume', source: 'paste' })
  writeDraftState(storage, { activeDraftId: draft.id, drafts: [draft] })
  return storage
}

function sandboxStorage() {
  const storage = new MemoryStorage()
  const draft = createResumeDraft(customResume(), {
    id: 'sandbox',
    name: 'Sandbox Resume',
    source: 'ai-generated'
  })
  writeDraftState(storage, { activeDraftId: draft.id, drafts: [draft] })
  return storage
}

function storageWithSecondDraft() {
  const storage = new MemoryStorage()
  const first = createResumeDraft(customResume(), { id: 'custom', name: 'Custom Resume', source: 'paste' })
  const second = createResumeDraft(normalizeResumeData({
    ...customResume(),
    profile: { ...customResume().profile, name: 'Lin Second' },
    projects: [{
      id: 'lin-project', name: 'Lin Project', type: 'Platform', tags: ['Go'],
      summary: 'A different active draft.', highlights: ['Served another team.']
    }]
  }), { id: 'second-draft', name: 'Second Resume', source: 'paste' })
  writeDraftState(storage, { activeDraftId: first.id, drafts: [first, second] })
  return storage
}

function duplicateProjectResume() {
  return normalizeResumeData({
    ...customResume(),
    projects: [
      { id: '', name: 'Empty One', type: 'Demo', tags: ['Same', 'Same'], summary: 'First empty id.', highlights: ['Repeat', 'Repeat'] },
      { id: '', name: 'Empty Two', type: 'Demo', tags: ['Same'], summary: 'Second empty id.', highlights: [] },
      { id: 'duplicate', name: 'Duplicate One', type: 'Demo', tags: [], summary: 'First duplicate id.', highlights: [] },
      { id: 'duplicate', name: 'Duplicate Two', type: 'Demo', tags: [], summary: 'Second duplicate id.', highlights: [] },
      { id: 'project-1', name: 'Reserved Project Key', type: 'Demo', tags: [], summary: 'Unique id wins.', highlights: [] }
    ]
  })
}

function duplicateEverywhereResume() {
  const projects = duplicateProjectResume().projects
  const experience = {
    company: 'Repeated Co', role: 'Engineer', period: '2025', location: 'Remote',
    tags: ['Repeat', 'Repeat'], bullets: ['Same bullet', 'Same bullet']
  }
  return normalizeResumeData({
    ...customResume(),
    profile: { ...customResume().profile, summary: ['Same summary', 'Same summary'] },
    skills: [
      { group: 'Repeated Group', items: ['Same skill', 'Same skill'] },
      { group: 'Repeated Group', items: ['Same skill'] }
    ],
    experiences: [experience, { ...experience }],
    projects,
    education: [
      { school: 'Repeated School', degree: 'BS', major: 'CS', period: '2020' },
      { school: 'Repeated School', degree: 'BS', major: 'CS', period: '2020' }
    ],
    openSource: ['Repeated contribution', 'Repeated contribution']
  })
}

function emptyTerminalResume() {
  return normalizeResumeData({
    ...customResume(),
    skills: [],
    projects: []
  })
}

function LiveUpdateProbe() {
  const drafts = useResumeDraft()
  return (
    <div hidden>
      <button onClick={() => drafts.updateActiveResume(normalizeResumeData({
        ...drafts.activeResume,
        profile: { ...drafts.activeResume.profile, name: 'Grace Live' },
        experiences: [{ ...drafts.activeResume.experiences[0], company: 'Live Systems' }],
        projects: [{ ...drafts.activeResume.projects[0], name: 'Live Console' }, ...drafts.activeResume.projects.slice(1)]
      }))}>Update resume live</button>
      <button onClick={() => drafts.updateActiveResume(normalizeResumeData({ ...drafts.activeResume, projects: [] }))}>
        Remove active projects
      </button>
      <button onClick={() => drafts.setActiveDraft('second-draft')}>Switch to second draft</button>
    </div>
  )
}

function renderApps({
  seed = true,
  apps = 'all',
  storage = seed ? seededStorage() : null,
  locale = 'en'
}: {
  seed?: boolean
  apps?: 'all' | 'projects' | 'terminal'
  storage?: MemoryStorage | null
  locale?: 'en' | 'zh'
} = {}) {
  const messages = locale === 'zh' ? zh : en
  const tree = () => (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <MotionPreferenceProvider>
        <ResumeDraftProviderCore locale={locale} storage={storage}>
          <LiveUpdateProbe />
          {apps === 'all' && <>
            <ClassicResumeApp />
            <ProjectsApp />
            <TimelineApp />
            <TerminalApp />
          </>}
          {apps === 'projects' && <ProjectsApp />}
          {apps === 'terminal' && <TerminalApp />}
        </ResumeDraftProviderCore>
      </MotionPreferenceProvider>
    </NextIntlClientProvider>
  )
  const view = render(tree())
  return { ...view, rerenderApps: () => view.rerender(tree()), storage }
}

beforeEach(() => {
  navigationState.push.mockReset()
  navigationState.replace.mockReset()
  navigationState.back.mockReset()
})

afterEach(() => {
  navigationState.pathname = '/projects'
  cleanup()
})

describe('structured presentation applications', () => {
  it.each([
    ['without a saved draft', null],
    ['with only an AI-generated Sandbox draft', sandboxStorage()]
  ])('keeps candidate-specific sample content out of Review & Export %s', (_label, storage) => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ResumeDraftProviderCore locale="en" storage={storage}>
          <ClassicResumeApp />
        </ResumeDraftProviderCore>
      </NextIntlClientProvider>
    )

    expect(screen.getByRole('heading', { name: 'Import a verified resume to review' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open Resume Studio' })).toHaveAttribute('href', '/en/studio')
    expect(screen.queryByRole('combobox', { name: 'Resume version' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Print resume' })).not.toBeInTheDocument()
  })

  it('reviews a saved job-specific variant and can return to the unchanged master before printing', async () => {
    const user = userEvent.setup()
    const tailored = normalizeResumeData({
      ...customResume(),
      experiences: [{
        ...customResume().experiences[0],
        bullets: ['Tailored verified platform impact.']
      }]
    })
    const variantLoader = vi.fn<ReviewVariantLoader>().mockResolvedValue({
      variants: [{
        id: 'variant-1', sourceDraftId: 'custom', targetJobId: 'job-1',
        name: 'Custom Resume · Platform role', data: tailored,
        createdAt: '2026-07-16T08:00:00.000Z', updatedAt: '2026-07-16T08:00:00.000Z'
      }],
      runs: [{
        appliedVariantId: 'variant-1', sourceDraftId: 'custom',
        scoreBefore: { requirementCoverage: 50, evidenceCompleteness: 50 },
        scoreAfter: { requirementCoverage: 75, evidenceCompleteness: 75 }
      } as never]
    })
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ResumeDraftProviderCore locale="en" storage={seededStorage()}>
          <ClassicResumeApp variantLoader={variantLoader} />
        </ResumeDraftProviderCore>
      </NextIntlClientProvider>
    )

    const version = await screen.findByRole('combobox', { name: 'Resume version' })
    await user.selectOptions(version, 'variant-1')
    expect(await screen.findByRole('article', { name: 'Custom Resume · Platform role' })).toHaveTextContent('Tailored verified platform impact.')
    const quality = screen.getByRole('group', { name: 'Before and after deterministic quality report' })
    expect(within(quality).getAllByText('50% → 75%')).toHaveLength(2)
    expect(within(quality).getByText('Structure & readability')).toBeVisible()

    await user.selectOptions(version, 'master')
    expect(await screen.findByRole('article', { name: 'Custom Resume' })).toHaveTextContent('Shipped the custom orchestration layer.')
    expect(screen.queryByText('Tailored verified platform impact.')).not.toBeInTheDocument()
  })

  it('parses only the fixed localized or locale-free Projects detail route shape', () => {
    expect(projectKeyFromPath('/projects/projects')).toBe('projects')
    expect(projectKeyFromPath('/en/projects/projects')).toBe('projects')
    expect(projectKeyFromPath('/zh/projects/agent%20console')).toBe('agent console')
    expect(projectKeyFromPath('/projects/agent%2Fconsole')).toBe('agent/console')

    expect(projectKeyFromPath('/en/portfolio/projects/key')).toBeNull()
    expect(projectKeyFromPath('/en/projects/key/extra')).toBeNull()
    expect(projectKeyFromPath('/projects/key/extra')).toBeNull()
    expect(projectKeyFromPath('/fr/projects/key')).toBeNull()
    expect(projectKeyFromPath('/en/projects/%E0%A4%A')).toBeNull()
    expect(projectKeyFromPath('/en/projects/')).toBeNull()
  })

  it('renders the active draft in every application and updates live without sample leakage', async () => {
    const user = userEvent.setup()
    renderApps()

    const classic = await screen.findByRole('article', { name: 'Custom Resume' })
    const projects = screen.getByRole('region', { name: 'Project Explorer' })
    const timeline = screen.getByRole('region', { name: 'Career Timeline' })
    const terminal = screen.getByRole('region', { name: 'Resume terminal' })
    expect(within(classic).getByText('Ada Custom')).toBeVisible()
    expect(within(classic).getByText('Custom Console')).toBeVisible()
    expect(within(classic).getByText(/Custom Systems/)).toBeVisible()
    expect(within(projects).getByText(/Ada Custom/)).toBeVisible()
    expect(within(projects).getByText('Custom Console')).toBeVisible()
    expect(within(timeline).getByText(/Ada Custom/)).toBeVisible()
    expect(within(timeline).getByText('Custom Systems')).toBeVisible()
    expect(within(terminal).getByText(/Ada Custom/)).toBeVisible()
    expect(screen.queryByText(/Demo Candidate/i)).not.toBeInTheDocument()

    await user.click(screen.getByText('Update resume live'))
    expect(await within(classic).findByText('Grace Live')).toBeVisible()
    expect(within(classic).getByText('Live Console')).toBeVisible()
    expect(within(classic).getByText(/Live Systems/)).toBeVisible()
    expect(within(projects).getByText(/Grace Live/)).toBeVisible()
    expect(within(projects).getByText('Live Console')).toBeVisible()
    expect(within(timeline).getByText(/Grace Live/)).toBeVisible()
    expect(within(timeline).getByText('Live Systems')).toBeVisible()
    expect(within(terminal).getByText(/Grace Live/)).toBeVisible()
  })

  it('keeps showcase apps empty until the user explicitly creates or loads a draft', () => {
    renderApps({ seed: false })
    const projects = screen.getByRole('region', { name: 'Project Explorer' })
    const timeline = screen.getByRole('region', { name: 'Career Timeline' })
    const terminal = screen.getByRole('region', { name: 'Resume terminal' })
    expect(screen.getByRole('heading', { name: 'Import a verified resume to review' })).toBeVisible()
    expect(screen.queryByRole('article', { name: 'Sample resume' })).not.toBeInTheDocument()
    expect(within(projects).getByText('No projects are available in this resume.')).toBeVisible()
    expect(within(timeline).getByText('No experience has been added to this resume.')).toBeVisible()
    expect(within(terminal).queryByText(/Demo Candidate/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Ada Custom')).not.toBeInTheDocument()
  })

  it('keeps Projects list and detail in one application while navigation owns the URL', async () => {
    const user = userEvent.setup()
    const view = renderApps({ apps: 'projects' })

    const explorer = await screen.findByRole('region', { name: 'Project Explorer' })
    await user.click(within(explorer).getByRole('button', { name: 'Open Custom Console' }))
    expect(navigationState.push).toHaveBeenCalledWith('/projects/custom-console', { locale: 'en' })
    expect(within(explorer).getByRole('heading', { name: 'Project Explorer' })).toBeVisible()

    navigationState.pathname = '/projects/custom-console'
    view.rerenderApps()
    expect(within(explorer).getByRole('heading', { name: 'Custom Console' })).toBeVisible()
    expect(within(explorer).getByText('Reduced incident response time.')).toBeVisible()
    expect(screen.getAllByRole('region', { name: 'Project Explorer' })).toHaveLength(1)

    await user.click(within(explorer).getByRole('button', { name: 'Back to Projects' }))
    expect(navigationState.push).toHaveBeenLastCalledWith('/projects', { locale: 'en' })

    navigationState.pathname = '/projects'
    view.rerenderApps()
    expect(within(explorer).getByRole('heading', { name: 'Project Explorer' })).toBeVisible()
    expect(within(explorer).getByRole('button', { name: 'Open Second Project' })).toBeVisible()
  })

  it('restores Projects detail on refresh and follows browser back and forward path changes', async () => {
    navigationState.pathname = '/en/projects/custom-console'
    const view = renderApps({ apps: 'projects' })
    expect(await screen.findByRole('heading', { name: 'Custom Console' })).toBeVisible()

    navigationState.pathname = '/projects'
    view.rerenderApps()
    expect(await screen.findByRole('heading', { name: 'Project Explorer' })).toBeVisible()

    navigationState.pathname = '/projects/second-project'
    view.rerenderApps()
    expect(await screen.findByRole('heading', { name: 'Second Project' })).toBeVisible()
    expect(navigationState.push).not.toHaveBeenCalled()
    expect(navigationState.replace).not.toHaveBeenCalled()
  })

  it('encodes special project ids and opens an id named projects at the fixed detail route', async () => {
    const user = userEvent.setup()
    const resume = normalizeResumeData({
      ...customResume(),
      projects: [
        { ...customResume().projects[0], id: 'projects', name: 'Projects Named Project' },
        { ...customResume().projects[1], id: 'agent/console', name: 'Slash Project' }
      ]
    })
    const view = renderApps({ apps: 'projects', storage: seededStorage(resume) })
    const explorer = await screen.findByRole('region', { name: 'Project Explorer' })

    await user.click(within(explorer).getByRole('button', { name: 'Open Slash Project' }))
    expect(navigationState.push).toHaveBeenLastCalledWith('/projects/agent%2Fconsole', { locale: 'en' })
    await user.click(within(explorer).getByRole('button', { name: 'Open Projects Named Project' }))
    expect(navigationState.push).toHaveBeenLastCalledWith('/projects/projects', { locale: 'en' })

    navigationState.pathname = '/projects/projects'
    view.rerenderApps()
    expect(await screen.findByRole('heading', { name: 'Projects Named Project' })).toBeVisible()
  })

  it('falls back to the list and repairs the URL once when active draft data invalidates a detail', async () => {
    const user = userEvent.setup()
    navigationState.pathname = '/projects/custom-console'
    const view = renderApps({ apps: 'projects', storage: storageWithSecondDraft() })
    expect(await screen.findByRole('heading', { name: 'Custom Console' })).toBeVisible()

    await user.click(screen.getByText('Switch to second draft'))
    expect(await screen.findByRole('heading', { name: 'Project Explorer' })).toBeVisible()
    expect(screen.getByText(/Lin Second/)).toBeVisible()
    expect(navigationState.replace).toHaveBeenCalledTimes(1)
    expect(navigationState.replace).toHaveBeenCalledWith('/projects', { locale: 'en' })

    view.rerenderApps()
    expect(navigationState.replace).toHaveBeenCalledTimes(1)
  })

  it('revalidates a selected project when active resume data removes it', async () => {
    const user = userEvent.setup()
    navigationState.pathname = '/projects/custom-console'
    renderApps({ apps: 'projects' })
    expect(await screen.findByRole('heading', { name: 'Custom Console' })).toBeVisible()

    await user.click(screen.getByText('Remove active projects'))
    expect(await screen.findByRole('heading', { name: 'Project Explorer' })).toBeVisible()
    expect(navigationState.replace).toHaveBeenCalledWith('/projects', { locale: 'en' })
  })

  it('uses collision-free deterministic keys for empty and duplicate project ids', async () => {
    const user = userEvent.setup()
    const view = renderApps({ apps: 'projects', storage: seededStorage(duplicateProjectResume()) })
    const explorer = await screen.findByRole('region', { name: 'Project Explorer' })

    await user.click(within(explorer).getByRole('button', { name: 'Open Empty One' }))
    const emptyOneRoute = navigationState.push.mock.lastCall?.[0] as string
    expect(emptyOneRoute).toMatch(/^\/projects\/project-empty-one-[a-z0-9]+$/)
    await user.click(within(explorer).getByRole('button', { name: 'Open Empty Two' }))
    const emptyTwoRoute = navigationState.push.mock.lastCall?.[0] as string
    expect(emptyTwoRoute).toMatch(/^\/projects\/project-empty-two-[a-z0-9]+$/)
    await user.click(within(explorer).getByRole('button', { name: 'Open Duplicate One' }))
    const duplicateOneRoute = navigationState.push.mock.lastCall?.[0] as string
    expect(duplicateOneRoute).toMatch(/^\/projects\/project-duplicate-one-[a-z0-9]+$/)
    await user.click(within(explorer).getByRole('button', { name: 'Open Reserved Project Key' }))
    expect(navigationState.push).toHaveBeenLastCalledWith('/projects/project-1', { locale: 'en' })

    navigationState.pathname = emptyTwoRoute
    view.rerenderApps()
    expect(await screen.findByRole('heading', { name: 'Empty Two' })).toBeVisible()
  })

  it('renders duplicate resume values across all presentation apps without React key collisions', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    renderApps({ storage: seededStorage(duplicateEverywhereResume()) })

    await user.click(screen.getByRole('button', { name: 'Run skills' }))
    await user.click(screen.getByRole('button', { name: 'Run projects' }))

    const keyWarnings = consoleError.mock.calls.filter((call) => {
      const message = call.map(String).join(' ')
      return message.includes('same key') || message.includes('unique "key"')
    })
    expect(keyWarnings).toEqual([])
    consoleError.mockRestore()
  })

  it('runs Terminal commands from buttons and keyboard using current resume data', async () => {
    const user = userEvent.setup()
    renderApps({ apps: 'terminal' })
    const terminal = await screen.findByRole('region', { name: 'Resume terminal' })
    const output = within(terminal).getByLabelText('Terminal output')

    await user.click(within(terminal).getByRole('button', { name: 'Run whoami' }))
    expect(within(output).getByText(/Ada Custom.*Systems Engineer/)).toBeVisible()

    await user.click(within(terminal).getByRole('button', { name: 'Run skills' }))
    expect(within(output).getByText(/Core: TypeScript, Rust/)).toBeVisible()

    const input = within(terminal).getByRole('textbox', { name: 'Terminal command' })
    await user.type(input, 'projects{Enter}')
    expect(within(output).getByText(/Custom Console: React, RAG/)).toBeVisible()
    expect(input).toHaveValue('')

    await user.type(input, 'help{Enter}')
    expect(within(output).getByText('Commands: whoami, skills, projects, help')).toBeVisible()

    await user.type(input, 'deploy{Enter}')
    expect(within(output).getByText('Command not found: deploy')).toBeVisible()
  })

  it('snapshots Terminal output at execution time and announces only the latest result', async () => {
    const user = userEvent.setup()
    renderApps({ apps: 'terminal', storage: storageWithSecondDraft() })
    const terminal = await screen.findByRole('region', { name: 'Resume terminal' })
    const output = within(terminal).getByLabelText('Terminal output')
    const status = within(terminal).getByRole('status')
    expect(output).not.toHaveAttribute('aria-live')

    await user.click(within(terminal).getByRole('button', { name: 'Run whoami' }))
    expect(within(output).getByText(/Ada Custom.*Systems Engineer/)).toBeVisible()
    expect(status).toHaveTextContent(/Ada Custom.*Systems Engineer/)

    await user.click(screen.getByText('Update resume live'))
    expect(within(output).getByText(/Ada Custom.*Systems Engineer/)).toBeVisible()
    expect(within(output).queryByText(/Grace Live/)).not.toBeInTheDocument()

    await user.click(within(terminal).getByRole('button', { name: 'Run whoami' }))
    expect(within(output).getByText(/Grace Live.*Systems Engineer/)).toBeVisible()
    expect(status).toHaveTextContent(/Grace Live.*Systems Engineer/)
    expect(status).not.toHaveTextContent('Ada Custom')

    await user.click(screen.getByText('Switch to second draft'))
    expect(within(output).getByText(/Ada Custom.*Systems Engineer/)).toBeVisible()
    expect(within(output).getByText(/Grace Live.*Systems Engineer/)).toBeVisible()
    expect(within(output).queryByText(/Lin Second/)).not.toBeInTheDocument()

    await user.click(within(terminal).getByRole('button', { name: 'Run whoami' }))
    expect(within(output).getByText(/Lin Second.*Systems Engineer/)).toBeVisible()
    expect(status).toHaveTextContent(/Lin Second.*Systems Engineer/)
    expect(status).not.toHaveTextContent('Grace Live')
  })

  it('returns and announces localized nonempty output for empty skills and projects', async () => {
    const user = userEvent.setup()
    const englishView = renderApps({ apps: 'terminal', storage: seededStorage(emptyTerminalResume()) })
    const englishTerminal = await screen.findByRole('region', { name: 'Resume terminal' })
    const englishOutput = within(englishTerminal).getByLabelText('Terminal output')
    const englishStatus = within(englishTerminal).getByRole('status')

    await user.click(within(englishTerminal).getByRole('button', { name: 'Run skills' }))
    expect(within(englishOutput).getByText('No skills yet.')).toBeVisible()
    expect(englishStatus).toHaveTextContent('No skills yet.')
    await user.click(within(englishTerminal).getByRole('button', { name: 'Run projects' }))
    expect(within(englishOutput).getByText('No projects yet.')).toBeVisible()
    expect(englishStatus).toHaveTextContent('No projects yet.')

    englishView.unmount()
    const chineseView = renderApps({ apps: 'terminal', storage: seededStorage(emptyTerminalResume()), locale: 'zh' })
    const chineseTerminal = await screen.findByRole('region', { name: '简历终端' })
    const chineseOutput = within(chineseTerminal).getByLabelText('终端输出')
    const chineseStatus = within(chineseTerminal).getByRole('status')

    await user.click(within(chineseTerminal).getByRole('button', { name: '运行 skills' }))
    expect(within(chineseOutput).getByText('暂无技能。')).toBeVisible()
    expect(chineseStatus).toHaveTextContent('暂无技能。')
    await user.click(within(chineseTerminal).getByRole('button', { name: '运行 projects' }))
    expect(within(chineseOutput).getByText('暂无项目。')).toBeVisible()
    expect(chineseStatus).toHaveTextContent('暂无项目。')
    chineseView.unmount()
  })

  it('updates the live announcement for consecutive identical commands without making history live', async () => {
    const user = userEvent.setup()
    renderApps({ apps: 'terminal' })
    const terminal = await screen.findByRole('region', { name: 'Resume terminal' })
    const output = within(terminal).getByLabelText('Terminal output')
    const status = within(terminal).getByRole('status')
    const command = within(terminal).getByRole('button', { name: 'Run whoami' })

    await user.click(command)
    const firstAnnouncement = status.firstElementChild
    expect(firstAnnouncement).toHaveTextContent(/Ada Custom.*Systems Engineer/)

    await user.click(command)
    const secondAnnouncement = status.firstElementChild
    expect(secondAnnouncement).not.toBe(firstAnnouncement)
    expect(secondAnnouncement).toHaveTextContent(/Ada Custom.*Systems Engineer/)
    expect(within(output).getAllByText(/Ada Custom.*Systems Engineer/)).toHaveLength(2)
    expect(output).not.toHaveAttribute('aria-live')
  })

  it('exposes reduced-motion timeline semantics, print rules, and mobile touch targets', async () => {
    renderApps()
    const timeline = await screen.findByRole('region', { name: 'Career Timeline' })
    expect(timeline).toHaveAttribute('data-motion-mode')
    expect(within(timeline).getByText('Custom Systems').closest('article')).toHaveClass('timeline-app__entry')

    const classic = screen.getByRole('article', { name: 'Custom Resume' })
    expect(classic).toHaveClass('classic-resume-app__document')

    const css = readFileSync('app/globals.css', 'utf8')
    expect(css).toMatch(/@media print[\s\S]*\.classic-resume-app__document/)
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.projects-app button[\s\S]*min-height:\s*44px/)
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.terminal-app button[\s\S]*min-height:\s*44px/)
  })

  it('prints only the Classic document without desktop shell chrome', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    const print = postcss.parse(css).nodes.find(
      (node): node is AtRule => node.type === 'atrule' && node.name === 'media' && node.params === 'print'
    )
    expect(print).toBeDefined()

    for (const selector of [
      'body:has(.classic-resume-app) .desktop-menu-bar',
      'body:has(.classic-resume-app) .desktop-dock',
      'body:has(.classic-resume-app) .desktop-surface',
      'body:has(.classic-resume-app) .desktop-route-descriptors',
      'body:has(.classic-resume-app) .desktop-window__titlebar',
      'body:has(.classic-resume-app) .desktop-window__controls'
    ]) {
      expect(printDeclaration(print, selector, 'display')).toEqual({ value: 'none', important: true })
    }

    expect(printDeclaration(
      print,
      'body:has(.classic-resume-app) .desktop-window-motion:not(:has(.classic-resume-app))',
      'display'
    )).toEqual({ value: 'none', important: true })
    expect(printDeclaration(print, '.classic-resume-app__document', 'display')).toEqual({ value: 'block', important: true })
    expect(printDeclaration(print, '.classic-resume-app__document', 'width')).toEqual({ value: '186mm', important: false })
  })
})

function printDeclaration(print: AtRule | undefined, selector: string, property: string) {
  let matchingRule: Rule | undefined
  print?.walkRules((rule) => {
    if (rule.selectors.includes(selector)) matchingRule = rule
  })
  const declaration = matchingRule?.nodes.find(
    (node) => node.type === 'decl' && node.prop === property
  )
  return declaration?.type === 'decl'
    ? { value: declaration.value, important: Boolean(declaration.important) }
    : undefined
}
