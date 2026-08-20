'use client'

import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  CircleStop,
  Link2,
  Plus,
  Settings2,
  TriangleAlert
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  confirmAgentQuestionGap,
  loadActiveAgentWorkspace,
  resolveAgentQuestionWithFact,
  resolveAgentQuestionWithNewFact,
  type AgentWorkspace
} from '@/lib/agent/agent-workspace'
import { createDomainStore, type CareerFact } from '@/lib/agent/domain-store'
import { aiFetch } from '@/lib/agent/browser-config'
import {
  buildOptimizationPlanTargets,
  OPTIMIZATION_PLAN_JSON_SCHEMA,
  prepareOptimizationPlan,
  type OptimizationPlanTarget
} from '@/lib/agent/optimization-plan'
import { buildOptimizationPlanPrompt } from '@/lib/agent/optimization-plan-prompt'
import { readAiProviderPreference } from '@/lib/agent/provider-preference'
import {
  ChromeBuiltInAiError,
  ChromeBuiltInAiProvider,
  ProviderRoutingError,
  localLanguagePolicyForLocale,
  runPreferredProviderTask,
  type StructuredTaskInput
} from '@/lib/agent/providers'
import type {
  AgentStage,
  OptimizationPlan
} from '@/lib/agent/optimization-run'
import { isOperationalOptimizationPlanItem } from '@/lib/agent/optimization-run'
import {
  ACTIVE_WORKFLOW_CHANGED_EVENT,
  approveOptimizationPlan,
  persistOptimizationPlan,
  saveActiveWorkflowPreference
} from '@/lib/agent/workflow-persistence'
import {
  createResumeId,
  type ResumeData
} from '@/lib/resume-model'

export interface AgentWorkspaceService {
  load(): Promise<AgentWorkspace | null>
  linkFact(input: {
    workspace: AgentWorkspace
    questionId: string
    factId: string
    status: 'direct' | 'partial'
    rationale: string
    now: string
  }): Promise<AgentWorkspace>
  addFact(input: {
    workspace: AgentWorkspace
    questionId: string
    factId: string
    evidenceSourceId: string
    text: string
    kind: CareerFact['kind']
    status: 'direct' | 'partial'
    rationale: string
    now: string
  }): Promise<AgentWorkspace>
  confirmGap(input: {
    workspace: AgentWorkspace
    questionId: string
    rationale: string
    now: string
  }): Promise<AgentWorkspace>
  preparePlan(input: {
    workspace: AgentWorkspace
    instruction: string
    locale: 'zh' | 'en'
    resumeTargets: OptimizationPlanTarget[]
    signal?: AbortSignal
    onDownloadProgress?: (progress: number) => void
    now: string
  }): Promise<{
    workspace: AgentWorkspace
    execution: { provider: string; model: string }
  }>
  approvePlan(input: {
    workspace: AgentWorkspace
    now: string
  }): Promise<AgentWorkspace>
}

