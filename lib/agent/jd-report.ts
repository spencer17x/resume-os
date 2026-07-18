import { z } from 'zod'
import { AgentOutputError, extractJsonText } from '@/lib/agent/json'
import {
  REQUIREMENT_MATRIX_VERSION,
  requirementMatrixSchema,
  requirementScoreResultSchema,
  scoreRequirementMatrix,
  targetJobSchema
} from '@/lib/agent/requirement-matrix'
import {
  resumeStructureScoreSchema,
  scoreResumeStructure
} from '@/lib/agent/resume-structure-score'
import type { ResumeData, ResumeLocale } from '@/lib/resume-model'

const reportItemSchema = z.string().trim().min(1).max(1_200)
const reportListSchema = z.array(reportItemSchema).max(12)
const extractedRequirementSchema = z.object({
  text: reportItemSchema,
  category: z.enum(['skill', 'experience', 'domain', 'education', 'responsibility']),
  priority: z.enum(['must', 'preferred', 'signal']),
  weight: z.number().finite().gt(0).max(10),
  keywords: z.array(z.string().trim().min(1).max(120)).max(20)
}).strict()

export const jdMatchReportSchema = z.object({
  jobTitle: z.string().trim().max(300),
  company: z.string().trim().max(300),
  requirements: z.array(extractedRequirementSchema).min(1).max(50),
  resumeEmphasis: reportListSchema,
  interviewPrep: reportListSchema
}).strict()

export type JDMatchReport = z.infer<typeof jdMatchReportSchema>

export const JD_MATCH_REPORT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    jobTitle: { type: 'string', maxLength: 300 },
    company: { type: 'string', maxLength: 300 },
    requirements: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 1_200 },
          category: { type: 'string', enum: ['skill', 'experience', 'domain', 'education', 'responsibility'] },
          priority: { type: 'string', enum: ['must', 'preferred', 'signal'] },
          weight: { type: 'number', exclusiveMinimum: 0, maximum: 10 },
          keywords: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 120 },
            maxItems: 20
          }
        },
        required: ['text', 'category', 'priority', 'weight', 'keywords'],
        additionalProperties: false
      }
    },
    resumeEmphasis: reportArrayJsonSchema(),
    interviewPrep: reportArrayJsonSchema()
  },
  required: [
    'jobTitle',
    'company',
    'requirements',
    'resumeEmphasis',
    'interviewPrep'
  ],
  additionalProperties: false
} as const satisfies Record<string, unknown>

export const jdRequirementAnalysisSchema = z.object({
  targetJob: targetJobSchema,
  matrix: requirementMatrixSchema,
  score: requirementScoreResultSchema,
  structureScore: resumeStructureScoreSchema
}).strict().superRefine((analysis, context) => {
  if (analysis.targetJob.id !== analysis.matrix.targetJobId) {
    context.addIssue({
      code: 'custom',
      path: ['matrix', 'targetJobId'],
      message: 'Requirement matrix must belong to the supplied target job'
    })
  }

  const expectedScore = scoreRequirementMatrix(analysis.matrix)
  if (JSON.stringify(expectedScore) !== JSON.stringify(analysis.score)) {
    context.addIssue({
      code: 'custom',
      path: ['score'],
      message: 'Requirement score must be derived from the supplied matrix'
    })
  }
})

export type JDRequirementAnalysis = z.infer<typeof jdRequirementAnalysisSchema>

const reportKeys = Object.keys(jdMatchReportSchema.shape)

export function parseJDMatchReportJson(value: string): JDMatchReport {
  try {
    const json = extractJsonText(value)
    const keyCounts = topLevelKeyCounts(json)
    if (reportKeys.some((key) => keyCounts.get(key) !== 1)) {
      throw new AgentOutputError('AI_OUTPUT_INVALID')
    }
    return jdMatchReportSchema.parse(JSON.parse(json))
  } catch (error) {
    if (error instanceof AgentOutputError) throw error
    throw new AgentOutputError('AI_OUTPUT_INVALID')
  }
}

