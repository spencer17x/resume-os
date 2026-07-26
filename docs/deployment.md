# Deployment and data boundaries

Resume OS is a local-first Evidence Agent with a stateless Next.js service boundary. “Local-first” means the durable career workspace belongs to the browser origin; it does not mean that every operation is guaranteed to run offline or that uploaded files never reach a same-origin route.

## Runtime responsibilities

| Runtime | Responsibilities | Durable user data |
| --- | --- | --- |
| Browser | Desktop/mobile UI, drafts, Career Evidence, requirement matrix, deterministic scoring, agent-run state, approvals, variants, provider selection | `localStorage` and IndexedDB for this origin |
| Chrome Built-in AI (Beta) | Supported structured tasks through the browser `LanguageModel` API | Model lifecycle is managed by Chrome; Resume OS does not copy the model into its database |
| Next.js route handlers | Same-origin request validation, PDF/DOCX/TXT extraction, OpenAI-compatible request execution, schema/error normalization | None; request-scoped processing only |
| User-configured OpenAI-compatible provider | Cloud inference for explicitly selected cloud tasks | Governed by that provider's policy, not by Resume OS |

The application has no server-side user database, ORM, account system, authentication session, vector database, or cloud-sync layer. Serverless Function instances may be created or discarded without losing the user's saved workspace because that workspace remains in the browser. Changing domains, subdomains, browser profiles, or site-storage partitions creates a different local workspace.

## What “RAG” means here

Resume OS does not implement embedding search or a vector store. Its retrieval graph is typed and explicit:

- `CareerFact.evidenceRefs` points to one or more `EvidenceSource` records.
- `RequirementMatch.factIds` points from a target-job requirement to relevant career facts.
- optimization plans, questions, change sets, scores, and variants retain requirement/fact references.
- deterministic scoring reads the reviewed requirement status and evidence IDs; it does not accept a model-generated pass probability.

This is structured evidence retrieval for a resume-tailoring domain. It is intentionally not a general RAG knowledge base and does not crawl the web, chunk arbitrary document collections, create embeddings, or add a hosted vector database.

## Browser persistence

| Record | Browser storage | Notes |
| --- | --- | --- |
| Resume drafts and snapshots | `localStorage` | Structured resume data; sample/demo data is not promoted to verified evidence |
| Evidence sources and career facts | IndexedDB | Imported facts remain visually unconfirmed until reviewed; original file bytes are rejected by the schema |
| Target jobs, requirements, mappings | IndexedDB | Powers reviewable requirement matrices and deterministic alignment |
| Resume variants and optimization runs | IndexedDB | Enables job-specific versions and resumable state transitions |
| Active workflow pointer and UI preferences | `localStorage` | Theme, motion, desktop layout, locale/provider preference |
| Provider Base URL/model | `localStorage` | Per browser origin |
| BYOK API key | `sessionStorage` by default | Moves to `localStorage` only after explicit device-persistence consent |

If IndexedDB is unavailable, Resume OS reports that Career Evidence or agent state was not saved; it must not display an in-memory result as durable. Deletion checks are restrictive: a draft, fact, requirement, job, or variant referenced by saved agent data is not silently cascaded away.

## AI provider policy

### Chrome Built-in AI (Beta)

The current adapter uses Chrome's `LanguageModel` API for bounded structured tasks. It checks task-specific input/output languages, normalizes availability (`unavailable`, `downloadable`, `downloading`, `available`), requires user activation before a required model download, can forward download progress when a caller supplies a progress handler, enforces the session context budget, applies a JSON response constraint, validates the parsed value, supports cancellation, and destroys the session after the task.

Chrome Built-in AI is initialized and persisted as the first provider preference. Every AI task reads the persisted preference when it starts; cloud calls also read the persisted Base URL and model plus the saved session/device key. Current product integrations cover raw resume parsing, Demo / Sandbox generation, target-job requirement extraction, scoped optimization-plan preparation, and one evidence-linked narrative-leaf rewrite at a time. Studio's local and cloud paths use the same prompts, structural JSON schema, normalized `ResumeData` validation, cancellation, and source classification. The local rewrite prompt contains only the selected path and original text, its approved plan item, and linked requirements/facts; it excludes contact details, unrelated resume sections, and the full JD.

