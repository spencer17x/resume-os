export const RESUME_AGENT_TASK_KINDS = [
  'parse-resume',
  'generate-demo-resume',
  'extract-job-requirements',
  'classify-evidence',
  'draft-gap-questions',
  'prepare-optimization-plan',
  'rewrite-resume-bullet',
  'review-resume'
] as const

export type ResumeAgentTaskKind = typeof RESUME_AGENT_TASK_KINDS[number]

export type LocalLanguagePolicy = 'strict' | 'best-effort'

export type ResumeAgentTask = {
  kind: ResumeAgentTaskKind
  expectedInputLanguages: readonly string[]
  expectedOutputLanguages: readonly string[]
  /**
   * Strict mode asks the browser to guarantee every declared language before
   * creating a session. Best-effort mode deliberately omits that capability
   * declaration so an on-device model may attempt an otherwise unsupported
   * language; output validation and privacy routing still apply unchanged.
   */
  localLanguagePolicy?: LocalLanguagePolicy
}

export function localLanguagePolicyForLocale(locale: 'zh' | 'en'): LocalLanguagePolicy {
  return locale === 'zh' ? 'best-effort' : 'strict'
}

export type AiProviderKind = 'chrome-built-in' | 'openai-compatible'

export type ProviderAvailability =
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available'

export type StructuredTaskInput<T> = {
  task: ResumeAgentTask
  system: string
  prompt: string
  jsonSchema: Record<string, unknown>
  validate: (value: unknown) => T
  signal?: AbortSignal
  onDownloadProgress?: (progress: number) => void
}

export type StructuredTaskResult<T> = {
  value: T
  provider: string
  model: string
}

export interface ResumeAiProvider {
  readonly kind: AiProviderKind
  availability(task: ResumeAgentTask): Promise<ProviderAvailability>
  runStructuredTask<T>(input: StructuredTaskInput<T>): Promise<StructuredTaskResult<T>>
}
