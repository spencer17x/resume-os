'use client'

import { ArrowRight, Check, CircleAlert, LoaderCircle, MessageSquareText, Sparkles, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useResumeDraft } from '@/components/resume-draft-provider'
import {
  AgentWorkflowPanel,
  type AgentWorkspaceService
} from './agent-workflow-panel'
import type { AgentWorkspace } from '@/lib/agent/agent-workspace'
import {
  ResumeChangeSetError,
  isResumeChangeApplicable,
  localResumeRewriteJsonSchema,
  parseModelResumeChangeSet,
  parseResumeChangeSet,
  requireResumeChangeConfirmation,
  resumeChangeBlockReason,
  validateResumeChangeCandidates,
  validateResumeChangeEvidence,
  validateResumeChangesAgainstApprovedPlan,
  validateResumeChanges,
  type ResumeChange,
  type ResumeChangeSet
} from '@/lib/agent/resume-change-set'
import { aiFetch } from '@/lib/agent/browser-config'
import { createDomainStore, type CareerFact, type ResumeVariant } from '@/lib/agent/domain-store'
import { readAiProviderPreference } from '@/lib/agent/provider-preference'
import {
  ChromeBuiltInAiError,
  ChromeBuiltInAiProvider,
  ProviderRoutingError,
  localLanguagePolicyForLocale,
  runPreferredProviderTask,
  type StructuredTaskInput
} from '@/lib/agent/providers'
import {
  buildLocalResumeRewritePrompt,
  buildOptimizeResumePrompt
} from '@/lib/agent/resume-prompts'
import { scoreRequirementMatrix, type JobRequirement, type ScoreResult } from '@/lib/agent/requirement-matrix'
import { createResumeVariant } from '@/lib/agent/resume-variant'
import {
  ACTIVE_WORKFLOW_CHANGED_EVENT,
  discardOptimizationChangeSet,
  fingerprintOptimizationInputs,
  persistAcceptedResumeVariant,
  persistOptimizationChangeSet,
  persistRunInputChange
} from '@/lib/agent/workflow-persistence'
import { createResumeId } from '@/lib/resume-model'

type ApiErrorBody = { code?: string; error?: unknown }

export interface ResumeAgentRunPersistence {
  saveChangeSet(input: {
    workspace: AgentWorkspace
    changeSet: ResumeChangeSet
    currentFingerprint: string
    now: string
  }): Promise<AgentWorkspace>
  saveAppliedVariant(input: {
    workspace: AgentWorkspace
    variant: ResumeVariant
    acceptedChangeIds: string[]
    currentFingerprint: string
    scoreAfter: ScoreResult
    now: string
  }): Promise<AgentWorkspace>
  discardChangeSet(input: {
    workspace: AgentWorkspace
    now: string
  }): Promise<AgentWorkspace>
  observeInput(input: {
    workspace: AgentWorkspace
    currentFingerprint: string
    now: string
  }): Promise<AgentWorkspace>
}

