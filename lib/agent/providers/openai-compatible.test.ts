import { describe, expect, it, vi } from 'vitest'
import { OpenAiCompatibleProvider } from './openai-compatible'
import type { StructuredTaskInput } from './types'

describe('OpenAI-compatible provider adapter', () => {
  it('preserves the common task contract while delegating to the stateless BYOK runner', async () => {
    const input: StructuredTaskInput<{ ok: boolean }> = {
      task: {
        kind: 'prepare-optimization-plan',
        expectedInputLanguages: ['en'],
        expectedOutputLanguages: ['en']
      },
      system: 'Return JSON only.',
      prompt: 'Prepare one evidence-grounded plan.',
      jsonSchema: { type: 'object' },
      validate: (value) => value as { ok: boolean }
    }
    const runner = vi.fn().mockResolvedValue({
      value: { ok: true },
      provider: 'OpenAI-compatible',
      model: 'configured-model'
    })
    const provider = new OpenAiCompatibleProvider(runner)

    await expect(provider.availability(input.task)).resolves.toBe('available')
    await expect(provider.runStructuredTask(input)).resolves.toEqual({
      value: { ok: true },
      provider: 'OpenAI-compatible',
      model: 'configured-model'
    })
    expect(runner).toHaveBeenCalledWith(input)
  })
})
