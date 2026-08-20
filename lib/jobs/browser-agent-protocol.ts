import { z } from 'zod'
import { JOB_AGENT_PLATFORM_IDS, jobAgentPlatformIdSchema } from './job-agent-policy'

export const BROWSER_AGENT_REQUEST_EVENT = 'resume-os:browser-agent:request'
export const BROWSER_AGENT_RESPONSE_EVENT = 'resume-os:browser-agent:response'
export const JOB_AGENT_WAKE_EVENT = 'resume-os:job-agent:wakeup'

export const browserPlatformSessionSchema = z.object({
  platform: jobAgentPlatformIdSchema,
  state: z.enum(['available', 'login-required', 'unknown']),
  tabId: z.number().int().positive().optional()
})

export type BrowserPlatformSession = z.infer<typeof browserPlatformSessionSchema>

export const browserBossJobSchema = z.object({
  externalId: z.string().trim().min(1).max(300),
  url: z.url().max(2_000),
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(20_000),
  location: z.string().trim().min(1).max(500).optional(),
  minimumMonthlySalary: z.number().int().nonnegative().max(1_000_000).optional(),
  maximumMonthlySalary: z.number().int().positive().max(1_000_000).optional()
}).strict()

export type BrowserBossJob = z.infer<typeof browserBossJobSchema>

export const browserBossRecipientSchema = z.object({
  platformRecipientId: z.string().trim().min(1).max(500),
  conversationId: z.string().trim().min(1).max(500),
  recipientName: z.string().trim().min(1).max(300),
  recipientTitle: z.string().trim().min(1).max(300).optional()
}).strict()

export type BrowserBossRecipient = z.infer<typeof browserBossRecipientSchema>

export const browserBossSendReceiptSchema = z.object({
  platformMessageId: z.string().trim().min(1).max(500),
  conversationId: z.string().trim().min(1).max(500),
  observedBody: z.string().trim().min(1).max(5_000),
  observedStatus: z.enum(['sent', 'delivered', 'read']),
  observedRecipient: browserBossRecipientSchema,
  observedAt: z.iso.datetime({ offset: true })
}).strict()

export type BrowserBossSendReceipt = z.infer<typeof browserBossSendReceiptSchema>

export const browserBossConversationSignalSchema = z.object({
  signalId: z.string().trim().min(1).max(256),
  conversationId: z.string().trim().min(1).max(500),
  kind: z.enum([
    'recruiter-reply', 'resume-request', 'interview-invite',
    'interview-schedule', 'offer', 'rejection'
  ]),
  observedAt: z.iso.datetime({ offset: true })
}).strict()

export type BrowserBossConversationSignal = z.infer<typeof browserBossConversationSignalSchema>

export const resumeArtifactMimeTypeSchema = z.enum([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])
export type ResumeArtifactMimeType = z.infer<typeof resumeArtifactMimeTypeSchema>

export const browserBossResumeReceiptSchema = z.object({
  platformAttachmentId: z.string().trim().min(1).max(500),
  conversationId: z.string().trim().min(1).max(500),
  observedFileName: z.string().trim().min(1).max(200),
  observedMimeType: resumeArtifactMimeTypeSchema,
  observedByteLength: z.number().int().positive().max(1_000_000),
  contentFingerprint: z.string().trim().min(1).max(256),
  observedRecipient: browserBossRecipientSchema,
  observedAt: z.iso.datetime({ offset: true })
}).strict()

export type BrowserBossResumeReceipt = z.infer<typeof browserBossResumeReceiptSchema>

