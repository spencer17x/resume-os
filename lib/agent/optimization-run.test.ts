import { describe, expect, it } from 'vitest'
import { scoreRequirementMatrix } from './requirement-matrix'
import {
  createOptimizationRun,
  OptimizationRunTransitionError,
  transitionOptimizationRun,
  type OptimizationRun
} from './optimization-run'

const times = [
  '2026-07-16T08:00:00.000Z',
  '2026-07-16T08:01:00.000Z',
  '2026-07-16T08:02:00.000Z',
  '2026-07-16T08:03:00.000Z',
  '2026-07-16T08:04:00.000Z',
  '2026-07-16T08:05:00.000Z',
  '2026-07-16T08:06:00.000Z',
  '2026-07-16T08:07:00.000Z',
  '2026-07-16T08:08:00.000Z'
]
const changeFingerprint = 'change-context-1'

const matches = [{
  requirementId: 'req-1',
  factIds: ['fact-1'],
  status: 'direct' as const,
  rationale: 'The verified fact directly supports this requirement.'
}]

const score = scoreRequirementMatrix({
  version: 1,
  targetJobId: 'job-1',
  inputFingerprint: 'fingerprint-1',
  requirements: [{
    id: 'req-1',
    jobId: 'job-1',
    text: 'Build reliable agent systems',
    category: 'experience',
    priority: 'must',
    weight: 5,
    keywords: ['agents'],
    userConfirmed: true
  }],
  matches
})

const gapScore = scoreRequirementMatrix({
  version: 1,
  targetJobId: 'job-1',
  inputFingerprint: 'fingerprint-1',
  requirements: [{
    id: 'req-1',
    jobId: 'job-1',
    text: 'Build reliable agent systems',
    category: 'experience',
    priority: 'must',
    weight: 5,
    keywords: ['agents'],
    userConfirmed: true
  }],
  matches: [{ ...matches[0], factIds: [], status: 'gap' }]
})

const plan = {
  id: 'plan-1',
  summary: 'Emphasize the verified agent reliability work.',
  items: [{
    id: 'item-1',
    requirementIds: ['req-1'],
    factIds: ['fact-1'],
    intent: 'Make the existing evidence easier to find.',
    transformation: 'emphasize' as const
  }]
}

const changeSet = {
  summary: 'Clarify the evidence-backed summary.',
  questions: [],
  changes: [{
    id: 'change-1',
    path: 'profile.summary.0',
    original: 'Builds systems.',
    proposed: 'Builds reliable agent systems.',
    reason: 'Matches the approved plan using verified evidence.',
    needsConfirmation: false,
    evidence: {
      requirementIds: ['req-1'],
      factIds: ['fact-1'],
      matchType: 'direct' as const,
      support: 'verified' as const,
      confidence: 0.95,
      transformation: 'emphasize' as const
    }
  }]
}

function initialRun() {
  return createOptimizationRun({
    id: 'run-1',
    sourceDraftId: 'draft-1',
    targetJobId: 'job-1',
    inputFingerprint: 'fingerprint-1',
    now: times[0]
  })
}

function runUntilEvidenceMapped() {
  let run = transitionOptimizationRun(initialRun(), { type: 'requirements-ready' }, times[1])
  run = transitionOptimizationRun(run, {
    type: 'map-evidence',
    requirementMatches: matches,
    questions: [],
    scoreBefore: score
  }, times[2])
  return run
}

function runUntilValidated() {
  let run = runUntilEvidenceMapped()
  run = transitionOptimizationRun(run, { type: 'prepare-plan', plan }, times[3])
  run = transitionOptimizationRun(run, { type: 'request-plan-approval' }, times[4])
  run = transitionOptimizationRun(run, { type: 'approve-plan' }, times[5])
  run = transitionOptimizationRun(run, {
    type: 'propose-changes', changeSet, currentFingerprint: changeFingerprint
  }, times[6])
  run = transitionOptimizationRun(run, { type: 'approve-changes', acceptedChangeIds: ['change-1'] }, times[7])
  return run
}

