import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildJDRequirementAnalysis } from './jd-report'
import { createDomainStore } from './domain-store'
import {
  confirmAgentQuestionGap,
  loadActiveAgentWorkspace,
  resolveAgentQuestionWithFact,
  resolveAgentQuestionWithNewFact
} from './agent-workspace'
import {
  persistAnalysisAsOptimizationRun,
  saveActiveWorkflowPreference
} from './workflow-persistence'
import { scoreRequirementMatrix } from './requirement-matrix'
import { normalizeResumeData } from '@/lib/resume-model'

const now = '2026-07-16T08:00:00.000Z'
const extractedAnalysis = buildJDRequirementAnalysis({
  report: {
    jobTitle: 'Platform Lead',
    company: '',
    requirements: [{
      text: 'Lead a platform migration', category: 'experience',
      priority: 'must', weight: 5, keywords: ['migration']
    }],
    resumeEmphasis: [],
    interviewPrep: []
  },
  jobDescription: 'Lead a platform migration',
  locale: 'en',
  resume: normalizeResumeData({
    profile: { name: 'Ada', title: 'Engineer' },
    metadata: { source: 'paste', locale: 'en', updatedAt: now }
  }),
  timestamp: now
})
const confirmedMatrix = {
  ...extractedAnalysis.matrix,
  requirements: extractedAnalysis.matrix.requirements.map((requirement) => ({
    ...requirement,
    userConfirmed: true
  }))
}
const analysis = {
  ...extractedAnalysis,
  matrix: confirmedMatrix,
  score: scoreRequirementMatrix(confirmedMatrix)
}

beforeEach(() => window.localStorage.clear())

async function workspaceHarness(analysisInput = analysis) {
  const store = createDomainStore({
    databaseName: `agent-workspace-${crypto.randomUUID()}`,
    indexedDB: new IDBFactory()
  })
  await persistAnalysisAsOptimizationRun({
    store,
    analysis: analysisInput,
    sourceDraftId: 'draft-1',
    runId: 'run-1',
    locale: 'en',
    now
  })
  saveActiveWorkflowPreference({
    targetJobId: analysisInput.targetJob.id,
    optimizationRunId: 'run-1'
  })
  const workspace = await loadActiveAgentWorkspace({ store })
  if (!workspace) throw new Error('Expected active workspace')
  return { store, workspace }
}