Chrome owns model eligibility and download lifecycle. Availability can vary by browser, device resources, language, and model state. The [official Chrome Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api) is the source of truth for platform eligibility.

### OpenAI-compatible BYOK

The browser sends the configured Base URL, model, and API key only to approved same-origin Next.js AI routes. The route uses them for that invocation and forwards the request to the selected provider without persisting or echoing the key. Provider URLs must use HTTPS in public deployments, redirects are rejected, and browser-selected hosts must match the built-in exact-host allowlist or `RESUME_OS_ALLOWED_AI_HOSTS`.

Public browser requests require a complete BYOK configuration. `OPENAI_API_KEY` on the Vercel project is not a shared fallback for browser UI traffic. The `OPENAI_*` variables are used for loopback/local-only operation or authenticated server-to-server calls.

### No silent cloud fallback

Provider routing has three modes:

| Mode | Behavior |
| --- | --- |
| Chrome Built-in AI | Run locally or return a local availability/task error |
| OpenAI-compatible | Use the user's configured cloud provider by explicit selection |
| Automatic | Try local first; use cloud only for local model unavailability and only after saved fallback consent |

Automatic mode defaults to cloud fallback **off**. Context overflow, invalid structured output, cancellation, and other local errors do not silently cross the device boundary.

Chrome does not currently guarantee Chinese as a Prompt API input or output language. Resume OS therefore treats Chinese local AI tasks as experimental best-effort execution: it omits the unsupported `zh` capability declaration, sends the bounded task directly to the on-device model, and still requires the task's normal JSON schema, deterministic validations, cancellation, and stale-input checks where applicable. Invalid model output never triggers cloud fallback; model unavailability can use cloud only in Automatic mode after saved fallback consent.

## Data that crosses the device boundary

- A PDF/DOCX/TXT upload is sent to the same-origin extraction route. Bytes are processed transiently and are not stored by Resume OS. The route returns extracted text.
- Pasted or extracted raw resume text is processed in the browser when Chrome Built-in AI is selected. It is sent through the same-origin parse route to the configured OpenAI-compatible provider only when that provider is explicitly selected or Automatic mode has saved fallback consent and the local model is unavailable or over its context budget.
- Demo / Sandbox generation follows the same saved provider preference. Locally generated and cloud-generated demo resumes are both classified as `ai-generated` and never become verified Career Evidence.
- Cloud agent tasks receive only the context assembled for that task, plus the user's instructions. Planning sends requirements, matches, facts already referenced by the Requirement Matrix, and a deterministic catalog of safe editable targets containing their paths, current text, and allowed transformations. The catalog excludes protected profile fields and unrelated resume sections. Change generation sends the full active structured resume and full target-job description so the provider can produce exact path/original edits, while requirement, match, and career-fact collections are limited to IDs cited by the approved plan.
- Chrome Built-in AI tasks run in the browser and do not pass their prompt through Resume OS route handlers.
- The same-origin route sees the BYOK credential for the duration of a cloud request, but Resume OS server code does not persist it.

Users should still review the privacy and retention terms of their chosen hosting platform and OpenAI-compatible provider. “No Resume OS server database” is not a claim that network infrastructure or an external provider has no operational logs.

## Quality, release, and deployment

The repository runs the `Quality` workflow for pull requests and pushes to
`main`. It validates pull request titles and runs the authoritative `pnpm check`
(typecheck, unit/integration tests, and a production build). Release preparation,
publication, and production deployment remain explicit operations:

```text
explicit verification and release request
  → create release/* from current main
  → release-it calculates the next SemVer version
  → package.json + CHANGELOG.md + local version commit
  → push release branch and open chore(release): vX.Y.Z PR
  → required Repository check succeeds
  → squash merge into protected main
manual Release workflow with vX.Y.Z + full merged main SHA
  → verify main ancestry and package version
  → pnpm check against that exact revision
  → create or validate immutable tag + GitHub Release
  → Vercel production build and deployment from the released revision
```

