import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import {
  clearAiProviderPreference,
  saveAiProviderPreference
} from '@/lib/agent/provider-preference'
import { AIServiceTest } from './ai-service-test'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  window.localStorage.clear()
  clearAiProviderPreference()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AIServiceTest', () => {
  it('does not send a cloud-only test while Chrome-only mode is selected', async () => {
    const user = userEvent.setup()
    saveAiProviderPreference({ mode: 'chrome-built-in', allowCloudFallback: false })
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AIServiceTest />
      </NextIntlClientProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Test AI Service' }))

    expect(await screen.findByText(
      /This task requires the OpenAI-compatible provider/
    )).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps stable error codes and never displays arbitrary server prose', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: { code: 'AI_UNAVAILABLE', message: 'raw provider secret detail' }
      })
    } as Response)
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AIServiceTest />
      </NextIntlClientProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Test AI Service' }))

    expect(await screen.findByText('AI service is temporarily unavailable.')).toBeVisible()
    expect(screen.queryByText(/raw provider secret detail/)).not.toBeInTheDocument()
  })

  it('observes Retry-After, shows an actionable message, and re-enables its action', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: false,
      headers: new Headers({ 'Retry-After': '1' }),
      json: async () => ({
        error: 'Too many requests. Try again later.',
        code: 'RATE_LIMITED'
      })
    } as Response)
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AIServiceTest />
      </NextIntlClientProvider>
    )

    const button = screen.getByRole('button', { name: 'Test AI Service' })
    await user.click(button)

    expect(await screen.findByText('Too many requests. Try again in 1 second.')).toBeVisible()
    expect(button).toBeDisabled()
    await waitFor(() => expect(button).toBeEnabled(), { timeout: 2_000 })
  })
})
