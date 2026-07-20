# Resume OS Agent Guide

This file applies to the entire repository. It defines the durable project guidance that coding agents must follow when inspecting, changing, testing, reviewing, committing, or pushing Resume OS.

## Project Intent

Resume OS is a local-first, evidence-grounded resume tailoring agent built with Next.js App Router, TypeScript, React, and `next-intl`.

Preserve these product invariants:

- Career evidence is the boundary for real resume claims. Missing evidence becomes a question or an explicit gap, never an invented achievement.
- AI output is a proposal, not authority. Validate model output deterministically and require the existing approval steps before applying it.
- Never silently rewrite the master resume. Accepted optimization changes create or update a separate job-specific `ResumeVariant` unless the user explicitly requests a different product change.
- Sample and AI-generated sandbox resumes are not verified career evidence. Only trusted upload or paste flows may be imported into the evidence workspace under the existing rules.
- Durable user data belongs to the browser origin. Do not add server-side persistence, accounts, analytics, cloud sync, or uploaded-file retention without an explicit product decision.
- Cloud use must remain explicit. Automatic mode may fall back to a cloud provider only when the saved preference allows it; do not introduce silent fallback.
- API keys and career data must not be logged, echoed, or persisted by server routes.

## Repository Map

- `app/[locale]/`: locale-aware App Router pages. Most pages are route descriptors that open an application in the shared shell.
- `app/api/`: stateless same-origin route handlers for AI calls and document extraction.
- `components/desktop/`: desktop/mobile shell, application registry integration, window management, Dock, and global UI providers.
- `components/apps/`: product applications such as Studio, JD Match, Agent, Settings, and resume presentation views.
- `components/resume-draft-provider.tsx`: active resume and draft context.
- `lib/resume-model.ts`: canonical `ResumeData`, drafts, snapshots, IDs, and normalization.
- `lib/resume-store.ts`: localStorage draft persistence and multi-tab merge behavior.
- `lib/agent/`: evidence domain, IndexedDB store, provider routing, deterministic scoring, optimization state machine, plans, change sets, and variants.
- `lib/server/`: request guards, bounded JSON parsing, document parser isolation, and DOCX preflight checks.
- `i18n/` and `messages/`: locale routing and Chinese/English messages.
- `tests/e2e/`: Playwright desktop, mobile, safety, and workflow coverage.
- `docs/`: deployment boundaries, design specifications, and implementation plans.

## Sources Of Truth

- Treat the current implementation and its colocated tests as the source of truth for behavior and invariants.
- Use `README.md` for the current product model and local workflow, and `docs/deployment.md` for environment, security, release, retry, rollback, and production boundaries.
- Treat dated files under `docs/superpowers/` as design history. Verify their assumptions against current code, tests, README, and deployment documentation before using them as requirements.
- When behavior, data boundaries, or operational behavior changes intentionally, update the authoritative documentation in the same change instead of leaving contradictory guidance.

## Architecture Rules

- Keep `ResumeData` as the normalized contract consumed by every presentation application. Do not make a view depend on raw uploaded files or model-specific output.
- Keep desktop layout state independent from resume and Agent domain state. Closing or resetting a window must not delete career data.
- Use the existing persistence boundaries:
  - localStorage for drafts, snapshots, desktop state, provider preferences, theme, motion, and the active workflow pointer.
  - IndexedDB through `lib/agent/domain-store.ts` for evidence sources, career facts, target jobs, requirements, matches, variants, and optimization runs.
  - sessionStorage for a BYOK key by default; localStorage only after explicit remember consent.
- Treat data from requests, storage, uploaded documents, and models as untrusted. Parse it through the relevant Zod schema and retain existing byte/count limits.
- Preserve IndexedDB referential integrity. Writes involving related Agent entities must use the domain-store transaction API.
- Keep optimization transitions inside the deterministic state machine. Do not mutate `OptimizationRun.stage` ad hoc in components.
- Keep alignment and structure scores deterministic. Never accept a model-authored score or pass probability.
- Apply resume changes only through the change-set validators and applicator. Preserve protected fields, original-value checks, approved-plan references, evidence checks, and stale-input fingerprints.
- Treat persisted schemas as public local data contracts. Schema changes require backward-compatible parsing or an explicit migration plus tests using older stored data; never solve a migration by silently clearing browser storage.
- Uploaded PDF, DOCX, and TXT bytes are transient extraction inputs. Do not persist the original files or add them to the evidence store without an explicit product and privacy decision.
- Propagate cancellation through browser requests, provider calls, document parsing, and long-running work. Ignore late responses after cancellation or input changes, and retain fingerprint-based stale-result protection.
- Browser cloud requests must use `aiFetch` and its approved same-origin paths. Document extraction is the deliberate same-origin non-AI exception.
- Preserve request-guard, provider-host allowlist, no-redirect, timeout, rate-limit, payload-limit, and worker-resource boundaries when changing API routes.
- Avoid adding a vector database or embedding pipeline unless the product scope explicitly changes. Retrieval currently means typed, explicit evidence references.

