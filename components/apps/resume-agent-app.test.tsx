import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { ResumeDraftProviderCore, useResumeDraft } from '@/components/resume-draft-provider'
import { createResumeDraft, normalizeResumeData, type ResumeData } from '@/lib/resume-model'
import { clearAiProviderPreference, saveAiProviderPreference } from '@/lib/agent/provider-preference'
import { writeDraftState } from '@/lib/resume-store'
import type { AgentWorkspace } from '@/lib/agent/agent-workspace'
import type { AgentWorkspaceService } from './agent-workflow-panel'
import { scoreRequirementMatrix } from '@/lib/agent/requirement-matrix'
import { transitionOptimizationRun } from '@/lib/agent/optimization-run'
import { fingerprintOptimizationInputs } from '@/lib/agent/workflow-persistence'
import {
  ResumeAgentApp,
  type ResumeAgentRunPersistence
} from './resume-agent-app'

const fetchMock = vi.fn<typeof fetch>()
const now = '2026-07-16T08:00:00.000Z'

const requirements = [{
    id: 'requirement-1', jobId: 'job-1', text: 'Build reliable AI systems',
    category: 'experience' as const, priority: 'must' as const, weight: 5,
    keywords: ['AI'], userConfirmed: true
  }, {
    id: 'requirement-2', jobId: 'job-1', text: 'Own platform delivery',
    category: 'responsibility' as const, priority: 'preferred' as const, weight: 3,
    keywords: ['platform'], userConfirmed: true
  }]
const careerFacts = [{
    id: 'fact-1', kind: 'experience' as const, text: 'Built verified AI systems',
    evidenceRefs: ['source-1'], verification: 'document-backed' as const, tags: ['AI'],
    createdAt: '2026-07-16T08:00:00.000Z', updatedAt: '2026-07-16T08:00:00.000Z'
  }, {
    id: 'fact-2', kind: 'experience' as const, text: 'Owned platform delivery',
    evidenceRefs: ['source-2'], verification: 'user-confirmed' as const, tags: ['platform'],
    createdAt: '2026-07-16T08:00:00.000Z', updatedAt: '2026-07-16T08:00:00.000Z'
  }]
const matrix = {
  version: 1 as const,
  targetJobId: 'job-1',
  inputFingerprint: 'fingerprint-1',
  requirements,
  matches: [{
    requirementId: 'requirement-1', factIds: ['fact-1'], status: 'direct' as const,
    rationale: 'Verified fact directly supports the requirement.'
  }, {
    requirementId: 'requirement-2', factIds: ['fact-2'], status: 'partial' as const,
    rationale: 'Confirmed fact partially supports the requirement.'
  }]
}
const plan = {
  id: 'plan-1',
  summary: 'Use the two confirmed facts for this target role.',
  approvedAt: '2026-07-16T08:01:00.000Z',
  items: [{
    id: 'plan-item-1', requirementIds: ['requirement-1'], factIds: ['fact-1'],
    intent: 'Emphasize reliable AI systems.', transformation: 'emphasize' as const
  }, {
    id: 'plan-item-2', requirementIds: ['requirement-2'], factIds: ['fact-2'],
    intent: 'Rewrite platform delivery clearly.', transformation: 'rewrite' as const
  }]
}

const generatingWorkspace: AgentWorkspace = {
  summary: {
    preference: { targetJobId: 'job-1', optimizationRunId: 'run-1' },
    targetJob: {
      id: 'job-1', title: 'AI Engineer', description: 'Build reliable AI platforms',
      locale: 'en', createdAt: now, updatedAt: now
    },
    run: {
      version: 1,
      id: 'run-1', sourceDraftId: 'ada', targetJobId: 'job-1',
      stage: 'generating-changes', inputFingerprint: 'fingerprint-1',
      requirementMatches: matrix.matches, questions: [], plan,
      scoreBefore: scoreRequirementMatrix(matrix), createdAt: now, updatedAt: plan.approvedAt
    }
  },
  matrix,
  facts: careerFacts
}

