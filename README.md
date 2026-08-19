# Resume OS

[Live Demo](https://resume-os-phi.vercel.app/en) · [中文体验](https://resume-os-phi.vercel.app/zh) · [Deployment and data boundaries](docs/deployment.md)

Resume OS is a local-first, evidence-grounded job-search agent. It turns a trusted resume and explicit job preferences into cross-platform discovery, qualification, job-specific materials, and recruiter-conversation drafts. Users choose the platforms and automation level. The agent improves search and communication strategy from user corrections, replies, interviews, and outcomes without changing the user's career facts.

The current MVP runs while the browser is open and is scoped only to BOSS Zhipin. The bundled Manifest V3 Browser Agent detects the BOSS tab and local login state without reading cookies; its send adapter remains disabled until recipient, final-content, and receipt checks are implemented. The target product requirements are documented in [docs/product-requirements.md](docs/product-requirements.md).

The product is built around four principles:

- **Evidence before claims:** saved career facts are the boundary for resume content; missing evidence becomes a question, not an invented achievement.
- **Job-specific decisions:** the target role determines which verified experience should be emphasized.
- **Zero-configuration automation:** after model setup, every supported platform is enabled and the Agent reuses available local Chrome sessions. Login challenges remain user actions.
- **Local-first ownership:** resume drafts and AI configuration stay in the browser. The server handles individual requests without persisting career data or API keys.

The primary workflow is:

1. Import or paste an existing resume in Resume Studio.
2. Open Job Agent. It enables all supported platforms, detects available Chrome sessions, derives the initial search, and starts automatically.
3. Run discovery. Reviewed public sources refresh inside Resume OS; restricted platforms open fixed-host searches or produce draft-only handoffs until an authorized connector exists.
4. Confirm every extracted requirement and inspect the evidence and gaps.
5. Ask the Resume Agent for job-specific, reviewable changes.
6. Verify each claim and apply selected changes to a separate resume variant.
7. Manage outreach and follow-ups in the conversation center. A browser adapter may send only after verifying the recipient and final content, and records completion only from a platform success receipt.

Simulated resume generation is a **Demo / Sandbox** for exploring the interface. It does not represent verified user history and should not be used as the evidence source for a real application.

Resume 3D, Resume Book, Projects, Timeline, and Terminal are secondary showcase views over the same structured resume. They demonstrate presentation possibilities without replacing the evidence-driven tailoring workflow.

## What kind of agent is this?

Resume OS is a **job-search domain agent**, not an unrestricted computer-use bot. Its bounded loop is Career Profile → discovery → qualification → evidence mapping → job-specific material → recruiter conversation → outcome feedback. The model can propose structured output, but deterministic validators, platform capabilities, the saved autonomy policy, and evidence boundaries control what may be applied or sent.

The project uses a narrow, structured form of retrieval rather than a conventional vector RAG stack:

```text
EvidenceSource <- CareerFact.evidenceRefs
CareerFact     <- RequirementMatch.factIds
Requirement   <- OptimizationRun / plan / change-set references
```

There is currently no embedding pipeline, vector database, document chunk index, web crawler, or general knowledge-base retrieval. “RAG” in this project means retrieving locally stored, typed career facts and their explicit source relationships for the current requirement or agent run. This keeps claim provenance inspectable and makes deterministic scoring possible.

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Vercel AI SDK / OpenAI-compatible BYOK
- Chrome Built-in AI `LanguageModel` adapter (Beta)
- `localStorage` for drafts and preferences
- IndexedDB for evidence, jobs, recommendations, application records, requirements, mappings, variants, and resumable agent runs

## Routes

```text
/{locale}                 Desktop or mobile workflow home
/{locale}/studio          Resume import, drafts, and Demo / Sandbox generation
/{locale}/jobs            Job Agent controls, sources, conversations, recommendations, and applications
/{locale}/agent           Evidence-grounded Resume Agent
/{locale}/jd-match        Target-job evidence and gap analysis
/{locale}/3d              Three.js resume scene
/{locale}/book            Animated book reader
/{locale}/classic         Review, compare, select, and print resume versions
/{locale}/projects        Project explorer
/{locale}/projects/[id]   Project detail
/{locale}/timeline        Career timeline
/{locale}/terminal        Terminal-style resume
/{locale}/settings        Theme, language, motion, layout, and local AI configuration
```

Supported locales are `en` and `zh`.

## Development

```bash
corepack pnpm@11.17.0 install
corepack pnpm@11.17.0 dev
corepack pnpm@11.17.0 check
```

`pnpm check` is the authoritative local verification command: it runs
typecheck, the unit/integration suite, and a production build (not Playwright
e2e). The repository does not ship Git hooks or an automatic pull-request/push
quality workflow, so run the relevant checks directly before committing or
pushing. There is no required whole-tree Prettier/ESLint gate; keep formatting
consistent with nearby files.

The supported local runtime is Node.js 24.18.0 (`>=24.18.0 <25`).

`pnpm dev` binds to `127.0.0.1:3001`. When that port is owned by another process, use a separate loopback port without killing an unrelated service:

```bash
RESUME_OS_LOCAL_ONLY=1 corepack pnpm@11.17.0 exec next dev --hostname 127.0.0.1 -p 3114
```

For local development, either configure the AI service in Settings or create `.env.local`:

```bash
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
```

Theme (`system`, `light`, `dark`), motion (`system`, `full`, `reduced`), and desktop layout are stored independently. Resetting desktop layout does not delete resume drafts.

## Local data and server boundary

Resume OS does not require a server-side database, account system, or cloud-sync service. The browser origin owns the durable product state:

| Data | Storage | Sent off-device? |
| --- | --- | --- |
| Structured resume drafts and snapshots | `localStorage` | Only when required by an explicitly selected cloud AI task |
| Career evidence, public postings, recommendations, application records, target jobs, requirements, mappings, variants, agent runs | IndexedDB | Job-source refresh sends only the configured public board identifier; career context leaves the device only for an explicitly selected cloud AI task |
| Provider choice, theme, motion, desktop layout | `localStorage` | No |
| OpenAI-compatible Base URL and model | `localStorage` | Included with same-origin AI requests |
| BYOK API key | `sessionStorage` by default; `localStorage` only after explicit “remember” consent | Relayed through the same-origin route to the configured provider; never persisted by Resume OS server code |

Uploaded PDF/DOCX/TXT bytes are processed transiently by the same-origin extraction route and are not written to the domain store. The original document bytes are not stored in IndexedDB. Clearing site data, using a different browser profile, or moving to a different deployment origin produces a separate local workspace unless the user exports or migrates it separately.

## Job Agent platform and action boundary

Job Agent starts from the resume rather than a required target company. Its first release supports only BOSS Zhipin. Platform availability never implies that the browser send adapter is enabled:

- BOSS Zhipin opens a fixed-host official search carrying the primary target title.
- BOSS Zhipin session detection has been verified; its send adapter remains disabled until recipient, content, and receipt checks are stable.
- Other marketplace and public-board parsers remain internal for backward compatibility with existing local data, but are not shown in the first-release Job Agent catalog.

For a role selected on BOSS Zhipin, the user may paste its official HTTPS
URL, title, company, location, and description into Job Agent. The URL is accepted only
when its hostname matches the selected platform. Resume OS never fetches that URL,
reads the platform session, or infers data the user did not provide. The imported role
is stored locally, scored against the active search profile, and handed directly to
Target Job for evidence review.

The quick-paste helper can parse a labeled job share (`Job title`, `Company`,
`Location`, `URL`, and `Job description`, with Chinese equivalents) entirely in the
browser and prefill the reviewable import form. Unlabeled plain text is treated only
as a description proposal; Resume OS does not guess missing identity fields or import
until the user reviews the form and presses the explicit action.

The automatic source classes remain:

- Greenhouse Job Board API at the fixed `boards-api.greenhouse.io` host;
- Lever Postings API at the fixed `api.lever.co` host.

The bundled catalog is a versioned source seed, not a server-side job database. A market search refreshes at most ten selected automatic sources. The browser calls only the same-origin `/api/jobs/discover` route with a strict provider enum and a bounded public board identifier. The route constructs the upstream URL itself, uses HTTPS GET without cookies or credentials, rejects redirects, limits the request to 1 KiB, limits an upstream response to 2 MiB and 500 postings, applies a 15-second timeout and per-process rate limit, and returns normalized records. It does not accept arbitrary URLs, headers, authorization data, or resume/career content.

Refresh is manual and runs only while the browser request is active; Resume OS does not promise background discovery after the browser closes. Partial source responses are shown as warnings and do not close missing postings. Matching and application state stay in IndexedDB. Demo/Sandbox resumes cannot enter the real application flow.

Resume OS prepares a checked local packet and opens the original employer application URL in a new tab. Opening that page never changes the application status. Only the separate user action “I submitted this application” records `applied` and `submittedAt`. Authenticated marketplace scraping, cookie reuse, CAPTCHA bypass, screening-answer invention, browser form submission, and unattended or bulk applications are outside the product boundary.

## AI providers and no-silent-fallback policy

Settings exposes three explicit modes:

- **Chrome Built-in AI (Beta):** this is initialized and persisted as the first provider preference. Supported structured tasks run in the browser with Chrome's browser-managed model. Availability depends on the browser, device, model download state, task language, and context budget. The project routes raw resume parsing, Demo / Sandbox generation, bounded requirement extraction, scoped optimization-plan preparation, and one evidence-linked narrative-leaf rewrite at a time through this adapter. Plan preparation receives only reviewed requirements/facts and a deterministic catalog of safe editable resume targets; protected profile fields and unrelated resume sections are excluded. The local and cloud Studio paths share the same prompts, structural JSON schema, normalized `ResumeData` validation, cancellation, and source classification. A local rewrite prompt excludes contact details, unrelated resume sections, and the full JD. Because Chrome does not yet officially guarantee Chinese Prompt API input or output, Chinese tasks use an explicitly marked experimental best-effort session that omits the unsupported `zh` capability declaration while retaining the same schema, evidence, cancellation, and stale-result validation.
- **OpenAI-compatible BYOK:** tasks use the Base URL, model, and key saved by the user. Selecting this mode routes Studio parsing and generation, diagnostics, and supported Agent tasks through the configured same-origin cloud routes.
- **Automatic:** tries Chrome Built-in AI first. It may call the configured cloud provider only when the local model is unavailable or cannot fit the bounded task **and** the user has saved “Allow explicit cloud fallback.” The default fallback permission is off. Invalid output, cancellation, and other local failures are surfaced instead of silently changing the privacy boundary.

Every browser AI feature reads the same persisted provider preference at task start. Cloud calls also read the persisted Base URL and model plus the saved session/device key; unsaved form edits are never used implicitly. Chrome-only mode never calls an AI route; Automatic mode without saved fallback consent also stops locally when Chrome cannot run a task. PDF/DOCX/TXT byte extraction remains the deliberate same-origin, non-AI route before the extracted text is parsed by the selected provider.

Chrome may need to download its local model after a user action. Resume OS checks task-specific language availability for officially supported languages. For experimental Chinese tasks it checks general model availability, lets the local model attempt the Chinese prompt without claiming browser-level language support, then applies the same strict output validation. It exposes availability diagnostics, can forward download progress to a task UI, validates JSON against the task schema, checks the context budget, and destroys the session after use. See the [Chrome Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api) for the browser-managed model lifecycle.

Resume OS supports per-browser BYOK (bring your own key) configuration for OpenAI-compatible APIs. The Base URL and model are stored in `localStorage`. The API key is stored in `sessionStorage` by default and is moved to `localStorage` only when the user explicitly selects “remember on this device.” Each AI request sends the configuration and the career data required for that task to the same-origin Next.js route. The server uses them for that invocation only and does not persist or echo the key or career data.

Public browser requests must be exact same-origin requests with a complete BYOK configuration. Cross-origin browser requests remain blocked. Provider URLs must use HTTPS and match the built-in exact-host allowlist. A deployment owner can append trusted OpenAI-compatible hosts with a comma-separated `RESUME_OS_ALLOWED_AI_HOSTS` value. This allowlist is an SSRF boundary; do not add hosts you do not control or trust.

The shipped `pnpm dev` and `pnpm start` scripts bind Next.js to `127.0.0.1` and enable local-only mode. Local requests can use either the browser configuration or the `OPENAI_*` environment fallback. A public browser deployment requires complete BYOK headers for cloud AI requests; setting a shared `OPENAI_API_KEY` on Vercel does not turn the public UI into a shared-key AI service. For intentional server-to-server integration, configure a high-entropy `RESUME_OS_AI_ACCESS_TOKEN` of at least 32 bytes and `OPENAI_*`, then run `pnpm start:server`. The access token is server-only and must never be exposed through client JavaScript.

The in-process route limiter remains defense-in-depth. Set `RESUME_OS_TRUSTED_PROXY=vercel` on Vercel or `RESUME_OS_TRUSTED_PROXY=cloudflare` behind Cloudflare to use the platform-provided client IP inside each instance. Public deployments must also configure a platform or distributed rate limiter because process memory is not shared across serverless instances.

## Versioned releases

Production is released from SemVer tags through an explicit release operation rather than from every `main` push:

```text
clean main → local pnpm check → calculate SemVer
           → package version + CHANGELOG commit → push main
manual tag + full release SHA → recheck → GitHub Release → Vercel Production
```

Release changes are prepared directly on a clean, up-to-date `main`. Run
`pnpm check` first, plus the production extraction smoke test and relevant
Playwright suite when a change warrants them. When a release is explicitly
requested, run `pnpm release`; release-it derives the next version from commits
added since the previous release:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- `feat!:` or a `BREAKING CHANGE` creates a major release.
- `perf:` and `revert:` create a patch release.
- `docs:`, `test:`, `chore:`, and `ci:` do not create a production release by themselves.

`release-it` updates `package.json` and `CHANGELOG.md` and creates only the
`chore(release): vX.Y.Z` commit. It does not tag, push, or publish a GitHub
Release. Push that commit to `main`, then manually run the Release workflow from
the `main` ref with `vX.Y.Z` and the full release commit SHA. The workflow
verifies main ancestry and package version,
runs that revision's `pnpm check` (or its equivalent historical quality gate
for releases that predate `pnpm check`), resolves the live remote tag and GitHub
Release immediately before publication, verifies the published
non-draft/non-prerelease Release again, and only then deploys to Vercel. The
deployment job repeats that live check before it can read Vercel credentials.
Store `VERCEL_TOKEN`,
`VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` as secrets on the `production` GitHub
Environment, whose deployment branch policy allows only `main`. See
[Deployment and data boundaries](docs/deployment.md#quality-release-and-deployment)
for setup, deployment retry, rollback, and the complete lifecycle.

## Deploy to Vercel

Vercel can run the complete current Next.js application, including Node.js document extraction and stateless AI route handlers. It does **not** replace the browser's IndexedDB/localStorage, and it does not require a server database.

For the complete raw-resume-to-tailored-variant workflow on Vercel:

1. Link the repository to the Vercel project once, then add the Vercel project IDs and access token to the `production` GitHub Environment as Actions secrets and restrict deployments to `main`.
2. Keep branch Preview deployments enabled. `vercel.json` disables direct `main` deployments so Production can only follow a version tag.
3. Build from source in GitHub Actions on Linux; do not upload a macOS-built `.next` directory because document extraction includes platform-native code.
4. Set `RESUME_OS_TRUSTED_PROXY=vercel`; do not set `RESUME_OS_LOCAL_ONLY`.
5. Add a Vercel Firewall or other distributed rate limit for `/api/`. The in-process limiter is not shared across Functions.
6. If users select an OpenAI-compatible host outside the built-in exact-host allowlist, add that exact host to `RESUME_OS_ALLOWED_AI_HOSTS`.
7. Each browser user reviews the saved AI mode in Settings and runs diagnostics. Local Chrome AI is the initial persisted preference; users selecting OpenAI-compatible or allowing Automatic cloud fallback must also save a complete BYOK configuration.
8. The browser must allow site storage. Chrome Built-in AI additionally requires a compatible Chrome environment and an available browser-managed model.

The app enforces a 3 MiB resume-file limit and a 4 MiB multipart limit, below Vercel Functions' documented 4.5 MB request-body limit. PDF and DOCX extraction uses the Node.js runtime and includes its worker asset in the production trace. See [Deployment and data boundaries](docs/deployment.md) for the environment-variable matrix, privacy flow, and verification checklist.

GitHub Pages cannot host the complete current repository because it does not execute Next.js route handlers. A separately adapted static build could expose local presentation, pasted-text parsing, Demo / Sandbox generation, and other supported Chrome tasks, but PDF/DOCX/TXT extraction and OpenAI-compatible calls would require a separately deployed API and corresponding same-origin/security changes.

Run `pnpm test:production-extraction` to build Resume OS, copy the document function trace into an isolated sandbox, and verify real PDF and DOCX extraction both inside that trace and through the built API route.
