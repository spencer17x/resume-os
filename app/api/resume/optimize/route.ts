import { z } from 'zod'
import { AgentOutputError, extractJsonText } from '@/lib/agent/json'
import {
  MAX_RESUME_CHANGE_SET_BYTES,
  ResumeChangeSetError,
  isResumeChangeApplicable,
  parseModelResumeChangeSet,
  requireResumeChangeConfirmation,
  validateResumeChangeCandidates,
  validateResumeChangeEvidence,
  validateResumeChangesAgainstApprovedPlan,
  validateResumeChanges,
} from '@/lib/agent/resume-change-set'
import { createAgentErrorResponse, generateAgentText } from '@/lib/agent/openai'
import { buildOptimizeResumePrompt } from '@/lib/agent/resume-prompts'
import { normalizeResumeData, resumeLocaleSchema } from '@/lib/resume-model'
import { optimizationPlanSchema } from '@/lib/agent/optimization-run'
import { requirementMatchSchema } from '@/lib/agent/requirement-matrix'
import { apiErrorResponse, guardAiRequest, type AiRequestGuard } from '@/lib/server/request-guard'
import { readLimitedJson, requestJsonErrorResponse } from '@/lib/server/request-json'

const MAX_OPTIMIZE_BODY_BYTES = 160_000

const stableIdSchema = z.string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim())

const optimizeRequirementSchema = z.object({
  id: stableIdSchema,
  text: z.string().trim().min(1).max(2_000)
}).strict()

const optimizeCareerFactSchema = z.object({
  id: stableIdSchema,
  text: z.string().trim().min(1).max(20_000),
  verification: z.enum(['imported', 'user-confirmed', 'document-backed'])
}).strict()

const optimizeRequestSchema = z.object({
  resume: z.unknown(),
  locale: resumeLocaleSchema,
  instruction: z.string().trim().min(1).max(4_000),
  jd: z.string().trim().min(1).max(50_000),
  requirements: z.array(optimizeRequirementSchema).min(1).max(250),
  requirementMatches: z.array(requirementMatchSchema).min(1).max(250),
  careerFacts: z.array(optimizeCareerFactSchema).max(500).default([]),
  optimizationPlan: optimizationPlanSchema
}).strict()

export function createResumeOptimizeRoute(dependencies: {
  guard?: AiRequestGuard
  rateLimit?: { limit: number; windowMs: number }
} = {}) {
  const guardRequest = dependencies.guard ?? guardAiRequest
  const rateLimit = dependencies.rateLimit ?? { limit: 8, windowMs: 60_000 }

  return async function resumeOptimizeRoute(request: Request) {
    const guard = guardRequest(request, {
      bucket: 'resume-optimize',
      ...rateLimit,
      maxBodyBytes: MAX_OPTIMIZE_BODY_BYTES
    })
    if (guard) return guard

    let rawInput: unknown
    try {
      rawInput = await readLimitedJson(request, MAX_OPTIMIZE_BODY_BYTES)
    } catch (error) {
      return requestJsonErrorResponse(error) ?? apiErrorResponse('INVALID_REQUEST', 400)
    }

    const input = optimizeRequestSchema.safeParse(rawInput)
    if (!input.success) return apiErrorResponse('INVALID_REQUEST', 400)
    if (
      !approvedPlanMatchesRequestContext(
        input.data.optimizationPlan,
        input.data.requirements,
        input.data.requirementMatches,
        input.data.careerFacts
      )
    ) {
      return apiErrorResponse('INVALID_REQUEST', 400)
    }

    let resume
    try {
      resume = normalizeResumeData(input.data.resume, { locale: input.data.locale })
      if (new TextEncoder().encode(JSON.stringify(resume)).byteLength > 60_000) {
        return apiErrorResponse('PAYLOAD_TOO_LARGE', 413)
      }
    } catch {
      return apiErrorResponse('INVALID_REQUEST', 400)
    }

    try {
      const prompt = buildOptimizeResumePrompt({ ...input.data, resume })
      const result = await generateAgentText(prompt.user, {
        system: prompt.system,
        request,
        abortSignal: request.signal,
        maxOutputTokens: 5_000
      })
      const json = extractJsonText(result.text)
      if (new TextEncoder().encode(json).byteLength > MAX_RESUME_CHANGE_SET_BYTES) {
        throw new AgentOutputError('AI_OUTPUT_TOO_LARGE')
      }
      const changeSet = requireResumeChangeConfirmation(
        parseModelResumeChangeSet(JSON.parse(json))
      )
      validateResumeChangesAgainstApprovedPlan(
        changeSet,
        input.data.optimizationPlan,
        input.data.requirementMatches
      )
      validateResumeChangeCandidates(resume, changeSet)
      validateResumeChangeEvidence(changeSet, {
        facts: input.data.careerFacts,
        requirements: input.data.requirements
      })
      validateResumeChanges(
        resume,
        changeSet,
        changeSet.changes.filter(isResumeChangeApplicable).map(({ id }) => id),
        { facts: input.data.careerFacts, requirements: input.data.requirements }
      )
      return Response.json({ changeSet, model: result.model })
    } catch (error) {
      if (error instanceof AgentOutputError) return apiErrorResponse(error.code, 502)
      if (error instanceof ResumeChangeSetError) {
        const code = error.code === 'CHANGE_SET_TOO_LARGE' ? 'AI_OUTPUT_TOO_LARGE' : 'AI_OUTPUT_INVALID'
        return apiErrorResponse(code, 502)
      }
      return createAgentErrorResponse(error)
    }
  }
}

function approvedPlanMatchesRequestContext(
  plan: z.infer<typeof optimizationPlanSchema>,
  requirements: Array<z.infer<typeof optimizeRequirementSchema>>,
  requirementMatches: Array<z.infer<typeof requirementMatchSchema>>,
  careerFacts: Array<z.infer<typeof optimizeCareerFactSchema>>
) {
  if (!plan.approvedAt) return false
  const requirementIds = new Set(requirements.map(({ id }) => id))
  const factsById = new Map(careerFacts.map((fact) => [fact.id, fact]))
  const matchesByRequirement = new Map(
    requirementMatches.map((match) => [match.requirementId, match])
  )
  if (
    requirementMatches.some((match) => (
      !requirementIds.has(match.requirementId)
      || match.factIds.some((id) => !factsById.has(id))
    ))
  ) return false
  return plan.items.every((item) => (
    item.requirementIds.every((id) => requirementIds.has(id))
    && item.factIds.every((id) => {
      const fact = factsById.get(id)
      const linkedToPlannedRequirement = item.requirementIds.some(
        (requirementId) => matchesByRequirement.get(requirementId)?.factIds.includes(id)
      )
      return linkedToPlannedRequirement && (fact?.verification === 'document-backed'
        || fact?.verification === 'user-confirmed'
      )
    })
  ))
}

export const POST = createResumeOptimizeRoute()
