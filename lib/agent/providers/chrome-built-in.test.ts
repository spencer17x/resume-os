import { describe, expect, it, vi } from 'vitest'
import {
  CHROME_BUILT_IN_MODEL,
  CHROME_BUILT_IN_PROVIDER,
  ChromeBuiltInAiProvider,
  normalizeChromeAvailability,
  type ChromeLanguageModelApi,
  type ChromeLanguageModelSession
} from './chrome-built-in'
import type { ResumeAgentTask } from './types'

const task: ResumeAgentTask = {
  kind: 'extract-job-requirements',
  expectedInputLanguages: ['en'],
  expectedOutputLanguages: ['en']
}

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['requirements'],
  properties: {
    requirements: { type: 'array' }
  }
}

function createSession(overrides: Partial<ChromeLanguageModelSession> = {}) {
  return {
    contextUsage: 20,
    contextWindow: 1_000,
    measureContextUsage: vi.fn().mockResolvedValue(100),
    prompt: vi.fn().mockResolvedValue('{"requirements":[]}'),
    destroy: vi.fn(),
    ...overrides
  } satisfies ChromeLanguageModelSession
}

function createLanguageModel(
  session: ChromeLanguageModelSession,
  availability: unknown = 'available'
) {
  return {
    availability: vi.fn().mockResolvedValue(availability),
    create: vi.fn().mockResolvedValue(session)
  } satisfies ChromeLanguageModelApi
}

