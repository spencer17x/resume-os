import { describe, expect, it, vi } from 'vitest'
import { ChromeBuiltInAiError } from './chrome-built-in'
import {
  runPreferredProviderTask,
  type CloudStructuredTaskRunner
} from './router'
import type {
  ResumeAiProvider,
  StructuredTaskInput,
  StructuredTaskResult
} from './types'

const input: StructuredTaskInput<{ ok: boolean }> = {
  task: {
    kind: 'review-resume',
    expectedInputLanguages: ['en'],
    expectedOutputLanguages: ['en']
  },
  system: 'Return a structured review.',
  prompt: 'Review this resume.',
  jsonSchema: { type: 'object' },
  validate: (value) => value as { ok: boolean }
}

const localResult: StructuredTaskResult<{ ok: boolean }> = {
  value: { ok: true },
  provider: 'Chrome Built-in AI',
  model: 'browser-managed'
}

const cloudResult: StructuredTaskResult<{ ok: boolean }> = {
  value: { ok: true },
  provider: 'OpenAI-compatible',
  model: 'configured-model'
}

function harness(availability: 'unavailable' | 'downloadable' | 'downloading' | 'available') {
  const localProvider: ResumeAiProvider = {
    kind: 'chrome-built-in',
    availability: vi.fn().mockResolvedValue(availability),
    runStructuredTask: vi.fn().mockResolvedValue(localResult)
  }
  const runCloudTask = vi.fn().mockResolvedValue(cloudResult) as unknown as CloudStructuredTaskRunner<{ ok: boolean }>
  return { localProvider, runCloudTask }
}

describe('preferred provider routing', () => {
  it('uses only the explicitly selected cloud provider', async () => {
    const { localProvider, runCloudTask } = harness('available')
    await expect(runPreferredProviderTask({
      preference: { mode: 'openai-compatible', allowCloudFallback: false },
      localProvider,
      runCloudTask,
      input
    })).resolves.toEqual(cloudResult)

    expect(localProvider.availability).not.toHaveBeenCalled()
    expect(localProvider.runStructuredTask).not.toHaveBeenCalled()
    expect(runCloudTask).toHaveBeenCalledOnce()
  })

  it('uses only the explicitly selected local provider', async () => {
    const { localProvider, runCloudTask } = harness('unavailable')
    await expect(runPreferredProviderTask({
      preference: { mode: 'chrome-built-in', allowCloudFallback: false },
      localProvider,
      runCloudTask,
      input
    })).resolves.toEqual(localResult)

    expect(localProvider.runStructuredTask).toHaveBeenCalledOnce()
    expect(runCloudTask).not.toHaveBeenCalled()
  })

  it.each(['available', 'downloadable', 'downloading'] as const)(
    'keeps automatic mode local while availability is %s',
    async (availability) => {
      const { localProvider, runCloudTask } = harness(availability)
      await expect(runPreferredProviderTask({
        preference: { mode: 'automatic', allowCloudFallback: true },
        localProvider,
        runCloudTask,
        input
      })).resolves.toEqual(localResult)
      expect(runCloudTask).not.toHaveBeenCalled()
    }
  )

  it('stops when automatic mode has no saved cloud-fallback consent', async () => {
    const { localProvider, runCloudTask } = harness('unavailable')
    await expect(runPreferredProviderTask({
      preference: { mode: 'automatic', allowCloudFallback: false },
      localProvider,
      runCloudTask,
      input
    })).rejects.toMatchObject({
      code: 'CLOUD_FALLBACK_NOT_ALLOWED'
    })
    expect(runCloudTask).not.toHaveBeenCalled()
  })

  it('uses cloud only after local unavailability and saved fallback consent', async () => {
    const { localProvider, runCloudTask } = harness('unavailable')
    await expect(runPreferredProviderTask({
      preference: { mode: 'automatic', allowCloudFallback: true },
      localProvider,
      runCloudTask,
      input
    })).resolves.toEqual(cloudResult)
    expect(localProvider.availability).toHaveBeenCalledOnce()
    expect(runCloudTask).toHaveBeenCalledOnce()
  })

  it('uses cloud after a local context-limit error only with saved fallback consent', async () => {
    const allowed = harness('available')
    vi.mocked(allowed.localProvider.runStructuredTask).mockRejectedValueOnce(
      new ChromeBuiltInAiError('CONTEXT_LIMIT_EXCEEDED', 'Task exceeds the local context window')
    )
    await expect(runPreferredProviderTask({
      preference: { mode: 'automatic', allowCloudFallback: true },
      localProvider: allowed.localProvider,
      runCloudTask: allowed.runCloudTask,
      input
    })).resolves.toEqual(cloudResult)
    expect(allowed.runCloudTask).toHaveBeenCalledOnce()

    const denied = harness('available')
    vi.mocked(denied.localProvider.runStructuredTask).mockRejectedValueOnce(
      new ChromeBuiltInAiError('CONTEXT_LIMIT_EXCEEDED', 'Task exceeds the local context window')
    )
    await expect(runPreferredProviderTask({
      preference: { mode: 'automatic', allowCloudFallback: false },
      localProvider: denied.localProvider,
      runCloudTask: denied.runCloudTask,
      input
    })).rejects.toMatchObject({ code: 'CLOUD_FALLBACK_NOT_ALLOWED' })
    expect(denied.runCloudTask).not.toHaveBeenCalled()
  })

  it('does not fall back for invalid output or other local task failures', async () => {
    const { localProvider, runCloudTask } = harness('available')
    vi.mocked(localProvider.runStructuredTask).mockRejectedValueOnce(
      new ChromeBuiltInAiError('INVALID_MODEL_OUTPUT', 'Invalid output')
    )
    await expect(runPreferredProviderTask({
      preference: { mode: 'automatic', allowCloudFallback: true },
      localProvider,
      runCloudTask,
      input
    })).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' })
    expect(runCloudTask).not.toHaveBeenCalled()
  })

  it('handles a local availability race without silently widening privacy', async () => {
    const { localProvider, runCloudTask } = harness('available')
    vi.mocked(localProvider.runStructuredTask).mockRejectedValueOnce(
      new ChromeBuiltInAiError('MODEL_UNAVAILABLE', 'Model became unavailable')
    )
    await expect(runPreferredProviderTask({
      preference: { mode: 'automatic', allowCloudFallback: false },
      localProvider,
      runCloudTask,
      input
    })).rejects.toMatchObject({
      code: 'CLOUD_FALLBACK_NOT_ALLOWED'
    })
    expect(runCloudTask).not.toHaveBeenCalled()
  })

  it('never falls back after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Canceled', 'AbortError'))
    const { localProvider, runCloudTask } = harness('unavailable')
    await expect(runPreferredProviderTask({
      preference: { mode: 'automatic', allowCloudFallback: true },
      localProvider,
      runCloudTask,
      input: { ...input, signal: controller.signal }
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(runCloudTask).not.toHaveBeenCalled()
  })
})