The repository ships optional versioned hooks under `.githooks`; contributors
may explicitly enable them with `pnpm hooks:install` for early feedback.
Dependency installation never enables hooks, and `pnpm check` plus CI remain
authoritative. There is no whole-tree ESLint or Prettier gate yet because
introducing one safely would require an application-wide rewrite.
`.github/workflows/release.yml` never creates a release
automatically. A manual dispatch names both the intended `vX.Y.Z` tag and the
full merged `main` SHA. The workflow validates that immutable input, reruns the
handoff check, creates or confirms the tag and GitHub Release, and only then
builds and deploys it. Reusing the same tag and SHA safely redeploys an existing
release.
`vercel.json` disables Vercel's direct deployment for `main`, while unspecified
feature branches retain Vercel Preview deployments.

Every version change uses a release pull request. This gives the resulting main
revision its required GitHub Actions check before any tag or GitHub Release is
created and avoids relying on an administrator bypass.

### One-time GitHub configuration

Add these repository Actions secrets:

| Secret | Purpose |
| --- | --- |
| `VERCEL_TOKEN` | Vercel access token used only by the tagged production deployment job. |
| `VERCEL_ORG_ID` | The linked Vercel project `orgId` from `.vercel/project.json`. |
| `VERCEL_PROJECT_ID` | The linked Vercel project `projectId` from `.vercel/project.json`. |

The workflow-level `GITHUB_TOKEN`, revision-resolution job, quality job, and
deployment job are read-only. Only the narrowly scoped `Publish tag and GitHub
Release` job receives `contents: write`; it runs after release quality succeeds.
The repository Actions policy allows only GitHub-owned actions pinned to a full
commit SHA. Keep this policy aligned with every `uses:` entry before introducing
another action.

Keep the remote repository settings aligned with these boundaries:

| Setting | Required value |
| --- | --- |
| Actions default workflow permissions | Read-only; workflows cannot approve pull requests |
| Allowed Actions | GitHub-owned only; full-length commit SHA required |
| `main` protection | Enforce for administrators; require pull requests, linear history, and the strict up-to-date `Repository check` from the GitHub Actions App; disallow force pushes and deletion |
| Pull-request merge methods | Merge commits disabled; squash and rebase enabled |
| Secret scanning | Secret scanning and push protection enabled |
| Code scanning | CodeQL default setup enabled for JavaScript/TypeScript and Actions |

CodeQL may still run through GitHub's separately managed default setup. Treat any CodeQL alert as a security finding that must be reviewed rather than as a release signal.

Require the exact `Repository check` context produced by the GitHub Actions App;
similarly named contexts must not satisfy branch protection. Because the release
commit reaches `main` through a checked pull request, strict status checks and
administrator enforcement remain enabled throughout the release. Before opening
that pull request, inspect commits for sensitive files, secrets, whitespace
errors, and valid release metadata. Fixtures must remain synthetic because local
Playwright traces can contain rendered form values and mocked request details.

### Version rules

The current package baseline is `0.3.0`. Release-it examines commits since the
previous version tag and ignores commits that do not match a releasable
Conventional Commit type.

| Conventional Commit | SemVer result |
| --- | --- |
| `fix(scope): ...` | Patch, for example `0.1.0` → `0.1.1` |
| `feat(scope): ...` | Minor, for example `0.1.0` → `0.2.0` |
| `feat(scope)!: ...` or `BREAKING CHANGE:` | Major, for example `0.1.0` → `1.0.0` |
| `perf(scope): ...` or `revert: ...` | Patch |
| `docs:`, `test:`, `build:`, `ci:`, `chore:` | No release by itself |

When explicitly invoked from a clean `release/*` branch, `release-it`
accumulates all unreleased commits, chooses the highest required bump, updates
`package.json` and `CHANGELOG.md`, and commits `chore(release): vX.Y.Z`. Its Git
tag, push, and GitHub Release operations are disabled. Push that branch, open a
pull request whose title matches the generated commit, and squash merge after
`Repository check` succeeds.

After merge, open **Actions → Release → Run workflow** and enter both `vX.Y.Z`
and the full merge commit SHA now reachable from `main`. The workflow rejects a
non-main commit, version mismatch, malformed SHA, or an existing tag that points
elsewhere. It reruns `pnpm check`, then creates the tag and GitHub Release if
needed before deploying the same revision. If Vercel deployment fails, rerun the
workflow with the same tag and SHA; the existing release is validated rather
than recalculated or replaced. Never move or overwrite a version tag.

### Rollback and hotfixes

