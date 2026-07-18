import type { AiProviderPreference } from '../provider-preference'
import { ChromeBuiltInAiError } from './chrome-built-in'
import { createOpenAiCompatibleProvider } from './openai-compatible'
import type {
  ResumeAiProvider,
  StructuredTaskInput,
  StructuredTaskResult
} from './types'

export type CloudStructuredTaskRunner<T> = (
  input: StructuredTaskInput<T>
) => Promise<StructuredTaskResult<T>>

export type RunPreferredProviderOptions<T> = {
  preference: AiProviderPreference
  localProvider: ResumeAiProvider
  runCloudTask: CloudStructuredTaskRunner<T>
  input: StructuredTaskInput<T>
}

export class ProviderRoutingError extends Error {
  constructor(
    readonly code: 'CLOUD_FALLBACK_NOT_ALLOWED'
  ) {
    super(code)
    this.name = 'ProviderRoutingError'
  }
}

/**
 * Routes one structured task without ever inferring cloud consent.
 *
 * Automatic mode only reaches the cloud runner when the local model is unavailable
 * or cannot fit the bounded task, and the persisted preference explicitly allows
 * fallback. Other local failures are surfaced instead of changing the privacy boundary.
 */
export async function runPreferredProviderTask<T>({
  preference,
  localProvider,
  runCloudTask,
  input
}: RunPreferredProviderOptions<T>): Promise<StructuredTaskResult<T>> {
  const cloudProvider = createOpenAiCompatibleProvider(runCloudTask)
  if (preference.mode === 'openai-compatible') return cloudProvider.runStructuredTask(input)
  if (preference.mode === 'chrome-built-in') {
    return localProvider.runStructuredTask(input)
  }

  const availability = await localProvider.availability(input.task)
  if (availability !== 'unavailable') {
    try {
      return await localProvider.runStructuredTask(input)
    } catch (error) {
      if (!isLocalUnavailableError(error)) throw error
      if (!preference.allowCloudFallback) {
        throw new ProviderRoutingError('CLOUD_FALLBACK_NOT_ALLOWED')
      }
      throwIfAborted(input.signal)
      return cloudProvider.runStructuredTask(input)
    }
  }

  if (!preference.allowCloudFallback) {
    throw new ProviderRoutingError('CLOUD_FALLBACK_NOT_ALLOWED')
  }
  throwIfAborted(input.signal)
  return cloudProvider.runStructuredTask(input)
}

function isLocalUnavailableError(error: unknown) {
  return error instanceof ChromeBuiltInAiError
    && ['MODEL_UNAVAILABLE', 'CONTEXT_LIMIT_EXCEEDED'].includes(error.code)
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}
