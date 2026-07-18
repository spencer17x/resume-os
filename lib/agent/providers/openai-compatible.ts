import type {
  ResumeAgentTask,
  ResumeAiProvider,
  StructuredTaskInput,
  StructuredTaskResult
} from './types'

export interface OpenAiCompatibleTaskRunner {
  <T>(input: StructuredTaskInput<T>): Promise<StructuredTaskResult<T>>
}

/**
 * Adapts the existing stateless, same-origin BYOK routes to the common provider
 * contract. The injected runner owns the task-specific route payload; prompts,
 * schemas, cancellation, and deterministic validation stay provider-independent.
 */
export class OpenAiCompatibleProvider implements ResumeAiProvider {
  readonly kind = 'openai-compatible' as const

  constructor(private readonly runTask: OpenAiCompatibleTaskRunner) {}

  async availability(_task: ResumeAgentTask) {
    return 'available' as const
  }

  runStructuredTask<T>(input: StructuredTaskInput<T>): Promise<StructuredTaskResult<T>> {
    return this.runTask(input)
  }
}

export function createOpenAiCompatibleProvider<T>(
  runTask: (input: StructuredTaskInput<T>) => Promise<StructuredTaskResult<T>>
) {
  const adapter: OpenAiCompatibleTaskRunner = async <Value>(input: StructuredTaskInput<Value>) => {
    // A routed provider instance is scoped to one validated task value. The common
    // provider interface remains generic so every task keeps its own output type.
    return runTask(input as unknown as StructuredTaskInput<T>) as unknown as Promise<StructuredTaskResult<Value>>
  }
  return new OpenAiCompatibleProvider(adapter)
}
