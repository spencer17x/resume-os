import { fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import type { ApplicationPacket } from '@/lib/jobs/application-record'
import { ApplicationPipeline } from './application-pipeline'

const packet: ApplicationPacket = {
  record: { id: 'application-1', postingId: 'posting-1', sourceDraftId: 'draft-1', targetJobId: 'target-1', resumeVariantId: 'variant-1', status: 'ready-to-apply', postingContentHash: 'hash:one', recommendationFingerprint: 'recommendation:one', workflowInputFingerprint: 'workflow:one', notes: '', createdAt: '2026-08-01T08:00:00.000Z', updatedAt: '2026-08-01T08:00:00.000Z' },
  posting: { id: 'posting-1', sourceId: 'source-1', externalId: '1', canonicalUrl: 'https://jobs.lever.co/example/1', applyUrl: 'https://jobs.lever.co/example/1/apply', title: 'Engineer', company: 'Example', description: 'Build systems.', locale: 'en', firstSeenAt: '2026-08-01T08:00:00.000Z', lastCheckedAt: '2026-08-01T08:00:00.000Z', status: 'open', contentHash: 'hash:one' },
  recommendation: null,
  run: null,
  variant: null,
  checks: [
    { code: 'posting-current', passed: true },
    { code: 'recommendation-current', passed: true },
    { code: 'workflow-applied', passed: true },
    { code: 'variant-related', passed: true },
    { code: 'workflow-current', passed: true }
  ],
  ready: true
}

describe('ApplicationPipeline', () => {
  it('shows the packet before the external link and never infers submission from opening it', () => {
    const markApplied = vi.fn()
    render(<NextIntlClientProvider locale="en" messages={en}><ApplicationPipeline packets={[packet]} onPrepare={vi.fn()} onMarkApplied={markApplied} onNotesChange={vi.fn()} /></NextIntlClientProvider>)
    expect(screen.getByRole('list', { name: 'Application readiness checklist' })).toBeVisible()
    const link = screen.getByRole('link', { name: 'Open application site' })
    expect(link).toHaveAttribute('href', packet.posting.applyUrl)
    fireEvent.click(link)
    expect(markApplied).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'I submitted this application' }))
    expect(markApplied).toHaveBeenCalledWith(packet.record.id)
  })

  it('does not present a stale ready record as ready to apply', () => {
    const { container } = render(<NextIntlClientProvider locale="en" messages={en}><ApplicationPipeline packets={[{
      ...packet,
      ready: false,
      checks: packet.checks.map((check) => check.code === 'posting-current' ? { ...check, passed: false } : check)
    }]} onPrepare={vi.fn()} onMarkApplied={vi.fn()} onNotesChange={vi.fn()} /></NextIntlClientProvider>)
    const pipeline = within(container)

    expect(pipeline.getByText('Needs preparation')).toBeVisible()
    expect(pipeline.queryByRole('link', { name: 'Open application site' })).not.toBeInTheDocument()
    expect(pipeline.queryByRole('button', { name: 'I submitted this application' })).not.toBeInTheDocument()
    expect(pipeline.getByRole('button', { name: 'Check application packet' })).toBeVisible()
  })
})
