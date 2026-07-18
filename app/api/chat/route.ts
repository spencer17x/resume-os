import { isLocale } from '@/i18n/routing'
import { createAgentErrorResponse, generateAgentText } from '@/lib/agent/openai'
import { buildResumeAgentPrompt } from '@/lib/agent/prompt'
import { apiErrorResponse, guardAiRequest, type AiRequestGuard } from '@/lib/server/request-guard'
import { readLimitedJson, requestJsonErrorResponse } from '@/lib/server/request-json'
import { normalizeResumeData, type ResumeData } from '@/lib/resume-model'

const MAX_CHAT_BODY_BYTES = 80_000

export function createChatRoute(dependencies: {
  guard?: AiRequestGuard
  rateLimit?: { limit: number; windowMs: number }
} = {}) {
  const guardRequest = dependencies.guard ?? guardAiRequest
  const rateLimit = dependencies.rateLimit ?? { limit: 20, windowMs: 60_000 }

  return async function chatRoute(request: Request) {
    const guard = guardRequest(request, {
      bucket: 'resume-chat',
      ...rateLimit,
      maxBodyBytes: MAX_CHAT_BODY_BYTES
    })
    if (guard) return guard

    let input: { locale?: unknown; message?: unknown; resume?: unknown }
    try {
      input = await readLimitedJson(request, MAX_CHAT_BODY_BYTES)
    } catch (error) {
      return requestJsonErrorResponse(error) ?? apiErrorResponse('INVALID_REQUEST', 400)
    }

    if (!input?.message || typeof input.message !== 'string' || input.message.length > 10_000) {
      return apiErrorResponse('INVALID_REQUEST', 400)
    }

    const locale = typeof input.locale === 'string' && isLocale(input.locale) ? input.locale : 'zh'
    let resume: ResumeData | undefined
    if (Object.hasOwn(input, 'resume')) {
      try {
        resume = normalizeResumeData(input.resume, { locale })
      } catch {
        return apiErrorResponse('INVALID_REQUEST', 400)
      }
    }

    try {
      const prompt = buildResumeAgentPrompt(input.message, locale, resume)
      const { model, text } = await generateAgentText(prompt.user, {
        system: prompt.system,
        request,
        abortSignal: request.signal,
        maxOutputTokens: 2_000
      })
      return Response.json({ answer: text, locale, model })
    } catch (error) {
      return createAgentErrorResponse(error)
    }
  }
}

export const POST = createChatRoute()