export function formatJDMatchReport(report: JDMatchReport, locale: ResumeLocale) {
  const labels = locale === 'zh'
    ? ['岗位要求', '简历强调点', '面试准备']
    : ['Job Requirements', 'Resume Emphasis', 'Interview Prep']
  const sections: Array<string | string[]> = [
    report.requirements.map((requirement) => requirement.text),
    report.resumeEmphasis,
    report.interviewPrep
  ]

  return sections.map((section, index) => {
    const content = Array.isArray(section)
      ? section.map((item) => `- ${item}`).join('\n') || '-'
      : section
    return `## ${labels[index]}\n${content}`
  }).join('\n\n')
}

export function buildJDRequirementAnalysis(input: {
  report: JDMatchReport
  jobDescription: string
  locale: ResumeLocale
  resume: ResumeData
  timestamp?: string
}): JDRequirementAnalysis {
  const report = jdMatchReportSchema.parse(input.report)
  const timestamp = input.timestamp ?? new Date().toISOString()
  const targetJobId = `job-${stableTextHash(`${input.locale}\u0000${input.jobDescription}`)}`
  const inputFingerprint = `fnv1a:${stableTextHash(JSON.stringify({
    jobDescription: input.jobDescription,
    locale: input.locale,
    report,
    resume: resumeFingerprintSource(input.resume)
  }))}`
  const requirementOccurrences = new Map<string, number>()
  const requirements = report.requirements.map((entry) => {
    const identity = entry.text.toLocaleLowerCase(input.locale === 'zh' ? 'zh-CN' : 'en-US')
    const occurrence = requirementOccurrences.get(identity) ?? 0
    requirementOccurrences.set(identity, occurrence + 1)
    return {
      id: `requirement-${stableTextHash(`${targetJobId}\u0000${identity}\u0000${occurrence}`)}`,
      jobId: targetJobId,
      text: entry.text,
      category: entry.category,
      priority: entry.priority,
      weight: entry.weight,
      keywords: [...new Set(entry.keywords)],
      userConfirmed: false
    }
  })
  const matches = requirements.map((requirement) => ({
    requirementId: requirement.id,
    factIds: [],
    status: 'gap' as const,
    rationale: requirementRationale(input.locale)
  }))
  const matrix = requirementMatrixSchema.parse({
    version: REQUIREMENT_MATRIX_VERSION,
    targetJobId,
    inputFingerprint,
    requirements,
    matches
  })

  return jdRequirementAnalysisSchema.parse({
    targetJob: {
      id: targetJobId,
      title: report.jobTitle || (input.locale === 'zh' ? '导入的目标岗位' : 'Imported target job'),
      ...(report.company ? { company: report.company } : {}),
      description: input.jobDescription,
      locale: input.locale,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    matrix,
    score: scoreRequirementMatrix(matrix),
    structureScore: scoreResumeStructure(input.resume)
  })
}

function reportArrayJsonSchema() {
  return {
    type: 'array',
    items: { type: 'string', minLength: 1, maxLength: 1_200 },
    maxItems: 12
  } as const
}

function requirementRationale(locale: ResumeLocale) {
  return locale === 'zh'
    ? '岗位要求已提取；在用户关联并确认职业事实前，它始终被安全地视为证据缺口。'
    : 'The job requirement was extracted, but it remains an evidence gap until the user links and confirms a career fact.'
}

function stableTextHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function resumeFingerprintSource(resume: ResumeData) {
  return {
    ...resume,
    metadata: {
      source: resume.metadata.source,
      locale: resume.metadata.locale
    }
  }
}

function topLevelKeyCounts(json: string) {
  const counts = new Map<string, number>()
  let objectDepth = 0

  for (let index = 0; index < json.length; index += 1) {
    const character = json[index]
    if (character === '{') {
      objectDepth += 1
      continue
    }
    if (character === '}') {
      objectDepth -= 1
      continue
    }
    if (character !== '"') continue

    const start = index
    index += 1
    let escaped = false
    while (index < json.length) {
      const current = json[index]
      if (!escaped && current === '"') break
      if (!escaped && current === '\\') escaped = true
      else escaped = false
      index += 1
    }
    if (index >= json.length || objectDepth !== 1) continue

    let cursor = index + 1
    while (/\s/.test(json[cursor] ?? '')) cursor += 1
    if (json[cursor] !== ':') continue

    const key = JSON.parse(json.slice(start, index + 1)) as string
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return counts
}
