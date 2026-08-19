import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { ResumeDraftProviderCore, useResumeDraft } from '@/components/resume-draft-provider'
import { buildJDRequirementAnalysis } from '@/lib/agent/jd-report'
import { startOptimizationWorkflow } from '@/lib/agent/agent-workflow'
import { clearAiProviderPreference, saveAiProviderPreference } from '@/lib/agent/provider-preference'
import { ACTIVE_WORKFLOW_CHANGED_EVENT } from '@/lib/agent/workflow-persistence'
import { createResumeDraft, normalizeResumeData } from '@/lib/resume-model'
import { writeDraftState } from '@/lib/resume-store'
import {
  JDMatchApp,
  type JDMatchRequirementPersistence,
  type JDMatchPromotionCompletion,
  type JDMatchPromotionLoader,
  type JDMatchStalePersistence,
  type JDMatchWorkflowSummaryLoader,
  type JDMatchWorkflowPersistence
} from './jd-match-app'

const fetchMock = vi.fn<typeof fetch>()

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const resume = normalizeResumeData({
  profile: { name: 'Ada Candidate', title: 'Engineer', summary: [], tags: [], links: [] },
  skills: [], experiences: [], projects: [], education: [], certifications: [], awards: [], languages: [], openSource: [],
  metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-13T00:00:00.000Z' }
})

function seededStorage(source: 'paste' | 'sample' = 'paste') {
  const storage = new MemoryStorage()
  const draft = createResumeDraft(resume, { id: 'ada', name: 'Ada Resume', source })
  writeDraftState(storage, { activeDraftId: draft.id, drafts: [draft] })
  return storage
}

function renderMatch(
  seed = true,
  workflowPersistence?: JDMatchWorkflowPersistence,
  requirementPersistence?: JDMatchRequirementPersistence,
  stalePersistence?: JDMatchStalePersistence,
  workflowSummaryLoader?: JDMatchWorkflowSummaryLoader,
  source: 'paste' | 'sample' = 'paste',
  promotionLoader?: JDMatchPromotionLoader,
  promotionCompletion?: JDMatchPromotionCompletion
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ResumeDraftProviderCore locale="en" storage={seed ? seededStorage(source) : null}>
        <Probe />
        <JDMatchApp
          workflowPersistence={workflowPersistence}
          requirementPersistence={requirementPersistence}
          stalePersistence={stalePersistence}
          workflowSummaryLoader={workflowSummaryLoader}
          promotionLoader={promotionLoader}
          promotionCompletion={promotionCompletion}
        />
      </ResumeDraftProviderCore>
    </NextIntlClientProvider>
  )
}

function Probe() {
  const drafts = useResumeDraft()
  return <button hidden onClick={() => drafts.updateActiveResume({
    ...drafts.activeResume,
    profile: { ...drafts.activeResume.profile, title: 'Platform Engineer' }
  })}>Update active resume</button>
}

const sections = {
  jobTitle: 'Platform Engineer',
  company: 'Example Co',
  requirements: [{
    text: 'TypeScript ownership', category: 'skill' as const,
    priority: 'must' as const, weight: 5, keywords: ['TypeScript']
  }, {
    text: 'AI delivery', category: 'experience' as const,
    priority: 'preferred' as const, weight: 3, keywords: ['AI']
  }, {
    text: 'Own production systems', category: 'responsibility' as const,
    priority: 'signal' as const, weight: 2, keywords: ['production']
  }],
  resumeEmphasis: ['Platform work'],
  interviewPrep: ['Prepare architecture examples']
}

function analysisFor(jobDescription: string) {
  return buildJDRequirementAnalysis({
    report: sections,
    jobDescription,
    locale: 'en',
    resume,
    timestamp: '2026-07-16T08:00:00.000Z'
  })
}

const analysis = analysisFor('Seeking a platform engineer')

async function reviewAllRequirements(user: ReturnType<typeof userEvent.setup>) {
  for (let index = 0; index < sections.requirements.length; index += 1) {
    const [next] = await screen.findAllByRole('button', { name: 'Confirm requirement' })
    await user.click(next)
  }
  await user.click(screen.getByRole('button', { name: 'Create Agent run' }))
}

