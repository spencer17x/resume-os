# Resume OS

[Live Demo](https://resume-os-phi.vercel.app/en) · [中文体验](https://resume-os-phi.vercel.app/zh) · [Deployment and data boundaries](docs/deployment.md)

Resume OS is a local-first, evidence-grounded agent for tailoring a resume to a target job. It compares a saved structured resume with a job description, proposes focused changes, and keeps every AI suggestion reviewable before it can create a separate job-specific version. The master resume is not silently rewritten.

The product is built around four principles:

- **Evidence before claims:** saved career facts are the boundary for resume content; missing evidence becomes a question, not an invented achievement.
- **Job-specific decisions:** the target role determines which verified experience should be emphasized.
- **Human approval:** AI proposes precise changes, while the user reviews, confirms, applies, or discards them.
- **Local-first ownership:** resume drafts and AI configuration stay in the browser. The server handles individual requests without persisting career data or API keys.

The primary workflow is:

1. Import or paste an existing resume in Resume Studio.
2. Add a target job description and inspect the evidence and gaps.
3. Ask the Resume Agent for job-specific, reviewable changes.
4. Verify each claim, apply selected changes, and export the resulting resume.

Simulated resume generation is a **Demo / Sandbox** for exploring the interface. It does not represent verified user history and should not be used as the evidence source for a real application.

Resume 3D, Resume Book, Projects, Timeline, and Terminal are secondary showcase views over the same structured resume. They demonstrate presentation possibilities without replacing the evidence-driven tailoring workflow.

## What kind of agent is this?

Resume OS is a **domain agent**, not a general computer-use agent. Its bounded workflow is Career Profile → target-job requirements → evidence mapping → gap questions → optimization plan → reviewable changes → job-specific resume variant. The model can propose structured output, but deterministic validators, explicit approval steps, and saved run state control what may be applied.

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
- IndexedDB for evidence, requirements, mappings, variants, and resumable agent runs

## Routes

```text
/{locale}                 Desktop or mobile workflow home
/{locale}/studio          Resume import, drafts, and Demo / Sandbox generation
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
corepack pnpm@10.33.0 install
corepack pnpm@10.33.0 dev
```

`pnpm dev` binds to `127.0.0.1:3001`. When that port is owned by another process, use a separate loopback port without killing an unrelated service:

```bash
RESUME_OS_LOCAL_ONLY=1 corepack pnpm@10.33.0 exec next dev --hostname 127.0.0.1 -p 3114
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
| Career evidence, target jobs, requirements, mappings, variants, agent runs | IndexedDB | Only the context required by an explicitly selected cloud AI task |
| Provider choice, theme, motion, desktop layout | `localStorage` | No |
| OpenAI-compatible Base URL and model | `localStorage` | Included with same-origin AI requests |
| BYOK API key | `sessionStorage` by default; `localStorage` only after explicit “remember” consent | Relayed through the same-origin route to the configured provider; never persisted by Resume OS server code |

Uploaded PDF/DOCX/TXT bytes are processed transiently by the same-origin extraction route and are not written to the domain store. The original document bytes are not stored in IndexedDB. Clearing site data, using a different browser profile, or moving to a different deployment origin produces a separate local workspace unless the user exports or migrates it separately.

## AI providers and no-silent-fallback policy

Settings exposes three explicit modes:

- **Chrome Built-in AI (Beta):** supported structured tasks run in the browser with Chrome's browser-managed model. Availability depends on the browser, device, model download state, task language, and context budget. The project currently routes bounded requirement extraction, scoped optimization-plan preparation, and one evidence-linked narrative-leaf rewrite at a time through this adapter; a local rewrite prompt excludes contact details, unrelated resume sections, and the full JD.
- **OpenAI-compatible BYOK:** tasks use the Base URL, model, and key saved by the user. This is also required for the current raw resume parsing and Demo / Sandbox generation routes.
- **Automatic:** tries Chrome Built-in AI first. It may call the configured cloud provider only when the local model is unavailable or cannot fit the bounded task **and** the user has saved “Allow explicit cloud fallback.” The default fallback permission is off. Invalid output, cancellation, and other local failures are surfaced instead of silently changing the privacy boundary.

Raw resume parsing, Demo / Sandbox generation, and the general AI service test are currently cloud-only tasks. Chrome-only mode and Automatic mode without saved fallback consent block these requests in the browser before any AI route is called and direct the user to Settings.

Chrome may need to download its local model after a user action. Resume OS checks task-specific language availability, exposes availability diagnostics, can forward download progress to a task UI, validates JSON against the task schema, checks the context budget, and destroys the session after use. See the [Chrome Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api) for the browser-managed model lifecycle.

Resume OS supports per-browser BYOK (bring your own key) configuration for OpenAI-compatible APIs. The Base URL and model are stored in `localStorage`. The API key is stored in `sessionStorage` by default and is moved to `localStorage` only when the user explicitly selects “remember on this device.” Each AI request sends the configuration and the career data required for that task to the same-origin Next.js route. The server uses them for that invocation only and does not persist or echo the key or career data.

Public browser requests must be exact same-origin requests with a complete BYOK configuration. Cross-origin browser requests remain blocked. Provider URLs must use HTTPS and match the built-in exact-host allowlist. A deployment owner can append trusted OpenAI-compatible hosts with a comma-separated `RESUME_OS_ALLOWED_AI_HOSTS` value. This allowlist is an SSRF boundary; do not add hosts you do not control or trust.

The shipped `pnpm dev` and `pnpm start` scripts bind Next.js to `127.0.0.1` and enable local-only mode. Local requests can use either the browser configuration or the `OPENAI_*` environment fallback. A public browser deployment requires complete BYOK headers for cloud AI requests; setting a shared `OPENAI_API_KEY` on Vercel does not turn the public UI into a shared-key AI service. For intentional server-to-server integration, configure a high-entropy `RESUME_OS_AI_ACCESS_TOKEN` of at least 32 bytes and `OPENAI_*`, then run `pnpm start:server`. The access token is server-only and must never be exposed through client JavaScript.

The in-process route limiter remains defense-in-depth. Set `RESUME_OS_TRUSTED_PROXY=vercel` on Vercel or `RESUME_OS_TRUSTED_PROXY=cloudflare` behind Cloudflare to use the platform-provided client IP inside each instance. Public deployments must also configure a platform or distributed rate limiter because process memory is not shared across serverless instances.

## Deploy to Vercel

Vercel can run the complete current Next.js application, including Node.js document extraction and stateless AI route handlers. It does **not** replace the browser's IndexedDB/localStorage, and it does not require a server database.

For the complete raw-resume-to-tailored-variant workflow on Vercel:

1. Deploy from source on Vercel's Linux builder; do not upload a macOS-built `.next` directory because document extraction includes platform-native code.
2. Set `RESUME_OS_TRUSTED_PROXY=vercel`; do not set `RESUME_OS_LOCAL_ONLY`.
3. Add a Vercel Firewall or other distributed rate limit for `/api/`. The in-process limiter is not shared across Functions.
4. If users select an OpenAI-compatible host outside the built-in exact-host allowlist, add that exact host to `RESUME_OS_ALLOWED_AI_HOSTS`.
5. Each browser user configures BYOK in Settings and runs diagnostics. Chrome-only mode can run the tasks currently supported by the local adapter, but it does not yet replace cloud resume parsing for a new pasted/uploaded resume.
6. The browser must allow site storage. Chrome Built-in AI additionally requires a compatible Chrome environment and an available browser-managed model.

The app enforces a 3 MiB resume-file limit and a 4 MiB multipart limit, below Vercel Functions' documented 4.5 MB request-body limit. PDF and DOCX extraction uses the Node.js runtime and includes its worker asset in the production trace. See [Deployment and data boundaries](docs/deployment.md) for the environment-variable matrix, privacy flow, and verification checklist.

GitHub Pages cannot host the complete current repository because it does not execute Next.js route handlers. A separately adapted static build could expose local presentation and supported Chrome tasks, but file extraction, raw resume parsing, and OpenAI-compatible calls would require a separately deployed API and corresponding same-origin/security changes.

Run `pnpm test:production-extraction` to build Resume OS, copy the document function trace into an isolated sandbox, and verify real PDF and DOCX extraction both inside that trace and through the built API route.
