import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import type { AgentWorkspace } from '@/lib/agent/agent-workspace'
import { ProviderRoutingError } from '@/lib/agent/providers'
import {
  AgentWorkflowPanel,
  selectPlanRelevantCareerFacts,
  type AgentWorkspaceService
} from './agent-workflow-panel'
import { ACTIVE_WORKFLOW_CHANGED_EVENT } from '@/lib/agent/workflow-persistence'

const workspace = {
  summary: {
    preference: { targetJobId: 'job-1', optimizationRunId: 'run-1' },
    targetJob: { id: 'job-1', title: 'Staff Platform Engineer' },
    run: {
      id: 'run-1',
      sourceDraftId: 'draft-1',
      targetJobId: 'job-1',
      stage: 'awaiting-answers',
      questions: [{
        id: 'question-1',
        requirementId: 'requirement-1',
        prompt: 'Do you have migration evidence?',
        status: 'open',
        factIds: []
      }]
    }
  },
  facts: [{
    id: 'fact-1',
    text: 'Led a related migration.',
    verification: 'imported'
  }],
  matrix: {}
} as unknown as AgentWorkspace

function renderPanel(service: AgentWorkspaceService, activeDraftId = 'draft-1') {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AgentWorkflowPanel activeDraftId={activeDraftId} service={service} />
    </NextIntlClientProvider>
  )
}

afterEach(() => cleanup())

