import { describe, expect, it } from 'vitest'
import { normalizeResumeData } from '@/lib/resume-model'
import { AgentOutputError } from './json'
import {
  buildJDRequirementAnalysis,
  formatJDMatchReport,
  jdMatchReportSchema,
  jdRequirementAnalysisSchema,
  parseJDMatchReportJson
} from './jd-report'

const report = {
  jobTitle: 'Staff Platform Engineer',
  company: 'Example Co',
  requirements: [{
    text: 'TypeScript platform ownership', category: 'skill' as const,
    priority: 'must' as const, weight: 5, keywords: ['TypeScript', 'platform']
  }, {
    text: 'Agent workflow exposure', category: 'experience' as const,
    priority: 'preferred' as const, weight: 3, keywords: ['agent']
  }, {
    text: 'Own production operations', category: 'responsibility' as const,
    priority: 'signal' as const, weight: 1, keywords: ['operations']
  }],
  resumeEmphasis: ['Highlight platform delivery'],
  interviewPrep: ['Prepare an architecture example']
}

const resume = normalizeResumeData({
  profile: { name: 'Ada Candidate', title: 'Engineer', summary: [], tags: [], links: [] },
  skills: [], experiences: [], projects: [], education: [], certifications: [], awards: [], languages: [], openSource: [],
  metadata: { source: 'paste', locale: 'en', updatedAt: '2026-07-13T00:00:00.000Z' }
})

