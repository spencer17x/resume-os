import { z } from 'zod'
import { AgentOutputError, extractJsonText } from '@/lib/agent/json'
import { createJobInputFingerprint, createStableJobDomainId } from './job-domain'
import {
  interviewQuestionSchema,
  interviewReviewSchema,
  interviewSessionSchema,
  type InterviewQuestion,
  type InterviewReview,
  type InterviewSession
} from './interview-domain'

const reviewOutputSchema = z.object({
  summary: z.string().trim().min(1).max(20_000),
  strengths: z.array(z.string().trim().min(1).max(1_200)).max(20),
  gaps: z.array(z.string().trim().min(1).max(1_200)).max(20),
  suggestions: z.array(z.string().trim().min(1).max(1_200)).max(20),
  prediction: z.object({
    outcome: z.enum(['likely-pass', 'uncertain', 'likely-fail']),
    passProbability: z.number().finite().min(0).max(1),
    confidence: z.number().finite().min(0).max(1),
    rationale: z.array(z.string().trim().min(1).max(1_200)).min(1).max(12)
  }).strict()
}).strict()

export const interviewReviewRequestSchema = z.object({
  locale: z.enum(['zh', 'en']).default('zh'),
  job: z.object({
    title: z.string().trim().min(1).max(500),
    company: z.string().trim().max(500),
    description: z.string().trim().max(50_000)
  }).strict(),
  session: interviewSessionSchema,
  questions: z.array(interviewQuestionSchema).max(100)
}).strict()

export type InterviewReviewRequest = z.infer<typeof interviewReviewRequestSchema>

export function buildInterviewReviewPrompt(input: InterviewReviewRequest) {
  const language = input.locale === 'zh' ? 'Simplified Chinese' : 'English'
  return {
    system: `You review a candidate's self-reported interview notes. Return exactly one JSON object and no markdown. Write in ${language}. Do not infer protected or sensitive traits. Do not claim to know the employer's decision. The prediction is advisory and must be based only on the supplied interview content. Required shape: {"summary":"...","strengths":["..."],"gaps":["..."],"suggestions":["..."],"prediction":{"outcome":"likely-pass|uncertain|likely-fail","passProbability":0.0,"confidence":0.0,"rationale":["..."]}}.`,
    user: JSON.stringify({
      job: input.job,
      interview: {
        round: input.session.round,
        format: input.session.format,
        stage: input.session.stage,
        notes: input.session.notes,
        questions: input.questions.map(({ question, userAnswer }) => ({ question, userAnswer }))
      }
    })
  }
}

export function parseInterviewReviewOutput(text: string) {
  try {
    return reviewOutputSchema.parse(JSON.parse(extractJsonText(text)))
  } catch (error) {
    if (error instanceof AgentOutputError) throw error
    throw new AgentOutputError('AI_OUTPUT_INVALID')
  }
}

export function createInterviewReview(input: {
  session: InterviewSession
  questions: InterviewQuestion[]
  output: z.infer<typeof reviewOutputSchema>
  model: string
  now: string
  locale: 'zh' | 'en'
}): InterviewReview {
  const inputFingerprint = createJobInputFingerprint({
    session: input.session,
    questions: input.questions.map(({ id, question, userAnswer }) => ({ id, question, userAnswer }))
  })
  return interviewReviewSchema.parse({
    id: createStableJobDomainId('interview-review', [input.session.id, inputFingerprint]),
    sessionId: input.session.id,
    inputFingerprint,
    ...input.output,
    prediction: {
      ...input.output.prediction,
      disclaimer: input.locale === 'zh'
        ? '该预测仅基于你提供的面试过程，是辅助判断，不代表招聘方最终决定。'
        : 'This estimate uses only your interview report and does not represent the employer’s final decision.'
    },
    model: input.model,
    createdAt: input.now,
    updatedAt: input.now
  })
}