describe('AgentWorkflowPanel', () => {
  it('sends planning only facts already referenced by the requirement matrix', () => {
    const facts = [
      {
        id: 'fact-relevant', kind: 'experience', text: 'Relevant',
        evidenceRefs: ['source-1'], verification: 'user-confirmed', tags: [],
        createdAt: '2026-07-16T08:00:00.000Z', updatedAt: '2026-07-16T08:00:00.000Z'
      },
      {
        id: 'fact-private', kind: 'experience', text: 'Unrelated private detail',
        evidenceRefs: ['source-2'], verification: 'user-confirmed', tags: [],
        createdAt: '2026-07-16T08:00:00.000Z', updatedAt: '2026-07-16T08:00:00.000Z'
      }
    ] as AgentWorkspace['facts']

    expect(selectPlanRelevantCareerFacts(facts, [{
      requirementId: 'requirement-1',
      status: 'direct',
      factIds: ['fact-relevant'],
      rationale: 'Direct evidence'
    }])).toEqual([facts[0]])
  })

  it('refreshes an already-open panel when another workflow window changes the active run', async () => {
    const refreshed = {
      ...workspace,
      summary: {
        ...workspace.summary,
        targetJob: { ...workspace.summary.targetJob, title: 'Principal AI Engineer' }
      }
    } as AgentWorkspace
    const load = vi.fn()
      .mockResolvedValueOnce(workspace)
      .mockResolvedValueOnce(refreshed)
    const service: AgentWorkspaceService = {
      load,
      linkFact: vi.fn(),
      addFact: vi.fn(),
      confirmGap: vi.fn(),
      preparePlan: vi.fn(),
      approvePlan: vi.fn()
    }
    renderPanel(service)
    expect(await screen.findByRole('heading', { name: 'Staff Platform Engineer' })).toBeVisible()

    window.dispatchEvent(new Event(ACTIVE_WORKFLOW_CHANGED_EVENT))

    expect(await screen.findByRole('heading', { name: 'Principal AI Engineer' })).toBeVisible()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('links and confirms an existing imported fact for an open question', async () => {
    const user = userEvent.setup()
    const linkFact = vi.fn().mockResolvedValue({
      ...workspace,
      summary: { ...workspace.summary, run: { ...workspace.summary.run, stage: 'evidence-mapped', questions: [] } }
    })
    const service: AgentWorkspaceService = {
      load: vi.fn().mockResolvedValue(workspace),
      linkFact,
      addFact: vi.fn(),
      confirmGap: vi.fn(),
      preparePlan: vi.fn(),
      approvePlan: vi.fn()
    }
    renderPanel(service)

    const question = await screen.findByRole('heading', { name: 'Do you have migration evidence?' })
    const card = question.closest('article') as HTMLElement
    await user.selectOptions(within(card).getByRole('combobox', { name: 'Match strength' }), 'partial')
    await user.click(within(card).getByRole('button', { name: 'Link & confirm fact' }))

    await waitFor(() => expect(linkFact).toHaveBeenCalledWith(expect.objectContaining({
      questionId: 'question-1',
      factId: 'fact-1',
      status: 'partial'
    })))
    expect(await screen.findByText('Evidence mapping is complete. Review the optimization plan next.')).toBeVisible()
  })

  it('creates a user-confirmed fact from an answer or explicitly confirms a gap', async () => {
    const user = userEvent.setup()
    const addFact = vi.fn().mockResolvedValue(workspace)
    const confirmGap = vi.fn().mockResolvedValue(workspace)
    const service: AgentWorkspaceService = {
      load: vi.fn().mockResolvedValue(workspace),
      linkFact: vi.fn(),
      addFact,
      confirmGap,
      preparePlan: vi.fn(),
      approvePlan: vi.fn()
    }
    renderPanel(service)
    const card = (await screen.findByRole('heading', { name: 'Do you have migration evidence?' })).closest('article') as HTMLElement
    await user.type(within(card).getByRole('textbox', { name: 'New career fact' }), 'Led a five-team migration.')
    await user.click(within(card).getByRole('button', { name: 'Save as confirmed fact' }))
    await waitFor(() => expect(addFact).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Led a five-team migration.',
      kind: 'experience'
    })))

    await user.click(within(card).getByRole('button', { name: 'Confirm real gap' }))
    await waitFor(() => expect(confirmGap).toHaveBeenCalledWith(expect.objectContaining({
      questionId: 'question-1'
    })))
  })

  it('does not expose another draft’s active run as actionable', async () => {
    const service: AgentWorkspaceService = {
      load: vi.fn().mockResolvedValue(workspace),
      linkFact: vi.fn(),
      addFact: vi.fn(),
      confirmGap: vi.fn(),
      preparePlan: vi.fn(),
      approvePlan: vi.fn()
    }
    renderPanel(service, 'other-draft')

    expect(await screen.findByRole('heading', { name: 'This run belongs to another resume' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Link & confirm fact' })).not.toBeInTheDocument()
  })

  it('prepares a reviewable plan and requires explicit approval before change generation', async () => {
    const user = userEvent.setup()
    const evidenceMapped = {
      ...workspace,
      summary: {
        ...workspace.summary,
        run: { ...workspace.summary.run, stage: 'evidence-mapped', questions: [] }
      }
    } as AgentWorkspace
    const plan = {
      id: 'plan-1',
      summary: 'Emphasize the confirmed migration fact.',
      items: [{
        id: 'item-1',
        requirementIds: ['requirement-1'],
        factIds: ['fact-1'],
        intent: 'Clarify verified impact.',
        transformation: 'emphasize'
      }]
    }
    const awaiting = {
      ...evidenceMapped,
      summary: {
        ...evidenceMapped.summary,
        run: { ...evidenceMapped.summary.run, stage: 'awaiting-plan-approval', plan }
      }
    } as AgentWorkspace
    const generating = {
      ...awaiting,
      summary: {
        ...awaiting.summary,
        run: {
          ...awaiting.summary.run,
          stage: 'generating-changes',
          plan: { ...plan, approvedAt: '2026-07-16T08:03:00.000Z' }
        }
      }
    } as AgentWorkspace
    const preparePlan = vi.fn().mockResolvedValue({
      workspace: awaiting,
      execution: { provider: 'Chrome Built-in AI', model: 'browser-managed' }
    })
    const approvePlan = vi.fn().mockResolvedValue(generating)
    const service: AgentWorkspaceService = {
      load: vi.fn().mockResolvedValue(evidenceMapped),
      linkFact: vi.fn(),
      addFact: vi.fn(),
      confirmGap: vi.fn(),
      preparePlan,
      approvePlan
    }
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AgentWorkflowPanel activeDraftId="draft-1" instruction="Tailor for platform leadership" service={service} />
      </NextIntlClientProvider>
    )

    await user.click(await screen.findByRole('button', { name: 'Prepare optimization plan' }))
    await waitFor(() => expect(preparePlan).toHaveBeenCalledWith(expect.objectContaining({
      instruction: 'Tailor for platform leadership',
      locale: 'en'
    })))
    expect(await screen.findByText('Emphasize the confirmed migration fact.')).toBeVisible()
    expect(screen.getByText('Chrome Built-in AI · browser-managed')).toBeVisible()
    expect(screen.getByText('Clarify verified impact.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Approve plan' }))
    await waitFor(() => expect(approvePlan).toHaveBeenCalledOnce())
    expect(await screen.findByText('Plan approved. Evidence-linked change generation is now unlocked.')).toBeVisible()
  })

  it('explains that cloud fallback is disabled when the local plan task is unavailable', async () => {
    const user = userEvent.setup()
    const evidenceMapped = {
      ...workspace,
      summary: {
        ...workspace.summary,
        run: { ...workspace.summary.run, stage: 'evidence-mapped', questions: [] }
      }
    } as AgentWorkspace
    const service: AgentWorkspaceService = {
      load: vi.fn().mockResolvedValue(evidenceMapped),
      linkFact: vi.fn(),
      addFact: vi.fn(),
      confirmGap: vi.fn(),
      preparePlan: vi.fn().mockRejectedValue(new ProviderRoutingError('CLOUD_FALLBACK_NOT_ALLOWED')),
      approvePlan: vi.fn()
    }
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AgentWorkflowPanel activeDraftId="draft-1" instruction="Tailor safely" service={service} />
      </NextIntlClientProvider>
    )

    await user.click(await screen.findByRole('button', { name: 'Prepare optimization plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cloud fallback is off, so no resume data was sent.'
    )
  })
})
