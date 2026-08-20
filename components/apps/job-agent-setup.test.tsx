import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { JobAgentSetup, type JobSetupValues } from './job-agent-setup'

const values: JobSetupValues = {
  goalDescription: 'Full-time Platform Engineer roles in Shanghai, 25K-45K.',
  profileName: 'Platform roles', titles: 'Platform Engineer', locations: 'Shanghai',
  preferredCompanies: '', blockedCompanies: '', requiredTerms: 'TypeScript', preferredTerms: '', excludedTerms: '',
  industries: 'Internet', experienceLevels: '3-5 years', educationLevels: 'Bachelor', companySizes: '', financingStages: '',
  minimumSalary: '25000', maximumSalary: '45000', maximumAgeDays: 14,
  workplaceTypes: ['hybrid'], employmentTypes: ['full-time'],
  minimumMatchScore: 75, dailyContactLimit: 12, autonomy: 'approval', autoSendResume: true
}

afterEach(cleanup)

describe('JobAgentSetup', () => {
  it('collects the goal first and then blocks resume progress until a trusted resume exists', async () => {
    const user = userEvent.setup()
    renderSetup({ trustedResume: false })
    await user.click(screen.getByRole('button', { name: 'Let Agent analyze goal' }))
    expect(screen.getByRole('button', { name: 'Continue to analysis' })).toBeDisabled()
    expect(screen.getByText('Upload a trusted resume')).toBeVisible()
  })

  it('reviews analysis, saves job-site criteria, then explicitly starts delegation', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => true)
    const onStart = vi.fn(async () => undefined)
    const onChange = vi.fn()
    const onAnalyzeGoal = vi.fn()
    renderSetup({ trustedResume: true, onSave, onStart, onChange, onAnalyzeGoal })

    await user.click(screen.getByRole('button', { name: 'Let Agent analyze goal' }))
    expect(onAnalyzeGoal).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Continue to analysis' }))
    expect(screen.getByText('Platform Engineer')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Confirm and choose job criteria' }))
    expect(screen.getByRole('textbox', { name: 'Target titles' })).toHaveValue('Platform Engineer')
    await user.click(screen.getByRole('button', { name: 'Save job criteria' }))
    expect(await screen.findByText('Confirm delegation rules')).toBeVisible()
    await user.click(screen.getByRole('checkbox', { name: /I authorize the Agent/ }))
    expect(onChange).toHaveBeenCalledWith('autonomy', 'autopilot')
    expect(onChange).toHaveBeenCalledWith('autoSendResume', true)
    await user.click(screen.getByRole('button', { name: 'Authorize and start managed mode' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onStart).toHaveBeenCalledTimes(1)
  })
})

function renderSetup(overrides: Partial<Parameters<typeof JobAgentSetup>[0]> = {}) {
  const props: Parameters<typeof JobAgentSetup>[0] = {
    trustedResume: false,
    resumeEditor: <div>Resume editor</div>,
    analysis: { name: 'Ada', role: 'Engineer', suggestedTitles: ['Platform Engineer'], skills: ['TypeScript'], experienceCount: 2 },
    values,
    onChange: vi.fn(),
    onAnalyzeGoal: vi.fn(),
    onSave: vi.fn(async () => true),
    onStart: vi.fn(async () => undefined),
    ...overrides
  }
  return render(<NextIntlClientProvider locale="en" messages={en}><JobAgentSetup {...props} /></NextIntlClientProvider>)
}