describe('Chrome Built-in AI provider', () => {
  it.each([
    ['available', 'available'],
    ['readily', 'available'],
    ['downloadable', 'downloadable'],
    ['after-download', 'downloadable'],
    ['downloading', 'downloading'],
    ['unavailable', 'unavailable'],
    ['no', 'unavailable'],
    ['unknown', 'unavailable']
  ] as const)('normalizes %s availability to %s', (raw, normalized) => {
    expect(normalizeChromeAvailability(raw)).toBe(normalized)
  })

  it('returns unavailable when the browser does not expose LanguageModel', async () => {
    const provider = new ChromeBuiltInAiProvider({
      hasUserActivation: () => false
    })

    await expect(provider.availability(task)).resolves.toBe('unavailable')
  })

  it('uses explicit languages, structured output, caller validation, and destroys the session', async () => {
    const session = createSession()
    const languageModel = createLanguageModel(session)
    const validate = vi.fn((value: unknown) => value as { requirements: unknown[] })
    const controller = new AbortController()
    const provider = new ChromeBuiltInAiProvider({ languageModel })

    const result = await provider.runStructuredTask({
      task,
      system: 'Return only supported job requirements.',
      prompt: 'Senior frontend engineer job description',
      jsonSchema: schema,
      validate,
      signal: controller.signal
    })

    const expectedLanguages = {
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }]
    }
    expect(languageModel.availability).toHaveBeenCalledWith(expectedLanguages)
    expect(languageModel.create).toHaveBeenCalledWith({
      ...expectedLanguages,
      initialPrompts: [{
        role: 'system',
        content: 'Return only supported job requirements.'
      }],
      signal: controller.signal
    })
    expect(session.measureContextUsage).toHaveBeenCalledWith(
      'Senior frontend engineer job description',
      { responseConstraint: schema, signal: controller.signal }
    )
    expect(session.prompt).toHaveBeenCalledWith(
      'Senior frontend engineer job description',
      { responseConstraint: schema, signal: controller.signal }
    )
    expect(validate).toHaveBeenCalledWith({ requirements: [] })
    expect(result).toEqual({
      value: { requirements: [] },
      provider: CHROME_BUILT_IN_PROVIDER,
      model: CHROME_BUILT_IN_MODEL
    })
    expect(session.destroy).toHaveBeenCalledOnce()
  })

  it('runs an explicitly opted-in language without declaring unsupported capabilities', async () => {
    const session = createSession()
    const languageModel = createLanguageModel(session)
    const provider = new ChromeBuiltInAiProvider({ languageModel })
    const bestEffortTask: ResumeAgentTask = {
      kind: 'extract-job-requirements',
      expectedInputLanguages: ['zh'],
      expectedOutputLanguages: ['zh'],
      localLanguagePolicy: 'best-effort'
    }

    await provider.runStructuredTask({
      task: bestEffortTask,
      system: '只返回符合结构的岗位要求。',
      prompt: '高级前端工程师职位描述',
      jsonSchema: schema,
      validate: (value) => value
    })

    expect(languageModel.availability.mock.calls).toEqual([[]])
    expect(languageModel.create).toHaveBeenCalledWith({
      initialPrompts: [{ role: 'system', content: '只返回符合结构的岗位要求。' }]
    })
    expect(languageModel.create.mock.calls[0]?.[0]).not.toHaveProperty('expectedInputs')
    expect(languageModel.create.mock.calls[0]?.[0]).not.toHaveProperty('expectedOutputs')
    expect(session.prompt).toHaveBeenCalledWith(
      '高级前端工程师职位描述',
      { responseConstraint: schema }
    )
    expect(session.destroy).toHaveBeenCalledOnce()
  })

  it('normalizes a rejected best-effort language prompt without losing cleanup', async () => {
    const session = createSession({
      prompt: vi.fn().mockRejectedValue(new DOMException('Unsupported language', 'NotSupportedError'))
    })
    const provider = new ChromeBuiltInAiProvider({
      languageModel: createLanguageModel(session)
    })

    await expect(provider.runStructuredTask({
      task: {
        kind: 'review-resume',
        expectedInputLanguages: ['zh'],
        expectedOutputLanguages: ['zh'],
        localLanguagePolicy: 'best-effort'
      },
      system: '只返回结果。',
      prompt: '检查简历。',
      jsonSchema: schema,
      validate: (value) => value
    })).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' })
    expect(session.destroy).toHaveBeenCalledOnce()
  })

  it('requires user activation before starting a model download', async () => {
    const session = createSession()
    const languageModel = createLanguageModel(session, 'downloadable')
    const provider = new ChromeBuiltInAiProvider({
      languageModel,
      hasUserActivation: () => false
    })

    await expect(provider.runStructuredTask({
      task,
      system: 'System',
      prompt: 'Prompt',
      jsonSchema: schema,
      validate: (value) => value
    })).rejects.toMatchObject({
      code: 'USER_ACTIVATION_REQUIRED'
    })
    expect(languageModel.create).not.toHaveBeenCalled()
  })

  it('forwards bounded model-download progress after user activation', async () => {
    const session = createSession()
    const languageModel = createLanguageModel(session, 'downloadable')
    languageModel.create.mockImplementation(async (
      options: Parameters<ChromeLanguageModelApi['create']>[0]
    ) => {
      options.monitor?.({
        addEventListener: (_type, listener) => {
          listener({ loaded: -0.2 })
          listener({ loaded: 0.4 })
          listener({ loaded: 1.4 })
        }
      })
      return session
    })
    const progress = vi.fn()
    const provider = new ChromeBuiltInAiProvider({
      languageModel,
      hasUserActivation: () => true
    })

    await provider.runStructuredTask({
      task,
      system: 'System',
      prompt: 'Prompt',
      jsonSchema: schema,
      validate: (value) => value,
      onDownloadProgress: progress
    })

    expect(progress.mock.calls.map(([value]) => value)).toEqual([0, 0.4, 1])
  })

  it('rejects a task before prompting when it exceeds the remaining context budget', async () => {
    const session = createSession({
      contextUsage: 950,
      contextWindow: 1_000,
      measureContextUsage: vi.fn().mockResolvedValue(51)
    })
    const provider = new ChromeBuiltInAiProvider({
      languageModel: createLanguageModel(session)
    })

    await expect(provider.runStructuredTask({
      task,
      system: 'System',
      prompt: 'Oversized prompt',
      jsonSchema: schema,
      validate: (value) => value
    })).rejects.toMatchObject({
      code: 'CONTEXT_LIMIT_EXCEEDED'
    })
    expect(session.prompt).not.toHaveBeenCalled()
    expect(session.destroy).toHaveBeenCalledOnce()
  })

  it.each([
    ['invalid JSON', 'not-json', (value: unknown) => value],
    ['duplicate JSON keys', '{"requirements":[],"requirements":["shadowed"]}', (value: unknown) => value],
    ['schema validation failure', '{"requirements":[]}', () => {
      throw new Error('invalid schema')
    }]
  ])('rejects %s and destroys the session', async (_case, response, validate) => {
    const session = createSession({
      prompt: vi.fn().mockResolvedValue(response)
    })
    const provider = new ChromeBuiltInAiProvider({
      languageModel: createLanguageModel(session)
    })

    await expect(provider.runStructuredTask({
      task,
      system: 'System',
      prompt: 'Prompt',
      jsonSchema: schema,
      validate
    })).rejects.toMatchObject({
      code: 'INVALID_MODEL_OUTPUT'
    })
    expect(session.destroy).toHaveBeenCalledOnce()
  })

  it('passes cancellation to Chrome and still destroys an interrupted session', async () => {
    const abortError = new DOMException('Stopped', 'AbortError')
    const session = createSession({
      prompt: vi.fn().mockRejectedValue(abortError)
    })
    const languageModel = createLanguageModel(session)
    const controller = new AbortController()
    const provider = new ChromeBuiltInAiProvider({ languageModel })

    await expect(provider.runStructuredTask({
      task,
      system: 'System',
      prompt: 'Prompt',
      jsonSchema: schema,
      validate: (value) => value,
      signal: controller.signal
    })).rejects.toBe(abortError)
    expect(languageModel.create).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal
    }))
    expect(session.prompt).toHaveBeenCalledWith('Prompt', expect.objectContaining({
      signal: controller.signal
    }))
    expect(session.destroy).toHaveBeenCalledOnce()
  })

  it('fails locally without invoking a cloud or network fallback', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const session = createSession()
    const provider = new ChromeBuiltInAiProvider({
      languageModel: createLanguageModel(session, 'unavailable')
    })

    await expect(provider.runStructuredTask({
      task,
      system: 'System',
      prompt: 'Private resume data',
      jsonSchema: schema,
      validate: (value) => value
    })).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE'
    })
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