- For a normal fix, merge a `fix:` pull request into `main`. When a patch
  release is desired, prepare and merge a separate release pull request.
- For an urgent traffic rollback, restore the previous deployment in Vercel, then follow with a `revert:` or `fix:` commit so Git history and the next patch version describe the production state.
- Never move or overwrite an existing `vX.Y.Z` tag.

## Vercel deployment

Vercel is the supported zero-server-management topology because it runs the Next.js App Router and route handlers required by this repository.

### Environment variables

| Variable | Vercel browser deployment | Purpose |
| --- | --- | --- |
| `RESUME_OS_TRUSTED_PROXY=vercel` | Required | Trust Vercel's forwarded protocol/IP only when the Vercel runtime marker is present |
| `RESUME_OS_ALLOWED_AI_HOSTS` | Optional | Comma-separated exact `host[:port]` additions for browser BYOK providers |
| `RESUME_OS_LOCAL_ONLY` | Must be unset | Loopback-only mode would reject public clients |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | Not required for browser BYOK | Local-only or authenticated server-to-server provider configuration |
| `RESUME_OS_AI_ACCESS_TOKEN` | Optional; server-to-server only | High-entropy bearer token of at least 32 bytes; never expose to client JavaScript |

### Deployment steps

1. Keep the GitHub repository connected to the existing Vercel project so feature branches receive Preview deployments.
2. Store the Vercel token, organization ID, and project ID in GitHub Actions secrets. Do not commit `.vercel/`.
3. Build from source on the GitHub-hosted Linux runner. The release workflow uses `vercel build --prod` and `vercel deploy --prebuilt --prod`; do not upload a `.next` output built on macOS because PDF extraction includes platform-native canvas code.
4. Set `RESUME_OS_TRUSTED_PROXY=vercel` in Preview and Production. Keep `RESUME_OS_LOCAL_ONLY` unset.
5. Add only the exact additional BYOK provider hosts users need. Treat this list as an SSRF boundary.
6. Add a Vercel Firewall or another distributed rate limit for `/api/`. The built-in process-memory limiter is defense-in-depth and is not shared by serverless instances.
7. After explicit release creation, dispatch the Release workflow with the existing `vX.Y.Z` tag and confirm that tagged quality validation and the Production deployment both succeed.
8. Open Settings on Production, select the intended provider mode, and run the corresponding AI check.
9. Import both a TXT and a representative PDF/DOCX; complete a JD analysis, save an agent run, reload, and verify IndexedDB recovery on the deployed origin.

### Complete-function conditions

The complete current raw-resume-to-job-variant workflow requires all of the following:

- Next.js route handlers are deployed and reachable at the same origin.
- browser site storage (`localStorage` and IndexedDB) is available.
- every browser user who selects cloud tasks or allows cloud fallback has saved a valid BYOK configuration.
- any selected cloud provider host is on the exact-host allowlist and reachable over HTTPS.
- platform-level rate limiting is in place for a public deployment.
- uploaded files fit the application's 3 MiB file and 4 MiB multipart limits.
- Chrome-only tasks additionally require a compatible Chrome environment, model availability/download, supported language, and sufficient context budget.

The 3 MiB/4 MiB application limits stay below Vercel Functions' documented [4.5 MB request-body limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions). The extraction route uses the Node.js runtime and production output tracing for its PDF worker assets.

### Verification

```bash
corepack pnpm@11.17.0 install --frozen-lockfile
corepack pnpm@11.17.0 check
corepack pnpm@11.17.0 test:production-extraction
```

For a public deployment, also verify the browser network panel: Chrome-local tasks must not call cloud routes, Automatic mode with fallback disabled must stop locally, and cloud tasks must call only the same-origin API before the configured provider.

## GitHub Pages boundary

GitHub Pages serves static files and cannot execute the Next.js route handlers used for document extraction and OpenAI-compatible AI tasks. The current repository therefore cannot provide its complete workflow on GitHub Pages.

A separate static adaptation could retain the shell, local persistence, deterministic scoring, presentation routes, and supported Chrome Built-in AI tasks. It would still need an independently hosted API for upload extraction and cloud/raw-resume parsing, plus code changes for routing, CORS, authentication, SSRF protection, secrets, and rate limiting. That is a different deployment architecture, not a configuration switch.
