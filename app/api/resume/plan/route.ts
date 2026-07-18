import { AgentOutputError, extractJsonText } from '@/lib/agent/json'
import { createAgentErrorResponse, generateAgentText } from '@/lib/agent/openai'
import {
  MAX_OPTIMIZATION_PLAN_BODY_BYTES,
  MAX_OPTIMIZATION_PLAN_OUTPUT_BYTES,
  OptimizationPlanPreparationError,
  optimizationPlanRequestSchema,
  prepareOptimizationPlan
} from '@/lib/agent/optimization-plan'
import { buildOptimizationPlanPrompt } from '@/lib/agent/optimization-plan-prompt'
import { apiErrorResponse, guardAiRequest, type AiRequestGuard } from '@/lib/server/request-guard'
import { readLimitedJson, requestJsonErrorResponse } from '@/lib/server/request-json'

export function createResumePlanRoute(dependencies: {
  guard?: AiRequestGuard
  rateLimit?: { limit: number; windowMs: number }
} = {}) {
  const guardRequest = dependencies.guard ?? guardAiRequest
  const rateLimit = dependencies.rateLimit ?? { limit: 6, windowMs: 60_000 }

  return async function resumePlanRoute(request: Request) {
    const guard = guardRequest(request, {
      bucket: 'resume-plan',
      ...rateLimit,
      maxBodyBytes: MAX_OPTIMIZATION_PLAN_BODY_BYTES
    })
    if (guard) return guard

    let rawInput: unknown
    try {
      rawInput = await readLimitedJson(request, MAX_OPTIMIZATION_PLAN_BODY_BYTES)
    } catch (error) {
      return requestJsonErrorResponse(error) ?? apiErrorResponse('INVALID_REQUEST', 400)
    }

    const input = optimizationPlanRequestSchema.safeParse(rawInput)
    if (!input.success) return apiErrorResponse('INVALID_REQUEST', 400)

    try {
      const prompt = buildOptimizationPlanPrompt(input.data)
      const result = await generateAgentText(prompt.user, {
        system: prompt.system,
        request,
        abortSignal: request.signal,
        maxOutputTokens: 4_000
      })
      const json = extractJsonText(result.text)
      if (new TextEncoder().encode(json).byteLength > MAX_OPTIMIZATION_PLAN_OUTPUT_BYTES) {
        throw new AgentOutputError('AI_OUTPUT_TOO_LARGE')
      }

      const plan = prepareOptimizationPlan({
        sourceDraftId: input.data.sourceDraftId,
        targetJobId: input.data.targetJobId,
        requirements: input.data.requirements,
        requirementMatches: input.data.requirementMatches,
        careerFacts: input.data.careerFacts
      }, JSON.parse(json))
      return Response.json({ plan, model: result.model })
    } catch (error) {
      if (error instanceof AgentOutputError) return apiErrorResponse(error.code, 502)
      if (error instanceof OptimizationPlanPreparationError) {
        return apiErrorResponse('AI_OUTPUT_INVALID', 502)
      }
      return createAgentErrorResponse(error)
    }
  }
}

export const POST = createResumePlanRoute()
