import { aiFetch } from '@/lib/agent/browser-config'
import { createInterviewReview, interviewReviewRequestSchema } from './interview-review'

export async function requestInterviewReview(
  input: unknown,
  options: { signal?: AbortSignal; now?: () => string } = {}
) {
  const request = interviewReviewRequestSchema.parse(input)
  const response = await aiFetch('/api/interview/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: options.signal
  })
  if (!response.ok) throw new Error('INTERVIEW_REVIEW_FAILED')
  const body = await response.json() as { output?: unknown; model?: unknown }
  if (typeof body.model !== 'string') throw new Error('INTERVIEW_REVIEW_INVALID')
  return createInterviewReview({
    session: request.session,
    questions: request.questions,
    output: body.output as Parameters<typeof createInterviewReview>[0]['output'],
    model: body.model,
    now: options.now?.() ?? new Date().toISOString(),
    locale: request.locale
  })
}