export const browserBossAdapterDiagnosticSchema = z.object({
  pageKind: z.enum(['search', 'chat', 'other']),
  frameId: z.number().int().min(0),
  conversationFingerprint: z.string().trim().min(1).max(256).optional(),
  sessionState: z.enum(['available', 'login-required', 'unknown']),
  counts: z.object({
    jobLinks: z.number().int().min(0).max(1_000),
    editors: z.number().int().min(0).max(100),
    sendControls: z.number().int().min(0).max(100),
    recipientIdentities: z.number().int().min(0).max(100),
    conversationIdentities: z.number().int().min(0).max(100),
    recipientNames: z.number().int().min(0).max(100),
    docxInputs: z.number().int().min(0).max(100),
    pdfInputs: z.number().int().min(0).max(100),
    messageReceipts: z.number().int().min(0).max(1_000),
    attachmentReceipts: z.number().int().min(0).max(1_000),
    incomingMessages: z.number().int().min(0).max(1_000)
  }).strict(),
  ready: z.object({
    discovery: z.boolean(),
    conversation: z.boolean(),
    messageSend: z.boolean(),
    resumeUpload: z.boolean()
  }).strict()
}).strict()

export type BrowserBossAdapterDiagnostic = z.infer<typeof browserBossAdapterDiagnosticSchema>

export const browserAgentResponseSchema = z.object({
  requestId: z.string().min(1).max(120),
  ok: z.boolean(),
  extensionVersion: z.string().min(1).max(40).optional(),
  sessions: z.array(browserPlatformSessionSchema).max(JOB_AGENT_PLATFORM_IDS.length).optional(),
  jobs: z.array(browserBossJobSchema).max(50).optional(),
  recipient: browserBossRecipientSchema.optional(),
  sendReceipt: browserBossSendReceiptSchema.optional(),
  conversationSignals: z.array(browserBossConversationSignalSchema).max(100).optional(),
  resumeReceipt: browserBossResumeReceiptSchema.optional(),
  diagnostics: z.array(browserBossAdapterDiagnosticSchema).max(50).optional(),
  error: z.enum(['EXTENSION_UNAVAILABLE', 'INVALID_REQUEST', 'PROBE_FAILED']).optional()
})

export type BrowserAgentResponse = z.infer<typeof browserAgentResponseSchema>

export async function detectBrowserAgentSessions(input: {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>
  timeoutMs?: number
}): Promise<BrowserAgentResponse> {
  return requestBrowserAgent({ ...input, action: 'detect-platforms' })
}

export async function collectBossBrowserJobs(input: {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>
  timeoutMs?: number
}): Promise<BrowserAgentResponse> {
  return requestBrowserAgent({ ...input, action: 'collect-boss-jobs' })
}

export async function searchBossBrowserJobs(input: {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>
  query: string
  timeoutMs?: number
}): Promise<BrowserAgentResponse> {
  const query = input.query.normalize('NFKC').trim()
  if (!query || query.length > 120) throw new TypeError('BOSS search query must contain 1 to 120 characters')
  return requestBrowserAgent({
    window: input.window,
    timeoutMs: input.timeoutMs ?? 15_000,
    action: 'search-boss-jobs',
    payload: { query }
  })
}

export async function inspectBossBrowserConversation(input: {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>
  timeoutMs?: number
}): Promise<BrowserAgentResponse> {
  return requestBrowserAgent({ ...input, action: 'inspect-boss-conversation' })
}

export async function collectBossConversationSignals(input: {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>
  timeoutMs?: number
}): Promise<BrowserAgentResponse> {
  return requestBrowserAgent({
    ...input,
    timeoutMs: input.timeoutMs ?? 5_000,
    action: 'collect-boss-conversation-signals'
  })
}

export async function diagnoseBossBrowserAdapter(input: {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>
  timeoutMs?: number
}): Promise<BrowserAgentResponse> {
  return requestBrowserAgent({
    ...input,
    timeoutMs: input.timeoutMs ?? 5_000,
    action: 'diagnose-boss-adapter'
  })
}

export async function sendBossBrowserMessage(input: {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>
  messageId: string
  body: string
  bodyFingerprint: string
  recipient: BrowserBossRecipient
  timeoutMs?: number
}): Promise<BrowserAgentResponse> {
  const body = input.body.trim()
  if (!body || body.length > 5_000) throw new TypeError('BOSS message body must contain 1 to 5000 characters')
  const recipient = browserBossRecipientSchema.parse(input.recipient)
  return requestBrowserAgent({
    window: input.window,
    timeoutMs: input.timeoutMs ?? 10_000,
    action: 'send-boss-message',
    payload: {
      messageId: input.messageId,
      body,
      bodyFingerprint: input.bodyFingerprint,
      recipient
    }
  })
}