export function AgentWorkflowPanel({
  activeDraftId,
  resume,
  instruction = '',
  service: serviceOverride,
  workspaceSnapshot,
  onWorkspaceChange
}: {
  activeDraftId: string
  resume: ResumeData
  instruction?: string
  service?: AgentWorkspaceService
  workspaceSnapshot?: AgentWorkspace | null
  onWorkspaceChange?: (workspace: AgentWorkspace | null) => void
}) {
  const t = useTranslations('agent.workflow')
  const providerErrors = useTranslations('agent.errors')
  const locale = useLocale() as 'zh' | 'en'
  const [service] = useState(() => serviceOverride ?? createAgentWorkspaceService())
  const [loadedWorkspace, setWorkspace] = useState<AgentWorkspace | null>(null)
  const [workspaceLoading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingQuestionId, setPendingQuestionId] = useState('')
  const [planPending, setPlanPending] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [execution, setExecution] = useState<{ provider: string; model: string } | null>(null)
  const planControllerRef = useRef<AbortController | null>(null)
  const onWorkspaceChangeRef = useRef(onWorkspaceChange)
  const loadSequenceRef = useRef(0)
  const ignoreWorkflowEventRef = useRef(false)
  const controlled = workspaceSnapshot !== undefined
  const workspace = controlled ? workspaceSnapshot : loadedWorkspace
  const loading = controlled ? false : workspaceLoading

  useEffect(() => { onWorkspaceChangeRef.current = onWorkspaceChange }, [onWorkspaceChange])

  useEffect(() => {
    if (controlled) return
    let active = true
    const sequence = ++loadSequenceRef.current
    void service.load().then((next) => {
      if (active && sequence === loadSequenceRef.current) {
        setWorkspace(next)
        onWorkspaceChangeRef.current?.(next)
      }
    }).catch(() => {
      if (active) setError(t('loadError'))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [controlled, service, t])

  useEffect(() => {
    let active = true
    const refresh = () => {
      if (ignoreWorkflowEventRef.current) return
      const sequence = ++loadSequenceRef.current
      void service.load().then((next) => {
        if (!active || sequence !== loadSequenceRef.current) return
        if (!controlled) setWorkspace(next)
        onWorkspaceChangeRef.current?.(next)
      }).catch(() => {
        if (active) setError(t('loadError'))
      })
    }
    window.addEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, refresh)
    return () => {
      active = false
      window.removeEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, refresh)
      planControllerRef.current?.abort()
    }
  }, [controlled, service, t])

  async function runQuestionAction(
    questionId: string,
    action: (current: AgentWorkspace) => Promise<AgentWorkspace>
  ) {
    if (!workspace) return
    setPendingQuestionId(questionId)
    setError('')
    try {
      const next = await action(workspace)
      setWorkspace(next)
      onWorkspaceChangeRef.current?.(next)
      announceActiveWorkspace(next)
    } catch {
      setError(t('saveError'))
    } finally {
      setPendingQuestionId('')
    }
  }

  async function preparePlan() {
    if (!workspace || workspace.summary.run.stage !== 'evidence-mapped') return
    if (!instruction.trim()) {
      setError(t('instructionRequired'))
      return
    }
    const resumeTargets = buildOptimizationPlanTargets(resume)
    if (resumeTargets.length === 0) {
      setError(t('noSafeTargets'))
      return
    }
    planControllerRef.current?.abort()
    const controller = new AbortController()
    planControllerRef.current = controller
    setPlanPending(true)
    setDownloadProgress(null)
    setError('')
    try {
      const result = await service.preparePlan({
        workspace,
        instruction: instruction.trim(),
        locale,
        resumeTargets,
        signal: controller.signal,
        onDownloadProgress: setDownloadProgress,
        now: new Date().toISOString()
      })
      if (controller.signal.aborted) return
      setWorkspace(result.workspace)
      setExecution(result.execution)
      onWorkspaceChangeRef.current?.(result.workspace)
      announceActiveWorkspace(result.workspace)
    } catch (caught) {
      if (!controller.signal.aborted) {
        if (caught instanceof ProviderRoutingError) {
          setError(providerErrors('CLOUD_FALLBACK_NOT_ALLOWED'))
        } else if (caught instanceof ChromeBuiltInAiError) {
          const code = caught.code === 'MODEL_UNAVAILABLE'
            ? 'LOCAL_MODEL_UNAVAILABLE'
            : caught.code === 'INVALID_MODEL_OUTPUT'
              ? 'AI_OUTPUT_INVALID'
              : caught.code
          setError(providerErrors(code as 'LOCAL_MODEL_UNAVAILABLE'))
        } else {
          setError(t('planError'))
        }
      }
    } finally {
      if (planControllerRef.current === controller) {
        planControllerRef.current = null
        setPlanPending(false)
        setDownloadProgress(null)
      }
    }
  }

  function cancelPlan() {
    planControllerRef.current?.abort()
  }

  async function approvePlan() {
    if (!workspace || workspace.summary.run.stage !== 'awaiting-plan-approval') return
    if (workspace.summary.run.plan?.items.some(
      (item) => !isOperationalOptimizationPlanItem(item)
    )) {
      setError(t('legacyPlanUnsupported'))
      return
    }
    setPlanPending(true)
    setError('')
    try {
      const next = await service.approvePlan({
        workspace,
        now: new Date().toISOString()
      })
      setWorkspace(next)
      onWorkspaceChangeRef.current?.(next)
      announceActiveWorkspace(next)
    } catch {
      setError(t('saveError'))
    } finally {
      setPlanPending(false)
    }
  }

  function announceActiveWorkspace(next: AgentWorkspace) {
    ignoreWorkflowEventRef.current = true
    try {
      saveActiveWorkflowPreference(next.summary.preference)
    } finally {
      ignoreWorkflowEventRef.current = false
    }
  }

  if (loading) return <section className="agent-workflow-panel" aria-label={t('title')}><p>{t('loading')}</p></section>
  if (!workspace) {
    return <section className="agent-workflow-panel" aria-label={t('title')}>
      <header><CircleHelp size={16} aria-hidden="true" /><h3>{t('noRun')}</h3></header>
      <p>{t('noRunDescription')}</p>
      <WorkflowSteps current={0} />
      <a className="agent-workflow-panel__next" href={`/${locale}/jobs/target-job`}>
        {t('openTargetJob')}<ArrowRight size={14} aria-hidden="true" />
      </a>
    </section>
  }
  if (workspace.summary.run.sourceDraftId !== activeDraftId) {
    return <section className="agent-workflow-panel" aria-label={t('title')}>
      <header><TriangleAlert size={16} aria-hidden="true" /><h3>{t('differentDraft')}</h3></header>
      <p>{t('differentDraftDescription')}</p>
      <a className="agent-workflow-panel__next" href={`/${locale}/jobs/target-job`}>
        {t('analyzeCurrentDraft')}<ArrowRight size={14} aria-hidden="true" />
      </a>
    </section>
  }

  const run = workspace.summary.run
  const openQuestions = run.questions.filter((question) => question.status === 'open')
  const planTargets = new Map(
    buildOptimizationPlanTargets(resume).map((target) => [target.path, target])
  )
  const planIsOperational = run.plan?.items.every((item) => {
    if (!isOperationalOptimizationPlanItem(item)) return false
    const target = planTargets.get(item.targetPath)
    return target?.transformations.includes(item.transformation) ?? false
  }) ?? true
  const requirementsById = new Map(
    workspace.matrix.requirements.map((requirement) => [requirement.id, requirement.text])
  )
  const factsById = new Map(workspace.facts.map((fact) => [fact.id, fact.text]))

  return (
    <section className="agent-workflow-panel" aria-labelledby="agent-workflow-title" data-stage={run.stage}>
      <header>
        <span>{t('eyebrow')}</span>
        <h3 id="agent-workflow-title">{workspace.summary.targetJob.title}</h3>
        <p>{t(`stages.${run.stage}`)}</p>
      </header>
      <WorkflowSteps current={workflowStep(run.stage)} />
      {error ? <p className="resume-app-error" role="alert">{error}</p> : null}
      {openQuestions.length > 0 ? (
        <div className="agent-workflow-panel__questions">
          {openQuestions.map((question) => (
            <AgentQuestionCard
              key={question.id}
              question={question}
              requirement={workspace.matrix.requirements.find(
                ({ id }) => id === question.requirementId
              )}
              facts={workspace.facts}
              pending={pendingQuestionId === question.id}
              onLinkFact={(factId, status) => runQuestionAction(question.id, async (current) => service.linkFact({
                workspace: current,
                questionId: question.id,
                factId,
                status,
                rationale: t('linkedFactRationale'),
                now: new Date().toISOString()
              }))}
              onAddFact={(text, kind, status) => runQuestionAction(question.id, async (current) => service.addFact({
                workspace: current,
                questionId: question.id,
                factId: createResumeId('fact'),
                evidenceSourceId: createResumeId('evidence'),
                text,
                kind,
                status,
                rationale: t('newFactRationale'),
                now: new Date().toISOString()
              }))}
              onConfirmGap={() => runQuestionAction(question.id, async (current) => service.confirmGap({
                workspace: current,
                questionId: question.id,
                rationale: t('gapRationale'),
                now: new Date().toISOString()
              }))}
            />
          ))}
        </div>
      ) : run.stage === 'evidence-mapped' ? (
        <div className="agent-workflow-panel__plan-action">
          <p className="agent-workflow-panel__ready">
            <CheckCircle2 size={15} aria-hidden="true" />{t('evidenceReady')}
          </p>
          <button
            type="button"
            onClick={() => planPending ? cancelPlan() : void preparePlan()}
          >
            {planPending ? <CircleStop size={13} aria-hidden="true" /> : null}
            {planPending ? t('cancelPlan') : t('preparePlan')}
          </button>
          {downloadProgress !== null ? <div className="resume-app-download" role="status">
            <span>{t('localModelDownload', { percentage: Math.round(downloadProgress * 100) })}</span>
            <progress aria-label={t('localModelDownloadLabel')} value={downloadProgress} max={1} />
            <a href={`/${locale}/jobs/settings`}>
              <Settings2 size={13} aria-hidden="true" />{t('openSettings')}
            </a>
          </div> : null}
        </div>
      ) : run.plan ? (
        <div className="agent-workflow-panel__plan">
          <header>
            <h4>{t('planTitle')}</h4>
            {execution ? <span>{t('providerUsed', execution)}</span> : null}
          </header>
          <p>{run.plan.summary}</p>
          <ol>{run.plan.items.map((item) => (
            <li key={item.id}>
              <strong>{t(`transformations.${item.transformation}`)}</strong>
              <span>{item.intent}</span>
              <dl className="agent-workflow-panel__plan-details">
                <div>
                  <dt>{t('targetPath')}</dt>
                  <dd>{item.targetPath ?? t('legacyTarget')}</dd>
                </div>
                <div>
                  <dt>{t('currentContent')}</dt>
                  <dd>{formatPlanTarget(
                    item.targetPath ? planTargets.get(item.targetPath)?.current : undefined,
                    t('legacyTarget')
                  )}</dd>
                </div>
                <div>
                  <dt>{t('planRequirements')}</dt>
                  <dd>{resolveReferenceText(
                    item.requirementIds,
                    requirementsById,
                    t('unavailableReference'),
                    t('none')
                  )}</dd>
                </div>
                <div>
                  <dt>{t('planFacts')}</dt>
                  <dd>{resolveReferenceText(
                    item.factIds,
                    factsById,
                    t('unavailableReference'),
                    t('none')
                  )}</dd>
                </div>
              </dl>
            </li>
          ))}</ol>
          {run.stage === 'awaiting-plan-approval' ? (
            <>
              {!planIsOperational ? (
                <p className="resume-app-error" role="alert">{t('legacyPlanUnsupported')}</p>
              ) : null}
              <button
                type="button"
                disabled={planPending || !planIsOperational}
                onClick={() => void approvePlan()}
              >
              {planPending ? t('approvingPlan') : t('approvePlan')}
              </button>
            </>
          ) : (
            <p className="agent-workflow-panel__ready">
              <CheckCircle2 size={15} aria-hidden="true" />{t('planApproved')}
            </p>
          )}
        </div>
      ) : (
        <p className="agent-workflow-panel__ready">
          <CheckCircle2 size={15} aria-hidden="true" />{t('noOpenQuestions')}
        </p>
      )}
    </section>
  )
}

function AgentQuestionCard({
  question,
  requirement,
  facts,
  pending,
  onLinkFact,
  onAddFact,
  onConfirmGap
}: {
  question: AgentWorkspace['summary']['run']['questions'][number]
  requirement?: AgentWorkspace['matrix']['requirements'][number]
  facts: CareerFact[]
  pending: boolean
  onLinkFact: (factId: string, status: 'direct' | 'partial') => Promise<void>
  onAddFact: (text: string, kind: CareerFact['kind'], status: 'direct' | 'partial') => Promise<void>
  onConfirmGap: () => Promise<void>
}) {
  const t = useTranslations('agent.workflow')
  const rankedFacts = useMemo(
    () => rankCareerFactsForRequirement(requirement, facts),
    [facts, requirement]
  )
  const suggestedFactId = rankedFacts[0]?.score > 0 ? rankedFacts[0].fact.id : ''
  const [factId, setFactId] = useState(suggestedFactId || rankedFacts[0]?.fact.id || '')
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<'direct' | 'partial'>('direct')
  const [kind, setKind] = useState<CareerFact['kind']>('experience')

  return (
    <article className="agent-workflow-panel__question">
      <h4>{question.prompt}</h4>
      <label>
        <span>{t('matchStrength')}</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} disabled={pending}>
          <option value="direct">{t('direct')}</option>
          <option value="partial">{t('partial')}</option>
        </select>
      </label>
      <div className="agent-workflow-panel__existing">
        <label>
          <span>{t('existingFact')}</span>
          <select value={factId} onChange={(event) => setFactId(event.target.value)} disabled={pending || rankedFacts.length === 0}>
            {rankedFacts.length === 0 ? <option value="">{t('noFacts')}</option> : rankedFacts.map(({ fact }) => (
              <option key={fact.id} value={fact.id}>{fact.text} · {t(`verification.${fact.verification}`)}</option>
            ))}
          </select>
        </label>
        <button type="button" disabled={pending || !factId} onClick={() => void onLinkFact(factId, status)}>
          <Link2 size={13} aria-hidden="true" />{t('linkFact')}
        </button>
      </div>
      {suggestedFactId ? (
        <p className="agent-workflow-panel__suggestion">{t('suggestedFact')}</p>
      ) : null}
      <div className="agent-workflow-panel__new-fact">
        <label>
          <span>{t('newFact')}</span>
          <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} disabled={pending} />
        </label>
        <label>
          <span>{t('factKind')}</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as CareerFact['kind'])} disabled={pending}>
            {(['experience', 'project', 'skill', 'achievement', 'metric'] as const).map((value) => (
              <option key={value} value={value}>{t(`kinds.${value}`)}</option>
            ))}
          </select>
        </label>
        <button type="button" disabled={pending || !answer.trim()} onClick={() => void onAddFact(answer.trim(), kind, status)}>
          <Plus size={13} aria-hidden="true" />{t('addFact')}
        </button>
      </div>
      <button className="agent-workflow-panel__gap" type="button" disabled={pending} onClick={() => void onConfirmGap()}>
        <TriangleAlert size={13} aria-hidden="true" />{t('confirmGap')}
      </button>
    </article>
  )
}