function expectOutputError(run: () => unknown, code = 'AI_OUTPUT_INVALID') {
  try {
    run()
    throw new Error(`Expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(AgentOutputError)
    expect((error as AgentOutputError).code).toBe(code)
  }
}

describe('JD match report JSON', () => {
  it('parses plain and fenced strict JSON', () => {
    expect(parseJDMatchReportJson(JSON.stringify(report))).toEqual(report)
    expect(parseJDMatchReportJson(`\`\`\`json\n${JSON.stringify(report)}\n\`\`\``)).toEqual(report)
    expect(jdMatchReportSchema.parse(report)).toEqual(report)
  })

  it('rejects missing and additional sections', () => {
    const { interviewPrep: _missing, ...missing } = report
    expectOutputError(() => parseJDMatchReportJson(JSON.stringify(missing)))
    expectOutputError(() => parseJDMatchReportJson(JSON.stringify({ ...report, extra: [] })))
  })

  it('rejects duplicate top-level section keys before JSON parsing can overwrite them', () => {
    const duplicate = `{"jobTitle":"Engineer","jobTitle":"Manager","company":"","requirements":[{"text":"Own systems","category":"responsibility","priority":"must","weight":5,"keywords":[]}],"resumeEmphasis":[],"interviewPrep":[]}`
    expectOutputError(() => parseJDMatchReportJson(duplicate))
  })

  it('enforces item, section, and total output bounds', () => {
    expectOutputError(() => parseJDMatchReportJson(JSON.stringify({
      ...report,
      requirements: Array.from({ length: 51 }, (_, index) => ({
        text: `Item ${index}`, category: 'skill', priority: 'signal', weight: 1, keywords: []
      }))
    })))
    expectOutputError(() => parseJDMatchReportJson(JSON.stringify({
      ...report,
      requirements: [{
        text: 'x'.repeat(1_201), category: 'skill', priority: 'must', weight: 5, keywords: []
      }]
    })))
    expectOutputError(
      () => parseJDMatchReportJson('x'.repeat(80_001)),
      'AI_OUTPUT_TOO_LARGE'
    )
  })

  it('formats the validated object as a backward-compatible report string', () => {
    const en = formatJDMatchReport(report, 'en')
    expect(en).toContain('## Job Requirements')
    expect(en).toContain('TypeScript platform ownership')
    expect(en).not.toContain('Match Score')

    const zh = formatJDMatchReport(report, 'zh')
    expect(zh).toContain('## 岗位要求')
    expect(zh).toContain('## 面试准备')
  })

  it('maps the compatible report to a deterministic requirement matrix without inventing evidence refs', () => {
    const input = {
      report,
      jobDescription: 'Staff platform engineer\nOwn TypeScript systems.',
      locale: 'en' as const,
      resume,
      timestamp: '2026-07-16T08:00:00.000Z'
    }
    const analysis = buildJDRequirementAnalysis(input)
    const repeated = buildJDRequirementAnalysis(input)

    expect(jdRequirementAnalysisSchema.parse(analysis)).toEqual(analysis)
    expect(analysis.targetJob).toMatchObject({
      title: 'Staff Platform Engineer',
      company: 'Example Co',
      description: input.jobDescription,
      locale: 'en'
    })
    expect(analysis.matrix.requirements.map(({ text, category, priority, weight, userConfirmed, keywords }) => ({
      text, category, priority, weight, userConfirmed, keywords
    }))).toEqual([
      { text: 'TypeScript platform ownership', category: 'skill', priority: 'must', weight: 5, userConfirmed: false, keywords: ['TypeScript', 'platform'] },
      { text: 'Agent workflow exposure', category: 'experience', priority: 'preferred', weight: 3, userConfirmed: false, keywords: ['agent'] },
      { text: 'Own production operations', category: 'responsibility', priority: 'signal', weight: 1, userConfirmed: false, keywords: ['operations'] }
    ])
    expect(analysis.matrix.matches.map(({ status, factIds }) => ({ status, factIds }))).toEqual([
      { status: 'gap', factIds: [] },
      { status: 'gap', factIds: [] },
      { status: 'gap', factIds: [] }
    ])
    expect(analysis.matrix.matches[0].rationale).toContain('remains an evidence gap')
    expect(analysis.score).toMatchObject({ requirementCoverage: 0, evidenceCompleteness: 0 })
    expect(analysis.structureScore).toMatchObject({
      rubricVersion: 'resume-os-structure-v1',
      score: 15
    })
    expect(repeated.matrix).toEqual(analysis.matrix)
    expect(repeated.score).toEqual(analysis.score)
    expect(repeated.structureScore).toEqual(analysis.structureScore)

    const refreshed = buildJDRequirementAnalysis({
      ...input,
      resume: normalizeResumeData(resume, { now: '2026-07-16T09:00:00.000Z' })
    })
    expect(refreshed.matrix.inputFingerprint).toBe(analysis.matrix.inputFingerprint)
  })

  it('rejects output that does not contain a concrete requirement', () => {
    expect(() => buildJDRequirementAnalysis({
      report: { ...report, requirements: [] },
      jobDescription: 'Own production operations.', locale: 'en', resume,
      timestamp: '2026-07-16T08:00:00.000Z'
    })).toThrow()
  })

  it('rejects an extended analysis whose score was not derived from its matrix', () => {
    const analysis = buildJDRequirementAnalysis({
      report,
      jobDescription: 'Platform role',
      locale: 'en',
      resume,
      timestamp: '2026-07-16T08:00:00.000Z'
    })

    expect(() => jdRequirementAnalysisSchema.parse({
      ...analysis,
      score: { ...analysis.score, evidenceCompleteness: 100 }
    })).toThrow(/derived from the supplied matrix/)
  })

  it('names requirement records by target job so identical text cannot overwrite another job', () => {
    const first = buildJDRequirementAnalysis({
      report, jobDescription: 'Platform role at company A', locale: 'en', resume,
      timestamp: '2026-07-16T08:00:00.000Z'
    })
    const second = buildJDRequirementAnalysis({
      report, jobDescription: 'Platform role at company B', locale: 'en', resume,
      timestamp: '2026-07-16T08:00:00.000Z'
    })

    expect(first.matrix.requirements[0].text).toBe(second.matrix.requirements[0].text)
    expect(first.matrix.requirements[0].id).not.toBe(second.matrix.requirements[0].id)
  })

  it('keeps requirement identity stable when extraction order or candidate classification changes', () => {
    const base = buildJDRequirementAnalysis({
      report, jobDescription: 'Stable role', locale: 'en', resume,
      timestamp: '2026-07-16T08:00:00.000Z'
    })
    const revisedExtraction = buildJDRequirementAnalysis({
      report: {
        ...report,
        requirements: [
          report.requirements[1],
          { ...report.requirements[0], category: 'domain', priority: 'signal', weight: 1 },
          report.requirements[2]
        ]
      },
      jobDescription: 'Stable role', locale: 'en', resume,
      timestamp: '2026-07-16T08:00:00.000Z'
    })
    const idsByText = (analysis: typeof base) => new Map(
      analysis.matrix.requirements.map((requirement) => [requirement.text, requirement.id])
    )

    expect(idsByText(revisedExtraction)).toEqual(idsByText(base))
  })
})
