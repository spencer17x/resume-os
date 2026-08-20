import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import { JobHistoryLearningPanel } from './job-history-learning-panel'

describe('JobHistoryLearningPanel', () => {
  it('shows a simulation and applies it only after the user chooses apply', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<NextIntlClientProvider locale="en" messages={en}><JobHistoryLearningPanel
      busy={false}
      simulation={{
        version: 1, sampleSize: 20, recommendedMinimumMatchScore: 70,
        recommendedDailyContactLimit: 5, recommendedAutonomy: 'autopilot',
        recommendedAutoSendResume: true,
        signals: { conversations: 20, recruiterReplies: 5, resumeRequests: 2, interviewInvites: 1, offers: 0, rejections: 1, localApplications: 2 },
        reasonCodes: ['reply-observed'], simulatedAt: '2026-08-20T08:00:00.000Z'
      }}
      onSimulate={vi.fn()} onApply={onApply} onDismiss={vi.fn()}
    /></NextIntlClientProvider>)
    expect(screen.getByText('History policy simulation')).toBeVisible()
    expect(onApply).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Apply history policy' }))
    expect(onApply).toHaveBeenCalledOnce()
  })
})