function response(body: unknown, status = 200, headers?: HeadersInit) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body } as Response
}

beforeEach(() => {
  window.localStorage.clear()
  clearAiProviderPreference()
  saveAiProviderPreference({ mode: 'openai-compatible', allowCloudFallback: false })
  fetchMock.mockReset().mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { jd: string }
    return response({
      report: '## Job Requirements\nTypeScript ownership\nAI delivery\nOwn production systems\n## Resume Emphasis\nPlatform work\n## Interview Prep\nPrepare architecture examples',
      sections,
      model: 'test-model',
      ...analysisFor(body.jd)
    })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('JDMatchApp', () => {
  it('loads a fingerprinted Job Agent handoff and links it only after requirement confirmation', async () => {
    const user = userEvent.setup()
    const intent = {
      postingId: 'posting-1', recommendationId: 'recommendation-1', sourceDraftId: 'ada',
      postingContentHash: 'hash:one', recommendationFingerprint: 'fingerprint:one',
      createdAt: '2026-08-01T08:00:00.000Z'
    }
    const promotionLoader = vi.fn<JDMatchPromotionLoader>().mockResolvedValue({
      intent,
      posting: {
        id: 'posting-1', sourceId: 'source-1', externalId: '1',
        canonicalUrl: 'https://boards.greenhouse.io/example/jobs/1',
        applyUrl: 'https://boards.greenhouse.io/example/jobs/1',
        title: 'Platform Engineer', company: 'Example Co', description: 'Seeking a platform engineer',
        locale: 'en', firstSeenAt: '2026-08-01T08:00:00.000Z', lastCheckedAt: '2026-08-01T08:00:00.000Z',
        status: 'open', contentHash: 'hash:one'
      },
      closed: false
    })
    const workflowPersistence = vi.fn<JDMatchWorkflowPersistence>().mockResolvedValue({
      targetJobId: 'target-1', optimizationRunId: 'run-1'
    })
    const promotionCompletion = vi.fn<JDMatchPromotionCompletion>().mockResolvedValue()

    renderMatch(true, workflowPersistence, undefined, undefined, undefined, 'paste', promotionLoader, promotionCompletion)
    expect(await screen.findByDisplayValue('Seeking a platform engineer')).toBeVisible()
    expect(screen.getByText(/Example Co · Platform Engineer was loaded/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))
    await screen.findByRole('heading', { name: 'TypeScript ownership' })
    await reviewAllRequirements(user)

    await waitFor(() => expect(promotionCompletion).toHaveBeenCalledWith({
      intent,
      targetJobId: 'target-1',
      now: expect.any(String)
    }))
    expect(screen.getByText(/Job Agent application is linked locally/)).toBeVisible()
  })

  it('warns that sandbox resumes cannot become verified career evidence', async () => {
    renderMatch(true, undefined, undefined, undefined, undefined, 'sample')

    expect(await screen.findByText('This is fictional sandbox data')).toBeVisible()
    expect(screen.getByRole('link', {
      name: 'Open Studio to paste or upload a trusted resume'
    })).toHaveAttribute('href', '/en/studio')
  })

  it('keeps the inset JD textarea within its application column', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    expect(css).toMatch(/\.jd-match-app__input\s*>\s*textarea\s*{[^}]*width:\s*auto;/)
  })

  it('sends the active resume and renders structured report sections without raw preformatted output', async () => {
    const user = userEvent.setup()
    renderMatch()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Seeking a platform engineer')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      jd: 'Seeking a platform engineer', locale: 'en',
      resume: expect.objectContaining({ profile: expect.objectContaining({ name: 'Ada Candidate' }) })
    })
    const report = await screen.findByRole('region', { name: 'Extracted job requirements' })
    expect(within(report).queryByText(/Match Score/)).not.toBeInTheDocument()
    expect(within(report).getByRole('heading', { name: 'Interview Prep' })).toBeVisible()
    expect(within(report).getByText('OpenAI-compatible · test-model')).toBeVisible()
    expect(within(report).getByText('Verified requirement coverage')).toBeVisible()
    expect(within(report).getByText('Verified evidence completeness')).toBeVisible()
    expect(within(report).getByText('Structure & readability')).toBeVisible()
    expect(within(report).getByText('Alignment rubric: resume-os-alignment-v1')).toBeVisible()
    expect(within(report).getByText('Structure rubric: resume-os-structure-v1')).toBeVisible()
    expect(within(report).getByText(/^Input fingerprint: fnv1a:/)).toBeVisible()
    expect(within(report).getByText('15%')).toBeVisible()
    expect(within(report).getAllByText('Pending evidence review')).toHaveLength(2)
    expect(within(report).getByRole('heading', { name: 'TypeScript ownership' })).toBeVisible()
    const firstRequirement = within(report).getByRole('heading', { name: 'TypeScript ownership' }).closest('[role="listitem"]') as HTMLElement
    expect(within(firstRequirement).getByText('Must', { selector: 'dd' })).toBeVisible()
    expect(within(firstRequirement).getByText('TypeScript', { selector: 'dd' })).toBeVisible()
    expect(within(report).getAllByText('Not yet mapped')).toHaveLength(3)
    expect(within(report).getAllByText('Missing — no verified career evidence is linked.')).toHaveLength(3)
    expect(report.querySelector('pre')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Job requirements are ready for review.')
  })

  it('creates the resumable Agent run only after every requirement is confirmed', async () => {
    const user = userEvent.setup()
    const workflowAnalysis = analysisFor('Platform role')
    const workflowPersistence = vi.fn<JDMatchWorkflowPersistence>().mockResolvedValue({
      targetJobId: workflowAnalysis.targetJob.id,
      optimizationRunId: 'run-1'
    })
    renderMatch(true, workflowPersistence)
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))

    expect(await screen.findByText('0 of 3 confirmed')).toBeVisible()
    expect(workflowPersistence).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('resume-os-active-workflow-v1')).toBeNull()

    await reviewAllRequirements(user)
    expect(await screen.findByText('Target job and resumable Agent run saved in this browser.')).toBeVisible()
    expect(workflowPersistence).toHaveBeenCalledWith(expect.objectContaining({
      sourceDraftId: 'ada',
      locale: 'en'
    }))
    expect(workflowPersistence.mock.calls[0][0].analysis.matrix.requirements.every(
      (requirement) => requirement.userConfirmed
    )).toBe(true)
    expect(JSON.parse(window.localStorage.getItem('resume-os-active-workflow-v1') ?? '')).toEqual({
      targetJobId: workflowAnalysis.targetJob.id,
      optimizationRunId: 'run-1'
    })
  })

  it('supports reviewing one requirement without persisting a partial Agent run', async () => {
    const user = userEvent.setup()
    const workflowPersistence = vi.fn<JDMatchWorkflowPersistence>().mockResolvedValue({
      targetJobId: analysis.targetJob.id,
      optimizationRunId: 'run-1'
    })
    renderMatch(true, workflowPersistence)
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))

    const requirement = (await screen.findByRole('heading', { name: 'TypeScript ownership' }))
      .closest('[role="listitem"]') as HTMLElement
    await user.click(within(requirement).getByRole('button', { name: 'Confirm requirement' }))

    expect(await screen.findByText('1 of 3 confirmed')).toBeVisible()
    expect(workflowPersistence).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('resume-os-active-workflow-v1')).toBeNull()
    expect(screen.getByRole('button', { name: 'Review 2 remaining' })).toBeDisabled()
  })

  it('refreshes persisted requirement matches after the active Agent workflow changes', async () => {
    const user = userEvent.setup()
    const workflowAnalysis = analysisFor('Platform role')
    const preference = {
      targetJobId: workflowAnalysis.targetJob.id,
      optimizationRunId: 'run-1'
    }
    const workflowPersistence = vi.fn<JDMatchWorkflowPersistence>().mockResolvedValue(preference)
    const workflowSummaryLoader = vi.fn<JDMatchWorkflowSummaryLoader>()
    renderMatch(true, workflowPersistence, undefined, undefined, workflowSummaryLoader)
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))
    await reviewAllRequirements(user)
    await screen.findByText('Target job and resumable Agent run saved in this browser.')

    const persistedAnalysis = workflowPersistence.mock.calls[0][0].analysis
    const workflow = startOptimizationWorkflow({
      id: preference.optimizationRunId,
      sourceDraftId: 'ada',
      matrix: persistedAnalysis.matrix,
      locale: 'en',
      now: '2026-07-16T09:00:00.000Z'
    })
    const updatedMatch = {
      ...workflow.run.requirementMatches[0],
      status: 'direct' as const,
      factIds: ['fact-agent-1'],
      rationale: 'Agent linked a confirmed career fact.'
    }
    workflowSummaryLoader.mockResolvedValueOnce({
      preference: { ...preference, optimizationRunId: 'run-other' },
      targetJob: persistedAnalysis.targetJob,
      run: { ...workflow.run, id: 'run-other' }
    })
    act(() => window.dispatchEvent(new Event(ACTIVE_WORKFLOW_CHANGED_EVENT)))
    await waitFor(() => expect(workflowSummaryLoader).toHaveBeenCalledOnce())
    expect(screen.getAllByText('Not yet mapped')).toHaveLength(3)

    workflowSummaryLoader.mockResolvedValue({
      preference,
      targetJob: persistedAnalysis.targetJob,
      run: {
        ...workflow.run,
        requirementMatches: [updatedMatch, ...workflow.run.requirementMatches.slice(1)]
      }
    })

    act(() => window.dispatchEvent(new Event(ACTIVE_WORKFLOW_CHANGED_EVENT)))

    const requirement = (await screen.findByRole('heading', { name: 'TypeScript ownership' }))
      .closest('[role="listitem"]') as HTMLElement
    expect(await within(requirement).findByText('Direct match')).toBeVisible()
    expect(within(requirement).getByText('1 verified career fact linked.')).toBeVisible()
    expect(within(requirement).getByText(/Agent linked a confirmed career fact/)).toBeVisible()
    expect(workflowSummaryLoader).toHaveBeenCalledTimes(2)
  })

  it('lets the user correct a saved requirement and invalidates the previous run fingerprint', async () => {
    const user = userEvent.setup()
    const workflowAnalysis = analysisFor('Platform role')
    const workflowPersistence = vi.fn<JDMatchWorkflowPersistence>().mockResolvedValue({
      targetJobId: workflowAnalysis.targetJob.id,
      optimizationRunId: 'run-1'
    })
    const requirementPersistence = vi.fn<JDMatchRequirementPersistence>().mockResolvedValue()
    renderMatch(true, workflowPersistence, requirementPersistence)
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))
    await reviewAllRequirements(user)
    await screen.findByText('Target job and resumable Agent run saved in this browser.')

    const requirement = (await screen.findByRole('heading', { name: 'TypeScript ownership' }))
      .closest('[role="listitem"]') as HTMLElement
    await user.selectOptions(within(requirement).getByRole('combobox', { name: 'Category' }), 'skill')
    await user.selectOptions(within(requirement).getByRole('combobox', { name: 'Priority' }), 'must')
    await user.clear(within(requirement).getByRole('spinbutton', { name: 'Weight' }))
    await user.type(within(requirement).getByRole('spinbutton', { name: 'Weight' }), '5')
    await user.clear(within(requirement).getByRole('textbox', { name: 'Keywords' }))
    await user.type(within(requirement).getByRole('textbox', { name: 'Keywords' }), 'TypeScript, platform')
    await user.click(within(requirement).getByRole('button', { name: 'Save correction' }))

    await waitFor(() => expect(requirementPersistence).toHaveBeenCalledOnce())
    const saved = requirementPersistence.mock.calls[0][0]
    expect(saved.preference).toEqual({
      targetJobId: workflowAnalysis.targetJob.id,
      optimizationRunId: 'run-1'
    })
    expect(saved.analysis.matrix.inputFingerprint).toMatch(/^revision:/)
    expect(saved.analysis.matrix.requirements[0]).toMatchObject({
      category: 'skill',
      priority: 'must',
      weight: 5,
      keywords: ['TypeScript', 'platform'],
      userConfirmed: true
    })
    expect(screen.getByText(/previous Agent run is now stale/i)).toBeVisible()
  })

  it('persists stale state when the analyzed resume or JD changes', async () => {
    const user = userEvent.setup()
    const workflowAnalysis = analysisFor('Platform role')
    const workflowPersistence = vi.fn<JDMatchWorkflowPersistence>().mockResolvedValue({
      targetJobId: workflowAnalysis.targetJob.id,
      optimizationRunId: 'run-1'
    })
    const stalePersistence = vi.fn<JDMatchStalePersistence>().mockResolvedValue()
    renderMatch(true, workflowPersistence, undefined, stalePersistence)
    await screen.findByText('Ada Resume')
    const input = screen.getByRole('textbox', { name: 'Job description' })
    await user.type(input, 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))
    await reviewAllRequirements(user)
    await screen.findByText('Target job and resumable Agent run saved in this browser.')

    await user.type(input, ' changed')
    await waitFor(() => expect(stalePersistence).toHaveBeenCalledWith(expect.objectContaining({
      preference: {
        targetJobId: workflowAnalysis.targetJob.id,
        optimizationRunId: 'run-1'
      },
      currentFingerprint: expect.stringMatching(/^context:/)
    })))
  })

  it('keeps rendering the legacy report when the compatible extension is absent', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(response({ report: 'legacy', sections, model: 'test-model' }))
    renderMatch()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))

    expect(await screen.findByText('Platform work')).toBeVisible()
    expect(screen.getByText('OpenAI-compatible · test-model')).toBeVisible()
    expect(screen.queryByText('Verified requirement coverage')).not.toBeInTheDocument()
  })

  it('runs JD extraction in Chrome without sending resume data to the cloud', async () => {
    const user = userEvent.setup()
    const destroy = vi.fn()
    const prompt = vi.fn().mockResolvedValue(JSON.stringify(sections))
    vi.stubGlobal('LanguageModel', {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({
        contextUsage: 0,
        contextWindow: 10_000,
        measureContextUsage: vi.fn().mockResolvedValue(500),
        prompt,
        destroy
      })
    })
    saveAiProviderPreference({ mode: 'chrome-built-in', allowCloudFallback: false })
    renderMatch()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Local platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))

    expect(await screen.findByText('Verified requirement coverage')).toBeVisible()
    expect(screen.getByText('Chrome Built-in AI (Beta) · browser-managed')).toBeVisible()
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining('Local platform role'), expect.objectContaining({
      responseConstraint: expect.objectContaining({ additionalProperties: false })
    }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('shows Chrome model download progress started by the Analyze action', async () => {
    const user = userEvent.setup()
    let resolvePrompt!: (value: string) => void
    const originalActivation = Object.getOwnPropertyDescriptor(navigator, 'userActivation')
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { isActive: true }
    })
    vi.stubGlobal('LanguageModel', {
      availability: vi.fn().mockResolvedValue('downloadable'),
      create: vi.fn().mockImplementation(async (options: {
        monitor?: (monitor: { addEventListener: (type: string, listener: (event: { loaded: number }) => void) => void }) => void
      }) => {
        options.monitor?.({
          addEventListener: (_type, listener) => listener({ loaded: 0.42 })
        })
        return {
          contextUsage: 0,
          contextWindow: 10_000,
          measureContextUsage: vi.fn().mockResolvedValue(500),
          prompt: vi.fn().mockReturnValue(new Promise<string>((resolve) => { resolvePrompt = resolve })),
          destroy: vi.fn()
        }
      })
    })
    saveAiProviderPreference({ mode: 'chrome-built-in', allowCloudFallback: false })
    renderMatch()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Local platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))

    expect(await screen.findByText('Chrome local model download: 42%')).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Chrome local model download progress' })).toHaveAttribute('value', '0.42')

    resolvePrompt(JSON.stringify(sections))
    expect(await screen.findByText('Verified requirement coverage')).toBeVisible()
    if (originalActivation) Object.defineProperty(navigator, 'userActivation', originalActivation)
    else Reflect.deleteProperty(navigator, 'userActivation')
  })

  it('does not silently use cloud when the selected Chrome model is unavailable', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('LanguageModel', {
      availability: vi.fn().mockResolvedValue('unavailable')
    })
    saveAiProviderPreference({ mode: 'chrome-built-in', allowCloudFallback: false })
    renderMatch()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Local-only role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Chrome local model is unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a partially present or non-deterministic requirement analysis extension', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(response({
      report: 'legacy',
      sections,
      model: 'test-model',
      ...analysis,
      score: { ...analysis.score, evidenceCompleteness: 100 }
    }))
    renderMatch()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('AI returned a report that could not be verified.')
    expect(screen.queryByText('Verified requirement coverage')).not.toBeInTheDocument()
  })

  it('rejects a structure score that was not derived from the active resume', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(response({
      report: 'legacy',
      sections,
      model: 'test-model',
      ...analysis,
      structureScore: { ...analysis.structureScore, score: 100 }
    }))
    renderMatch()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('AI returned a report that could not be verified.')
  })

  it('rejects an invalid structured response instead of parsing the legacy report string', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(response({ report: '## Match Score\n99', sections: { matchScore: '99' } }))
    renderMatch()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('AI returned a report that could not be verified.')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.queryByText('99')).not.toBeInTheDocument()
  })

  it('announces loading and completion in status, but announces errors only through one visible alert', async () => {
    const user = userEvent.setup()
    let resolve!: (value: Response) => void
    fetchMock.mockReturnValueOnce(new Promise((next) => { resolve = next }))
    renderMatch()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))
    expect(screen.getByRole('status')).toHaveTextContent('Extracting requirements')

    resolve(response({ report: 'legacy', sections, model: 'test-model' }))
    expect(await screen.findByText('Platform work')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Job requirements are ready for review.')

    fetchMock.mockResolvedValueOnce(response({ code: 'AI_UNAVAILABLE' }, 502))
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI service is temporarily unavailable.')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('marks a completed report stale as soon as the JD text changes', async () => {
    const user = userEvent.setup()
    renderMatch()
    await screen.findByText('Ada Resume')
    const input = screen.getByRole('textbox', { name: 'Job description' })
    await user.type(input, 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))
    expect(await screen.findByText('Verified requirement coverage')).toBeVisible()

    await user.type(input, ' updated')
    expect(screen.queryByText('Verified requirement coverage')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The job description or active resume changed.')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('marks a report stale when active resume data changes', async () => {
    const user = userEvent.setup()
    renderMatch()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))
    expect(await screen.findByText('Verified requirement coverage')).toBeVisible()

    await user.click(screen.getByText('Update active resume'))
    await waitFor(() => expect(screen.queryByText('Verified requirement coverage')).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('The job description or active resume changed.')
  })

  it('aborts a pending request when its JD context changes', async () => {
    const user = userEvent.setup()
    let signal: AbortSignal | undefined
    fetchMock.mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
      signal = init?.signal ?? undefined
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    renderMatch()
    await screen.findByText('Ada Resume')
    const input = screen.getByRole('textbox', { name: 'Job description' })
    await user.type(input, 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))
    await user.type(input, ' changed')

    await waitFor(() => expect(signal?.aborted).toBe(true))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Extract requirements' })).toBeEnabled())
  })

  it('lets the user cancel an in-flight requirement extraction', async () => {
    const user = userEvent.setup()
    let signal: AbortSignal | undefined
    fetchMock.mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
      signal = init?.signal ?? undefined
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    renderMatch()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Job description' }), 'Platform role')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))
    await user.click(screen.getByRole('button', { name: 'Cancel extraction' }))

    await waitFor(() => expect(signal?.aborted).toBe(true))
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Extract requirements' })
    ).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('preserves the job description on failure and supports localized retry timing', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(response({ error: 'raw provider detail', code: 'RATE_LIMITED' }, 429, { 'Retry-After': '1' }))
    renderMatch()
    await screen.findByText('Ada Resume')
    const input = screen.getByRole('textbox', { name: 'Job description' })
    await user.type(input, 'Keep this role description')
    await user.click(screen.getByRole('button', { name: 'Extract requirements' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Try again in 1 second.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('raw provider detail')
    expect(input).toHaveValue('Keep this role description')
    expect(screen.getByRole('button', { name: 'Extract requirements' })).toBeDisabled()
  })

  it('directs users without an active draft to Studio', () => {
    renderMatch(false)
    expect(screen.getByRole('heading', { name: 'Create a resume draft first' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open Resume Studio' })).toHaveAttribute('href', '/en/studio')
  })
})