const workflowService = {
  load: vi.fn<AgentWorkspaceService['load']>(),
  linkFact: vi.fn<AgentWorkspaceService['linkFact']>(),
  addFact: vi.fn<AgentWorkspaceService['addFact']>(),
  confirmGap: vi.fn<AgentWorkspaceService['confirmGap']>(),
  preparePlan: vi.fn<AgentWorkspaceService['preparePlan']>(),
  approvePlan: vi.fn<AgentWorkspaceService['approvePlan']>()
} satisfies AgentWorkspaceService

const runPersistence = {
  saveChangeSet: vi.fn<ResumeAgentRunPersistence['saveChangeSet']>(),
  saveAppliedVariant: vi.fn<ResumeAgentRunPersistence['saveAppliedVariant']>(),
  discardChangeSet: vi.fn<ResumeAgentRunPersistence['discardChangeSet']>(),
  observeInput: vi.fn<ResumeAgentRunPersistence['observeInput']>()
} satisfies ResumeAgentRunPersistence

function testResume(): ResumeData {
  return normalizeResumeData({
    profile: { name: 'Ada Candidate', title: 'Engineer', summary: ['Builds systems'], tags: [], links: [] },
    targetRole: 'AI Engineer',
    skills: [{ group: 'Core', items: ['TypeScript'] }],
    experiences: [{ company: 'Example Co', role: 'Engineer', period: '2024', tags: [], bullets: ['Owned delivery'] }],
    projects: [], education: [], certifications: [], awards: [], languages: ['English'], openSource: [],
    metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-13T00:00:00.000Z' }
  })
}

const responseChangeSet = {
  summary: 'Two focused improvements',
  changes: [
    {
      id: 'c1', path: 'profile.summary.0', original: 'Builds systems',
      proposed: 'Built verified AI systems', reason: 'Aligns verified evidence', needsConfirmation: false,
      evidence: {
        requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
        support: 'verified', confidence: 0.94, transformation: 'emphasize'
      }
    },
    {
      id: 'c2', path: 'experiences.0.bullets.0', original: 'Owned delivery',
      proposed: 'Owned platform delivery', reason: 'Clarifies confirmed scope', needsConfirmation: true,
      evidence: {
        requirementIds: ['requirement-2'], factIds: ['fact-2'], matchType: 'partial',
        support: 'user-confirmed', confidence: 0.82, transformation: 'rewrite'
      }
    }
  ],
  questions: ['How many teams were involved?']
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body } as Response
}

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function seededStorage(data = testResume()) {
  const storage = new MemoryStorage()
  const draft = createResumeDraft(data, { id: 'ada', name: 'Ada Resume', source: 'paste' })
  writeDraftState(storage, { activeDraftId: draft.id, drafts: [draft] })
  return storage
}

function Probe() {
  const drafts = useResumeDraft()
  return (
    <div hidden>
      <span data-testid="title-value">{drafts.activeDraft?.data.profile.title}</span>
      <span data-testid="bullet-value">{drafts.activeDraft?.data.experiences[0]?.bullets[0]}</span>
      <span data-testid="snapshot-count">{drafts.activeDraft?.snapshots.length ?? 0}</span>
      <button onClick={() => drafts.updateActiveResume({ ...drafts.activeResume, profile: { ...drafts.activeResume.profile, title: 'Externally updated' } })}>External update</button>
    </div>
  )
}

function renderAgent(seed = true, options: {
  workflowService?: AgentWorkspaceService
  runPersistence?: ResumeAgentRunPersistence
  resume?: ResumeData
} = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ResumeDraftProviderCore locale="en" storage={seed ? seededStorage(options.resume) : null}>
        <Probe />
        <ResumeAgentApp
          workflowService={options.workflowService ?? workflowService}
          runPersistence={options.runPersistence ?? runPersistence}
        />
      </ResumeDraftProviderCore>
    </NextIntlClientProvider>
  )
}