export function rankCareerFactsForRequirement(
  requirement: AgentWorkspace['matrix']['requirements'][number] | undefined,
  facts: readonly CareerFact[]
) {
  if (!requirement) return facts.map((fact) => ({ fact, score: 0 }))
  const requirementText = [
    requirement.text,
    ...requirement.keywords
  ].join(' ')
  const requirementTerms = evidenceTerms(requirementText)
  const compactRequirement = compactEvidenceText(requirementText)

  return facts.map((fact) => {
    const factText = [
      fact.text,
      ...(fact.tags ?? []),
      fact.context?.company,
      fact.context?.role,
      fact.context?.project
    ].filter(Boolean).join(' ')
    const factTerms = evidenceTerms(factText)
    const compactFact = compactEvidenceText(factText)
    const overlap = [...requirementTerms].filter((term) => factTerms.has(term)).length
    const containment = compactRequirement.length >= 4
      && compactFact.length >= 4
      && (
        compactRequirement.includes(compactFact)
        || compactFact.includes(compactRequirement)
      )
      ? 8
      : 0
    return { fact, score: overlap * 3 + containment }
  }).sort((left, right) => (
    right.score - left.score || left.fact.id.localeCompare(right.fact.id)
  ))
}

function evidenceTerms(value: string) {
  const normalized = value.normalize('NFKC').toLocaleLowerCase()
  const terms = new Set(
    (normalized.match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((term) => term.length > 1)
  )
  const han = [...normalized.matchAll(/[\p{Script=Han}]+/gu)]
    .map(([match]) => match)
    .join('')
  for (let index = 0; index < han.length - 1; index += 1) {
    terms.add(han.slice(index, index + 2))
  }
  return terms
}

function compactEvidenceText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function WorkflowSteps({ current }: { current: number }) {
  const t = useTranslations('agent.workflow')
  const steps = t.raw('steps') as string[]
  return (
    <ol className="agent-workflow-panel__steps" aria-label={t('progress')}>
      {steps.map((step, index) => (
        <li
          key={step}
          data-complete={index < current}
          data-current={index === current}
          aria-current={index === current ? 'step' : undefined}
        >
          <span>{index + 1}</span>{step}
        </li>
      ))}
    </ol>
  )
}

function workflowStep(stage: AgentStage) {
  if (stage === 'draft') return 0
  if (['requirements-ready', 'awaiting-answers', 'evidence-mapped'].includes(stage)) return 1
  if (['plan-ready', 'awaiting-plan-approval'].includes(stage)) return 2
  if (['generating-changes', 'awaiting-change-approval', 'validated'].includes(stage)) return 3
  if (stage === 'applied') return 4
  return 0
}

function formatPlanTarget(value: OptimizationPlanTarget['current'] | undefined, fallback: string) {
  if (typeof value === 'string') return value || fallback
  if (Array.isArray(value)) return value.join(' · ') || '—'
  return fallback
}

function resolveReferenceText(
  ids: readonly string[],
  values: ReadonlyMap<string, string>,
  unavailable: string,
  empty: string
) {
  if (ids.length === 0) return empty
  return ids.map((id) => values.get(id) ?? unavailable).join(' · ')
}

export function createAgentWorkspaceService(): AgentWorkspaceService {
  const store = createDomainStore()
  return {
    load: () => loadActiveAgentWorkspace({ store }),
    async linkFact(input) {
      return (await resolveAgentQuestionWithFact({ store, ...input })).workspace
    },
    async addFact(input) {
      return (await resolveAgentQuestionWithNewFact({ store, ...input })).workspace
    },
    async confirmGap(input) {
      return (await confirmAgentQuestionGap({ store, ...input })).workspace
    },
    async preparePlan(input) {
      const relevantFacts = selectPlanRelevantCareerFacts(
        input.workspace.facts,
        input.workspace.summary.run.requirementMatches
      )
      const context = {
        sourceDraftId: input.workspace.summary.run.sourceDraftId,
        targetJobId: input.workspace.summary.run.targetJobId,
        requirements: input.workspace.matrix.requirements,
        requirementMatches: input.workspace.summary.run.requirementMatches,
        careerFacts: relevantFacts,
        resumeTargets: input.resumeTargets
      }
      const request = {
        locale: input.locale,
        instruction: input.instruction,
        ...context
      }
      const prompt = buildOptimizationPlanPrompt(request)
      const taskInput: StructuredTaskInput<OptimizationPlan> = {
        task: {
          kind: 'prepare-optimization-plan',
          expectedInputLanguages: [input.locale],
          expectedOutputLanguages: [input.locale],
          localLanguagePolicy: localLanguagePolicyForLocale(input.locale)
        },
        system: prompt.system,
        prompt: prompt.user,
        jsonSchema: OPTIMIZATION_PLAN_JSON_SCHEMA,
        validate: (value) => prepareOptimizationPlan(context, value),
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.onDownloadProgress ? { onDownloadProgress: input.onDownloadProgress } : {})
      }
      const result = await runPreferredProviderTask({
        preference: readAiProviderPreference(),
        localProvider: new ChromeBuiltInAiProvider(),
        input: taskInput,
        runCloudTask: () => requestCloudPlan(request, context, input.signal)
      })
      const run = await persistOptimizationPlan({
        store,
        optimizationRunId: input.workspace.summary.run.id,
        plan: result.value,
        now: input.now
      })
      return {
        workspace: {
          ...input.workspace,
          summary: { ...input.workspace.summary, run }
        },
        execution: { provider: result.provider, model: result.model }
      }
    },
    async approvePlan(input) {
      const run = await approveOptimizationPlan({
        store,
        optimizationRunId: input.workspace.summary.run.id,
        now: input.now
      })
      return {
        ...input.workspace,
        summary: { ...input.workspace.summary, run }
      }
    }
  }
}

export function selectPlanRelevantCareerFacts(
  facts: readonly CareerFact[],
  matches: AgentWorkspace['summary']['run']['requirementMatches']
) {
  const referencedFactIds = new Set(matches.flatMap((match) => match.factIds))
  return facts.filter((fact) => referencedFactIds.has(fact.id))
}

async function requestCloudPlan(
  request: Parameters<typeof buildOptimizationPlanPrompt>[0],
  context: Parameters<typeof prepareOptimizationPlan>[0],
  signal?: AbortSignal
) {
  const response = await aiFetch('/api/resume/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    ...(signal ? { signal } : {})
  })
  const body = await response.json() as { plan?: unknown; model?: unknown }
  if (!response.ok) throw new Error('PLAN_REQUEST_FAILED')
  return {
    value: prepareOptimizationPlan(context, body.plan),
    provider: 'OpenAI-compatible',
    model: typeof body.model === 'string' && body.model.trim()
      ? body.model
      : 'configured-model'
  }
}
