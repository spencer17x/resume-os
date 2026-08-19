import { describe, expect, it, vi } from 'vitest'
import {
  BROWSER_AGENT_REQUEST_EVENT,
  BROWSER_AGENT_RESPONSE_EVENT,
  detectBrowserAgentSessions
} from './browser-agent-protocol'

describe('browser agent protocol', () => {
  it('accepts a bounded response from the local extension bridge', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string }>).detail
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        extensionVersion: '0.1.0',
        sessions: [{ platform: 'boss', state: 'available', tabId: 12 }]
      } }))
    })

    await expect(detectBrowserAgentSessions({ window: target as Window, timeoutMs: 50 })).resolves.toMatchObject({
      ok: true,
      sessions: [{ platform: 'boss', state: 'available' }]
    })
  })

  it('fails closed when no extension responds', async () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const pending = detectBrowserAgentSessions({ window: target as Window, timeoutMs: 20 })
    await vi.advanceTimersByTimeAsync(20)
    await expect(pending).resolves.toMatchObject({ ok: false, error: 'EXTENSION_UNAVAILABLE' })
    vi.useRealTimers()
  })
})
