import { z } from 'zod'
import { NoObjectGeneratedError } from 'ai'
import { createAgentErrorResponse, generateAgentText, streamAgentObject } from '@/lib/agent/openai'
import { AgentOutputError, parseResumeJson } from '@/lib/agent/json'
import { buildGenerateResumePrompt } from '@/lib/agent/resume-prompts'
import {
  resumeTaskOutputSchema,
  validateDemoResumeTaskOutput
} from '@/lib/agent/resume-tasks'
import { resumeLocaleSchema } from '@/lib/resume-model'
import { apiErrorResponse, guardAiRequest, type AiRequestGuard } from '@/lib/server/request-guard'
import { readLimitedJson, requestJsonErrorResponse } from '@/lib/server/request-json'

export const MAX_GENERATE_BACKGROUND_CHARS = 10_000
export const RESUME_STREAM_INTERVAL_MS = 250
const MAX_GENERATE_BODY_BYTES = 32_000

const generateResumeRequestSchema = z.object({
  locale: resumeLocaleSchema,
  targetRole: z.string().trim().min(1).max(120),
  seniority: z.enum(['junior', 'mid', 'senior', 'lead']),
  background: z.string().trim().max(MAX_GENERATE_BACKGROUND_CHARS).optional()
}).strict()

type GenerateResumeInput = z.infer<typeof generateResumeRequestSchema>

export function createResumeGenerateRoute(dependencies: {
  guard?: AiRequestGuard
  rateLimit?: { limit: number; windowMs: number }
} = {}) {
  const guardRequest = dependencies.guard ?? guardAiRequest
  const rateLimit = dependencies.rateLimit ?? { limit: 6, windowMs: 60_000 }

  return async function resumeGenerateRoute(request: Request) {
    const guard = guardRequest(request, {
      bucket: 'resume-generate',
      ...rateLimit,
      maxBodyBytes: MAX_GENERATE_BODY_BYTES
    })
    if (guard) return guard

    let rawInput: unknown
    try {
      rawInput = await readLimitedJson(request, MAX_GENERATE_BODY_BYTES)
    } catch (error) {
      return requestJsonErrorResponse(error) ?? apiErrorResponse('INVALID_REQUEST', 400)
    }

    const input = generateResumeRequestSchema.safeParse(rawInput)
    if (!input.success) return apiErrorResponse('INVALID_REQUEST', 400)

    try {
      const prompt = buildGenerateResumePrompt(input.data)
      if (request.headers.get('Accept')?.includes('application/x-ndjson')) {
        return createResumeStream(request, input.data, prompt)
      }

      const result = await generateAgentText(prompt.user, {
        system: prompt.system,
        request,
        abortSignal: request.signal,
        maxOutputTokens: 5_000
      })
      const parsed = parseResumeJson(result.text, {
        locale: input.data.locale,
        source: 'ai-generated'
      })
      const data = validateDemoResumeTaskOutput(parsed, input.data)

      return Response.json({ data, model: result.model })
    } catch (error) {
      if (error instanceof AgentOutputError) return apiErrorResponse(error.code, 502)
      return createAgentErrorResponse(error)
    }
  }
}

function createResumeStream(
  request: Request,
  input: GenerateResumeInput,
  prompt: ReturnType<typeof buildGenerateResumePrompt>
) {
  const result = streamAgentObject(prompt.user, resumeTaskOutputSchema, {
    system: prompt.system,
    request,
    abortSignal: request.signal,
    maxOutputTokens: 5_000
  })
  const encoder = new TextEncoder()
  let closed = false
  let lastPartialSentAt = 0

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }

      send({
        type: 'start',
        model: result.model,
        data: validateDemoResumeTaskOutput({}, input)
      })
      void (async () => {
        try {
          for await (const partial of result.partialOutputStream) {
            const data = tryNormalizeGeneratedResume(partial, input)
            const now = Date.now()
            if (data && now - lastPartialSentAt >= RESUME_STREAM_INTERVAL_MS) {
              lastPartialSentAt = now
              send({ type: 'partial', data })
            }
          }

          const output = await result.output
          const data = validateDemoResumeTaskOutput(output, input)
          send({ type: 'result', data, model: result.model })
        } catch (error) {
          if (NoObjectGeneratedError.isInstance(error)) {
            try {
              const parsed = parseResumeJson(await result.text, {
                locale: input.locale,
                source: 'ai-generated'
              })
              const data = validateDemoResumeTaskOutput(parsed, input)
              send({ type: 'result', data, model: result.model })
            } catch {
              send({ type: 'error', code: 'AI_OUTPUT_INVALID' })
            }
          } else {
            const response = createAgentErrorResponse(error)
            const payload = await response.json() as { code?: string }
            send({ type: 'error', code: payload.code ?? 'AI_UNAVAILABLE' })
          }
        } finally {
          result.dispose()
          if (!closed) {
            closed = true
            controller.close()
          }
        }
      })()
    },
    cancel(reason) {
      closed = true
      result.abort(reason)
      result.dispose()
    }
  })

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'X-Accel-Buffering': 'no'
    }
  })
}

function tryNormalizeGeneratedResume(input: unknown, request: GenerateResumeInput) {
  try {
    return validateDemoResumeTaskOutput(input, request)
  } catch {
    return null
  }
}

export const POST = createResumeGenerateRoute()