describe('optimization run state machine', () => {
  it('requires explicit plan and change approval before applying a variant', () => {
    const run = runUntilValidated()
    expect(run.stage).toBe('validated')
    expect(run.plan?.approvedAt).toBe(times[5])
    expect(run.acceptedChangeIds).toEqual(['change-1'])

    const applied = transitionOptimizationRun(run, {
      type: 'apply',
      currentFingerprint: changeFingerprint,
      appliedVariantId: 'variant-1',
      scoreAfter: score
    }, times[8])

    expect(applied).toMatchObject({
      stage: 'applied',
      appliedVariantId: 'variant-1',
      scoreAfter: score
    })
  })

  it('cannot generate changes before the plan approval stage', () => {
    const run = runUntilEvidenceMapped()
    expectTransitionError(
      () => transitionOptimizationRun(run, {
        type: 'propose-changes', changeSet, currentFingerprint: changeFingerprint
      }, times[3]),
      'INVALID_TRANSITION'
    )
  })

  it('rejects new optimization-run changes that omit evidence metadata', () => {
    let run = runUntilEvidenceMapped()
    run = transitionOptimizationRun(run, { type: 'prepare-plan', plan }, times[3])
    run = transitionOptimizationRun(run, { type: 'request-plan-approval' }, times[4])
    run = transitionOptimizationRun(run, { type: 'approve-plan' }, times[5])
    const { evidence: _evidence, ...legacyChange } = changeSet.changes[0]

    expectTransitionError(
      () => transitionOptimizationRun(run, {
        type: 'propose-changes',
        changeSet: { ...changeSet, changes: [legacyChange] },
        currentFingerprint: changeFingerprint
      } as never, times[6]),
      'INVALID_EVENT'
    )
  })

  it('rejects generated changes that exceed the explicitly approved plan', () => {
    let run = runUntilEvidenceMapped()
    run = transitionOptimizationRun(run, { type: 'prepare-plan', plan }, times[3])
    run = transitionOptimizationRun(run, { type: 'request-plan-approval' }, times[4])
    run = transitionOptimizationRun(run, { type: 'approve-plan' }, times[5])
    const outsidePlan = {
      ...changeSet,
      changes: [{
        ...changeSet.changes[0],
        evidence: { ...changeSet.changes[0].evidence, transformation: 'rewrite' as const }
      }]
    }

    expectTransitionError(
      () => transitionOptimizationRun(run, {
        type: 'propose-changes', changeSet: outsidePlan,
        currentFingerprint: changeFingerprint
      }, times[6]),
      'INVALID_PLAN_REFERENCE'
    )
  })

  it('pauses for evidence questions and refuses unresolved answers', () => {
    let run = transitionOptimizationRun(initialRun(), { type: 'requirements-ready' }, times[1])
    const questions = [{
      id: 'question-1',
      requirementId: 'req-1',
      prompt: 'Do you have verified evidence for this requirement?',
      status: 'open' as const,
      factIds: []
    }]
    run = transitionOptimizationRun(run, {
      type: 'map-evidence',
      requirementMatches: [{ ...matches[0], factIds: [], status: 'gap' }],
      questions,
      scoreBefore: gapScore
    }, times[2])
    expect(run.stage).toBe('awaiting-answers')

    expectTransitionError(
      () => transitionOptimizationRun(run, {
        type: 'complete-answers',
        requirementMatches: matches,
        questions
      }, times[3]),
      'UNRESOLVED_QUESTIONS'
    )

    const resumed = transitionOptimizationRun(run, {
      type: 'complete-answers',
      requirementMatches: matches,
      questions: [{ ...questions[0], status: 'answered', factIds: ['fact-1'] }]
    }, times[3])
    expect(resumed.stage).toBe('evidence-mapped')
  })

  it('resolves one question into an evidence-linked match and updated score', () => {
    let run = transitionOptimizationRun(initialRun(), { type: 'requirements-ready' }, times[1])
    run = transitionOptimizationRun(run, {
      type: 'map-evidence',
      requirementMatches: [{ ...matches[0], factIds: [], status: 'gap' }],
      questions: [{
        id: 'question-1',
        requirementId: 'req-1',
        prompt: 'Which verified fact supports this requirement?',
        status: 'open',
        factIds: []
      }],
      scoreBefore: gapScore
    }, times[2])

    const resolved = transitionOptimizationRun(run, {
      type: 'answer-question',
      questionId: 'question-1',
      resolution: 'answered',
      factIds: ['fact-1'],
      matchStatus: 'direct',
      rationale: 'The user linked a verified fact.',
      scoreBefore: score
    }, times[3])

    expect(resolved.stage).toBe('evidence-mapped')
    expect(resolved.questions[0]).toMatchObject({ status: 'answered', factIds: ['fact-1'] })
    expect(resolved.requirementMatches[0]).toMatchObject({ status: 'direct', factIds: ['fact-1'] })
    expect(resolved.scoreBefore?.requirementCoverage).toBe(100)
  })

  it('allows a user to confirm a real gap without inventing a fact', () => {
    let run = transitionOptimizationRun(initialRun(), { type: 'requirements-ready' }, times[1])
    run = transitionOptimizationRun(run, {
      type: 'map-evidence',
      requirementMatches: [{ ...matches[0], factIds: [], status: 'gap' }],
      questions: [{
        id: 'question-1',
        requirementId: 'req-1',
        prompt: 'Do you have evidence?',
        status: 'open',
        factIds: []
      }],
      scoreBefore: gapScore
    }, times[2])

    const resolved = transitionOptimizationRun(run, {
      type: 'answer-question',
      questionId: 'question-1',
      resolution: 'gap-confirmed',
      factIds: [],
      matchStatus: 'gap',
      rationale: 'The user confirmed this is a real gap.',
      scoreBefore: gapScore
    }, times[3])

    expect(resolved).toMatchObject({ stage: 'evidence-mapped' })
    expect(resolved.questions[0]).toMatchObject({ status: 'gap-confirmed', factIds: [] })
  })

  it('marks active work stale when its source fingerprint changes', () => {
    const run = runUntilValidated()
    const stale = transitionOptimizationRun(run, {
      type: 'observe-input',
      currentFingerprint: 'fingerprint-2'
    }, times[8])

    expect(stale).toMatchObject({
      stage: 'stale',
      inputFingerprint: 'fingerprint-1',
      staleBecauseFingerprint: 'fingerprint-2'
    })
    expectTransitionError(
      () => transitionOptimizationRun(stale, {
        type: 'apply',
        currentFingerprint: 'fingerprint-2',
        appliedVariantId: 'variant-1',
        scoreAfter: score
      }, times[8]),
      'INVALID_TRANSITION'
    )
  })

  it('rejects applying if the live input changed without a prior observation event', () => {
    expectTransitionError(
      () => transitionOptimizationRun(runUntilValidated(), {
        type: 'apply',
        currentFingerprint: 'fingerprint-2',
        appliedVariantId: 'variant-1',
        scoreAfter: score
      }, times[8]),
      'FINGERPRINT_MISMATCH'
    )
  })

  it('rejects plan items that cite facts outside their requirement mappings', () => {
    const run = runUntilEvidenceMapped()
    expectTransitionError(
      () => transitionOptimizationRun(run, {
        type: 'prepare-plan',
        plan: {
          ...plan,
          items: [{ ...plan.items[0], factIds: ['unmapped-fact'] }]
        }
      }, times[3]),
      'INVALID_PLAN_REFERENCE'
    )
  })

  it('rejects a score that does not describe the supplied evidence mappings', () => {
    const ready = transitionOptimizationRun(initialRun(), { type: 'requirements-ready' }, times[1])
    expectTransitionError(
      () => transitionOptimizationRun(ready, {
        type: 'map-evidence',
        requirementMatches: [{ ...matches[0], factIds: [], status: 'gap' }],
        questions: [],
        scoreBefore: score
      }, times[2]),
      'INCONSISTENT_SCORE'
    )
  })

  it('does not mutate the prior run', () => {
    const run = runUntilEvidenceMapped()
    const before = structuredClone(run)
    transitionOptimizationRun(run, { type: 'prepare-plan', plan }, times[3])
    expect(run).toEqual(before)
  })

  it('rejects unknown accepted change IDs', () => {
    let run = runUntilEvidenceMapped()
    run = transitionOptimizationRun(run, { type: 'prepare-plan', plan }, times[3])
    run = transitionOptimizationRun(run, { type: 'request-plan-approval' }, times[4])
    run = transitionOptimizationRun(run, { type: 'approve-plan' }, times[5])
    run = transitionOptimizationRun(run, {
      type: 'propose-changes', changeSet, currentFingerprint: changeFingerprint
    }, times[6])

    expectTransitionError(
      () => transitionOptimizationRun(run, {
        type: 'approve-changes',
        acceptedChangeIds: ['unknown-change']
      }, times[7]),
      'UNKNOWN_CHANGE'
    )
  })

  it('discards a proposed change set and returns to generation without reviving it on reload', () => {
    let run = runUntilEvidenceMapped()
    run = transitionOptimizationRun(run, { type: 'prepare-plan', plan }, times[3])
    run = transitionOptimizationRun(run, { type: 'request-plan-approval' }, times[4])
    run = transitionOptimizationRun(run, { type: 'approve-plan' }, times[5])
    run = transitionOptimizationRun(run, {
      type: 'propose-changes', changeSet, currentFingerprint: changeFingerprint
    }, times[6])

    const discarded = transitionOptimizationRun(run, { type: 'discard-changes' }, times[7])

    expect(discarded).toMatchObject({ stage: 'generating-changes' })
    expect(discarded.changeSet).toBeUndefined()
    expect(discarded.changeInputFingerprint).toBeUndefined()
    expect(discarded.acceptedChangeIds).toBeUndefined()
  })

  it('supports explicit failure and abandonment only for active runs', () => {
    const failed = transitionOptimizationRun(initialRun(), {
      type: 'fail',
      message: 'The selected provider could not complete the task.'
    }, times[1])
    expect(failed).toMatchObject({ stage: 'failed', failureMessage: expect.any(String) })

    const abandoned = transitionOptimizationRun(initialRun(), { type: 'abandon' }, times[1])
    expect(abandoned.stage).toBe('abandoned')
    expectTransitionError(
      () => transitionOptimizationRun(abandoned, { type: 'abandon' }, times[2]),
      'INVALID_TRANSITION'
    )
  })
})

function expectTransitionError(
  operation: () => OptimizationRun,
  code: OptimizationRunTransitionError['code']
) {
  try {
    operation()
    throw new Error('Expected transition to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(OptimizationRunTransitionError)
    expect((error as OptimizationRunTransitionError).code).toBe(code)
  }
}
