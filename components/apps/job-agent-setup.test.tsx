import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { JobAgentSetup, type JobSetupValues } from './job-agent-setup'

const values: JobSetupValues = {
  profileName: 'Platform roles', titles: 'Platform Engineer', locations: 'Shanghai',
  preferredCompanies: '', blockedCompanies: '', requiredTerms: 'TypeScript', preferredTerms: '', excludedTerms: '',
  industries: 'Internet', experienceLevels: '3-5 years', educationLevels: 'Bachelor', companySizes: '', financingStages: '',
  minimumSalary: '25000', maximumSalary: '45000', maximumAgeDays: 14,
  workplaceTypes: ['hybrid'], employmentTypes: ['full-time'],
  minimumMatchScore: 75, dailyContactLimit: 12, autonomy: 'approval', autoSendResume: true
}

describe('JobAgentSetup', () => {
  it('blocks progress until a trusted resume exists', () => {
    renderSetup({ trustedResume: false })
    expect(screen.getByRole('button', { name: 'Continue to analysis' })).toBeDisabled()
    expect(screen.getByText('Upload a trusted resume')).toBeVisible()
  })

  it('reviews analysis, saves job-site criteria, then explicitly starts delegation', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async () => true)
    const onStart = vi.fn(async () => undefined)
    const onChange = vi.fn()
    renderSetup({ trustedResume: true, onSave, onStart, onChange })

    expect(screen.getByText('Platform Engineer')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Confirm and choose job criteria' }))
    expect(screen.getByRole('textbox', { name: 'Target titles' })).toHaveValue('Platform Engineer')
    await user.click(screen.getByRole('button', { name: 'Save job criteria' }))
    expect(await screen.findByText('Confirm delegation rules')).toBeVisible()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Automation level' }), 'autopilot')
    expect(onChange).toHaveBeenCalledWith('autonomy', 'autopilot')
    await user.click(screen.getByRole('button', { name: 'Confirm and start Agent' }))
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
    onSave: vi.fn(async () => true),
    onStart: vi.fn(async () => undefined),
    ...overrides
  }
  return render(<NextIntlClientProvider locale="en" messages={en}><JobAgentSetup {...props} /></NextIntlClientProvider>)
}
