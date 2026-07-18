import { beforeEach, describe, expect, it, vi } from 'vitest'

const agentMocks = vi.hoisted(() => ({ generateAgentText: vi.fn() }))
vi.mock('@/lib/agent/openai', () => ({
  generateAgentText: agentMocks.generateAgentText,
  createAgentErrorResponse: () => Response.json({ error: 'AI service is temporarily unavailable.', code: 'AI_UNAVAILABLE' }, { status: 502 })
}))

import { FixedWindowRateLimiter, createAiRequestGuard } from '@/lib/server/request-guard'
import { createJdMatchRoute } from './route'

let post: ReturnType<typeof createJdMatchRoute>

const structuredReport = {
  jobTitle: 'Staff Platform Engineer',
  company: 'Example Co',
  requirements: [{
    text: 'TypeScript platform ownership', category: 'skill',
    priority: 'must', weight: 5, keywords: ['TypeScript']
  }, {
    text: 'Agent workflow exposure', category: 'experience',
    priority: 'preferred', weight: 3, keywords: ['agent']
  }, {
    text: 'Production operations ownership', category: 'responsibility',
    priority: 'signal', weight: 1, keywords: ['operations']
  }],
  resumeEmphasis: ['Highlight platform delivery'],
  interviewPrep: ['Prepare an architecture example']
}

beforeEach(() => {
  post = createJdMatchRoute({ guard: createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter() }) })
  agentMocks.generateAgentText.mockReset().mockResolvedValue({ text: JSON.stringify(structuredReport), model: 'test-model' })
})

describe('POST /api/jd-match', () => {
  it('uses an optional normalized active resume in the JD prompt', async () => {
    const resume = {
      profile: { name: 'Custom Candidate', title: 'Engineer', summary: [], tags: [], links: [] },
      skills: [], experiences: [], projects: [], education: [], certifications: [], awards: [], languages: [], openSource: [],
      metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-13T00:00:00.000Z' }
    }
    const response = await post(new Request('http://localhost/api/jd-match', {
      method: 'POST', body: JSON.stringify({ locale: 'en', jd: 'Platform role', resume })
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.sections).toEqual(structuredReport)
    expect(body.report).toContain('## Job Requirements')
    expect(body.report).toContain('TypeScript platform ownership')
    expect(body.report).not.toContain('Match Score')
    expect(body.targetJob).toMatchObject({ title: 'Staff Platform Engineer', company: 'Example Co', description: 'Platform role', locale: 'en' })
    expect(body.matrix.matches.map(({ status, factIds }: { status: string; factIds: string[] }) => ({ status, factIds }))).toEqual([
      { status: 'gap', factIds: [] },
      { status: 'gap', factIds: [] },
      { status: 'gap', factIds: [] }
    ])
    expect(body.score).toMatchObject({ requirementCoverage: 0, evidenceCompleteness: 0 })
    expect(body.structureScore).toMatchObject({
      rubricVersion: 'resume-os-structure-v1',
      score: 15
    })
    expect(agentMocks.generateAgentText.mock.calls[0][0]).toContain('Platform role')
    expect(agentMocks.generateAgentText.mock.calls[0][0]).not.toContain('Custom Candidate')
    expect(agentMocks.generateAgentText.mock.calls[0][1]).toEqual(expect.objectContaining({
      abortSignal: expect.any(AbortSignal), maxOutputTokens: 3_000
    }))
    expect(agentMocks.generateAgentText.mock.calls[0][1].system).toContain('Return exactly one JSON object')
    expect(agentMocks.generateAgentText.mock.calls[0][1].system).toContain('generate a match score')
  })

  it('returns AI_OUTPUT_INVALID for malformed, missing, or duplicate structured output', async () => {
    const makeRequest = () => new Request('http://localhost/api/jd-match', {
      method: 'POST', body: JSON.stringify({ locale: 'en', jd: 'Platform role' })
    })

    agentMocks.generateAgentText.mockResolvedValueOnce({ text: 'Report', model: 'test-model' })
    const malformed = await post(makeRequest())
    expect(malformed.status).toBe(502)
    expect((await malformed.json()).code).toBe('AI_OUTPUT_INVALID')

    const { interviewPrep: _missing, ...missing } = structuredReport
    agentMocks.generateAgentText.mockResolvedValueOnce({ text: JSON.stringify(missing), model: 'test-model' })
    const absent = await post(makeRequest())
    expect(absent.status).toBe(502)
    expect((await absent.json()).code).toBe('AI_OUTPUT_INVALID')

    agentMocks.generateAgentText.mockResolvedValueOnce({
      text: `{"jobTitle":"Engineer","jobTitle":"Manager","company":"","requirements":[{"text":"Own systems","category":"responsibility","priority":"must","weight":5,"keywords":[]}],"resumeEmphasis":[],"interviewPrep":[]}`,
      model: 'test-model'
    })
    const duplicate = await post(makeRequest())
    expect(duplicate.status).toBe(502)
    expect((await duplicate.json()).code).toBe('AI_OUTPUT_INVALID')
  })

  it('rejects an invalid provided resume instead of falling back to sample data', async () => {
    const response = await post(new Request('http://localhost/api/jd-match', {
      method: 'POST', body: JSON.stringify({ locale: 'en', jd: 'Platform role', resume: { profile: null } })
    }))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_REQUEST')
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it('rejects cross-origin requests before provider work', async () => {
    const response = await post(new Request('http://localhost/api/jd-match', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ locale: 'en', jd: 'role' })
    }))
    expect(response.status).toBe(403)
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it('returns a stable validation code', async () => {
    const response = await post(new Request('http://localhost/api/jd-match', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_REQUEST')
  })

  it('rejects omitted-length chunked JSON beyond the route budget', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"jd":"'))
        controller.enqueue(encoder.encode('x'.repeat(128_001)))
        controller.enqueue(encoder.encode('"}'))
        controller.close()
      }
    })
    const response = await post(new Request('http://localhost/api/jd-match', {
      method: 'POST', body, duplex: 'half'
    } as RequestInit))

    expect(response.status).toBe(413)
    expect((await response.json()).code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('exercises the JD rate bucket with an isolated limiter', async () => {
    const limitedPost = createJdMatchRoute({
      guard: createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter(), now: () => 4_000 }),
      rateLimit: { limit: 1, windowMs: 4_000 }
    })
    const makeRequest = () => new Request('http://localhost/api/jd-match', {
      method: 'POST', body: JSON.stringify({ locale: 'en', jd: 'role' })
    })

    expect((await limitedPost(makeRequest())).status).toBe(200)
    const response = await limitedPost(makeRequest())
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('4')
  })
})
