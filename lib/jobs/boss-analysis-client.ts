import { aiFetch } from '@/lib/agent/browser-config'
import {
  buildJDRequirementAnalysis,
  jdMatchReportSchema,
  type JDRequirementAnalysis
} from '@/lib/agent/jd-report'
import type { ResumeData } from '@/lib/resume-model'
import type { JobPosting } from './job-domain'

export class BossAnalysisClientError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'BossAnalysisClientError'
  }
}

export async function requestBossCandidateAnalysis(input: {
  posting: JobPosting
  resume: ResumeData
  locale: 'zh' | 'en'
  signal?: AbortSignal
}): Promise<JDRequirementAnalysis> {
  const response = await aiFetch('/api/jd-match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jd: input.posting.description,
      locale: input.locale,
      resume: input.resume,
      targetIdentity: input.posting.id
    }),
    signal: input.signal
  })
  const body = await response.json() as { sections?: unknown; code?: unknown }
  if (!response.ok) {
    throw new BossAnalysisClientError(typeof body.code === 'string' ? body.code : 'BOSS_ANALYSIS_FAILED')
  }
  const report = jdMatchReportSchema.safeParse(body.sections)
  if (!report.success) throw new BossAnalysisClientError('AI_OUTPUT_INVALID')
  return buildJDRequirementAnalysis({
    report: {
      ...report.data,
      jobTitle: input.posting.title,
      company: input.posting.company
    },
    jobDescription: input.posting.description,
    locale: input.locale,
    resume: input.resume,
    targetIdentity: input.posting.id
  })
}
