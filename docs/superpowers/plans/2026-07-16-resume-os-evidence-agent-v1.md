# Resume OS Evidence-Driven Agent V1

## Task

Upgrade Resume OS from a presentation-led AI resume workspace into a local-first,
evidence-grounded resume tailoring agent, while preserving the existing desktop
shell, local drafts, BYOK support, safe change-set application, and showcase
experiences.

V1 must also add Chrome Built-in AI as an optional on-device provider for supported
desktop Chrome installations. Cloud inference remains available through the existing
OpenAI-compatible BYOK path. The product must never silently send local data to a
cloud provider when local inference is unavailable.

## Product Baseline

Position Resume OS as:

> A local-first, evidence-grounded workspace that turns verified career facts into a
> tailored resume for each target job.

Primary user promise:

> Every proposed claim has evidence, every change is reviewable, and nothing is
> applied without the user's approval.

Product principles:

1. **Truth before fit** — never improve alignment by inventing experience.
2. **Evidence before writing** — map job requirements to verified career facts before
   generating resume changes.
3. **Plan before action** — show the intended optimization strategy before producing
   an editable change set.
4. **Deterministic validation** — calculate coverage and structural quality in code;
   do not ask a model to invent an ATS score.
5. **Local by default** — persist career data and agent state in the browser.
6. **Explicit cloud boundary** — a cloud fallback requires prior user consent.

## Target User

V1 targets mid-to-senior technical and product candidates who:

- have substantial experience or project evidence;
- tailor their resume for multiple roles;
- value factual accuracy and change transparency;
- may use Chinese or English resumes;
- are willing to configure their own cloud model when local inference is not suitable.

## Non-Goals

Do not add the following in this task:

- user accounts, a hosted database, or cloud synchronization;
- vector RAG or a vector database;
- automatic job applications or browser form submission;
- a job-search CRM, scheduled background agents, or multi-user collaboration;
- claims of predicting a real ATS pass rate;
- a template marketplace;
- Chinese support claims for Chrome Built-in AI until Chrome officially supports the
  requested input and output languages;
- removal of 3D, Book, Projects, Timeline, or Terminal showcase experiences.

## Current Foundation To Preserve

- Normalized `ResumeData` and browser-local multi-draft storage.
- Resume snapshots before accepted agent changes.
- OpenAI-compatible BYOK configuration and same-origin server routes.
- PDF, DOCX, and TXT extraction.
- Strict model-output parsing and Zod validation.
- Allowlisted change paths, original-value matching, and hidden-change prevention.
- Per-change before/after review and explicit confirmation.
- Desktop/mobile shell, themes, localization, and reduced-motion support.

## Required Product Changes

### 1. Reframe the information architecture

Make the primary product path visible from the desktop root and Dock:

1. **Career Profile** — imported resume and verified career evidence.
2. **Target Job** — job description and requirement matrix.
3. **Tailor Agent** — gaps, questions, plan, and proposed changes.
4. **Review & Export** — tailored variant, quality report, version comparison.
5. **Settings** — model provider, privacy, language, theme, and motion.

Move Resume 3D, Book, Projects, Timeline, and Terminal into a secondary Showcase
group. They remain accessible but no longer define the main workflow.

Replace candidate-specific copy such as references to one AI engineer's RAG, MCP, or
trading-system background with product-neutral copy.

Move simulated resume generation into an explicitly labeled Demo/Sandbox entry. It
must not appear equivalent to importing verified user data.

The desktop root should show the active workflow state instead of only an application
launcher:

- active career profile;
- active target job;
- evidence coverage summary;
- current agent stage;
- one recommended next action.

### 2. Add a versioned local domain store

Keep existing resume drafts backward compatible. Introduce a separate versioned
domain store rather than immediately changing the current draft storage envelope.

Use IndexedDB for the new domain objects. Store only small compatibility/settings
records in `localStorage`. Do not store original PDF or DOCX bytes in `localStorage`.

Minimum domain contracts:

```ts
type EvidenceSource = {
  id: string
  type: 'resume-import' | 'user-answer' | 'document'
  label: string
  excerpt?: string
  contentHash?: string
  createdAt: string
}

type CareerFact = {
  id: string
  kind: 'experience' | 'project' | 'skill' | 'achievement' | 'metric'
  text: string
  context?: {
    company?: string
    role?: string
    project?: string
  }
  evidenceRefs: string[]
  verification: 'imported' | 'user-confirmed' | 'document-backed'
  tags: string[]
  createdAt: string
  updatedAt: string
}

type TargetJob = {
  id: string
  title: string
  company?: string
  description: string
  locale: 'zh' | 'en'
  createdAt: string
  updatedAt: string
}

type JobRequirement = {
  id: string
  jobId: string
  text: string
  category: 'skill' | 'experience' | 'domain' | 'education' | 'responsibility'
  priority: 'must' | 'preferred' | 'signal'
  weight: number
  keywords: string[]
  userConfirmed: boolean
}

type RequirementMatch = {
  requirementId: string
  factIds: string[]
  status: 'direct' | 'partial' | 'gap'
  rationale: string
}

type ResumeVariant = {
  id: string
  sourceDraftId: string
  targetJobId: string
  name: string
  data: ResumeData
  createdAt: string
  updatedAt: string
}
```

Requirements:

- Every object has a stable ID.
- Storage has a schema version and migration boundary.
- Importing a resume produces candidate facts, but imported facts are visually
  distinguishable from explicitly user-confirmed facts.
- User corrections update the career profile so the same incorrect assumption is not
  repeated in later runs.
- Deleting a resume draft must not silently delete a career fact that has become part
  of another saved variant; destructive relationships require confirmation.

### 3. Replace the JD report with a requirement matrix

The model may extract candidate requirements from a JD, but the output must be a
strict structured object and must be reviewable before scoring.

For every requirement, display:

- requirement text;
- category;
- Must / Preferred / Signal classification;
- weight;
- matched career facts and resume paths;
- Direct / Partial / Gap status;
- explanation;
- user correction controls.

Do not accept a model-generated `matchScore`. Calculate alignment with a pure
function after requirements and mappings are available:

```text
direct  = 1.0
partial = 0.5
gap     = 0.0

alignment =
  sum(requirement.weight * matchFactor) /
  sum(requirement.weight) * 100
```

Show separate results for:

- requirement coverage;
- evidence completeness;
- resume structure/readability.

Call the result **Resume OS alignment**, not an ATS pass probability. Save the rubric
version, input fingerprint, individual rule results, and evidence paths so identical
inputs produce identical results.

### 4. Turn the resume assistant into a staged domain agent

Persist an `OptimizationRun` and make the workflow resumable:

```ts
type AgentStage =
  | 'draft'
  | 'requirements-ready'
  | 'evidence-mapped'
  | 'awaiting-answers'
  | 'plan-ready'
  | 'awaiting-plan-approval'
  | 'generating-changes'
  | 'awaiting-change-approval'
  | 'validated'
  | 'applied'
  | 'stale'
  | 'failed'
  | 'abandoned'

type OptimizationRun = {
  id: string
  sourceDraftId: string
  targetJobId: string
  stage: AgentStage
  inputFingerprint: string
  requirementMatches: RequirementMatch[]
  questions: AgentQuestion[]
  plan?: OptimizationPlan
  changeSet?: ResumeChangeSet
  scoreBefore?: ScoreResult
  scoreAfter?: ScoreResult
  createdAt: string
  updatedAt: string
}
```

Required workflow:

```text
Import and verify facts
  -> extract and confirm requirements
  -> map requirements to facts
  -> ask for missing evidence
  -> persist confirmed answers as facts
  -> present an optimization plan
  -> wait for plan approval
  -> generate evidence-linked changes
  -> validate changes
  -> wait for per-change approval
  -> create a target-job variant
  -> rescore and show the result
```

The existing questions list must become interactive. Answers must either:

- create a user-confirmed `CareerFact`;
- link an existing fact; or
- explicitly mark the requirement as a real gap.

A resume, job, requirement, or career-profile change that invalidates the run's input
fingerprint must set the run to `stale`. Never apply stale changes.

### 5. Extend the safe change contract

Keep the existing path allowlist and original-value check. Extend each change with:

```ts
type ResumeChangeEvidence = {
  requirementIds: string[]
  factIds: string[]
  matchType: 'direct' | 'partial' | 'gap'
  support: 'verified' | 'user-confirmed' | 'unsupported'
  confidence: number
  transformation: 'rewrite' | 'emphasize' | 'remove' | 'reorder' | 'add-from-fact'
  scoreImpact?: number // legacy-read compatibility only; models must not emit this
}
```

Rules:

- `unsupported` changes cannot be applied.
- Model-authored score impacts are forbidden; deterministic scores come from persisted
  requirement matches and facts.
