import { z } from 'zod'
import { JOB_AGENT_PLATFORM_IDS, jobAgentPlatformIdSchema } from './job-agent-policy'

export const BROWSER_AGENT_REQUEST_EVENT = 'resume-os:browser-agent:request'
export const BROWSER_AGENT_RESPONSE_EVENT = 'resume-os:browser-agent:response'

export const browserPlatformSessionSchema = z.object({
  platform: jobAgentPlatformIdSchema,
  state: z.enum(['available', 'login-required', 'unknown']),
  tabId: z.number().int().positive().optional()
})

export type BrowserPlatformSession = z.infer<typeof browserPlatformSessionSchema>

export const browserAgentResponseSchema = z.object({
  requestId: z.string().min(1).max(120),
  ok: z.boolean(),
  extensionVersion: z.string().min(1).max(40).optional(),
  sessions: z.array(browserPlatformSessionSchema).max(JOB_AGENT_PLATFORM_IDS.length).optional(),
  error: z.enum(['EXTENSION_UNAVAILABLE', 'INVALID_REQUEST', 'PROBE_FAILED']).optional()
})

export type BrowserAgentResponse = z.infer<typeof browserAgentResponseSchema>

export async function detectBrowserAgentSessions(input: {
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>
  timeoutMs?: number
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
      detail: { requestId, action: 'detect-platforms' }
    }))
  })
}
