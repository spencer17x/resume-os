import { z } from 'zod'
import { normalizeResumeData, type ResumeData } from '@/lib/resume-model'

export const RESUME_STRUCTURE_SCORE_VERSION = 1 as const
export const RESUME_STRUCTURE_RUBRIC_VERSION = 'resume-os-structure-v1' as const

const ruleIdSchema = z.enum([
  'profile-basics',
  'contact-path',
  'summary-readability',
  'experience-structure',
  'bullet-readability',
  'skills-structure'
])

export const resumeStructureRuleResultSchema = z.object({
  id: ruleIdSchema,
  weight: z.number().finite().positive().max(100),
  factor: z.number().finite().min(0).max(1),
  points: z.number().finite().min(0).max(100),
  resumePaths: z.array(z.string().trim().min(1).max(200)).max(250)
}).strict()

export const resumeStructureScoreSchema = z.object({
  version: z.literal(RESUME_STRUCTURE_SCORE_VERSION),
  rubricVersion: z.literal(RESUME_STRUCTURE_RUBRIC_VERSION),
  score: z.number().finite().min(0).max(100),
  rules: z.array(resumeStructureRuleResultSchema).length(6)
}).strict().superRefine((result, context) => {
  const expected = round(result.rules.reduce((total, rule) => total + rule.points, 0))
  if (result.score !== expected) {
    context.addIssue({ code: 'custom', path: ['score'], message: 'Score must equal rule points' })
  }
  if (round(result.rules.reduce((total, rule) => total + rule.weight, 0)) !== 100) {
    context.addIssue({ code: 'custom', path: ['rules'], message: 'Rule weights must total 100' })
  }
})

export type ResumeStructureRuleResult = z.infer<typeof resumeStructureRuleResultSchema>
export type ResumeStructureScore = z.infer<typeof resumeStructureScoreSchema>

export function scoreResumeStructure(input: ResumeData): ResumeStructureScore {
  const resume = normalizeResumeData(input)
  const bullets = resume.experiences.flatMap((experience, experienceIndex) =>
    experience.bullets.map((bullet, bulletIndex) => ({
      value: bullet,
      path: `experiences.${experienceIndex}.bullets.${bulletIndex}`
    }))
  )

  const rules = [
    rule('profile-basics', 15, ratio([
      Boolean(resume.profile.name.trim()),
      Boolean(resume.profile.title.trim())
    ]), ['profile.name', 'profile.title']),
    rule('contact-path', 10, Number(Boolean(
      resume.profile.email?.trim()
      || resume.profile.phone?.trim()
      || resume.profile.links.some((link) => link.url.trim())
    )), ['profile.email', 'profile.phone', 'profile.links']),
    rule('summary-readability', 15, collectionFactor(
      resume.profile.summary,
      (item) => readableLength(item, 30, 500)
    ), resume.profile.summary.map((_, index) => `profile.summary.${index}`)),
    rule('experience-structure', 25, collectionFactor(
      resume.experiences,
      (experience) => Boolean(
        experience.company.trim()
        && experience.role.trim()
        && experience.period.trim()
        && experience.bullets.length > 0
      )
    ), resume.experiences.flatMap((_, index) => [
      `experiences.${index}.company`,
      `experiences.${index}.role`,
      `experiences.${index}.period`,
      `experiences.${index}.bullets`
    ])),
    rule('bullet-readability', 25, collectionFactor(
      bullets,
      (bullet) => readableLength(bullet.value, 20, 320)
    ), bullets.map((bullet) => bullet.path)),
    rule('skills-structure', 10, collectionFactor(
      resume.skills,
      (group) => Boolean(group.group.trim() && group.items.length > 0)
    ), resume.skills.flatMap((_, index) => [
      `skills.${index}.group`,
      `skills.${index}.items`
    ]))
  ] satisfies ResumeStructureRuleResult[]

  return resumeStructureScoreSchema.parse({
    version: RESUME_STRUCTURE_SCORE_VERSION,
    rubricVersion: RESUME_STRUCTURE_RUBRIC_VERSION,
    score: round(rules.reduce((total, item) => total + item.points, 0)),
    rules
  })
}

function rule(
  id: ResumeStructureRuleResult['id'],
  weight: number,
  factor: number,
  resumePaths: string[]
): ResumeStructureRuleResult {
  return {
    id,
    weight,
    factor: round(factor),
    points: round(weight * factor),
    resumePaths
  }
}

function ratio(values: readonly boolean[]) {
  if (values.length === 0) return 0
  return values.filter(Boolean).length / values.length
}

function collectionFactor<Value>(
  values: readonly Value[],
  predicate: (value: Value) => boolean
) {
  return values.length === 0 ? 0 : ratio(values.map(predicate))
}

function readableLength(value: string, minimum: number, maximum: number) {
  const length = value.trim().length
  return length >= minimum && length <= maximum
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000
}
