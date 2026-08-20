import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FixedWindowRateLimiter, createAiRequestGuard } from '@/lib/server/request-guard'
import { createInterviewSession } from '@/lib/jobs/interview-domain'

const agentMocks = vi.hoisted(() => ({ generateAgentText: vi.fn() }))
vi.mock('@/lib/agent/openai', () => ({
  generateAgentText: agentMocks.generateAgentText,
  createAgentErrorResponse: () => Response.json({ code: 'AI_UNAVAILABLE' }, { status: 502 })
}))

import { createInterviewReviewRoute } from './route'

const now = '2026-08-19T08:00:00.000Z'
const session = createInterviewSession({
  applicationId: 'application-1', targetJobId: 'target-1', round: 1, format: 'video', now
})
const body = {
  locale: 'zh',
  job: { title: '前端工程师', company: '示例公司', description: '负责前端架构' },
  session: { ...session, notes: '沟通顺畅，系统设计题回答不完整。' },
  questions: [{
    id: 'question-1', sessionId: session.id, question: '如何设计组件库？',
    userAnswer: '从规范和可访问性开始。', suggestedAnswer: '', feedback: '', tags: [],
    createdAt: now, updatedAt: now
  }]
}

let post: ReturnType<typeof createInterviewReviewRoute>

beforeEach(() => {
  post = createInterviewReviewRoute({
    guard: createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter() })
  })
  agentMocks.generateAgentText.mockReset().mockResolvedValue({
    model: 'test-model',
    text: JSON.stringify({
      summary: '表现有亮点但证据不足。', strengths: ['结构清楚'], gaps: ['缺少指标'],
      suggestions: ['补充权衡和结果'], prediction: {
        outcome: 'uncertain', passProbability: 0.55, confidence: 0.4, rationale: ['信息有限']
      }
    })
  })
})

describe('POST /api/interview/review', () => {
  it('returns a bounded advisory review without accepting a final result', async () => {
    const response = await post(new Request('http://localhost/api/interview/review', {
      method: 'POST', body: JSON.stringify(body)
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ model: 'test-model', output: { prediction: { outcome: 'uncertain' } } })
    expect(agentMocks.generateAgentText.mock.calls[0][1].system).toContain('Do not claim to know')
  })

  it('rejects cross-origin and invalid requests before model work', async () => {
    const crossOrigin = await post(new Request('http://localhost/api/interview/review', {
      method: 'POST', headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify(body)
    }))
    expect(crossOrigin.status).toBe(403)
    const invalid = await post(new Request('http://localhost/api/interview/review', {
      method: 'POST', body: JSON.stringify({ ...body, questions: [{ answer: 'missing question' }] })
    }))
    expect(invalid.status).toBe(400)
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it('rejects malformed model output', async () => {
    agentMocks.generateAgentText.mockResolvedValueOnce({ model: 'test-model', text: '{"summary":"x"}' })
    const response = await post(new Request('http://localhost/api/interview/review', {
      method: 'POST', body: JSON.stringify(body)
    }))
    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('AI_OUTPUT_INVALID')
  })
})