describe('active Agent workspace', () => {
  it('reconstructs the active matrix and open questions from IndexedDB', async () => {
    const { store, workspace } = await workspaceHarness()
    expect(workspace.summary.run.stage).toBe('awaiting-answers')
    expect(workspace.matrix.requirements).toHaveLength(1)
    expect(workspace.summary.run.questions).toHaveLength(1)
    await store.close()
  })

  it('atomically creates a user-confirmed answer fact and resumes the run', async () => {
    const { store, workspace } = await workspaceHarness()
    const questionId = workspace.summary.run.questions[0].id
    const resolved = await resolveAgentQuestionWithNewFact({
      store,
      workspace,
      questionId,
      factId: 'fact-answer-1',
      evidenceSourceId: 'source-answer-1',
      text: 'Led a platform migration across five product teams.',
      kind: 'achievement',
      status: 'direct',
      rationale: 'The user supplied and confirmed this fact.',
      now: '2026-07-16T08:01:00.000Z'
    })

    expect(resolved.workspace.summary.run.stage).toBe('evidence-mapped')
    expect(resolved.createdFact).toMatchObject({
      id: 'fact-answer-1',
      verification: 'user-confirmed'
    })
    expect(await store.get('requirementMatches', analysis.matrix.requirements[0].id))
      .toMatchObject({ status: 'direct', factIds: ['fact-answer-1'] })
    expect(await store.get('optimizationRuns', 'run-1'))
      .toMatchObject({ stage: 'evidence-mapped' })
    await store.close()
  })

  it('explicitly confirms an imported fact when linking it to a requirement', async () => {
    const { store, workspace } = await workspaceHarness()
    await store.put('evidenceSources', {
      id: 'source-import-1',
      type: 'resume-import',
      label: 'Imported resume',
      createdAt: now
    })
    await store.put('careerFacts', {
      id: 'fact-import-1',
      kind: 'experience',
      text: 'Led a related migration.',
      evidenceRefs: ['source-import-1'],
      verification: 'imported',
      tags: [],
      createdAt: now,
      updatedAt: now
    })
    const reloaded = await loadActiveAgentWorkspace({ store })
    if (!reloaded) throw new Error('Expected active workspace')
    const resolved = await resolveAgentQuestionWithFact({
      store,
      workspace: reloaded,
      questionId: reloaded.summary.run.questions[0].id,
      factId: 'fact-import-1',
      status: 'partial',
      rationale: 'The user confirmed this imported fact is relevant.',
      now: '2026-07-16T08:01:00.000Z'
    })

    expect(resolved.workspace.facts.find((fact) => fact.id === 'fact-import-1'))
      .toMatchObject({ verification: 'user-confirmed' })
    expect(await store.get('careerFacts', 'fact-import-1'))
      .toMatchObject({ verification: 'user-confirmed' })
    await store.close()
  })

  it('records a confirmed gap without creating a career fact', async () => {
    const { store, workspace } = await workspaceHarness()
    const resolved = await confirmAgentQuestionGap({
      store,
      workspace,
      questionId: workspace.summary.run.questions[0].id,
      rationale: 'The user confirmed this is a real experience gap.',
      now: '2026-07-16T08:01:00.000Z'
    })

    expect(resolved.workspace.summary.run).toMatchObject({ stage: 'evidence-mapped' })
    expect(resolved.workspace.summary.run.questions[0]).toMatchObject({
      status: 'gap-confirmed',
      factIds: []
    })
    expect(await store.list('careerFacts')).toEqual([])
    await store.close()
  })

  it('merges concurrent answers by reading the latest run inside each transaction', async () => {
    const extracted = buildJDRequirementAnalysis({
      report: {
        jobTitle: 'Platform Lead',
        company: '',
        requirements: [{
          text: 'Lead a platform migration', category: 'experience',
          priority: 'must', weight: 5, keywords: ['migration']
        }, {
          text: 'Own reliability improvements', category: 'responsibility',
          priority: 'must', weight: 4, keywords: ['reliability']
        }],
        resumeEmphasis: [],
        interviewPrep: []
      },
      jobDescription: 'Lead a platform migration and own reliability improvements',
      locale: 'en',
      resume: normalizeResumeData({
        profile: { name: 'Ada', title: 'Engineer' },
        metadata: { source: 'paste', locale: 'en', updatedAt: now }
      }),
      timestamp: now
    })
    const matrix = {
      ...extracted.matrix,
      requirements: extracted.matrix.requirements.map((requirement) => ({
        ...requirement,
        userConfirmed: true
      }))
    }
    const multiAnalysis = {
      ...extracted,
      matrix,
      score: scoreRequirementMatrix(matrix)
    }
    const { store, workspace } = await workspaceHarness(multiAnalysis)
    const [firstQuestion, secondQuestion] = workspace.summary.run.questions

    await Promise.all([
      resolveAgentQuestionWithNewFact({
        store, workspace, questionId: firstQuestion.id,
        factId: 'fact-concurrent-1', evidenceSourceId: 'source-concurrent-1',
        text: 'Led a platform migration.', kind: 'experience', status: 'direct',
        rationale: 'Confirmed migration evidence.', now: '2026-07-16T08:01:00.000Z'
      }),
      resolveAgentQuestionWithNewFact({
        store, workspace, questionId: secondQuestion.id,
        factId: 'fact-concurrent-2', evidenceSourceId: 'source-concurrent-2',
        text: 'Owned reliability improvements.', kind: 'experience', status: 'direct',
        rationale: 'Confirmed reliability evidence.', now: '2026-07-16T08:01:01.000Z'
      })
    ])

    const persisted = await store.get('optimizationRuns', 'run-1')
    expect(persisted).toMatchObject({ stage: 'evidence-mapped' })
    expect(persisted?.questions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstQuestion.id, status: 'answered', factIds: ['fact-concurrent-1'] }),
      expect.objectContaining({ id: secondQuestion.id, status: 'answered', factIds: ['fact-concurrent-2'] })
    ]))
    expect(persisted?.requirementMatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ requirementId: firstQuestion.requirementId, factIds: ['fact-concurrent-1'] }),
      expect.objectContaining({ requirementId: secondQuestion.requirementId, factIds: ['fact-concurrent-2'] })
    ]))
    expect((await store.list('careerFacts')).map(({ id }) => id).sort()).toEqual([
      'fact-concurrent-1', 'fact-concurrent-2'
    ])
    await store.close()
  })
})