export async function sendBossResumeAttachment(input: {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>
  fileName: string
  bytesBase64: string
  byteLength: number
  mimeType: ResumeArtifactMimeType
  contentFingerprint: string
  recipient: BrowserBossRecipient
  timeoutMs?: number
}): Promise<BrowserAgentResponse> {
  const fileName = input.fileName.normalize('NFKC').trim()
  const expectedExtension = input.mimeType === 'application/pdf' ? '.pdf' : '.docx'
  if (!fileName.toLocaleLowerCase().endsWith(expectedExtension) || fileName.length > 200) throw new TypeError('BOSS resume file name is invalid')
  if (!Number.isInteger(input.byteLength) || input.byteLength <= 0 || input.byteLength > 1_000_000) {
    throw new TypeError('BOSS resume file is too large')
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(input.bytesBase64) || input.bytesBase64.length > 1_400_000) {
    throw new TypeError('BOSS resume payload is invalid')
  }
  const recipient = browserBossRecipientSchema.parse(input.recipient)
  return requestBrowserAgent({
    window: input.window,
    timeoutMs: input.timeoutMs ?? 15_000,
    action: 'send-boss-resume-attachment',
    payload: {
      fileName,
      mimeType: resumeArtifactMimeTypeSchema.parse(input.mimeType),
      bytesBase64: input.bytesBase64,
      byteLength: input.byteLength,
      contentFingerprint: input.contentFingerprint,
      recipient
    }
  })
}

export async function configureBrowserJobAgent(input: {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>
  enabled: boolean
  intervalMinutes?: number
  timeoutMs?: number
}): Promise<BrowserAgentResponse> {
  const intervalMinutes = input.intervalMinutes ?? 15
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 1_440) {
    throw new TypeError('Job Agent interval must be between 5 and 1440 minutes')
  }
  return requestBrowserAgent({
    window: input.window,
    timeoutMs: input.timeoutMs,
    action: 'configure-job-agent',
    payload: { enabled: input.enabled, intervalMinutes }
  })
}

async function requestBrowserAgent(input: {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>
  timeoutMs?: number
  action: 'detect-platforms' | 'collect-boss-jobs' | 'search-boss-jobs' | 'inspect-boss-conversation' | 'collect-boss-conversation-signals' | 'diagnose-boss-adapter' | 'send-boss-message' | 'send-boss-resume-attachment' | 'configure-job-agent'
  payload?: Record<string, unknown>
}): Promise<BrowserAgentResponse> {
  const requestId = crypto.randomUUID()
  const timeoutMs = input.timeoutMs ?? 1_200

  return new Promise((resolve) => {
    let settled = false
    const finish = (response: BrowserAgentResponse) => {
      if (settled) return
      settled = true
      input.window.removeEventListener(BROWSER_AGENT_RESPONSE_EVENT, onResponse as EventListener)
      window.clearTimeout(timeout)
      resolve(response)
    }
    const onResponse = (event: Event) => {
      const parsed = browserAgentResponseSchema.safeParse((event as CustomEvent<unknown>).detail)
      if (!parsed.success || parsed.data.requestId !== requestId) return
      finish(parsed.data)
    }
    const timeout = window.setTimeout(() => finish({
      requestId,
      ok: false,
      error: 'EXTENSION_UNAVAILABLE'
    }), timeoutMs)
    input.window.addEventListener(BROWSER_AGENT_RESPONSE_EVENT, onResponse as EventListener)
    input.window.dispatchEvent(new CustomEvent(BROWSER_AGENT_REQUEST_EVENT, {
      detail: { requestId, action: input.action, ...(input.payload ? { payload: input.payload } : {}) }
    }))
  })
}
