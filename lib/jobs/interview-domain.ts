import { z } from 'zod'
import { createJobInputFingerprint, createStableJobDomainId } from './job-domain'

export const RECRUITMENT_STAGES = [
  'outreach-draft',
  'awaiting-reply',
  'recruiter-replied',
  'resume-requested',
  'resume-sent',
  'interview-invited',
  'interview-scheduled',
  'interviewing',
  'awaiting-result',
  'completed'
] as const

const stableIdSchema = z.string().trim().min(1).max(160)
const timestampSchema = z.iso.datetime({ offset: true })
const boundedTextSchema = z.string().trim().min(1).max(20_000)

export const recruitmentStageSchema = z.enum(RECRUITMENT_STAGES)

export const interviewSessionSchema = z.object({
  id: stableIdSchema,
  applicationId: stableIdSchema,
  targetJobId: stableIdSchema,
  round: z.number().int().min(1).max(20),
  format: z.enum(['phone', 'video', 'onsite', 'take-home', 'other']),
  stage: z.enum(['invited', 'scheduled', 'completed', 'awaiting-result', 'passed', 'failed', 'cancelled']),
  scheduledAt: timestampSchema.optional(),
  durationMinutes: z.number().int().min(5).max(720).optional(),
  interviewerNames: z.array(z.string().trim().min(1).max(300)).max(20),
  notes: z.string().trim().max(20_000),
  userReportedResult: z.boolean(),
  resultReportedAt: timestampSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((session, context) => {
  if (session.stage === 'scheduled' && !session.scheduledAt) {
    context.addIssue({ code: 'custom', path: ['scheduledAt'], message: 'Scheduled interviews require a timestamp' })
  }
  if (['passed', 'failed'].includes(session.stage) && (!session.userReportedResult || !session.resultReportedAt)) {
    context.addIssue({ code: 'custom', path: ['userReportedResult'], message: 'Final interview outcomes require explicit user reporting' })
  }
  if (session.resultReportedAt && !session.userReportedResult) {
    context.addIssue({ code: 'custom', path: ['resultReportedAt'], message: 'Result timestamp requires explicit user reporting' })
  }
  if (Date.parse(session.updatedAt) < Date.parse(session.createdAt)) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Updated timestamp cannot precede creation' })
  }
})

export const interviewQuestionSchema = z.object({
  id: stableIdSchema,
  sessionId: stableIdSchema,
  question: boundedTextSchema,
  userAnswer: z.string().trim().max(20_000),
  suggestedAnswer: z.string().trim().max(20_000),
  feedback: z.string().trim().max(20_000),
  tags: z.array(z.string().trim().min(1).max(120)).max(50),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((question, context) => {
  if (Date.parse(question.updatedAt) < Date.parse(question.createdAt)) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Updated timestamp cannot precede creation' })
  }
})

export const interviewPredictionSchema = z.object({
  outcome: z.enum(['likely-pass', 'uncertain', 'likely-fail']),
  passProbability: z.number().finite().min(0).max(1),
  confidence: z.number().finite().min(0).max(1),
  rationale: z.array(z.string().trim().min(1).max(1_200)).min(1).max(12),
  disclaimer: z.string().trim().min(1).max(1_000)
}).strict()

export const interviewReviewSchema = z.object({
  id: stableIdSchema,
  sessionId: stableIdSchema,
  inputFingerprint: z.string().trim().min(1).max(256),
  summary: boundedTextSchema,
  strengths: z.array(z.string().trim().min(1).max(1_200)).max(20),
  gaps: z.array(z.string().trim().min(1).max(1_200)).max(20),
  suggestions: z.array(z.string().trim().min(1).max(1_200)).max(20),
  prediction: interviewPredictionSchema,
  model: z.string().trim().min(1).max(300),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict()

export type RecruitmentStage = z.infer<typeof recruitmentStageSchema>
export type InterviewSession = z.infer<typeof interviewSessionSchema>
export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>
export type InterviewReview = z.infer<typeof interviewReviewSchema>

export function createInterviewSession(input: {
  applicationId: string
  targetJobId: string
  round: number
  format: InterviewSession['format']
  scheduledAt?: string
  now: string
}) {
  return interviewSessionSchema.parse({
    id: createStableJobDomainId('interview', [input.applicationId, String(input.round)]),
    applicationId: input.applicationId,
    targetJobId: input.targetJobId,
    round: input.round,
    format: input.format,
    stage: input.scheduledAt ? 'scheduled' : 'invited',
    ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
    interviewerNames: [],
    notes: '',
    userReportedResult: false,
    createdAt: input.now,
    updatedAt: input.now
  })
}

export function recordInterviewOutcome(input: {
  session: InterviewSession
  outcome: 'passed' | 'failed'
  notes?: string
  now: string
  explicitUserReport: boolean
}) {
  if (!input.explicitUserReport) throw new TypeError('Interview outcomes require an explicit user report')
  return interviewSessionSchema.parse({
    ...input.session,
    stage: input.outcome,
    notes: input.notes?.trim() || input.session.notes,
    userReportedResult: true,
    resultReportedAt: input.now,
    updatedAt: input.now
  })
}

export function interviewReviewInputFingerprint(input: {
  session: InterviewSession
  questions: readonly InterviewQuestion[]
}) {
  return createJobInputFingerprint({
    session: {
      id: input.session.id,
      round: input.session.round,
      format: input.session.format,
      stage: input.session.stage,
      notes: input.session.notes
    },
    questions: [...input.questions]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, question, userAnswer }) => ({ id, question, userAnswer }))
  })
}
