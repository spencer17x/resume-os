import type {
  ProviderAvailability,
  ResumeAgentTask,
  ResumeAiProvider,
  StructuredTaskInput,
  StructuredTaskResult
} from './types'
import { extractJsonText } from '@/lib/agent/json'

export const CHROME_BUILT_IN_PROVIDER = 'Chrome Built-in AI (Beta)'
export const CHROME_BUILT_IN_MODEL = 'browser-managed'

type ChromeExpectedContent = {
  type: 'text'
  languages: string[]
}

type ChromeLanguageModelCoreOptions = {
  expectedInputs: ChromeExpectedContent[]
  expectedOutputs: ChromeExpectedContent[]
}

type ChromePromptOptions = {
  responseConstraint: Record<string, unknown>
  signal?: AbortSignal
}

type ChromeDownloadMonitor = {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: { loaded: number }) => void
  ): void
}

type ChromeLanguageModelCreateOptions = ChromeLanguageModelCoreOptions & {
  initialPrompts: [{ role: 'system'; content: string }]
  signal?: AbortSignal
  monitor?: (monitor: ChromeDownloadMonitor) => void
}

export interface ChromeLanguageModelSession {
  readonly contextUsage: number
  readonly contextWindow: number
  measureContextUsage(input: string, options: ChromePromptOptions): Promise<number>
  prompt(input: string, options: ChromePromptOptions): Promise<string>
  destroy(): void
}

export interface ChromeLanguageModelApi {
  availability(options: ChromeLanguageModelCoreOptions): Promise<unknown>
  create(options: ChromeLanguageModelCreateOptions): Promise<ChromeLanguageModelSession>
}

export type ChromeBuiltInAiErrorCode =
  | 'MODEL_UNAVAILABLE'
  | 'USER_ACTIVATION_REQUIRED'
  | 'CONTEXT_LIMIT_EXCEEDED'
  | 'INVALID_MODEL_OUTPUT'

export class ChromeBuiltInAiError extends Error {
  constructor(
    readonly code: ChromeBuiltInAiErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ChromeBuiltInAiError'
  }
}

export type ChromeBuiltInAiProviderOptions = {
  languageModel?: ChromeLanguageModelApi
  hasUserActivation?: () => boolean
}

function browserLanguageModel(): ChromeLanguageModelApi | undefined {
  return (globalThis as typeof globalThis & {
    LanguageModel?: ChromeLanguageModelApi
  }).LanguageModel
}

function browserHasUserActivation(): boolean {
  if (typeof navigator === 'undefined') return false
  return (navigator as Navigator & {
    userActivation?: { isActive: boolean }
  }).userActivation?.isActive === true
}

function expectedLanguageOptions(task: ResumeAgentTask): ChromeLanguageModelCoreOptions {
  const inputLanguages = task.expectedInputLanguages.map((language) => language.trim())
  const outputLanguages = task.expectedOutputLanguages.map((language) => language.trim())

  if (
    inputLanguages.length === 0
    || outputLanguages.length === 0
    || inputLanguages.some((language) => !language)
    || outputLanguages.some((language) => !language)
  ) {
    throw new TypeError('Expected input and output languages must be provided.')
  }

  return {
    expectedInputs: [{ type: 'text', languages: inputLanguages }],
    expectedOutputs: [{ type: 'text', languages: outputLanguages }]
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

export function normalizeChromeAvailability(value: unknown): ProviderAvailability {
  switch (value) {
    case 'available':
    case 'readily':
      return 'available'
    case 'downloadable':
    case 'after-download':
      return 'downloadable'
    case 'downloading':
      return 'downloading'
    case 'unavailable':
    case 'no':
    default:
      return 'unavailable'
  }
}

function progressMonitor(onProgress: (progress: number) => void) {
  return (monitor: ChromeDownloadMonitor) => {
    monitor.addEventListener('downloadprogress', (event) => {
      if (!Number.isFinite(event.loaded)) return
      onProgress(Math.min(1, Math.max(0, event.loaded)))
    })
  }
}

export class ChromeBuiltInAiProvider implements ResumeAiProvider {
  readonly kind = 'chrome-built-in' as const

  private readonly languageModel: ChromeLanguageModelApi | undefined
  private readonly hasUserActivation: () => boolean

  constructor(options: ChromeBuiltInAiProviderOptions = {}) {
    this.languageModel = options.languageModel ?? browserLanguageModel()
    this.hasUserActivation = options.hasUserActivation ?? browserHasUserActivation
  }

  async availability(task: ResumeAgentTask): Promise<ProviderAvailability> {
    if (!this.languageModel) return 'unavailable'
    const availability = await this.languageModel.availability(expectedLanguageOptions(task))
    return normalizeChromeAvailability(availability)
  }

  async runStructuredTask<T>(
    input: StructuredTaskInput<T>
  ): Promise<StructuredTaskResult<T>> {
    throwIfAborted(input.signal)
    const languageModel = this.languageModel
    if (!languageModel) {
      throw new ChromeBuiltInAiError(
        'MODEL_UNAVAILABLE',
        'Chrome Built-in AI is not available in this browser.'
      )
    }

    const languageOptions = expectedLanguageOptions(input.task)
    const availability = normalizeChromeAvailability(
      await languageModel.availability(languageOptions)
    )
    throwIfAborted(input.signal)

    if (availability === 'unavailable') {
      throw new ChromeBuiltInAiError(
        'MODEL_UNAVAILABLE',
        'Chrome Built-in AI does not support this task or its expected languages.'
      )
    }
    if (availability === 'downloadable' && !this.hasUserActivation()) {
      throw new ChromeBuiltInAiError(
        'USER_ACTIVATION_REQUIRED',
        'A user action is required before Chrome can download its local model.'
      )
    }

    const session = await languageModel.create({
      ...languageOptions,
      initialPrompts: [{ role: 'system', content: input.system }],
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onDownloadProgress
        ? { monitor: progressMonitor(input.onDownloadProgress) }
        : {})
    })

    try {
      const promptOptions: ChromePromptOptions = {
        responseConstraint: input.jsonSchema,
        ...(input.signal ? { signal: input.signal } : {})
      }
      const requiredContext = await session.measureContextUsage(
        input.prompt,
        promptOptions
      )
      throwIfAborted(input.signal)

      if (
        !Number.isFinite(requiredContext)
        || !Number.isFinite(session.contextUsage)
        || !Number.isFinite(session.contextWindow)
        || requiredContext < 0
        || session.contextUsage < 0
        || session.contextWindow <= 0
        || session.contextUsage + requiredContext > session.contextWindow
      ) {
        throw new ChromeBuiltInAiError(
          'CONTEXT_LIMIT_EXCEEDED',
          'This task exceeds the Chrome local model context budget.'
        )
      }

      const response = await session.prompt(input.prompt, promptOptions)
      let parsed: unknown
      try {
        parsed = JSON.parse(extractJsonText(response))
      } catch (error) {
        throw new ChromeBuiltInAiError(
          'INVALID_MODEL_OUTPUT',
          'Chrome Built-in AI returned invalid JSON.',
          { cause: error }
        )
      }

      let value: T
      try {
        value = input.validate(parsed)
      } catch (error) {
        throw new ChromeBuiltInAiError(
          'INVALID_MODEL_OUTPUT',
          'Chrome Built-in AI returned data that failed validation.',
          { cause: error }
        )
      }

      return {
        value,
        provider: CHROME_BUILT_IN_PROVIDER,
        model: CHROME_BUILT_IN_MODEL
      }
    } finally {
      session.destroy()
    }
  }
}