- New numbers, skills, responsibilities, employers, titles, dates, team sizes, or
  outcomes require at least one supporting fact.
- Identity fields, employers, titles, and dates remain protected from automatic
  rewriting.
- V1 may add a bullet only through `add-from-fact` using a verified or user-confirmed
  fact.
- Reordering must reference stable item IDs rather than fragile array indexes.
- Applying changes creates a separate `ResumeVariant`; the master career profile is
  not silently rewritten.
- Every accepted operation remains reversible.

### 6. Introduce a provider abstraction

Replace the assumption that every AI task uses the server-side OpenAI-compatible
route with a task-oriented provider interface:

```ts
type AiProviderKind = 'chrome-built-in' | 'openai-compatible'

interface ResumeAiProvider {
  kind: AiProviderKind
  availability(task: ResumeAgentTask): Promise<ProviderAvailability>
  runStructuredTask<T>(input: {
    task: ResumeAgentTask
    system: string
    prompt: string
    jsonSchema: object
    validate: (value: unknown) => T
    signal?: AbortSignal
  }): Promise<{ value: T; provider: string; model: string }>
}
```

Keep prompts, task schemas, validation, and deterministic post-processing independent
of a provider wherever possible.

### 7. Add Chrome Built-in AI Beta

Implement a client-side adapter around `LanguageModel`:

- check `LanguageModel.availability()`;
- handle `unavailable`, `downloadable`, `downloading`, and `available` states;
- start model download only after a valid user activation;
- display download progress;
- create sessions with explicit expected input/output languages;
- use `responseConstraint` JSON Schema for structured tasks;
- parse and validate every response with the existing Zod contract;
- support abort and session destruction;
- monitor `contextUsage` and `contextWindow`;
- reject oversized tasks before context overflow;
- do not run in a Web Worker because the API is not currently available there;
- expose diagnostics in Settings.

Provider policy:

- Label the provider **Chrome Built-in AI (Beta)**.
- Officially support it only for languages returned as supported by the API.
- Do not claim Chinese support while the browser model does not declare it.
- Prefer local inference only for bounded tasks such as JD requirement extraction,
  evidence classification, gap-question drafting, single-bullet rewriting, and
  concise review.
- Use cloud BYOK for unsupported languages, long inputs, company research, and tasks
  that exceed the local context budget.
- Never silently fall back to cloud inference. Ask once, explain what data will be
  sent, and persist the user's fallback preference.
- When the user declines cloud fallback, keep deterministic and manual features
  usable.

Chrome Built-in AI must bypass the Next.js AI routes for inference. Existing server
routes remain available for OpenAI-compatible providers and file extraction.

### 8. Update Settings and privacy UX

Settings must provide:

- provider selection: Chrome Built-in AI / OpenAI-compatible / Automatic;
- local model availability and download state;
- supported languages and device compatibility;
- local diagnostics;
- cloud provider configuration when applicable;
- a separate “Allow explicit cloud fallback” preference;
- a clear summary of which data stays local and which data is sent to a selected
  provider.

Privacy copy must state:

> Resume OS does not persist your career data on its server. Chrome Built-in AI runs
> supported tasks on this device. When you explicitly use a cloud provider, only the
> information required for that task is sent to the provider you configured.

### 9. Preserve the deployment model

V1 deployment remains:

```text
Next.js on Vercel
  + browser-local IndexedDB domain data
  + optional Chrome Built-in AI
  + optional cloud BYOK through stateless route handlers
```

No database is required. Server routes must remain stateless and must not persist
resumes, job descriptions, career facts, agent runs, or API keys.

PDF/DOCX extraction may continue through the existing server route in V1. The UI must
not describe file processing as fully on-device until document parsing is moved to a
browser worker in a future task.

## Implementation Order

### Phase 0 — Product framing and navigation

- Update README, metadata, Chinese/English product copy, Dock priorities, and desktop
  workflow summary.
- Move simulated generation to Demo/Sandbox.
- Group showcase applications without deleting them.

### Phase 1 — Provider foundation

- Introduce the provider/task abstraction.
- Preserve existing OpenAI-compatible behavior behind its adapter.
- Add mocked provider contract tests.
- Add Chrome capability detection and Settings diagnostics.

### Phase 2 — Requirement matrix and deterministic scoring

- Replace the string JD report contract.
- Add reviewable requirements and evidence mappings.
- Add pure scoring functions with rubric versions and unit tests.

### Phase 3 — Career evidence store

