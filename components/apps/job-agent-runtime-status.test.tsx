import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'
import en from '@/messages/en.json'
import { JobAgentRuntimeStatus } from './job-agent-runtime-status'

describe('JobAgentRuntimeStatus', () => {
  it('shows persisted queue and catch-up status', () => {
    render(<NextIntlClientProvider locale="en" messages={en}><JobAgentRuntimeStatus runtime={{
      enabled: true, intervalMinutes: 15, pendingCount: 2, missedRunCount: 3,
      offlineReason: 'page-closed', nextRunAt: '2026-08-20T09:15:00.000Z'
    }} /></NextIntlClientProvider>)
    expect(screen.getByLabelText('Agent runtime')).toHaveTextContent('2')
    expect(screen.getByLabelText('Agent runtime')).toHaveTextContent('JobSeeker Agent page was closed')
    expect(screen.getByText('3 missed cycles will be coalesced and checked before execution.')).toBeVisible()
  })
})
