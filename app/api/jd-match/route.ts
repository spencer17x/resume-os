import { isLocale } from '@/i18n/routing'
import { createAgentErrorResponse, generateAgentText } from '@/lib/agent/openai'
import { AgentOutputError } from '@/lib/agent/json'
import {
  buildJDRequirementAnalysis,
  formatJDMatchReport,
  parseJDMatchReportJson
} from '@/lib/agent/jd-report'
import { buildJDMatchPrompt } from '@/lib/agent/prompt'
import { apiErrorResponse, guardAiRequest, type AiRequestGuard } from '@/lib/server/request-guard'
import { readLimitedJson, requestJsonErrorResponse } from '@/lib/server/request-json'
import { normalizeResumeData, type ResumeData } from '@/lib/resume-model'

const MAX_JD_BODY_BYTES = 128_000

export function createJdMatchRoute(dependencies: {
  guard?: AiRequestGuard
  rateLimit?: { limit: number; windowMs: number }
} = {}) {
  const guardRequest = dependencies.guard ?? guardAiRequest
  const rateLimit = dependencies.rateLimit ?? { limit: 6, windowMs: 60_000 }

  return async function jdMatchRoute(request: Request) {
    const guard = guardRequest(request, {
      bucket: 'jd-match',
      ...rateLimit,
      maxBodyBytes: MAX_JD_BODY_BYTES
    })
    if (guard) return guard

    let input: { jd?: unknown; locale?: unknown; resume?: unknown }
    try {
      input = await readLimitedJson(request, MAX_JD_BODY_BYTES)
    } catch (error) {
      return requestJsonErrorResponse(error) ?? apiErrorResponse('INVALID_REQUEST', 400)
    }

    if (!input?.jd || typeof input.jd !== 'string' || input.jd.length > 50_000) {
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
      const activeResume = resume ?? normalizeResumeData({}, {
        locale,
        source: 'sample'
      })
      const prompt = buildJDMatchPrompt(input.jd, locale, activeResume)
      const { model, text } = await generateAgentText(prompt.user, {
        system: prompt.system,
        request,
        abortSignal: request.signal,
        maxOutputTokens: 3_000
      })
      const sections = parseJDMatchReportJson(text)
      const report = formatJDMatchReport(sections, locale)
      const analysis = buildJDRequirementAnalysis({
        report: sections,
        jobDescription: input.jd,
        locale,
        resume: activeResume
      })
      return Response.json({ report, sections, locale, model, ...analysis })
    } catch (error) {
      if (error instanceof AgentOutputError) return apiErrorResponse(error.code, 502)
      return createAgentErrorResponse(error)
    }
  }
}

export const POST = createJdMatchRoute()
