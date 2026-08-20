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

  it('validates bounded BOSS job cards returned by the extension', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      if (request.action !== 'collect-boss-jobs') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        jobs: [{
          externalId: 'abc', url: 'https://www.zhipin.com/job_detail/abc.html',
          title: '平台工程师', company: '示例公司', summary: '负责 TypeScript 平台研发。'
        }]
      } }))
    })
    const { collectBossBrowserJobs } = await import('./browser-agent-protocol')
    await expect(collectBossBrowserJobs({ window: target as Window, timeoutMs: 50 })).resolves.toMatchObject({
      ok: true,
      jobs: [{ externalId: 'abc', title: '平台工程师' }]
    })
  })

  it('validates a BOSS recipient only when all platform identities are present', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      if (request.action !== 'inspect-boss-conversation') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        recipient: {
          platformRecipientId: 'boss-user-1', conversationId: 'conversation-1',
          recipientName: '招聘经理', recipientTitle: 'HR'
        }
      } }))
    })
    const { inspectBossBrowserConversation } = await import('./browser-agent-protocol')
    await expect(inspectBossBrowserConversation({ window: target as Window, timeoutMs: 50 })).resolves.toMatchObject({
      recipient: { platformRecipientId: 'boss-user-1', conversationId: 'conversation-1' }
    })
  })

  it('accepts only bounded de-identified conversation signals', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      if (request.action !== 'collect-boss-conversation-signals') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        conversationSignals: [{
          signalId: 'fnv1a64:signal-1', conversationId: 'conversation-1',
          kind: 'resume-request', observedAt: '2026-08-19T08:00:00.000Z'
        }]
      } }))
    })
    const { collectBossConversationSignals } = await import('./browser-agent-protocol')
    await expect(collectBossConversationSignals({ window: target as Window, timeoutMs: 50 }))
      .resolves.toMatchObject({ conversationSignals: [{ kind: 'resume-request' }] })
  })

  it('validates content-free adapter diagnostics', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string }>).detail
      if (request.action !== 'diagnose-boss-adapter') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        diagnostics: [{
          pageKind: 'chat', frameId: 0, sessionState: 'available',
          counts: { jobLinks: 0, editors: 1, sendControls: 1, recipientIdentities: 1, conversationIdentities: 1, recipientNames: 1, docxInputs: 1, pdfInputs: 1, messageReceipts: 3, attachmentReceipts: 1, incomingMessages: 2 },
          ready: { discovery: false, conversation: true, messageSend: true, resumeUpload: true }
        }]
      } }))
    })
    const { diagnoseBossBrowserAdapter } = await import('./browser-agent-protocol')
    await expect(diagnoseBossBrowserAdapter({ window: target as Window, timeoutMs: 50 }))
      .resolves.toMatchObject({ diagnostics: [{ ready: { resumeUpload: true } }] })
  })

  it('normalizes and bounds automatic BOSS search queries', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string; payload: { query: string } }>).detail
      if (request.action !== 'search-boss-jobs') return
      expect(request.payload).toEqual({ query: '平台工程师' })
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId, ok: true, jobs: []
      } }))
    })
    const { searchBossBrowserJobs } = await import('./browser-agent-protocol')
    await expect(searchBossBrowserJobs({ window: target as Window, query: '  平台工程师  ', timeoutMs: 50 }))
      .resolves.toMatchObject({ ok: true, jobs: [] })
    await expect(searchBossBrowserJobs({ window: target as Window, query: '' })).rejects.toThrow()
  })

  it('validates a complete BOSS send receipt', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string; payload: { body: string } }>).detail
      if (request.action !== 'send-boss-message') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        sendReceipt: {
          platformMessageId: 'message-1', conversationId: 'conversation-1',
          observedBody: request.payload.body, observedStatus: 'delivered',
          observedRecipient: {
            platformRecipientId: 'boss-user-1', conversationId: 'conversation-1', recipientName: '招聘经理'
          },
          observedAt: '2026-08-19T08:00:00.000Z'
        }
      } }))
    })
    const { sendBossBrowserMessage } = await import('./browser-agent-protocol')
    await expect(sendBossBrowserMessage({
      window: target as Window,
      messageId: 'local-message-1',
      body: '您好',
      bodyFingerprint: 'fnv1a64:body',
      recipient: { platformRecipientId: 'boss-user-1', conversationId: 'conversation-1', recipientName: '招聘经理' },
      timeoutMs: 50
    })).resolves.toMatchObject({ sendReceipt: { observedStatus: 'delivered', observedBody: '您好' } })
  })

  it('validates a complete BOSS resume attachment receipt', async () => {
    const target = new EventTarget()
    target.addEventListener(BROWSER_AGENT_REQUEST_EVENT, (event) => {
      const request = (event as CustomEvent<{ requestId: string; action: string; payload: { fileName: string; byteLength: number; contentFingerprint: string } }>).detail
      if (request.action !== 'send-boss-resume-attachment') return
      target.dispatchEvent(new CustomEvent(BROWSER_AGENT_RESPONSE_EVENT, { detail: {
        requestId: request.requestId,
        ok: true,
        resumeReceipt: {
          platformAttachmentId: 'attachment-1', conversationId: 'conversation-1',
          observedFileName: request.payload.fileName,
          observedMimeType: 'application/pdf',
          observedByteLength: request.payload.byteLength,
          contentFingerprint: request.payload.contentFingerprint,
          observedRecipient: {
            platformRecipientId: 'boss-user-1', conversationId: 'conversation-1', recipientName: '招聘经理'
          },
          observedAt: '2026-08-19T08:00:00.000Z'
        }
      } }))
    })
    const { sendBossResumeAttachment } = await import('./browser-agent-protocol')
    await expect(sendBossResumeAttachment({
      window: target as Window,
      fileName: 'target-role.pdf',
      bytesBase64: btoa('%PDF'),
      byteLength: 4,
      mimeType: 'application/pdf',
      contentFingerprint: 'fnv1a64:pdf',
      recipient: { platformRecipientId: 'boss-user-1', conversationId: 'conversation-1', recipientName: '招聘经理' },
      timeoutMs: 50
    })).resolves.toMatchObject({ resumeReceipt: { platformAttachmentId: 'attachment-1' } })
    await expect(sendBossResumeAttachment({
      window: target as Window,
      fileName: 'target-role.docx',
      bytesBase64: btoa('%PDF'),
      byteLength: 4,
      mimeType: 'application/pdf',
      contentFingerprint: 'fnv1a64:pdf',
      recipient: { platformRecipientId: 'boss-user-1', conversationId: 'conversation-1', recipientName: '招聘经理' }
    })).rejects.toThrow()
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