async function requestSuggestions(
  user: ReturnType<typeof userEvent.setup>,
  expectedSummary = 'Two focused improvements'
) {
  await screen.findByText('Ada Resume')
  await user.type(screen.getByRole('textbox', { name: 'Optimization instruction' }), 'Improve my impact')
  const analyze = screen.getByRole('button', { name: 'Analyze resume' })
  await waitFor(() => expect(analyze).toBeEnabled())
  await user.click(analyze)
  await screen.findByText(expectedSummary)
}

beforeEach(() => {
  window.localStorage.clear()
  clearAiProviderPreference()
  saveAiProviderPreference({ mode: 'openai-compatible', allowCloudFallback: false })
  workflowService.load.mockReset().mockResolvedValue(generatingWorkspace)
  workflowService.linkFact.mockReset()
  workflowService.addFact.mockReset()
  workflowService.confirmGap.mockReset()
  workflowService.preparePlan.mockReset()
  workflowService.approvePlan.mockReset()
  runPersistence.saveChangeSet.mockReset().mockImplementation(async (input) => ({
    ...input.workspace,
    summary: {
      ...input.workspace.summary,
      run: transitionOptimizationRun(input.workspace.summary.run, {
        type: 'propose-changes', changeSet: input.changeSet,
        currentFingerprint: input.currentFingerprint
      }, input.now)
    }
  }))
  runPersistence.saveAppliedVariant.mockReset().mockImplementation(async (input) => {
    const validated = transitionOptimizationRun(input.workspace.summary.run, {
      type: 'approve-changes', acceptedChangeIds: input.acceptedChangeIds
    }, input.now)
    const applied = transitionOptimizationRun(validated, {
      type: 'apply', currentFingerprint: input.currentFingerprint,
      appliedVariantId: input.variant.id, scoreAfter: input.scoreAfter
    }, input.now)
    return {
      ...input.workspace,
      summary: { ...input.workspace.summary, run: applied }
    }
  })
  runPersistence.discardChangeSet.mockReset().mockImplementation(async (input) => ({
    ...input.workspace,
    summary: {
      ...input.workspace.summary,
      run: transitionOptimizationRun(input.workspace.summary.run, {
        type: 'discard-changes'
      }, input.now)
    }
  }))
  runPersistence.observeInput.mockReset().mockImplementation(async (input) => ({
    ...input.workspace,
    summary: {
      ...input.workspace.summary,
      run: transitionOptimizationRun(input.workspace.summary.run, {
        type: 'observe-input', currentFingerprint: input.currentFingerprint
      }, input.now)
    }
  }))
  fetchMock.mockReset().mockResolvedValue(jsonResponse({ changeSet: responseChangeSet, model: 'test-model' }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ResumeAgentApp', () => {
  it('directs users without an active draft to Studio and does not modify sample data', () => {
    renderAgent(false)
    expect(screen.getByRole('heading', { name: 'Create a resume draft first' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open Resume Studio' })).toHaveAttribute('href', '/en/studio')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps generation locked until the active plan is explicitly approved', async () => {
    const user = userEvent.setup()
    const { approvedAt: _approvedAt, ...unapprovedPlan } = plan
    const awaitingApproval = {
      ...generatingWorkspace,
      summary: {
        ...generatingWorkspace.summary,
        run: {
          ...generatingWorkspace.summary.run,
          stage: 'awaiting-plan-approval' as const,
          plan: unapprovedPlan
        }
      }
    }
    workflowService.load.mockResolvedValueOnce(awaitingApproval)
    workflowService.approvePlan.mockResolvedValueOnce(generatingWorkspace)
    renderAgent()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Optimization instruction' }), 'Improve my impact')
    const analyze = screen.getByRole('button', { name: 'Analyze resume' })
    expect(analyze).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('button', { name: 'Approve plan' }))
    await waitFor(() => expect(workflowService.approvePlan).toHaveBeenCalledOnce())
    await waitFor(() => expect(analyze).toBeEnabled())
    await user.click(analyze)

    expect(await screen.findByText('Two focused improvements')).toBeVisible()
    expect(runPersistence.saveChangeSet).toHaveBeenCalledOnce()
  })

  it('sends active resume context and renders conversation, actions, questions, and before/after preview', async () => {
    const user = userEvent.setup()
    renderAgent()
    await requestSuggestions(user)

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      resume: expect.objectContaining({ profile: expect.objectContaining({ name: 'Ada Candidate' }) }),
      locale: 'en', instruction: 'Improve my impact', jd: 'Build reliable AI platforms',
      requirements: requirements.map(({ id, text }) => ({ id, text })),
      requirementMatches: matrix.matches,
      careerFacts: careerFacts.map(({ id, text, verification }) => ({
        id, text, verification
      })),
      optimizationPlan: plan
    })
    expect(runPersistence.saveChangeSet).toHaveBeenCalledWith(expect.objectContaining({
      workspace: generatingWorkspace,
      changeSet: expect.objectContaining({ summary: 'Two focused improvements' })
    }))
    expect(screen.getByText('How many teams were involved?')).toBeVisible()
    const preview = screen.getByRole('region', { name: 'Before and after preview' })
    expect(within(preview).getByText('Builds systems')).toBeVisible()
    expect(within(preview).getByText('Built verified AI systems')).toBeVisible()
    expect(screen.getAllByText('Accuracy verification required')).toHaveLength(2)
    expect(screen.getByText('Review and verify every AI-proposed change for accuracy before accepting it.')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'I verified this change is accurate: Built verified AI systems' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'I verified this change is accurate: Owned platform delivery' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Accept Built verified AI systems' })).toBeDisabled()
    expect(screen.getAllByText('fact-1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Verified').length).toBeGreaterThan(0)
    expect(screen.getByText('Generated with OpenAI-compatible · test-model')).toBeVisible()
    expect(screen.getByTestId('snapshot-count')).toHaveTextContent('0')
  })

  it('sends the cloud provider only requirements and facts referenced by the approved plan', async () => {
    const user = userEvent.setup()
    const unrelatedRequirement = {
      id: 'requirement-private', jobId: 'job-1', text: 'Unrelated private requirement',
      category: 'domain' as const, priority: 'signal' as const, weight: 1,
      keywords: ['private'], userConfirmed: true
    }
    const unrelatedFact = {
      id: 'fact-private', kind: 'experience' as const, text: 'Unrelated private career detail',
      evidenceRefs: ['source-private'], verification: 'user-confirmed' as const, tags: [],
      createdAt: now, updatedAt: now
    }
    const unrelatedMatch = {
      requirementId: unrelatedRequirement.id, factIds: [unrelatedFact.id], status: 'direct' as const,
      rationale: 'Not selected by the approved plan.'
    }
    const scopedWorkspace: AgentWorkspace = {
      ...generatingWorkspace,
      summary: {
        ...generatingWorkspace.summary,
        run: {
          ...generatingWorkspace.summary.run,
          requirementMatches: [...matrix.matches, unrelatedMatch]
        }
      },
      matrix: {
        ...matrix,
        requirements: [...requirements, unrelatedRequirement],
        matches: [...matrix.matches, unrelatedMatch]
      },
      facts: [...careerFacts, unrelatedFact]
    }
    workflowService.load.mockResolvedValueOnce(scopedWorkspace)
    renderAgent()
    await requestSuggestions(user)

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.requirements).toEqual(requirements.map(({ id, text }) => ({ id, text })))
    expect(body.requirementMatches).toEqual(matrix.matches)
    expect(body.careerFacts).toEqual(careerFacts.map(({ id, text, verification }) => ({
      id, text, verification
    })))
    expect(JSON.stringify(body)).not.toContain('Unrelated private')
  })

  it('accepts a subset into one variant, completes the run, and leaves the master unchanged', async () => {
    const user = userEvent.setup()
    renderAgent()
    await requestSuggestions(user)
    await user.click(screen.getByRole('checkbox', { name: 'I verified this change is accurate: Built verified AI systems' }))
    await user.click(screen.getByRole('button', { name: 'Accept Built verified AI systems' }))

    await waitFor(() => expect(runPersistence.saveAppliedVariant).toHaveBeenCalledOnce())
    expect(runPersistence.saveAppliedVariant).toHaveBeenCalledWith(expect.objectContaining({
      acceptedChangeIds: ['c1'],
      variant: expect.objectContaining({
        sourceDraftId: 'ada', targetJobId: 'job-1',
        data: expect.objectContaining({
          profile: expect.objectContaining({ summary: ['Built verified AI systems'] }),
          experiences: [expect.objectContaining({ bullets: ['Owned delivery'] })]
        })
      })
    }))
    expect(screen.getByTestId('title-value')).toHaveTextContent('Engineer')
    expect(screen.getByTestId('bullet-value')).toHaveTextContent('Owned delivery')
    expect(screen.getByTestId('snapshot-count')).toHaveTextContent('0')
    expect(screen.getByRole('status')).toHaveTextContent('Job-specific variant prepared')
    expect(screen.queryByText('Two focused improvements')).not.toBeInTheDocument()
    expect(screen.getByText('The target-job variant is ready.')).toBeVisible()
  })

  it('requires explicit confirmation before accepting flagged changes or accepting all', async () => {
    const user = userEvent.setup()
    renderAgent()
    await requestSuggestions(user)

    const flaggedAccept = screen.getByRole('button', { name: 'Accept Owned platform delivery' })
    const acceptAll = screen.getByRole('button', { name: 'Accept all suggestions' })
    expect(flaggedAccept).toBeDisabled()
    expect(acceptAll).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: 'I verified this change is accurate: Built verified AI systems' }))
    expect(acceptAll).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'I verified this change is accurate: Owned platform delivery' }))
    expect(flaggedAccept).toBeEnabled()
    expect(acceptAll).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Accept all suggestions' }))

    await waitFor(() => expect(runPersistence.saveAppliedVariant).toHaveBeenCalledOnce())
    expect(runPersistence.saveAppliedVariant).toHaveBeenCalledWith(expect.objectContaining({
      acceptedChangeIds: ['c1', 'c2'],
      variant: expect.objectContaining({
        data: expect.objectContaining({
          profile: expect.objectContaining({ summary: ['Built verified AI systems'] }),
          experiences: [expect.objectContaining({ bullets: ['Owned platform delivery'] })]
        })
      })
    }))
    expect(screen.getByTestId('title-value')).toHaveTextContent('Engineer')
    expect(screen.getByTestId('bullet-value')).toHaveTextContent('Owned delivery')
    expect(screen.getByTestId('snapshot-count')).toHaveTextContent('0')
    expect(screen.getByRole('status')).toHaveTextContent('Your master resume was not changed')
  })

  it('renders unsupported evidence as an explicit non-applicable review item', async () => {
    const user = userEvent.setup()
    const gapMatch = {
      ...matrix.matches[1], factIds: [], status: 'gap' as const,
      rationale: 'No supporting fact has been confirmed.'
    }
    const gapPlan = {
      ...plan,
      items: plan.items.map((item) => item.id === 'plan-item-2'
        ? { ...item, factIds: [] }
        : item)
    }
    workflowService.load.mockResolvedValueOnce({
      ...generatingWorkspace,
      summary: {
        ...generatingWorkspace.summary,
        run: {
          ...generatingWorkspace.summary.run,
          requirementMatches: [matrix.matches[0], gapMatch],
          plan: gapPlan
        }
      },
      matrix: { ...matrix, matches: [matrix.matches[0], gapMatch] }
    })
    fetchMock.mockResolvedValueOnce(jsonResponse({
      changeSet: {
        summary: 'Evidence is missing',
        changes: [{
          id: 'blocked', path: 'experiences.0.bullets.0', original: 'Owned delivery',
          proposed: 'Led 20 engineers', reason: 'This claim needs verification', needsConfirmation: true,
          evidence: {
            requirementIds: ['requirement-2'], factIds: [], matchType: 'gap',
            support: 'unsupported', confidence: 0, transformation: 'rewrite'
          }
        }],
        questions: ['What team size can you verify?']
      },
      model: 'test-model'
    }))
    renderAgent()
    await requestSuggestions(user, 'Evidence is missing')

    expect(screen.getAllByText('Blocked: no verified supporting evidence').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Unsupported').length).toBeGreaterThan(0)
    expect(screen.getByText('What team size can you verify?')).toBeVisible()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept Led 20 engineers' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Accept all suggestions' })).toBeDisabled()
  })

  it('uses Chrome Built-in AI without calling the cloud optimize route', async () => {
    const user = userEvent.setup()
    const destroy = vi.fn()
    const prompt = vi.fn().mockResolvedValue(JSON.stringify({
      summary: 'One bounded local rewrite',
      changes: [{
        id: 'local-rewrite', path: 'experiences.0.bullets.0', original: 'Owned delivery',
        proposed: 'Owned platform delivery', reason: 'Uses the confirmed platform fact',
        needsConfirmation: true,
        evidence: {
          requirementIds: ['requirement-2'], factIds: ['fact-2'], matchType: 'partial',
          support: 'user-confirmed', confidence: 0.82, transformation: 'rewrite'
        }
      }],
      questions: []
    }))
    const create = vi.fn().mockResolvedValue({
      contextUsage: 0,
      contextWindow: 10_000,
      measureContextUsage: vi.fn().mockResolvedValue(600),
      prompt,
      destroy
    })
    vi.stubGlobal('LanguageModel', {
      availability: vi.fn().mockResolvedValue('available'),
      create
    })
    saveAiProviderPreference({ mode: 'chrome-built-in', allowCloudFallback: false })
    const privateResume = normalizeResumeData({
      ...testResume(),
      profile: {
        ...testResume().profile,
        email: 'ada.private@example.com',
        phone: '+86 138 0000 0000'
      },
      skills: [{ group: 'Private unrelated skill', items: ['SecretUnrelatedSkill'] }]
    })
    renderAgent(true, { resume: privateResume })
    await requestSuggestions(user, 'One bounded local rewrite')

    expect(await screen.findByText('One bounded local rewrite')).toBeVisible()
    expect(screen.getByText('Generated with Chrome Built-in AI (Beta) · browser-managed')).toBeVisible()
    const localUserPrompt = String(prompt.mock.calls[0][0])
    expect(JSON.parse(localUserPrompt)).toEqual({
      locale: 'en',
      instruction: 'Improve my impact',
      target: { path: 'experiences.0.bullets.0', original: 'Owned delivery' },
      requirements: [{ id: 'requirement-2', text: 'Own platform delivery' }],
      requirementMatches: [matrix.matches[1]],
      careerFacts: [{
        id: 'fact-2', text: 'Owned platform delivery', verification: 'user-confirmed'
      }],
      approvedPlan: {
        id: 'plan-1', approvedAt: plan.approvedAt, item: plan.items[1]
      }
    })
    expect(localUserPrompt).not.toContain('ada.private@example.com')
    expect(localUserPrompt).not.toContain('+86 138 0000 0000')
    expect(localUserPrompt).not.toContain('SecretUnrelatedSkill')
    expect(localUserPrompt).not.toContain('Example Co')
    expect(localUserPrompt).not.toContain('Build reliable AI platforms')
    expect(create.mock.calls[0][0].initialPrompts[0].content).not.toContain('ada.private@example.com')
    expect(prompt).toHaveBeenCalledWith(localUserPrompt, expect.objectContaining({
      responseConstraint: expect.objectContaining({
        additionalProperties: false,
        properties: expect.objectContaining({
          changes: expect.objectContaining({
            maxItems: 1,
            items: expect.objectContaining({
              properties: expect.objectContaining({
                path: expect.objectContaining({ enum: ['experiences.0.bullets.0'] }),
                original: expect.objectContaining({ enum: ['Owned delivery'] }),
                evidence: expect.objectContaining({
                  properties: expect.objectContaining({
                    transformation: expect.objectContaining({ enum: ['rewrite'] })
                  })
                })
              })
            })
          })
        })
      })
    }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('rejects a Chrome response that escapes the selected leaf or returns multiple changes', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('LanguageModel', {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({
        contextUsage: 0,
        contextWindow: 10_000,
        measureContextUsage: vi.fn().mockResolvedValue(600),
        prompt: vi.fn().mockResolvedValue(JSON.stringify(responseChangeSet)),
        destroy: vi.fn()
      })
    })
    saveAiProviderPreference({ mode: 'chrome-built-in', allowCloudFallback: false })
    renderAgent()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Optimization instruction' }), 'Improve')
    await user.click(screen.getByRole('button', { name: 'Analyze resume' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'AI returned suggestions that could not be verified.'
    )
    expect(runPersistence.saveChangeSet).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not expose generated suggestions when the resumable run write fails', async () => {
    const user = userEvent.setup()
    runPersistence.saveChangeSet.mockRejectedValueOnce(new Error('IndexedDB failed'))
    renderAgent()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Optimization instruction' }), 'Improve')
    const analyze = screen.getByRole('button', { name: 'Analyze resume' })
    await waitFor(() => expect(analyze).toBeEnabled())
    await user.click(analyze)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The generated changes could not be saved to the resumable Agent run.'
    )
    expect(screen.queryByText('Two focused improvements')).not.toBeInTheDocument()
    expect(runPersistence.saveAppliedVariant).not.toHaveBeenCalled()
  })

  it('does not silently fetch when the selected Chrome model is unavailable', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('LanguageModel', { availability: vi.fn().mockResolvedValue('unavailable') })
    saveAiProviderPreference({ mode: 'chrome-built-in', allowCloudFallback: false })
    renderAgent()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Optimization instruction' }), 'Improve')
    const analyze = screen.getByRole('button', { name: 'Analyze resume' })
    await waitFor(() => expect(analyze).toBeEnabled())
    await user.click(analyze)

    expect(await screen.findByRole('alert')).toHaveTextContent('Chrome Built-in AI is unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('restores a persisted awaiting-approval change set without another model request', async () => {
    const awaiting = {
      ...generatingWorkspace,
      summary: {
        ...generatingWorkspace.summary,
        run: transitionOptimizationRun(generatingWorkspace.summary.run, {
          type: 'propose-changes', changeSet: responseChangeSet,
          currentFingerprint: fingerprintOptimizationInputs({
            sourceDraftId: 'ada', resume: testResume(),
            targetJob: generatingWorkspace.summary.targetJob,
            requirements: matrix.requirements,
            requirementMatches: matrix.matches,
            careerFacts
          })
        }, '2026-07-16T08:02:00.000Z')
      }
    }
    workflowService.load.mockResolvedValueOnce(awaiting)
    renderAgent()

    expect(await screen.findByText('Two focused improvements')).toBeVisible()
    expect(screen.getByText('Review each proposed change.')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks a reloaded run stale when an unrelated resume field changed and blocks apply', async () => {
    const baseline = testResume()
    const awaiting = {
      ...generatingWorkspace,
      summary: {
        ...generatingWorkspace.summary,
        run: transitionOptimizationRun(generatingWorkspace.summary.run, {
          type: 'propose-changes', changeSet: responseChangeSet,
          currentFingerprint: fingerprintOptimizationInputs({
            sourceDraftId: 'ada', resume: baseline,
            targetJob: generatingWorkspace.summary.targetJob,
            requirements: matrix.requirements,
            requirementMatches: matrix.matches,
            careerFacts
          })
        }, '2026-07-16T08:02:00.000Z')
      }
    }
    workflowService.load.mockResolvedValueOnce(awaiting)
    const changed = normalizeResumeData({
      ...baseline,
      languages: [...baseline.languages, 'French']
    })
    renderAgent(true, { resume: changed })

    await waitFor(() => expect(runPersistence.observeInput).toHaveBeenCalledOnce())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The resume changed while the Agent was working.'
    )
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(runPersistence.saveAppliedVariant).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks the run stale when the source resume changes before any change set exists', async () => {
    const user = userEvent.setup()
    renderAgent()
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Analyze resume' })
    ).toBeEnabled())

    await user.click(screen.getByRole('button', { name: 'External update', hidden: true }))

    await waitFor(() => expect(runPersistence.observeInput).toHaveBeenCalledOnce())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The resume changed while the Agent was working.'
    )
    expect(screen.getByRole('button', { name: 'Analyze resume' })).toBeDisabled()
    expect(runPersistence.saveChangeSet).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps suggestions intact when the local variant write fails', async () => {
    const user = userEvent.setup()
    runPersistence.saveAppliedVariant.mockRejectedValueOnce(new Error('IndexedDB failed'))
    renderAgent()
    await requestSuggestions(user)
    await user.click(screen.getByRole('checkbox', { name: 'I verified this change is accurate: Built verified AI systems' }))
    await user.click(screen.getByRole('button', { name: 'Accept Built verified AI systems' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The job-specific variant could not be saved locally. No suggestion was consumed.'
    )
    expect(screen.getByText('Two focused improvements')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Accept Built verified AI systems' })).toBeEnabled()
    expect(screen.getByTestId('snapshot-count')).toHaveTextContent('0')
  })

  it('discards suggestions without changing the draft', async () => {
    const user = userEvent.setup()
    renderAgent()
    await requestSuggestions(user)
    await user.click(screen.getByRole('checkbox', { name: 'I verified this change is accurate: Owned platform delivery' }))
    await user.click(screen.getByRole('button', { name: 'Discard suggestions' }))

    await waitFor(() => expect(runPersistence.discardChangeSet).toHaveBeenCalledOnce())
    expect(screen.queryByText('Two focused improvements')).not.toBeInTheDocument()
    expect(screen.getByTestId('title-value')).toHaveTextContent('Engineer')
    expect(screen.getByTestId('snapshot-count')).toHaveTextContent('0')
    expect(screen.getByRole('button', { name: 'Analyze resume' })).toBeEnabled()
  })

  it('preserves the active draft when a request fails', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'provider detail', code: 'AI_UNAVAILABLE' }, 502))
    renderAgent()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Optimization instruction' }), 'Improve')
    const analyze = screen.getByRole('button', { name: 'Analyze resume' })
    await waitFor(() => expect(analyze).toBeEnabled())
    await user.click(analyze)

    expect(await screen.findByRole('alert')).toHaveTextContent('AI service is temporarily unavailable.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('provider detail')
    expect(screen.getByTestId('title-value')).toHaveTextContent('Engineer')
    expect(screen.getByTestId('snapshot-count')).toHaveTextContent('0')
  })

  it('ignores a stale response after the active resume changes', async () => {
    const user = userEvent.setup()
    let resolve!: (response: Response) => void
    fetchMock.mockReturnValueOnce(new Promise((next) => { resolve = next }))
    renderAgent()
    await screen.findByText('Ada Resume')
    await user.type(screen.getByRole('textbox', { name: 'Optimization instruction' }), 'Improve')
    const analyze = screen.getByRole('button', { name: 'Analyze resume' })
    await waitFor(() => expect(analyze).toBeEnabled())
    await user.click(analyze)
    await user.click(screen.getByRole('button', { name: 'External update', hidden: true }))
    resolve(jsonResponse({ changeSet: responseChangeSet, model: 'test-model' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The resume changed while the Agent was working.')
    expect(screen.queryByText('Two focused improvements')).not.toBeInTheDocument()
    expect(screen.getByTestId('title-value')).toHaveTextContent('Externally updated')
  })

  it('invalidates visible suggestions when the resume changes after analysis', async () => {
    const user = userEvent.setup()
    renderAgent()
    await requestSuggestions(user)
    await user.click(screen.getByRole('button', { name: 'External update', hidden: true }))

    await waitFor(() => expect(screen.queryByText('Two focused improvements')).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('The resume changed while the Agent was working.')
    expect(screen.getByTestId('title-value')).toHaveTextContent('Externally updated')
  })
})
