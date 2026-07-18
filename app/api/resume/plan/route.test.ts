import { beforeEach, describe, expect, it, vi } from 'vitest'

const agentMocks = vi.hoisted(() => ({ generateAgentText: vi.fn() }))
vi.mock('@/lib/agent/openai', () => ({
  generateAgentText: agentMocks.generateAgentText,
  createAgentErrorResponse: () => Response.json({
    error: 'AI service is temporarily unavailable.',
    code: 'AI_UNAVAILABLE'
  }, { status: 502 })
}))

import { FixedWindowRateLimiter, createAiRequestGuard } from '@/lib/server/request-guard'
import { createResumePlanRoute } from './route'

const requirement = {
  id: 'requirement-1', jobId: 'job-1', text: 'Build reliable TypeScript platforms',
  category: 'skill', priority: 'must', weight: 4, keywords: ['TypeScript'], userConfirmed: true
}

const careerFact = {
  id: 'fact-1', kind: 'experience', text: 'Built a reliable TypeScript platform',
  evidenceRefs: ['source-1'], verification: 'user-confirmed', tags: ['typescript'],
  createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z'
}

const validRequest = {
  locale: 'en',
  instruction: 'Emphasize job-relevant evidence',
  sourceDraftId: 'draft-1',
  targetJobId: 'job-1',
  requirements: [requirement],
  requirementMatches: [{
    requirementId: 'requirement-1', factIds: ['fact-1'], status: 'direct',
    rationale: 'The career fact directly supports the requirement.'
  }],
  careerFacts: [careerFact]
}

const validPlan = {
  id: 'plan-1',
  summary: 'Emphasize the strongest evidence.',
  items: [{
    id: 'item-1', requirementIds: ['requirement-1'], factIds: ['fact-1'],
    intent: 'Surface verified TypeScript platform ownership.', transformation: 'emphasize'
  }]
}

