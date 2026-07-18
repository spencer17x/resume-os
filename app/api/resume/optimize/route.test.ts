import { beforeEach, describe, expect, it, vi } from 'vitest'

const agentMocks = vi.hoisted(() => ({ generateAgentText: vi.fn() }))
vi.mock('@/lib/agent/openai', () => ({
  generateAgentText: agentMocks.generateAgentText,
  createAgentErrorResponse: () => Response.json({ error: 'AI service is temporarily unavailable.', code: 'AI_UNAVAILABLE' }, { status: 502 })
}))

import { FixedWindowRateLimiter, createAiRequestGuard } from '@/lib/server/request-guard'
import { createResumeOptimizeRoute } from './route'

const customResume = {
  profile: { name: 'Custom Candidate', title: 'Engineer', summary: ['Builds systems'], tags: [], links: [] },
  targetRole: 'AI Engineer',
  skills: [{ group: 'Core', items: ['TypeScript'] }],
  experiences: [{ company: 'Custom Co', role: 'Engineer', period: '2024', tags: [], bullets: ['Owned delivery'] }],
  projects: [], education: [], certifications: [], awards: [], languages: [], openSource: [],
  metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-13T00:00:00.000Z' }
}

const defaultWorkflowContext = {
  jd: 'Looking for platform ownership',
  requirements: [{ id: 'requirement-1', text: 'Own reliable platform delivery' }],
  requirementMatches: [{
    requirementId: 'requirement-1', factIds: ['fact-1'], status: 'direct' as const,
    rationale: 'The verified fact directly supports the requirement.'
  }],
  careerFacts: [{
    id: 'fact-1', text: 'Owned platform delivery',
    verification: 'document-backed' as const
  }],
  optimizationPlan: {
    id: 'plan-1', summary: 'Use the verified platform evidence.',
    approvedAt: '2026-07-16T08:00:00.000Z',
    items: [{
      id: 'rewrite-1', requirementIds: ['requirement-1'], factIds: ['fact-1'],
      intent: 'Rewrite platform evidence clearly.', transformation: 'rewrite' as const
    }, {
      id: 'emphasize-1', requirementIds: ['requirement-1'], factIds: ['fact-1'],
      intent: 'Emphasize platform evidence.', transformation: 'emphasize' as const
    }]
  }
}

function request(body: unknown, signal?: AbortSignal, withWorkflow = true) {
  const payload = withWorkflow && typeof body === 'object' && body !== null
    ? { ...defaultWorkflowContext, ...body }
    : body
  return new Request('http://localhost/api/resume/optimize', {
    method: 'POST', body: JSON.stringify(payload), signal
  })
}

const defaultEvidence = {
  requirementIds: ['requirement-1'],
  factIds: ['fact-1'],
  matchType: 'direct' as const,
  support: 'verified' as const,
  confidence: 0.9,
  transformation: 'rewrite' as const
}

function modelResponse(changeSet: {
  summary: string
  changes: Array<Record<string, unknown>>
  questions?: string[]
}) {
  return {
    model: 'test-model',
    text: JSON.stringify({
      ...changeSet,
      changes: changeSet.changes.map((change) => ({
        ...change,
        evidence: change.evidence ?? defaultEvidence
      }))
    })
  }
}

