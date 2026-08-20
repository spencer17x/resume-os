import { createAgentErrorResponse, generateAgentText } from '@/lib/agent/openai'
import { AgentOutputError } from '@/lib/agent/json'
import {
  buildInterviewReviewPrompt,
  interviewReviewRequestSchema,
  parseInterviewReviewOutput
} from '@/lib/jobs/interview-review'
import { apiErrorResponse, guardAiRequest, type AiRequestGuard } from '@/lib/server/request-guard'
import { readLimitedJson, requestJsonErrorResponse } from '@/lib/server/request-json'

const MAX_INTERVIEW_REVIEW_BYTES = 160_000

export function createInterviewReviewRoute(dependencies: {
  guard?: AiRequestGuard
  rateLimit?: { limit: number; windowMs: number }
} = {}) {
  const guardRequest = dependencies.guard ?? guardAiRequest
  const rateLimit = dependencies.rateLimit ?? { limit: 6, windowMs: 60_000 }

  return async function interviewReviewRoute(request: Request) {
    const guard = guardRequest(request, {
      bucket: 'interview-review',
      ...rateLimit,
      maxBodyBytes: MAX_INTERVIEW_REVIEW_BYTES
    })
    if (guard) return guard

    let body: unknown
    try {
      body = await readLimitedJson(request, MAX_INTERVIEW_REVIEW_BYTES)
    } catch (error) {
      return requestJsonErrorResponse(error) ?? apiErrorResponse('INVALID_REQUEST', 400)
    }
    const parsed = interviewReviewRequestSchema.safeParse(body)
    if (!parsed.success) return apiErrorResponse('INVALID_REQUEST', 400)

    try {
      const prompt = buildInterviewReviewPrompt(parsed.data)
      const { model, text } = await generateAgentText(prompt.user, {
        system: prompt.system,
        request,
        abortSignal: request.signal,
        maxOutputTokens: 3_000
      })
      return Response.json({ output: parseInterviewReviewOutput(text), model })
    } catch (error) {
      if (error instanceof AgentOutputError) return apiErrorResponse(error.code, 502)
      return createAgentErrorResponse(error)
    }
  }
}

export const POST = createInterviewReviewRoute()