- Add IndexedDB repository and migration tests.
- Derive candidate facts from imported resumes.
- Add fact verification and correction UI.

### Phase 4 — Resumable agent workflow

- Add `OptimizationRun` state transitions.
- Implement interactive gap questions and plan approval.
- Add stale-input handling and run recovery.

### Phase 5 — Evidence-linked changes and variants

- Extend the change contract.
- Add verified-fact insertion and stable reordering operations.
- Create job-specific variants without mutating the master profile.
- Add before/after alignment and quality results.

### Phase 6 — Chrome Built-in AI task rollout

- Enable local inference one bounded task at a time.
- Start with English JD requirement extraction and single-bullet rewriting.
- Add local structured-output, context-limit, cancellation, and fallback tests.
- Keep unsupported tasks routed to explicit cloud BYOK or manual operation.

### Phase 7 — Evidence-flow motion and visual polish

- Visualize Requirement -> Evidence -> Change relationships.
- Use motion for agent progress and causal transitions.
- Respect reduced-motion settings.
- Keep showcase motion secondary to the core workflow.

## Testing Requirements

### Unit tests

- IndexedDB serialization, migration, and relationship integrity.
- Requirement scoring and rubric-version stability.
- Agent state-transition validity.
- Input fingerprint and stale-run detection.
- Evidence support validation.
- New safe edit operations and rollback.
- Provider selection and explicit fallback policy.
- Chrome availability-state normalization and context-budget checks.

### Component tests

- Requirement editing and confirmation.
- Evidence linking and gap resolution.
- Plan approval gate.
- Unsupported-change blocking.
- Local model download and unavailable states.
- Cloud-fallback consent.
- Provider-specific Settings states.
- Resume variant review and restore.

### API tests

- Existing cloud BYOK security boundaries remain intact.
- New structured JD and optimization schemas reject duplicate or additional keys.
- Server routes remain stateless.
- Unsupported provider headers and malformed requests remain rejected.

### End-to-end tests

1. Import an English resume, add an English JD, confirm requirements, resolve a gap,
   approve a plan, accept supported changes, and create a variant.
2. Complete the same core flow with the mocked Chrome provider and assert no AI API
   route is called.
3. Simulate Chrome AI unavailable, obtain explicit cloud consent, and finish through
   BYOK.
4. Decline cloud fallback and verify that local/manual features remain usable.
5. Change the source resume during a run and verify that proposals become stale and
   cannot be applied.
6. Attempt to apply an unsupported claim and verify that validation blocks it.
7. Reload during `awaiting-answers` and `awaiting-plan-approval` and resume the run.

## Acceptance Criteria

The task is complete only when all of the following are true:

- The primary UI communicates the evidence-driven job-tailoring workflow without
  requiring users to infer it from separate apps.
- Candidate-specific demo copy is removed from the product workflow.
- A user can inspect and correct a structured JD requirement matrix.
- Every requirement can show its supporting fact IDs or an explicit gap.
- Alignment is calculated deterministically and includes a visible rubric/version.
- Gap questions accept answers and persist confirmed facts.
- The Agent cannot generate changes until the optimization plan is approved.
- Every applicable change references requirements and supported career facts.
- Unsupported claims are technically blocked, not merely warned about.
- Applying changes creates a reversible job-specific variant.
- An interrupted Agent run can be restored from browser-local state.
- Chrome Built-in AI can complete at least English JD extraction and one bounded
  rewriting task without an API key or server inference request.
- Unsupported Chrome devices/languages receive a clear explanation and an explicit,
  non-silent cloud fallback choice.
- Cloud BYOK and server file extraction continue to work.
- No database is introduced and no career data is persisted by server routes.
- Unit, component, API, typecheck, lint, production build, and relevant Playwright
  suites pass.

## Success Metrics

Instrument locally without collecting personal resume content:

- time from import to first tailored variant;
- percentage of Must requirements with direct or partial evidence;
- proportion of proposed changes accepted;
- unsupported claims applied: target **zero**;
- completion rate from JD import to saved variant;
- percentage of users who reuse their career profile for a second target job;
- local-provider completion and explicit cloud-fallback rates.

## Definition of Done

Deliver the feature in reviewable phases. Each phase must preserve existing user data,
include migration coverage where needed, and keep the current safe change boundary.
Do not mark the task complete after adding UI shells or prompts alone: the evidence
links, state transitions, deterministic validators, provider routing, persistence, and
end-to-end recovery flow must all operate in the running application.