describe('POST /api/resume/optimize', () => {
  let post: ReturnType<typeof createResumeOptimizeRoute>

  beforeEach(() => {
    post = createResumeOptimizeRoute({
      guard: createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter() })
    })
    agentMocks.generateAgentText.mockReset().mockResolvedValue(modelResponse({
        summary: 'Clarify impact',
        changes: [{
          id: 'change-1',
          path: 'experiences.0.bullets.0',
          original: 'Owned delivery',
          proposed: 'Owned platform delivery',
          reason: 'Clearer scope',
          needsConfirmation: false
        }],
        questions: ['How many teams were involved?']
    }))
  })

  it('returns a strict validated change set and sends normalized resume context', async () => {
    const response = await post(request({
      resume: customResume,
      locale: 'en',
      instruction: 'Improve impact',
      jd: 'Looking for platform ownership'
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      model: 'test-model',
      changeSet: expect.objectContaining({ summary: 'Clarify impact' })
    }))
    const [user, options] = agentMocks.generateAgentText.mock.calls[0]
    expect(JSON.parse(user)).toEqual(expect.objectContaining({
      instruction: 'Improve impact',
      jd: 'Looking for platform ownership',
      resume: expect.objectContaining({ profile: expect.objectContaining({ name: 'Custom Candidate' }) })
    }))
    expect(options.system).toMatch(/Do not fabricate/i)
    expect(options.system).toMatch(/needsConfirmation/i)
    expect(options.system).toMatch(/must set needsConfirmation to true/i)
    expect(options.system).toMatch(/never return false/i)
    expect(options.system).toContain('experiences.0.bullets.0')
    expect(options.system).toContain('profile.links.0.url')
    expect(options.system).toContain('Never use targetRole, profile.github, or profile.blog paths.')
    expect(options.system).toMatch(/never prefix paths with resume/i)
    expect(options.system).toContain('Never return scoreImpact')
    expect(options.system).not.toContain('"scoreImpact"')
    expect(options.maxOutputTokens).toBeGreaterThan(0)
    expect(options.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('requires the exact request context and rejects oversized instructions before provider work', async () => {
    expect((await post(request({
      resume: customResume, locale: 'en', instruction: 'Improve'
    }, undefined, false))).status).toBe(400)
    expect((await post(request({ locale: 'en', instruction: 'Improve' }))).status).toBe(400)
    expect((await post(request({ resume: customResume, locale: 'fr', instruction: 'Improve' }))).status).toBe(400)
    expect((await post(request({ resume: customResume, locale: 'en', instruction: 'x'.repeat(4_001) }))).status).toBe(400)
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()
  })

  it('requires evidence metadata on new model output and verifies every referenced fact and requirement', async () => {
    agentMocks.generateAgentText.mockResolvedValueOnce({
      model: 'test-model',
      text: JSON.stringify({
        summary: 'Legacy output is not accepted from a model',
        changes: [{
          id: 'legacy', path: 'profile.summary.0', original: 'Builds systems',
          proposed: 'Builds reliable systems', reason: 'Missing evidence', needsConfirmation: true
        }], questions: []
      })
    })
    const missing = await post(request({ resume: customResume, locale: 'en', instruction: 'Improve' }))
    expect(missing.status).toBe(502)
    expect((await missing.json()).code).toBe('AI_OUTPUT_INVALID')

    const evidence = {
      requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
      support: 'verified', confidence: 0.9, transformation: 'emphasize'
    }
    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
      summary: 'Evidence-backed output',
      changes: [{
        id: 'supported', path: 'profile.summary.0', original: 'Builds systems',
        proposed: 'Builds reliable systems', reason: 'Uses verified evidence',
        needsConfirmation: false, evidence
      }], questions: []
    }))
    const supported = await post(request({
      resume: customResume, locale: 'en', instruction: 'Improve',
      requirements: [{ id: 'requirement-1', text: 'Build reliable systems' }],
      careerFacts: [{ id: 'fact-1', text: 'Builds reliable systems', verification: 'document-backed' }]
    }))
    expect(supported.status).toBe(200)
    expect((await supported.json()).changeSet.changes[0]).toMatchObject({
      needsConfirmation: true,
      evidence: { factIds: ['fact-1'], requirementIds: ['requirement-1'], support: 'verified' }
    })

    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
      summary: 'Unverified fact',
      changes: [{
        id: 'unsupported-fact', path: 'profile.summary.0', original: 'Builds systems',
        proposed: 'Builds reliable systems', reason: 'Uses an imported-only fact',
        needsConfirmation: true, evidence
      }], questions: []
    }))
    const importedOnly = await post(request({
      resume: customResume, locale: 'en', instruction: 'Improve',
      requirements: [{ id: 'requirement-1', text: 'Build reliable systems' }],
      careerFacts: [{ id: 'fact-1', text: 'Builds reliable systems', verification: 'imported' }]
    }))
    expect(importedOnly.status).toBe(400)
    expect((await importedOnly.json()).code).toBe('INVALID_REQUEST')
  })

  it('revalidates an approved plan against request evidence and rejects model changes outside it', async () => {
    const context = {
      requirements: [{ id: 'requirement-1', text: 'Build reliable systems' }],
      careerFacts: [{
        id: 'fact-1', text: 'Builds reliable systems', verification: 'document-backed' as const
      }]
    }
    const optimizationPlan = {
      id: 'plan-1', summary: 'Emphasize verified reliability work.',
      approvedAt: '2026-07-16T08:00:00.000Z',
      items: [{
        id: 'item-1', requirementIds: ['requirement-1'], factIds: ['fact-1'],
        intent: 'Make verified reliability work easier to find.',
        transformation: 'emphasize' as const
      }]
    }
    const evidence = {
      requirementIds: ['requirement-1'], factIds: ['fact-1'], matchType: 'direct',
      support: 'verified', confidence: 0.9, transformation: 'emphasize'
    }
    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
      summary: 'Follows the approved plan',
      changes: [{
        id: 'planned', path: 'profile.summary.0', original: 'Builds systems',
        proposed: 'Builds reliable systems', reason: 'Approved emphasis',
        needsConfirmation: false, evidence
      }], questions: []
    }))
    const approved = await post(request({
      resume: customResume, locale: 'en', instruction: 'Improve',
      ...context, optimizationPlan
    }))
    expect(approved.status).toBe(200)
    expect(JSON.parse(agentMocks.generateAgentText.mock.calls[0][0])).toMatchObject({
      optimizationPlan
    })

    agentMocks.generateAgentText.mockClear()
    const unapproved = await post(request({
      resume: customResume, locale: 'en', instruction: 'Improve', ...context,
      optimizationPlan: { ...optimizationPlan, approvedAt: undefined }
    }))
    expect(unapproved.status).toBe(400)
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()

    const unknownFact = await post(request({
      resume: customResume, locale: 'en', instruction: 'Improve', ...context,
      optimizationPlan: {
        ...optimizationPlan,
        items: [{ ...optimizationPlan.items[0], factIds: ['fact-unknown'] }]
      }
    }))
    expect(unknownFact.status).toBe(400)
    expect(agentMocks.generateAgentText).not.toHaveBeenCalled()

    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
      summary: 'Leaves the plan',
      changes: [{
        id: 'unplanned', path: 'profile.summary.0', original: 'Builds systems',
        proposed: 'Builds reliable systems', reason: 'Wrong operation',
        needsConfirmation: true,
        evidence: { ...evidence, transformation: 'rewrite' }
      }], questions: []
    }))
    const outsidePlan = await post(request({
      resume: customResume, locale: 'en', instruction: 'Improve',
      ...context, optimizationPlan
    }))
    expect(outsidePlan.status).toBe(502)
    expect((await outsidePlan.json()).code).toBe('AI_OUTPUT_INVALID')
  })

  it('rejects model evidence that overstates the persisted requirement-match status', async () => {
    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
      summary: 'Overstates a partial match',
      changes: [{
        id: 'overstated', path: 'experiences.0.bullets.0', original: 'Owned delivery',
        proposed: 'Owned reliable platform delivery', reason: 'Claims direct support',
        needsConfirmation: true, evidence: defaultEvidence
      }], questions: []
    }))

    const response = await post(request({
      resume: customResume, locale: 'en', instruction: 'Improve',
      requirementMatches: [{
        ...defaultWorkflowContext.requirementMatches[0], status: 'partial'
      }]
    }))

    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('AI_OUTPUT_INVALID')
  })

  it('rejects scoreImpact in new model output', async () => {
    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
      summary: 'Model-authored score',
      changes: [{
        id: 'scored', path: 'experiences.0.bullets.0', original: 'Owned delivery',
        proposed: 'Owned platform delivery', reason: 'Adds a model score',
        needsConfirmation: true, evidence: { ...defaultEvidence, scoreImpact: 8 }
      }], questions: []
    }))

    const response = await post(request({
      resume: customResume, locale: 'en', instruction: 'Improve'
    }))

    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('AI_OUTPUT_INVALID')
  })

  it('rejects unsafe, duplicate, and oversized model change sets with stable errors', async () => {
    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
        summary: 'Unsafe',
        changes: [{ id: 'x', path: '__proto__.polluted', original: null, proposed: 'yes', reason: 'bad' }]
    }))
    const unsafe = await post(request({ resume: customResume, locale: 'en', instruction: 'Improve' }))
    expect(unsafe.status).toBe(502)
    expect((await unsafe.json()).code).toBe('AI_OUTPUT_INVALID')

    agentMocks.generateAgentText.mockResolvedValueOnce({ model: 'test-model', text: 'x'.repeat(80_001) })
    const large = await post(request({ resume: customResume, locale: 'en', instruction: 'Improve' }))
    expect(large.status).toBe(502)
    expect((await large.json()).code).toBe('AI_OUTPUT_TOO_LARGE')
  })

  it('rejects model changes that cannot be safely applied to the supplied resume', async () => {
    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
        summary: 'Stale original',
        changes: [{
          id: 'stale-1', path: 'profile.title', original: 'Different title',
          proposed: 'Platform Engineer', reason: 'Mismatch', needsConfirmation: false
        }], questions: []
    }))
    const stale = await post(request({ resume: customResume, locale: 'en', instruction: 'Improve' }))
    expect(stale.status).toBe(502)
    expect((await stale.json()).code).toBe('AI_OUTPUT_INVALID')

    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
        summary: 'Wrong type',
        changes: [{
          id: 'type-1', path: 'profile.title', original: 'Engineer',
          proposed: { value: 'Platform Engineer' }, reason: 'Invalid type', needsConfirmation: false
        }], questions: []
    }))
    const wrongType = await post(request({ resume: customResume, locale: 'en', instruction: 'Improve' }))
    expect(wrongType.status).toBe(502)
    expect((await wrongType.json()).code).toBe('AI_OUTPUT_INVALID')

    const aliasedResume = {
      ...customResume,
      profile: {
        ...customResume.profile,
        github: 'https://github.com/custom',
        links: [{ label: 'GitHub', url: 'https://github.com/custom' }]
      }
    }
    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
        summary: 'Hidden link creation',
        changes: [{
          id: 'link-1', path: 'profile.links.0.url', original: 'https://github.com/custom',
          proposed: 'https://github.com/new', reason: 'Update URL', needsConfirmation: false
        }], questions: []
    }))
    const hidden = await post(request({ resume: aliasedResume, locale: 'en', instruction: 'Improve' }))
    expect(hidden.status).toBe(502)
    expect((await hidden.json()).code).toBe('AI_OUTPUT_INVALID')
  })

  it('blocks unsupported quantitative claims while allowing a fact-backed metric rewrite', async () => {
    const yearResume = {
      ...customResume,
      experiences: [{ ...customResume.experiences[0], bullets: ['Worked on the platform since 2024'] }]
    }
    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
        summary: 'Misused year',
        changes: [{
          id: 'metric-1', path: 'experiences.0.bullets.0', original: 'Worked on the platform since 2024',
          proposed: 'Led 2024 engineers', reason: 'Adds unsupported scope', needsConfirmation: false
        }], questions: []
    }))
    const year = await post(request({ resume: yearResume, locale: 'en', instruction: 'Improve' }))
    expect(year.status).toBe(502)
    expect((await year.json()).code).toBe('AI_OUTPUT_INVALID')

    const existingMetricResume = {
      ...customResume,
      experiences: [{ ...customResume.experiences[0], bullets: ['Improved latency by 24%'] }]
    }
    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
        summary: 'Preserve verified metric',
        changes: [{
          id: 'metric-2', path: 'experiences.0.bullets.0', original: 'Improved latency by 24%',
          proposed: 'Reduced latency by 24%', reason: 'Clearer wording', needsConfirmation: false
        }], questions: []
    }))
    const existing = await post(request({
      resume: existingMetricResume, locale: 'en', instruction: 'Improve',
      careerFacts: [{
        id: 'fact-1', text: 'Reduced latency by 24%', verification: 'document-backed'
      }]
    }))
    expect(existing.status).toBe(200)
    expect((await existing.json()).changeSet.changes[0].needsConfirmation).toBe(true)

    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
        summary: 'Word metric',
        changes: [{
          id: 'metric-3', path: 'experiences.0.bullets.0', original: 'Owned delivery',
          proposed: 'Led twenty engineers', reason: 'Adds a team size', needsConfirmation: false
        }], questions: []
    }))
    const numberWord = await post(request({ resume: customResume, locale: 'en', instruction: 'Improve' }))
    expect(numberWord.status).toBe(502)
    expect((await numberWord.json()).code).toBe('AI_OUTPUT_INVALID')

    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
        summary: 'Keep model confirmation',
        changes: [{
          id: 'confirm-1', path: 'profile.title', original: 'Engineer',
          proposed: 'Platform Engineer', reason: 'Needs verification', needsConfirmation: true
        }], questions: []
    }))
    const confirmed = await post(request({
      resume: customResume, locale: 'en', instruction: 'Improve',
      careerFacts: [{
        id: 'fact-1', text: 'Platform Engineer', verification: 'document-backed'
      }]
    }))
    expect(confirmed.status).toBe(200)
    expect((await confirmed.json()).changeSet.changes[0].needsConfirmation).toBe(true)
  })

  it.each([
    'Led dozens of engineers',
    'Supported hundreds of customers',
    'Doubled platform throughput',
    'Tripled release frequency',
    'Cut latency by half',
    'Delivered a quarter of roadmap items',
    'Won first place',
    'Reached the second milestone',
    'Achieved tenfold growth',
    'Achieved x-fold growth',
    'Improved delivery by thirty percent',
    '推动交付效率翻倍',
    '将故障时间减半',
    '获得第一名',
    '支持数十个团队',
    '服务上百家客户'
  ])('blocks unsupported quantitative wording: %s', async (proposed) => {
    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
        summary: 'Quantitative title wording',
        changes: [{
          id: 'quantitative-title', path: 'profile.title', original: 'Engineer',
          proposed, reason: 'Adds quantitative wording', needsConfirmation: false
        }], questions: []
    }))

    const response = await post(request({ resume: customResume, locale: 'en', instruction: 'Improve' }))
    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('AI_OUTPUT_INVALID')
  })

  it.each([
    ['profile.summary.0', 'Builds systems', 'Leads reliable platform delivery'],
    ['experiences.0.bullets.0', 'Owned delivery', 'Led platform delivery'],
    ['projects.0.summary', 'Built platform', 'Led platform modernization'],
    ['projects.0.highlights.0', 'Shipped workflows', 'Improved critical workflows'],
    ['education.0.details.0', 'Studied systems', 'Led systems research'],
    ['awards.0', 'Engineering award', 'Recognized for engineering impact'],
    ['certifications.0', 'Cloud certification', 'Advanced cloud certification'],
    ['openSource.0', 'Maintained library', 'Led library maintenance']
  ])('blocks unsupported narrative claim path %s without explicit quantities', async (path, original, proposed) => {
    const claimResume = {
      ...customResume,
      profile: { ...customResume.profile, summary: ['Builds systems'] },
      projects: [{ name: 'Platform', type: 'Work', summary: 'Built platform', tags: [], highlights: ['Shipped workflows'] }],
      education: [{ school: 'University', details: ['Studied systems'] }],
      awards: ['Engineering award'],
      certifications: ['Cloud certification'],
      openSource: ['Maintained library']
    }
    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
        summary: 'Narrative claim',
        changes: [{ id: 'claim', path, original, proposed, reason: 'Strengthens the claim', needsConfirmation: false }],
        questions: []
    }))

    const response = await post(request({ resume: claimResume, locale: 'en', instruction: 'Improve' }))
    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('AI_OUTPUT_INVALID')
  })

  it('blocks unsupported role, skill, degree, and language claims', async () => {
    const resume = {
      ...customResume,
      education: [{ school: 'Example University', degree: 'BS', details: [] }],
      languages: ['English']
    }
    agentMocks.generateAgentText.mockResolvedValueOnce(modelResponse({
        summary: 'Four edits',
        changes: [
          { id: 'title', path: 'profile.title', original: 'Engineer', proposed: 'Platform Engineer', reason: 'Clarifies role', needsConfirmation: false },
          { id: 'skill', path: 'skills.0.group', original: 'Core', proposed: 'Platform Engineering', reason: 'Clarifies group', needsConfirmation: false },
          { id: 'degree', path: 'education.0.degree', original: 'BS', proposed: 'Bachelor of Science', reason: 'Expands degree', needsConfirmation: false },
          { id: 'language', path: 'languages.0', original: 'English', proposed: 'Professional English', reason: 'Clarifies proficiency', needsConfirmation: false }
        ], questions: []
    }))

    const response = await post(request({ resume, locale: 'en', instruction: 'Improve' }))
    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('AI_OUTPUT_INVALID')
  })

  it('enforces the isolated optimize rate bucket and Retry-After', async () => {
    const limited = createResumeOptimizeRoute({
      guard: createAiRequestGuard({ localOnly: true, limiter: new FixedWindowRateLimiter(), now: () => 5_000 }),
      rateLimit: { limit: 1, windowMs: 6_000 }
    })
    const body = { resume: customResume, locale: 'en', instruction: 'Improve' }
    expect((await limited(request(body))).status).toBe(200)
    const response = await limited(request(body))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('6')
  })
})
