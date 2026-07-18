import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { WorkflowOverview } from './workflow-overview'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  openApp: vi.fn(),
  activeDraft: { id: 'draft-1', name: 'Primary resume', source: 'paste' }
}))

vi.mock('@/lib/agent/workflow-persistence', () => ({
  ACTIVE_WORKFLOW_CHANGED_EVENT: 'resume-os-active-workflow-changed',
  loadActiveWorkflowSummary: mocks.load
}))

vi.mock('@/components/resume-draft-provider', () => ({
  useResumeDraft: () => ({
    activeDraft: mocks.activeDraft
  })
}))

vi.mock('./desktop-provider', () => ({
  useDesktop: () => ({ openApp: mocks.openApp })
}))

beforeEach(() => {
  mocks.openApp.mockReset()
  mocks.activeDraft = { id: 'draft-1', name: 'Primary resume', source: 'paste' }
  mocks.load.mockReset().mockResolvedValue({
    preference: { targetJobId: 'job-1', optimizationRunId: 'run-1' },
    targetJob: { id: 'job-1', title: 'Staff Platform Engineer' },
    run: {
      id: 'run-1',
      sourceDraftId: 'draft-1',
      targetJobId: 'job-1',
      stage: 'awaiting-answers',
      scoreBefore: {
        requirementCoverage: 62.5,
        evidenceCompleteness: 75,
        rubricVersion: 'resume-os-alignment-v1'
      }
    }
  })
})

afterEach(() => cleanup())

describe('WorkflowOverview', () => {
  it('restores the active target and sends the recommended action to the resumable Agent run', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WorkflowOverview />
      </NextIntlClientProvider>
    )

    expect(await screen.findByText('Staff Platform Engineer · saved locally')).toBeVisible()
    expect(screen.getByText('Waiting for your answers to evidence gaps.')).toBeVisible()
    expect(screen.getByText('Requirement coverage')).toBeVisible()
    expect(screen.getByText('62.5%')).toBeVisible()
    expect(screen.getByText('75%')).toBeVisible()
    expect(screen.getByText('resume-os-alignment-v1')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Stage 04: Review & Export' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Stage 05: Settings' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Continue Agent run' }))
    expect(mocks.openApp).toHaveBeenCalledWith('agent')
  })

  it('routes an applied run to review and export instead of restarting the Agent', async () => {
    mocks.load.mockResolvedValueOnce({
      preference: { targetJobId: 'job-1', optimizationRunId: 'run-1' },
      targetJob: { id: 'job-1', title: 'Staff Platform Engineer' },
      run: {
        id: 'run-1', sourceDraftId: 'draft-1', targetJobId: 'job-1', stage: 'applied'
      }
    })
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WorkflowOverview />
      </NextIntlClientProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Review tailored variant' }))
    expect(mocks.openApp).toHaveBeenCalledWith('classic')
  })

  it('ignores a target job that belongs to a different resume draft', async () => {
    mocks.load.mockResolvedValueOnce({
      targetJob: { id: 'job-1', title: 'Other role' },
      run: { id: 'run-1', sourceDraftId: 'other-draft', targetJobId: 'job-1', stage: 'awaiting-answers' }
    })
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WorkflowOverview compact />
      </NextIntlClientProvider>
    )

    expect(await screen.findByText('Add a job description to focus the analysis')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Open Target Job' }))
    expect(mocks.openApp).toHaveBeenCalledWith('jd-match')
  })

  it('keeps Demo and AI-created drafts outside the verified Career Profile workflow', async () => {
    mocks.activeDraft = { id: 'draft-1', name: 'Sandbox draft', source: 'ai-generated' }
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WorkflowOverview />
      </NextIntlClientProvider>
    )

    expect(await screen.findByText('Demo and AI-created drafts are not verified career evidence')).toBeVisible()
    expect(screen.getByText('Import or paste a real resume before starting job tailoring')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Open Career Profile' }))
    expect(mocks.openApp).toHaveBeenCalledWith('studio')
    expect(screen.queryByText('Staff Platform Engineer · saved locally')).not.toBeInTheDocument()
  })
})
