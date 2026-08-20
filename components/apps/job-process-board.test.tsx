import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'
import en from '@/messages/en.json'
import { JobProcessBoard } from './job-process-board'

describe('JobProcessBoard', () => {
  it('shows resume, communication, message, application, and interview state without private bodies', () => {
    render(<NextIntlClientProvider locale="en" messages={en}><JobProcessBoard
      applications={[{ id: 'app-1', postingId: 'posting-1', sourceDraftId: 'draft-1', resumeVariantId: 'variant-1', status: 'interviewing', notes: '', createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T09:00:00.000Z' }]}
      postings={[{ id: 'posting-1', sourceId: 'source-1', externalId: 'one', canonicalUrl: 'https://www.zhipin.com/job_detail/one.html', applyUrl: 'https://www.zhipin.com/job_detail/one.html', title: 'AI Engineer', company: 'Example', description: 'Build AI products.', locale: 'en', firstSeenAt: '2026-08-20T08:00:00.000Z', lastCheckedAt: '2026-08-20T08:00:00.000Z', status: 'open', contentHash: 'hash:one' }]}
      threads={[]}
      messages={[]}
    /></NextIntlClientProvider>)
    expect(screen.getByRole('table', { name: 'Managed job-search progress' })).toHaveTextContent('AI Engineer')
    expect(screen.getByRole('table')).toHaveTextContent('Resume ready')
    expect(screen.getByRole('table')).toHaveTextContent('Interviewing')
  })
})