function request(body: unknown) {
  return new Request('http://localhost/api/resume/plan', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

describe('POST /api/resume/plan', () => {
  let post: ReturnType<typeof createResumePlanRoute>

  beforeEach(() => {
    post = createResumePlanRoute({
      guard: createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter() })
    })
    agentMocks.generateAgentText.mockReset().mockResolvedValue({
      model: 'test-model',
      text: JSON.stringify(validPlan)
    })
  })

  it('returns only a validated unapproved plan and model without persistence', async () => {
    const response = await post(request(validRequest))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ plan: validPlan, model: 'test-model' })
    const [user, options] = agentMocks.generateAgentText.mock.calls[0]
    expect(JSON.parse(user)).toEqual({
      instruction: validRequest.instruction,
      requirements: [{
        id: requirement.id, text: requirement.text, priority: requirement.priority
      }],
      requirementMatches: [{
        requirementId: 'requirement-1', factIds: ['fact-1'], status: 'direct'
      }],
      careerFacts: [{
        id: careerFact.id, text: careerFact.text, verification: careerFact.verification
      }]
    })
    expect(options).toEqual(expect.objectContaining({
      abortSignal: expect.any(AbortSignal),
      maxOutputTokens: 4_000
    }))
    expect(options.system).toMatch(/optimization plan only/i)
    expect(options.system).toMatch(/do not calculate.*scores/i)
  })

  it('does not send unmatched requirements or career facts to the provider', async () => {
    const response = await post(request({
      ...validRequest,
      requirements: [requirement, {
        ...requirement, id: 'requirement-private', text: 'Private requirement'
      }],
      careerFacts: [careerFact, {
        ...careerFact, id: 'fact-private', text: 'Private career detail'
      }]
    }))

    expect(response.status).toBe(200)
    const providerUser = agentMocks.generateAgentText.mock.calls[0][0]
    expect(providerUser).not.toContain('requirement-private')
    expect(providerUser).not.toContain('Private requirement')
    expect(providerUser).not.toContain('fact-private')
    expect(providerUser).not.toContain('Private career detail')
  })

  it.each([
    [{ ...validRequest, locale: 'fr' }],
    [{ ...validRequest, instruction: 'x'.repeat(4_001) }],
    [{ ...validRequest, unexpected: true }],
    [{ ...validRequest, requirements: [{ ...requirement, jobId: 'other-job' }] }],
    [{
      ...validRequest,
      requirements: [requirement, {
        ...requirement, id: 'requirement-unmatched', jobId: 'other-job'
      }]
    }],
    [{ ...validRequest, requirementMatches: [{ ...validRequest.requirementMatches[0], requirementId: 'unknown' }] }],
    [{ ...validRequest, careerFacts: [] }]
  ])('rejects invalid or cross-context request data before provider work', async (body) => {
    const response = await post(request(body))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_REQUEST')
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it.each([
    { ...validPlan, score: 92 },
    { ...validPlan, approvedAt: '2026-07-16T00:00:00.000Z' },
    { ...validPlan, items: [{ ...validPlan.items[0], requirementIds: ['unknown'] }] },
    { ...validPlan, items: [{ ...validPlan.items[0], factIds: ['unknown'] }] },
    { ...validPlan, items: [{ ...validPlan.items[0], factIds: [], transformation: 'add-from-fact' }] }
  ])('rejects model output that escapes the plan/evidence boundary', async (modelPlan) => {
    agentMocks.generateAgentText.mockResolvedValueOnce({
      model: 'test-model',
      text: JSON.stringify(modelPlan)
    })

    const response = await post(request(validRequest))
    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('AI_OUTPUT_INVALID')
  })

  it('rejects malformed and oversized model output with stable errors', async () => {
    agentMocks.generateAgentText.mockResolvedValueOnce({ model: 'test-model', text: 'not json' })
    const malformed = await post(request(validRequest))
    expect(malformed.status).toBe(502)
    expect((await malformed.json()).code).toBe('AI_OUTPUT_INVALID')

    agentMocks.generateAgentText.mockResolvedValueOnce({
      model: 'test-model',
      text: '{"id":"plan-1","id":"plan-2","summary":"Unsafe collision","items":[]}'
    })
    const duplicate = await post(request(validRequest))
    expect(duplicate.status).toBe(502)
    expect((await duplicate.json()).code).toBe('AI_OUTPUT_INVALID')

    agentMocks.generateAgentText.mockResolvedValueOnce({ model: 'test-model', text: 'x'.repeat(80_001) })
    const large = await post(request(validRequest))
    expect(large.status).toBe(502)
    expect((await large.json()).code).toBe('AI_OUTPUT_TOO_LARGE')
  })

  it('uses the resume-plan guard bucket before provider work', async () => {
    const limitedPost = createResumePlanRoute({
      guard: createAiRequestGuard({
        localOnly: true,
        limiter: new FixedWindowRateLimiter(),
        now: () => 4_000
      }),
      rateLimit: { limit: 1, windowMs: 4_000 }
    })

    expect((await limitedPost(request(validRequest))).status).toBe(200)
    const response = await limitedPost(request(validRequest))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('4')
    expect(agentMocks.generateAgentText).toHaveBeenCalledTimes(1)
  })

  it('rejects cross-origin requests before provider work', async () => {
    const response = await post(new Request('http://localhost/api/resume/plan', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify(validRequest)
    }))

    expect(response.status).toBe(403)
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it('rejects an omitted-length chunked body beyond the route budget', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"instruction":"'))
        controller.enqueue(encoder.encode('x'.repeat(256_001)))
        controller.enqueue(encoder.encode('"}'))
        controller.close()
      }
    })
    const response = await post(new Request('http://localhost/api/resume/plan', {
      method: 'POST', body, duplex: 'half'
    } as RequestInit))

    expect(response.status).toBe(413)
    expect((await response.json()).code).toBe('PAYLOAD_TOO_LARGE')
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })
})