## UI And Localization

- Reuse the application registry and `AppLoader` for desktop and mobile application entry points. A new application normally requires registry metadata, loading integration, route mapping, and messages.
- Keep desktop URLs synchronized with the focused application and retain mobile full-screen routing behavior.
- Add user-facing text to both `messages/en.json` and `messages/zh.json`; do not hard-code production UI copy in components.
- Respect theme, motion preference, reduced-motion behavior, keyboard access, focus states, ARIA labels, and mobile safe areas.
- Lazy-load browser-only or heavy visual features where appropriate; preserve the existing WebGL fallback behavior.
- Prefer extracting controller hooks and application services when a component starts mixing substantial UI, networking, persistence, and workflow logic.

## Coding Conventions

- Use strict TypeScript and the `@/` path alias. Avoid `any`; use `unknown` plus validation at boundaries.
- Keep domain logic pure and deterministic where possible. Inject stores, clocks, and external runners when that improves testability.
- Use server-only Node APIs only in server modules or Node route handlers. Add `'use client'` only where browser state, effects, or browser APIs require it.
- Preserve stable IDs and input fingerprints across persisted relations. Do not use array position as a durable domain identity.
- Keep changes focused. Do not perform unrelated formatting, dependency upgrades, architectural rewrites, or generated snapshot updates.
- Preserve existing user changes in a dirty worktree. Inspect before editing and do not revert files you did not change.
- Never commit secrets, `.env.local`, provider keys, uploaded resumes, generated career data, or test artifacts containing personal information.

## Runtime And Environment

- Match CI with Node.js 22 and `pnpm@10.33.0`. Do not use npm or Yarn to install dependencies or generate another lockfile.
- The default development server is local-only at `127.0.0.1:3001`. If that port is occupied, use another loopback port; do not terminate an unrelated process merely to reclaim the default port.
- Keep secrets in untracked `.env.local` or the deployment secret store. `.env.example` must contain only safe placeholders, and server credentials must never be exposed through a `NEXT_PUBLIC_*` variable or client bundle.
- Treat `RESUME_OS_ALLOWED_AI_HOSTS`, `RESUME_OS_AI_ACCESS_TOKEN`, `RESUME_OS_LOCAL_ONLY`, and `RESUME_OS_TRUSTED_PROXY` as security-boundary configuration. Do not weaken their semantics to make a request work.
- When adding or changing an environment variable, update `.env.example`, `README.md`, and `docs/deployment.md` wherever that variable affects local or production operation.

## Dependencies And Generated Artifacts

- Prefer existing platform APIs and installed libraries. Add a dependency only when it materially reduces risk or complexity, and consider client bundle size, server runtime compatibility, and document-worker tracing.
- Use pnpm for dependency changes and commit `package.json` and `pnpm-lock.yaml` together. Do not hand-edit the lockfile.
- Changes to `serverExternalPackages`, document parser dependencies, worker assets, or `outputFileTracingIncludes` require the production extraction smoke test.
- Do not stage ignored build or local-state output such as `.next/`, `out/`, `.vercel/`, `.worktrees/`, or local environment files.
- In normal feature and fix work, do not pre-bump `package.json`, hand-maintain `CHANGELOG.md`, or create version tags. The release workflow owns those artifacts.

## Commands And Verification

Use the pinned package manager:

```bash
corepack pnpm@10.33.0 install
corepack pnpm@10.33.0 dev
```

Primary checks:

```bash
corepack pnpm@10.33.0 typecheck
corepack pnpm@10.33.0 lint
corepack pnpm@10.33.0 test
corepack pnpm@10.33.0 build
corepack pnpm@10.33.0 test:e2e
corepack pnpm@10.33.0 test:production-extraction
```

`corepack pnpm@10.33.0 install` configures the tracked `.githooks/commit-msg` hook. If an existing checkout needs to restore it, run `corepack pnpm@10.33.0 hooks:install`.

Verification policy:

- Run the narrowest relevant Vitest file while iterating.
- Keep unit and component tests colocated as `*.test.ts` or `*.test.tsx`; keep browser workflows in `tests/e2e/`. Add a regression test for a bug fix when the failure is reproducible.
- Use synthetic resume and provider data in tests, fixtures, screenshots, and logs. Never copy a real resume, API key, or personal career history into the repository.
- Before handing off a material code change, run `typecheck`, `lint`, and the full unit/integration suite.
- Run `build` for App Router, server/client boundary, configuration, dependency, or production-bundling changes.
- Run `test:production-extraction` for document parsing, worker, dependency tracing, Next config, or deployment changes.
- Run the relevant Playwright project for desktop/mobile routing, window management, responsive UI, or complete user-flow changes.
- Security-boundary changes require both an allowed-path test and a rejected-path test. Cover origins, provider hosts, redirects, limits, credential handling, and cancellation as applicable.
- Do not run `test:e2e:update` or update snapshots merely to make a failing test pass. Snapshot changes must be intentional, inspected, and explained.
- For documentation-only changes, at minimum run `git diff --check` and verify every referenced path, command, environment variable, and workflow against the repository.
- If a required check cannot run, report exactly which check was skipped and why.

## Git And Commit Messages

Do not commit, amend, tag, or push unless the user explicitly asks for that action.

When asked to commit or use Commit and Push:

1. Inspect `git status`, the unstaged diff, and the staged diff.
2. Stage only files that belong to the requested change. Do not use `git add .` or `git add -A` without first verifying the complete scope.
3. Run checks proportional to the change before committing.
4. Generate the commit subject from the staged diff, not merely from the task description.
5. Use exactly one focused Conventional Commit subject in English:

```text
<type>(<scope>): <imperative summary>
```

Rules:

- Allowed types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Use `feat`, never `feature`; PR title validation does not accept `feature`.
- Use a lowercase type and optional lowercase scope. Useful scopes include `agent`, `studio`, `desktop`, `api`, `i18n`, `settings`, `docs`, `test`, `deps`, and `release`.
- Keep the subject concise, imperative, and free of a trailing period.
- Use `!` for a breaking change, for example `feat(agent)!: replace persisted run schema`, and explain the migration in a `BREAKING CHANGE:` footer when useful.
- Split unrelated changes into separate commits when they have independent purposes or release effects.
- Do not amend an existing commit or force-push unless explicitly requested.
- Do not bypass the tracked `commit-msg` hook with `--no-verify`. Treat a hook rejection as a request to correct the subject, not to disable validation.

Examples:

```text
fix(agent): reject stale resume changes
feat(studio): add resume export
docs(deployment): clarify browser data boundaries
test(desktop): cover restored window focus
```

Release behavior:

- A successful CI run on the current `main` revision starts the release workflow.
- `fix`, `perf`, and `revert` create a patch release.
- `feat` creates a minor release.
- A breaking-change note creates a major release.
- `docs`, `refactor`, `test`, `build`, `ci`, and `chore` do not create a release by themselves.
- Let release-it create the version commit, `vX.Y.Z` tag, and GitHub Release. Do not manually create release tags unless explicitly handling a documented redeploy or recovery.
- Do not run `pnpm release`, deploy production, move a tag, or invoke the manual redeploy workflow unless the user explicitly requests that exact release operation.
- PR titles must follow the same Conventional Commit subject format. Prefer squash merge so the validated PR title becomes the release commit subject.

## Review Guidelines

When reviewing a change, prioritize actionable correctness, data-loss, privacy, security, and regression risks over style preferences. Inspect the changed behavior and its callers rather than reviewing only the visible diff in isolation.

Specifically check for:

- Resume claims that are not backed by saved evidence, AI output that bypasses deterministic validation, or changes that mutate the master resume without explicit approval.
- Browser-storage schema changes that lose older data, break IndexedDB references, resurrect deleted multi-tab state, or leave active workflows inconsistent.
- Secret or career-data leakage through logs, errors, client bundles, persistence, fixtures, analytics, redirects, or overly broad cloud request payloads.
- SSRF, cross-origin, provider-redirect, trusted-proxy, shared-key, rate-limit, payload-limit, parser-resource, and access-token regressions in API or deployment changes.
- Silent provider fallback, missing cancellation, stale asynchronous results, races between requests, and model-authored values being trusted as deterministic facts or scores.
- Missing `en`/`zh` copy, keyboard or focus regressions, reduced-motion violations, broken desktop/mobile routing, and missing loading or error states.
- Tests that only exercise the happy path, snapshots updated without explanation, or production/release assumptions that no longer match the workflows.

Review findings must identify a concrete failure scenario and its user or operational impact, with the narrowest relevant file and line. Do not report speculative preferences as defects; if no actionable findings remain, say so and mention any verification gap.

## Definition Of Done

A change is complete only when:

- The requested behavior is implemented without violating the product invariants above.
- Relevant boundary validation, error handling, cancellation, and stale-result protection remain intact.
- Tests cover the changed behavior at the appropriate domain, component, route, or E2E level.
- Required checks pass, or skipped checks are disclosed with a reason.
- Both locales and accessibility behavior are updated when UI behavior changes.
- README or deployment documentation is updated when data, privacy, provider, release, or operational boundaries change.
- The final summary lists the changed files, verification performed, and any remaining risk or follow-up.