export function ResumeAgentApp({
  workflowService,
  runPersistence = defaultRunPersistence
}: {
  appId?: unknown
  workflowService?: AgentWorkspaceService
  runPersistence?: ResumeAgentRunPersistence
} = {}) {
  const locale = useLocale() as 'zh' | 'en'
  const t = useTranslations('agent')
  const { activeDraft } = useResumeDraft()
  const [instruction, setInstruction] = useState('')
  const [changeSet, setChangeSet] = useState<ResumeChangeSet | null>(null)
  const [workspace, setWorkspace] = useState<AgentWorkspace | null>(null)
  const [variant, setVariant] = useState<ResumeVariant | null>(null)
  const [execution, setExecution] = useState<{ provider: string; model: string } | null>(null)
  const [suggestionContext, setSuggestionContext] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [workflowBaseline, setWorkflowBaseline] = useState<{
    runId: string
    fingerprint: string
  } | null>(null)
  const requestRef = useRef<{ id: number; controller: AbortController } | null>(null)
  const staleObservationRef = useRef('')
  const activeRef = useRef(activeDraft)
  const workspaceRef = useRef(workspace)

  const careerFacts = workspace?.facts ?? []
  const requirements = workspace?.matrix.requirements ?? []
  const run = workspace?.summary.run ?? null
  const currentInputFingerprint = workspace && activeDraft
    ? optimizationInputFingerprint(workspace, activeDraft.data)
    : null
  const expectedInputFingerprint = run?.changeInputFingerprint
    ?? (workflowBaseline && workflowBaseline.runId === run?.id
      ? workflowBaseline.fingerprint
      : null)
  const workflowInputIsStale = Boolean(
    run?.stage === 'stale'
    || (expectedInputFingerprint
    && currentInputFingerprint
    && expectedInputFingerprint !== currentInputFingerprint)
  )
  const canGenerateChanges = Boolean(
    run
    && run.sourceDraftId === activeDraft?.id
    && run.stage === 'generating-changes'
    && run.plan?.approvedAt
  )

  useEffect(() => () => requestRef.current?.controller.abort(), [])
  useEffect(() => { activeRef.current = activeDraft }, [activeDraft])
  useEffect(() => { workspaceRef.current = workspace }, [workspace])
  useEffect(() => {
    if (
      !workspace
      || !currentInputFingerprint
      || !expectedInputFingerprint
      || expectedInputFingerprint === currentInputFingerprint
      || ['applied', 'stale', 'failed', 'abandoned'].includes(workspace.summary.run.stage)
    ) return
    const marker = `${workspace.summary.run.id}:${currentInputFingerprint}`
    if (staleObservationRef.current === marker) return
    staleObservationRef.current = marker
    void runPersistence.observeInput({
      workspace,
      currentFingerprint: currentInputFingerprint,
      now: new Date().toISOString()
    }).then(setWorkspace).catch(() => setError(t('variantSaveError')))
  }, [currentInputFingerprint, expectedInputFingerprint, runPersistence, t, workspace])
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1_000)
    return () => window.clearTimeout(timer)
  }, [cooldown])
  const currentContext = activeDraft
    ? suggestionFingerprint(
      activeDraft.id,
      activeDraft.data,
      requirements,
      careerFacts
    )
    : null
  const suggestionsAreStale = Boolean(
    workflowInputIsStale
    || (changeSet && suggestionContext && currentContext !== suggestionContext)
  )
  const visibleChangeSet = suggestionsAreStale ? null : changeSet
  const visibleError = suggestionsAreStale ? t('stale') : error

  const selected = useMemo(
    () => visibleChangeSet?.changes.find((change) => change.id === selectedId) ?? visibleChangeSet?.changes[0] ?? null,
    [selectedId, visibleChangeSet]
  )
  const applicableChanges = visibleChangeSet?.changes.filter(isResumeChangeApplicable) ?? []

  function synchronizeWorkspace(next: AgentWorkspace | null) {
    const draft = activeRef.current
    workspaceRef.current = next
    if (next && draft && next.summary.run.sourceDraftId === draft.id) {
      setWorkflowBaseline({
        runId: next.summary.run.id,
        fingerprint: optimizationInputFingerprint(next, draft.data)
      })
    } else if (!next) {
      setWorkflowBaseline(null)
    }
    setWorkspace(next)
    if (!next || !draft || next.summary.run.sourceDraftId !== draft.id) return
    const persisted = next.summary.run.changeSet
    if (
      persisted
      && ['awaiting-change-approval', 'validated'].includes(next.summary.run.stage)
    ) {
      setChangeSet(persisted)
      setSuggestionContext(suggestionFingerprint(
        draft.id,
        draft.data,
        next.matrix.requirements,
        next.facts
      ))
      setSelectedId(persisted.changes[0]?.id ?? null)
      setConfirmedIds(new Set())
    } else {
      setChangeSet(null)
      setSuggestionContext(null)
      setSelectedId(null)
      setConfirmedIds(new Set())
    }
  }

  if (!activeDraft) {
    return <EmptyDraft locale={locale} title={t('createFirst')} description={t('createFirstDescription')} action={t('openStudio')} />
  }

  async function analyze() {
    const draft = activeRef.current
    const activeWorkspace = workspaceRef.current
    if (!draft || !instruction.trim() || pending || cooldown > 0) {
      if (!instruction.trim()) setError(t('instructionRequired'))
      return
    }
    if (
      !activeWorkspace
      || activeWorkspace.summary.run.sourceDraftId !== draft.id
      || activeWorkspace.summary.run.stage !== 'generating-changes'
      || !activeWorkspace.summary.run.plan?.approvedAt
    ) {
      setError(t('planApprovalRequired'))
      return
    }
    const approvedPlan = activeWorkspace.summary.run.plan!

    requestRef.current?.controller.abort()
    const controller = new AbortController()
    const id = (requestRef.current?.id ?? 0) + 1
    requestRef.current = { id, controller }
    const facts = activeWorkspace.facts
    const availableRequirements = activeWorkspace.matrix.requirements
    const fingerprint = suggestionFingerprint(draft.id, draft.data, availableRequirements, facts)
    const generationInputFingerprint = optimizationInputFingerprint(activeWorkspace, draft.data)
    setPending(true)
    setError('')

    try {
      const approvedContext = selectApprovedPlanContext(activeWorkspace)
      const cloudPromptInput = {
        resume: draft.data,
        locale,
        instruction: instruction.trim(),
        jd: activeWorkspace.summary.targetJob.description,
        requirements: approvedContext.requirements.map(({ id, text }) => ({ id, text })),
        requirementMatches: approvedContext.requirementMatches,
        careerFacts: approvedContext.facts.map(({ id, text, verification }) => ({ id, text, verification })),
        optimizationPlan: approvedPlan
      }
      const preference = readAiProviderPreference()
      const localContext = selectLocalRewriteContext(activeWorkspace, draft.data)
      const runCloudTask = () => requestCloudOptimization({
        ...cloudPromptInput,
        signal: controller.signal,
        onCooldown: setCooldown
      })
      let result
      if (!localContext) {
        if (preference.mode === 'chrome-built-in') {
          throw new ChromeBuiltInAiError(
            'MODEL_UNAVAILABLE',
            'No confirmed evidence maps to an existing narrative leaf.'
          )
        }
        if (preference.mode === 'automatic' && !preference.allowCloudFallback) {
          throw new ProviderRoutingError('CLOUD_FALLBACK_NOT_ALLOWED')
        }
        result = await runCloudTask()
      } else {
        const localPrompt = buildLocalResumeRewritePrompt({
          locale,
          instruction: instruction.trim(),
          target: localContext.target,
          requirements: localContext.requirements.map(({ id, text }) => ({ id, text })),
          requirementMatches: localContext.requirementMatches,
          careerFacts: localContext.facts.map(({ id, text, verification }) => ({
            id,
            text,
            verification
          })),
          approvedPlan: {
            id: approvedPlan.id,
            approvedAt: approvedPlan.approvedAt!,
            item: localContext.planItem
          }
        })
        const localTaskInput: StructuredTaskInput<ResumeChangeSet> = {
          task: {
            kind: 'rewrite-resume-bullet',
            expectedInputLanguages: [locale],
            expectedOutputLanguages: [locale],
            localLanguagePolicy: localLanguagePolicyForLocale(locale)
          },
          system: localPrompt.system,
          prompt: localPrompt.user,
          jsonSchema: localResumeRewriteJsonSchema({
            ...localContext.target,
            transformation: localContext.planItem.transformation
          }),
          validate(value) {
            return validateLocalProviderChangeSet(
              value,
              localContext,
              draft.data,
              facts,
              availableRequirements,
              approvedPlan,
              activeWorkspace.matrix.matches
            )
          },
          signal: controller.signal
        }
        result = await runPreferredProviderTask({
          preference,
          localProvider: new ChromeBuiltInAiProvider(),
          input: localTaskInput,
          runCloudTask
        })
      }
      if (requestRef.current?.id !== id) return
      const current = activeRef.current
      const currentWorkspace = workspaceRef.current
      if (
        !current
        || !currentWorkspace
        || currentWorkspace.summary.run.id !== activeWorkspace.summary.run.id
        || currentWorkspace.summary.run.stage !== 'generating-changes'
        || optimizationInputFingerprint(currentWorkspace, current.data) !== generationInputFingerprint
        || suggestionFingerprint(
          current.id,
          current.data,
          currentWorkspace.matrix.requirements,
          currentWorkspace.facts
        ) !== fingerprint
      ) {
        setError(t('stale'))
        return
      }
      const parsed = result.value
      let nextWorkspace: AgentWorkspace
      try {
        nextWorkspace = await runPersistence.saveChangeSet({
        workspace: currentWorkspace,
        changeSet: parsed,
        currentFingerprint: generationInputFingerprint,
        now: new Date().toISOString()
        })
      } catch {
        throw new AgentUiError('RUN_SAVE_FAILED')
      }
      workspaceRef.current = nextWorkspace
      setWorkspace(nextWorkspace)
      setChangeSet(parsed)
      setSuggestionContext(fingerprint)
      setSelectedId(parsed.changes[0]?.id ?? null)
      setConfirmedIds(new Set())
      setVariant(null)
      setExecution({ provider: result.provider, model: result.model })
    } catch (caught) {
      if (controller.signal.aborted || requestRef.current?.id !== id) return
      setError(localizedError(caught, t))
    } finally {
      if (requestRef.current?.id === id) setPending(false)
    }
  }

  async function accept(ids: string[]) {
    const activeWorkspace = workspaceRef.current
    const persistedChangeSet = activeWorkspace?.summary.run.changeSet
    const liveInputFingerprint = activeWorkspace && activeDraft
      ? optimizationInputFingerprint(activeWorkspace, activeDraft.data)
      : null
    if (
      !changeSet
      || !activeDraft
      || !activeWorkspace
      || activeWorkspace.summary.run.stage !== 'awaiting-change-approval'
      || !persistedChangeSet
      || !liveInputFingerprint
      || activeWorkspace.summary.run.changeInputFingerprint !== liveInputFingerprint
      || JSON.stringify(persistedChangeSet) !== JSON.stringify(changeSet)
    ) {
      if (activeWorkspace?.summary.run.changeInputFingerprint) setError(t('stale'))
      return
    }
    const acceptedIds = new Set(ids)
    const acceptedChanges = changeSet.changes.filter((change) => acceptedIds.has(change.id))
    if (acceptedChanges.length !== acceptedIds.size) return
    if (acceptedChanges.some((change) => !isResumeChangeApplicable(change))) return
    if (acceptedChanges.some((change) => !confirmedIds.has(change.id))) return
    try {
      const now = new Date().toISOString()
      const nextVariant = createResumeVariant({
        id: createResumeId('variant'),
        sourceDraftId: activeDraft.id,
        targetJobId: activeWorkspace.summary.run.targetJobId,
        name: `${activeDraft.name} · ${activeDraft.data.targetRole || activeDraft.data.profile.title}`,
        resume: activeDraft.data,
        changeSet: persistedChangeSet,
        acceptedIds: ids,
        now,
        facts: activeWorkspace.facts,
        requirements: activeWorkspace.matrix.requirements
      })
      const nextWorkspace = await runPersistence.saveAppliedVariant({
        workspace: activeWorkspace,
        variant: nextVariant,
        acceptedChangeIds: ids,
        currentFingerprint: liveInputFingerprint,
        scoreAfter: scoreRequirementMatrix(activeWorkspace.matrix),
        now
      })
      workspaceRef.current = nextWorkspace
      setWorkspace(nextWorkspace)
      setVariant(nextVariant)
      setChangeSet(null)
      setSuggestionContext(null)
      setSelectedId(null)
      setConfirmedIds(new Set())
      setError('')
    } catch (caught) {
      setError(caught instanceof ResumeChangeSetError ? t('applyError') : t('variantSaveError'))
    }
  }

  async function discard() {
    const activeWorkspace = workspaceRef.current
    if (!activeWorkspace || activeWorkspace.summary.run.stage !== 'awaiting-change-approval') return
    setPending(true)
    setError('')
    try {
      const nextWorkspace = await runPersistence.discardChangeSet({
        workspace: activeWorkspace,
        now: new Date().toISOString()
      })
      workspaceRef.current = nextWorkspace
      setWorkspace(nextWorkspace)
      setChangeSet(null)
      setSuggestionContext(null)
      setSelectedId(null)
      setConfirmedIds(new Set())
      setExecution(null)
    } catch {
      setError(t('variantSaveError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="resume-agent-app">
      <section className="resume-agent-app__conversation" aria-labelledby="agent-conversation-title">
        <header className="resume-app-heading">
          <span><MessageSquareText size={15} />{t('draft')}</span>
          <h2 id="agent-conversation-title">{activeDraft.name}</h2>
          <p>{activeDraft.data.profile.name} · {activeDraft.data.profile.title}</p>
        </header>
        <AgentWorkflowPanel
          activeDraftId={activeDraft.id}
          instruction={instruction}
          service={workflowService}
          workspaceSnapshot={workspace ?? undefined}
          onWorkspaceChange={synchronizeWorkspace}
        />
        <div className="resume-agent-app__form">
          <label htmlFor="agent-instruction">{t('instruction')}</label>
          <textarea id="agent-instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={t('instructionPlaceholder')} disabled={pending} />
          <button
            className="resume-app-primary"
            onClick={analyze}
            disabled={pending || cooldown > 0 || !canGenerateChanges}
          >
            {pending ? <LoaderCircle className="resume-app-spinner" size={15} /> : <Sparkles size={15} />}
            {pending ? t('analyzing') : t('analyze')}
          </button>
          {!canGenerateChanges && !visibleChangeSet ? (
            <p className="resume-agent-app__generation-lock">{t('generationLocked')}</p>
          ) : null}
          {visibleError && <p className="resume-app-error" role="alert">{visibleError}</p>}
        </div>
        {visibleChangeSet && (
          <div className="resume-agent-app__response" aria-live="polite">
            <strong>{visibleChangeSet.summary}</strong>
            {execution && <small>{t('providerUsed', execution)}</small>}
            {visibleChangeSet.questions.length > 0 && <QuestionList questions={visibleChangeSet.questions} label={t('questions')} />}
          </div>
        )}
      </section>

      <section className="resume-agent-app__actions" aria-labelledby="agent-actions-title">
        <div className="resume-app-section-title">
          <h2 id="agent-actions-title">{t('suggestions')}</h2>
          <span>{visibleChangeSet?.changes.length ?? 0}</span>
        </div>
        {!visibleChangeSet || visibleChangeSet.changes.length === 0 ? (
          <p className="resume-app-empty">{t('noSuggestions')}</p>
        ) : (
          <>
            <p className="resume-agent-app__verification-policy">{t('verificationPolicy')}</p>
            <div className="resume-agent-app__change-list">
              {visibleChangeSet.changes.map((change) => (
                <ChangeItem
                  key={change.id}
                  change={change}
                  selected={selected?.id === change.id}
                  confirmed={confirmedIds.has(change.id)}
                  onSelect={() => setSelectedId(change.id)}
                  onConfirm={(confirmed) => setConfirmedIds((current) => {
                    const next = new Set(current)
                    if (confirmed) next.add(change.id)
                    else next.delete(change.id)
                    return next
                  })}
                  onAccept={() => accept([change.id])}
                />
              ))}
            </div>
            <div className="resume-agent-app__bulk-actions">
              <button
                className="resume-app-primary"
                onClick={() => accept(applicableChanges.map(({ id }) => id))}
                disabled={
                  applicableChanges.length === 0
                  || applicableChanges.some((change) => !confirmedIds.has(change.id))
                }
              ><Check size={14} />{t('acceptAll')}</button>
              <button className="resume-app-secondary" disabled={pending} onClick={() => void discard()}><Trash2 size={14} />{t('discard')}</button>
            </div>
          </>
        )}
      </section>

      <section className="resume-agent-app__preview" aria-label={t('preview')}>
        <div className="resume-app-section-title"><h2>{t('preview')}</h2></div>
        {variant && (
          <p className="resume-agent-app__variant-status" role="status">
            {t('variantReady', { name: variant.name })}
          </p>
        )}
        {selected ? (
          <div className="resume-agent-app__comparison">
            <span className="resume-agent-app__path">{selected.path}</span>
            <article><h3>{t('before')}</h3><p>{displayValue(selected.original)}</p></article>
            <ArrowRight aria-hidden="true" size={18} />
            <article><h3>{t('after')}</h3><p>{displayValue(selected.proposed)}</p></article>
            <p className="resume-agent-app__reason">{selected.reason}</p>
            <EvidenceDetails change={selected} />
          </div>
        ) : !variant && <p className="resume-app-empty">{t('noSuggestions')}</p>}
      </section>
    </main>
  )
}

function ChangeItem({ change, selected, confirmed, onSelect, onConfirm, onAccept }: {
  change: ResumeChange
  selected: boolean
  confirmed: boolean
  onSelect: () => void
  onConfirm: (confirmed: boolean) => void
  onAccept: () => void
}) {
  const t = useTranslations('agent')
  const blocked = resumeChangeBlockReason(change)
  const blockedLabel = blocked ? t(`blocked.${blocked}`) : null
  return (
    <article className="resume-agent-app__change" data-selected={selected} data-blocked={Boolean(blocked)}>
      <div className="resume-agent-app__change-main">
        <button className="resume-agent-app__change-select" onClick={onSelect} aria-pressed={selected}>
          <span>{change.path}</span><strong>{displayValue(change.proposed)}</strong><small>{change.reason}</small>
          <em><CircleAlert size={12} />{blockedLabel ?? t('needsConfirmation')}</em>
        </button>
        {blocked ? (
          <p className="resume-agent-app__blocked-reason">{blockedLabel}</p>
        ) : (
          <label className="resume-agent-app__confirmation">
            <input type="checkbox" checked={confirmed} onChange={(event) => onConfirm(event.target.checked)} />
            <span>{t('confirmEvidence', { value: displayValue(change.proposed) })}</span>
          </label>
        )}
        <EvidenceDetails change={change} compact />
      </div>
      <button
        className="resume-agent-app__accept"
        onClick={onAccept}
        aria-label={t('accept', { value: displayValue(change.proposed) })}
        disabled={Boolean(blocked) || !confirmed}
      ><Check size={14} /></button>
    </article>
  )
}

function EvidenceDetails({ change, compact = false }: { change: ResumeChange; compact?: boolean }) {
  const t = useTranslations('agent')
  const evidence = change.evidence
  return (
    <dl className="resume-agent-app__evidence" data-compact={compact}>
      <div><dt>{t('evidence.requirements')}</dt><dd>{evidence.requirementIds.join(', ') || t('evidence.none')}</dd></div>
      <div><dt>{t('evidence.facts')}</dt><dd>{evidence.factIds.join(', ') || t('evidence.none')}</dd></div>
      <div><dt>{t('evidence.supportLabel')}</dt><dd>{t(`evidence.support.${evidence.support}`)}</dd></div>
      <div><dt>{t('evidence.matchLabel')}</dt><dd>{t(`evidence.match.${evidence.matchType}`)}</dd></div>
      <div><dt>{t('evidence.confidence')}</dt><dd>{Math.round(evidence.confidence * 100)}%</dd></div>
      <div><dt>{t('evidence.transformationLabel')}</dt><dd>{t(`evidence.transformation.${evidence.transformation}`)}</dd></div>
    </dl>
  )
}

function QuestionList({ questions, label }: { questions: string[]; label: string }) {
  return <div className="resume-agent-app__questions"><span>{label}</span><ul>{questions.map((question) => <li key={question}>{question}</li>)}</ul></div>
}

function EmptyDraft({ locale, title, description, action }: { locale: string; title: string; description: string; action: string }) {
  return <div className="resume-app-empty-state"><Sparkles size={24} /><h2>{title}</h2><p>{description}</p><a href={`/${locale}/studio`}>{action}</a></div>
}

class AgentUiError extends Error {
  constructor(readonly code?: string, readonly retryAfter = 0) { super(code) }
}

function localizedError(error: unknown, t: ReturnType<typeof useTranslations<'agent'>>) {
  if (error instanceof ProviderRoutingError) {
    return t('errors.CLOUD_FALLBACK_NOT_ALLOWED')
  }
  if (error instanceof ChromeBuiltInAiError) {
    const code = error.code === 'MODEL_UNAVAILABLE'
      ? 'LOCAL_MODEL_UNAVAILABLE'
      : error.code === 'INVALID_MODEL_OUTPUT'
        ? 'AI_OUTPUT_INVALID'
        : error.code
    return t(`errors.${code}` as 'errors.LOCAL_MODEL_UNAVAILABLE')
  }
  if (error instanceof ResumeChangeSetError) return t('errors.AI_OUTPUT_INVALID')
  if (error instanceof AgentUiError) {
    if (error.code === 'RATE_LIMITED' && error.retryAfter > 0) return t('errors.RATE_LIMITED_RETRY', { seconds: error.retryAfter })
    if (error.code && ['RATE_LIMITED', 'PAYLOAD_TOO_LARGE', 'INVALID_REQUEST', 'AI_NOT_CONFIGURED', 'AI_UNAVAILABLE', 'AI_OUTPUT_INVALID', 'AI_OUTPUT_TOO_LARGE', 'REQUEST_ABORTED', 'RUN_SAVE_FAILED'].includes(error.code)) {
      return t(`errors.${error.code}` as 'errors.RATE_LIMITED')
    }
  }
  return t('errors.AI_UNAVAILABLE')
}

function readRetryAfter(response: Response) {
  const value = Number(response.headers.get('Retry-After'))
  return Number.isFinite(value) && value > 0 ? Math.min(Math.ceil(value), 300) : 0
}

function displayValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '—'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

type ConfirmedCareerFact = CareerFact & {
  verification: 'user-confirmed' | 'document-backed'
}

export function selectApprovedPlanContext(workspace: AgentWorkspace) {
  const planItems = workspace.summary.run.plan?.items ?? []
  const requirementIds = new Set(planItems.flatMap((item) => item.requirementIds))
  const plannedFactIds = new Set(planItems.flatMap((item) => item.factIds))
  const requirementMatches = workspace.matrix.matches
    .filter((match) => requirementIds.has(match.requirementId))
    .map((match) => ({
      ...match,
      factIds: match.factIds.filter((id) => plannedFactIds.has(id))
    }))
  const matchedFactIds = new Set(requirementMatches.flatMap((match) => match.factIds))
  return {
    requirements: workspace.matrix.requirements.filter((requirement) => requirementIds.has(requirement.id)),
    requirementMatches,
    facts: workspace.facts.filter((fact) => matchedFactIds.has(fact.id))
  }
}

type LocalRewriteContext = {
  target: { path: string; original: string }
  requirements: JobRequirement[]
  requirementMatches: AgentWorkspace['matrix']['matches']
  facts: ConfirmedCareerFact[]
  planItem: {
    id: string
    requirementIds: string[]
    factIds: string[]
    intent: string
    transformation: 'rewrite' | 'emphasize'
  }
}

function selectLocalRewriteContext(
  workspace: AgentWorkspace,
  resume: NonNullable<ReturnType<typeof useResumeDraft>['activeDraft']>['data']
): LocalRewriteContext | null {
  const plan = workspace.summary.run.plan
  if (!plan?.approvedAt) return null
  const leaves = narrativeLeaves(resume)
  const requirementsById = new Map(
    workspace.matrix.requirements.map((requirement) => [requirement.id, requirement])
  )
  const confirmedFacts = workspace.facts.filter(
    (fact): fact is ConfirmedCareerFact => (
      fact.verification === 'user-confirmed' || fact.verification === 'document-backed'
    )
  )
  let best: { score: number; context: LocalRewriteContext } | null = null

  for (const item of plan.items) {
    if (
      item.transformation !== 'rewrite'
      && item.transformation !== 'emphasize'
    ) continue
    const requirementMatches = workspace.matrix.matches.filter(
      (match) => item.requirementIds.includes(match.requirementId)
    )
    const linkedFactIds = new Set(requirementMatches.flatMap((match) => match.factIds))
    const facts = confirmedFacts.filter(
      (fact) => item.factIds.includes(fact.id) && linkedFactIds.has(fact.id)
    )
    const requirements = item.requirementIds
      .map((id) => requirementsById.get(id))
      .filter((requirement): requirement is JobRequirement => requirement !== undefined)
    if (facts.length === 0 || requirements.length === 0) continue
    const factIds = new Set(facts.map(({ id }) => id))
    const scopedMatches = requirementMatches.map((match) => ({
      ...match,
      factIds: match.factIds.filter((id) => factIds.has(id))
    }))

    for (const target of leaves) {
      const score = localRewriteRelevance(
        target.original,
        facts.map(({ text }) => text),
        requirements.map(({ text }) => text),
        item.intent
      )
      if (score <= 0 || (best && score <= best.score)) continue
      best = {
        score,
        context: {
          target,
          requirements,
          requirementMatches: scopedMatches,
          facts,
          planItem: { ...item, transformation: item.transformation }
        }
      }
    }
  }
  return best?.context ?? null
}

function narrativeLeaves(
  resume: NonNullable<ReturnType<typeof useResumeDraft>['activeDraft']>['data']
) {
  const leaves: Array<{ path: string; original: string }> = []
  resume.profile.summary.forEach((original, index) => {
    if (original.trim()) leaves.push({ path: `profile.summary.${index}`, original })
  })
  resume.experiences.forEach((experience, experienceIndex) => {
    experience.bullets.forEach((original, bulletIndex) => {
      if (original.trim()) {
        leaves.push({
          path: `experiences.${experienceIndex}.bullets.${bulletIndex}`,
          original
        })
      }
    })
  })
  resume.projects.forEach((project, projectIndex) => {
    if (project.summary.trim()) {
      leaves.push({ path: `projects.${projectIndex}.summary`, original: project.summary })
    }
    project.highlights.forEach((original, highlightIndex) => {
      if (original.trim()) {
        leaves.push({
          path: `projects.${projectIndex}.highlights.${highlightIndex}`,
          original
        })
      }
    })
  })
  return leaves
}

function localRewriteRelevance(
  target: string,
  facts: readonly string[],
  requirements: readonly string[],
  intent: string
) {
  return facts.reduce((score, fact) => score + textAffinity(target, fact) * 4, 0)
    + requirements.reduce((score, requirement) => score + textAffinity(target, requirement) * 2, 0)
    + textAffinity(target, intent)
}

function textAffinity(left: string, right: string) {
  const normalizedLeft = normalizeComparableText(left)
  const normalizedRight = normalizeComparableText(right)
  if (!normalizedLeft || !normalizedRight) return 0
  if (normalizedLeft === normalizedRight) return 20
  if (
    Math.min(normalizedLeft.length, normalizedRight.length) >= 4
    && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) return 10
  const leftTerms = new Set(left.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  const rightTerms = new Set(right.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  return [...leftTerms].filter((term) => rightTerms.has(term)).length
}

function normalizeComparableText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function validateLocalProviderChangeSet(
  value: unknown,
  localContext: LocalRewriteContext,
  resume: NonNullable<ReturnType<typeof useResumeDraft>['activeDraft']>['data'],
  facts: readonly CareerFact[],
  requirements: readonly JobRequirement[],
  plan: NonNullable<AgentWorkspace['summary']['run']['plan']>,
  requirementMatches: AgentWorkspace['matrix']['matches']
) {
  const changeSet = validateProviderChangeSet(
    value,
    resume,
    facts,
    requirements,
    plan,
    requirementMatches
  )
  const allowedRequirementIds = new Set(localContext.requirements.map(({ id }) => id))
  const allowedFactIds = new Set(localContext.facts.map(({ id }) => id))
  if (changeSet.changes.length > 1 || changeSet.questions.length > 1) {
    throw new ResumeChangeSetError('INVALID_CHANGE_SET')
  }
  for (const change of changeSet.changes) {
    if (
      change.path !== localContext.target.path
      || change.original !== localContext.target.original
      || change.evidence.transformation !== localContext.planItem.transformation
      || change.evidence.requirementIds.some((id) => !allowedRequirementIds.has(id))
      || change.evidence.factIds.some((id) => !allowedFactIds.has(id))
    ) {
      throw new ResumeChangeSetError('INVALID_CHANGE_SET')
    }
  }
  return changeSet
}

function validateProviderChangeSet(
  value: unknown,
  resume: NonNullable<ReturnType<typeof useResumeDraft>['activeDraft']>['data'],
  facts: readonly CareerFact[],
  requirements: readonly JobRequirement[],
  plan: NonNullable<AgentWorkspace['summary']['run']['plan']>,
  requirementMatches: AgentWorkspace['matrix']['matches']
) {
  const changeSet = requireResumeChangeConfirmation(parseModelResumeChangeSet(value))
  validateResumeChangesAgainstApprovedPlan(changeSet, plan, requirementMatches)
  validateResumeChangeCandidates(resume, changeSet)
  const context = { facts, requirements }
  validateResumeChangeEvidence(changeSet, context)
  validateResumeChanges(
    resume,
    changeSet,
    changeSet.changes.filter(isResumeChangeApplicable).map(({ id }) => id),
    context
  )
  return changeSet
}

async function requestCloudOptimization(input: {
  resume: NonNullable<ReturnType<typeof useResumeDraft>['activeDraft']>['data']
  locale: 'zh' | 'en'
  instruction: string
  jd: string
  requirements: Array<{ id: string; text: string }>
  requirementMatches: AgentWorkspace['matrix']['matches']
  careerFacts: Array<{
    id: string
    text: string
    verification: 'imported' | 'user-confirmed' | 'document-backed'
  }>
  optimizationPlan: NonNullable<AgentWorkspace['summary']['run']['plan']>
  signal: AbortSignal
  onCooldown: (seconds: number) => void
}) {
  const response = await aiFetch('/api/resume/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resume: input.resume,
      locale: input.locale,
      instruction: input.instruction,
      jd: input.jd,
      requirements: input.requirements,
      requirementMatches: input.requirementMatches,
      careerFacts: input.careerFacts,
      optimizationPlan: input.optimizationPlan
    }),
    signal: input.signal
  })
  const body = await response.json() as { changeSet?: unknown; model?: string } & ApiErrorBody
  if (!response.ok) {
    const seconds = readRetryAfter(response)
    if (seconds > 0) input.onCooldown(seconds)
    throw new AgentUiError(body.code, seconds)
  }
  return {
    value: parseResumeChangeSet(body.changeSet),
    provider: 'OpenAI-compatible',
    model: typeof body.model === 'string' && body.model.trim()
      ? body.model
      : 'configured-model'
  }
}

const defaultRunPersistence: ResumeAgentRunPersistence = {
  async saveChangeSet(input) {
    const store = createDomainStore()
    try {
      const run = await persistOptimizationChangeSet({
        store,
        optimizationRunId: input.workspace.summary.run.id,
        changeSet: input.changeSet,
        currentFingerprint: input.currentFingerprint,
        now: input.now
      })
      return {
        ...input.workspace,
        summary: { ...input.workspace.summary, run }
      }
    } finally {
      await store.close()
    }
  },
  async saveAppliedVariant(input) {
    const store = createDomainStore()
    try {
      const run = await persistAcceptedResumeVariant({
        store,
        optimizationRunId: input.workspace.summary.run.id,
        variant: input.variant,
        acceptedChangeIds: input.acceptedChangeIds,
        currentFingerprint: input.currentFingerprint,
        scoreAfter: input.scoreAfter,
        now: input.now
      })
      return {
        ...input.workspace,
        summary: { ...input.workspace.summary, run }
      }
    } finally {
      await store.close()
    }
  },
  async discardChangeSet(input) {
    const store = createDomainStore()
    try {
      const run = await discardOptimizationChangeSet({
        store,
        optimizationRunId: input.workspace.summary.run.id,
        now: input.now
      })
      return {
        ...input.workspace,
        summary: { ...input.workspace.summary, run }
      }
    } finally {
      await store.close()
    }
  },
  async observeInput(input) {
    const store = createDomainStore()
    try {
      const run = await persistRunInputChange({
        store,
        optimizationRunId: input.workspace.summary.run.id,
        currentFingerprint: input.currentFingerprint,
        now: input.now
      })
      if (!run) throw new TypeError('The optimization run does not exist.')
      if (run.stage === 'stale' && typeof window !== 'undefined') {
        window.dispatchEvent(new Event(ACTIVE_WORKFLOW_CHANGED_EVENT))
      }
      return {
        ...input.workspace,
        summary: { ...input.workspace.summary, run }
      }
    } finally {
      await store.close()
    }
  }
}

function optimizationInputFingerprint(
  workspace: AgentWorkspace,
  resume: NonNullable<ReturnType<typeof useResumeDraft>['activeDraft']>['data']
) {
  return fingerprintOptimizationInputs({
    sourceDraftId: workspace.summary.run.sourceDraftId,
    resume,
    targetJob: workspace.summary.targetJob,
    requirements: workspace.matrix.requirements,
    requirementMatches: workspace.matrix.matches,
    careerFacts: workspace.facts
  })
}

function suggestionFingerprint(
  id: string,
  data: NonNullable<ReturnType<typeof useResumeDraft>['activeDraft']>['data'],
  requirements: readonly JobRequirement[],
  facts: readonly CareerFact[]
) {
  const { updatedAt: _updatedAt, ...metadata } = data.metadata
  const evidenceContext = {
    requirements: [...requirements].sort((left, right) => left.id.localeCompare(right.id)),
    facts: [...facts].sort((left, right) => left.id.localeCompare(right.id))
  }
  return `${id}:${JSON.stringify({ resume: { ...data, metadata }, evidenceContext })}`
}
