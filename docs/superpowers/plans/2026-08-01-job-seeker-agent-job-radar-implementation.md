# JobSeeker Agent Job Radar Implementation Plan

## Objective

Implement the MVP defined in
`docs/superpowers/specs/2026-08-01-job-seeker-agent-job-radar-design.md` without weakening
the existing evidence, privacy, provider, storage, request-guard, cancellation, or
resume-variant boundaries.

This plan ends at user-confirmed, manual submission. It does not include logged-in
job-platform automation, arbitrary web scraping, unattended application submission,
server-side job persistence, or account sync.

## Progress

- Phase 0 product and operational boundaries: completed on 2026-08-01; the shipped
  endpoints and public-read classification were re-checked against the providers'
  official documentation before verification.
- Phase 1 local job-domain storage: completed on 2026-08-01.
- Phase 2 authorized source adapters: completed on 2026-08-01.
- Phase 3 bounded same-origin discovery route: completed on 2026-08-01.
- Phase 4 transactional refresh and duplicate suggestions: completed on 2026-08-01.
- Phase 5 deterministic preliminary recommendation scoring: completed on 2026-08-01.
- Phase 6 Job Radar application: completed on 2026-08-01.
- Phase 7 Target Job promotion: completed on 2026-08-01.
- Phase 8 application packet and explicit submission: completed on 2026-08-01.
- Phase 9 documentation and verification: completed on 2026-08-01.

## Delivery Strategy

Deliver Job Radar as a sequence of independently testable slices. Keep the existing
resume workflow operational after every slice. Do not add UI shells before the domain
and source boundaries have tests.

The MVP sequence is:

```text
local schema migration
  -> authorized source adapters
  -> normalized posting refresh
  -> deterministic preliminary ranking
  -> Job Radar application
  -> promote to existing Target Job workflow
  -> local application record
  -> manual open-and-confirm submission
```

## Phase 0 — Confirm Product And Operational Boundaries

### Work

- Treat the product design document as a proposal until implementation is explicitly
  authorized.
- Re-check current Greenhouse and Lever public API documentation and terms.
- Record exact endpoints, identifiers, redirect behavior, response limits, and rate
  limits in source-specific tests and comments.
- Confirm that the MVP performs user-triggered refresh only and remains stateless on
  the server.
- Decide whether each public GET can run from the browser. Use a same-origin proxy only
  when CORS or response normalization requires it.
- Define a source-adapter review checklist for later providers.

### Documentation to update when behavior ships

- `README.md`: primary workflow, routes, local data table, source policy, and explicit
  no-auto-submit boundary.
- `docs/deployment.md`: fixed upstream hosts, proxy limits, rate limiting, logging,
  retries, and production verification.
- `AGENTS.md`: repository invariants for authorized job sources, public-job data, and
  submission control if those rules are intended to govern future changes.

### Verification

- Every source and action in scope maps to an explicit allowed source class.
- No task depends on platform credentials, browser cookies, CAPTCHA bypass, or an
  arbitrary remote URL.

## Phase 1 — Add Backward-Compatible Job Domain Storage

### Files

- Modify: `lib/agent/domain-store.ts`
- Modify: `lib/agent/domain-store.test.ts`
- Create: `lib/jobs/job-domain.ts`
- Create: `lib/jobs/job-domain.test.ts`

### Work

1. Define strict Zod schemas and bounds for:
   - `JobSource`;
   - `JobSearchProfile`;
   - `JobPosting`;
   - `JobRecommendation`;
   - `ApplicationRecord`.
2. Add stable ID and fingerprint helpers. Prefer normalized source identity over array
   position or fetch order.
3. Increment the IndexedDB schema version and add object stores and indexes for the new
   entities.
4. Implement an explicit `1 -> 2` migration. Preserve every version 1 store and record.
   Do not reuse the current new-database-only migration path.
5. Add relationship validation:
   - postings require an existing source;
   - recommendations require posting and search-profile records;
   - an analyzed target job must exist;
   - application records require posting and source draft records by the appropriate
     repository boundary;
   - referenced target jobs and variants must belong to the same application context.
6. Add deletion restrictions and transaction helpers for multi-entity refresh and
   promotion operations.
7. Set bounded record counts and serialized text limits before accepting source data.

### Tests

- Open a synthetic schema version 1 database, migrate it, and verify all old records.
- Create a fresh version 2 database.
- Reject unknown fields, malformed timestamps, oversized descriptions, duplicate IDs,
  invalid URLs, and invalid status transitions.
- Reject missing cross-store references.
- Preserve application history when a posting becomes closed.
- Mark recommendations stale when their fingerprints no longer match.

### Iteration check

```bash
corepack pnpm@11.17.0 test lib/jobs/job-domain.test.ts lib/agent/domain-store.test.ts
```

## Phase 2 — Build Authorized Source Adapters

### Files

- Create: `lib/jobs/sources/types.ts`
- Create: `lib/jobs/sources/greenhouse.ts`
- Create: `lib/jobs/sources/greenhouse.test.ts`
- Create: `lib/jobs/sources/lever.ts`
- Create: `lib/jobs/sources/lever.test.ts`
- Create: `lib/jobs/sources/registry.ts`
- Create: `lib/jobs/sources/registry.test.ts`

### Contract

```ts
type JobSourceRefreshInput = {
  source: JobSource
  signal?: AbortSignal
}

type JobSourceRefreshResult = {
  sourceId: string
  completeness: 'complete' | 'partial'
  checkedAt: string
  postings: JobPostingCandidate[]
  warnings: string[]
}

interface JobSourceAdapter {
  kind: JobSource['kind']
  validateSourceKey(value: string): string
  recognizeUrl(url: URL): { sourceKey: string; externalId?: string } | null
  refresh(input: JobSourceRefreshInput): Promise<JobSourceRefreshResult>
}
```

### Work

1. Implement Greenhouse and Lever independently. Do not create a generic HTML scraper.
2. Validate raw upstream JSON with source-specific schemas before normalization.
3. Normalize HTML job descriptions into bounded plain text without retaining scripts,
   forms, tracking markup, or arbitrary embedded URLs.
4. Preserve canonical and application URLs only after exact-host and protocol checks.
5. Propagate `AbortSignal`, enforce timeouts, and treat late responses as unusable.
6. Distinguish complete and partial refreshes. Only a complete successful refresh may
   infer that a previously open source posting disappeared.
7. Add deterministic stable IDs from source kind, source key, and external ID.
8. Add fixture builders containing synthetic jobs only.

### Tests

- Normalize representative Greenhouse and Lever responses.
- Reject redirects, unexpected hosts, invalid protocols, malformed JSON, oversized
  responses, excessive posting counts, duplicate external IDs, and unsafe URLs.
- Cover cancellation, timeouts, 429 retry information, partial failures, and closed-job
  detection rules.
- Verify no career or resume fields exist in source-request inputs.

### Iteration check

```bash
corepack pnpm@11.17.0 test lib/jobs/sources
```

## Phase 3 — Add A Bounded Same-Origin Job Source Route If Required

Skip this phase if both initial sources can be fetched safely and reliably from the
browser. Do not add a proxy merely for convenience.

### Files

- Create: `app/api/jobs/discover/route.ts`
- Create: `app/api/jobs/discover/route.test.ts`
- Modify as needed: `lib/server/request-guard.ts`
- Modify as needed: `lib/server/request-json.ts`

### Request contract

Accept only a strict source enum and bounded public board identifier:

```ts
type DiscoverJobsRequest = {
  source: 'greenhouse' | 'lever'
  sourceKey: string
}
```

Do not accept `url`, `baseUrl`, custom headers, cookies, credentials, or a redirect
destination.

### Work

- Construct upstream URLs from source-specific constants.
- Require HTTPS and exact official hosts.
- Disable redirect following.
- Apply origin, access-mode, request-size, response-size, timeout, and rate-limit
  boundaries consistent with other public routes.
- Return normalized job data rather than an upstream response passthrough.
- Ensure logs and errors omit full posting descriptions and all request headers.
- Add this deliberate non-AI route to authoritative privacy and deployment docs.

### Security tests

- Allowed exact Greenhouse and Lever requests.
- Rejected arbitrary URLs, encoded host tricks, path traversal, custom ports,
  credentials, redirects, oversized identifiers, unsupported methods, cross-origin
  browser requests, malformed JSON, and upstream response overflow.
- Abort propagation and no retry after cancellation.

### Iteration check

```bash
corepack pnpm@11.17.0 test app/api/jobs/discover/route.test.ts
```

## Phase 4 — Implement Refresh, Deduplication, And Freshness Services

### Files

- Create: `lib/jobs/job-refresh.ts`
- Create: `lib/jobs/job-refresh.test.ts`
- Create: `lib/jobs/job-deduplication.ts`
- Create: `lib/jobs/job-deduplication.test.ts`

### Work

1. Refresh one source inside a domain-store transaction.
2. Upsert jobs by stable source identity and preserve `firstSeenAt`.
3. Update `lastCheckedAt`, content hash, source timestamps, and status.
4. Mark missing jobs closed only after a complete successful refresh.
5. Keep prior records unchanged after a failed or cancelled refresh.
6. Implement conservative cross-source duplicate suggestions. Do not automatically
   merge solely on title, company, or URL-host equality.
7. Invalidate recommendations and prepared packets when material job content changes.
8. Provide explicit refresh summaries: new, updated, unchanged, closed, rejected, and
   warning counts.

### Tests

- Idempotent repeated refresh.
- Content update with stable identity.
- Partial results do not close unseen jobs.
- Cancellation before commit performs no partial write.
- Cross-tab transaction behavior remains referentially valid.
- Material changes make downstream data stale without deleting it.

### Iteration check

```bash
corepack pnpm@11.17.0 test lib/jobs/job-refresh.test.ts lib/jobs/job-deduplication.test.ts
```

## Phase 5 — Add Deterministic Preliminary Recommendation Scoring

### Files

- Create: `lib/jobs/job-recommendation.ts`
- Create: `lib/jobs/job-recommendation.test.ts`

### Work

1. Define `job-seeker-agent-job-relevance-v1` as a versioned rubric.
2. Implement hard eligibility rules separately from ranking.
3. Normalize title families, locations, workplace types, employment types, and terms
   without model inference.
4. Calculate transparent contributions for:
   - title and role-family relevance;
   - career-fact tag overlap;
   - soft preference fit;
   - freshness.
5. Return `needs-analysis` when required fields or useful description content are
   insufficient.
6. Persist input fingerprints containing the posting content hash, search profile,
   source draft identity, and relevant career-fact revisions.
7. Never reuse the preliminary score as requirement coverage or an ATS probability.

### Tests

- Identical normalized inputs produce byte-for-byte stable results.
- Hard exclusions cannot be overridden by a high soft score.
- Missing data is unknown rather than a positive match.
- Stale, closed, and over-age postings are handled consistently.
- Chinese and English normalization fixtures.
- Numeric bounds, contribution totals, and rubric version.

### Iteration check

```bash
corepack pnpm@11.17.0 test lib/jobs/job-recommendation.test.ts
```

## Phase 6 — Add The Job Radar Application

### Files

- Create: `components/apps/job-radar-app.tsx`
- Create: `components/apps/job-radar-app.test.tsx`
- Create supporting controller/service hooks under `components/apps/job-radar/` when
  UI, persistence, and networking would otherwise mix in one component.
- Modify: `lib/desktop/types.ts`
- Modify: `lib/desktop/app-registry.ts`
- Modify: `lib/desktop/app-registry.test.ts`
- Modify: `components/desktop/app-loader.tsx`
- Modify: `components/desktop/workflow-overview.tsx`
- Create: `app/[locale]/jobs/page.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh.json`
- Modify: `app/globals.css`

### UI slices

1. Search profile editor.
2. Authorized source list and add-source flow.
3. Explicit refresh action with cancellation and per-source results.
4. Job inbox with filters for New, Saved, Needs analysis, Ready, Applied, and Closed.
5. Job detail panel with source, freshness, preliminary reasons, unknown fields, and
   original link.
6. Save, Ignore, Analyze, Prepare, and Open original actions.

### Rules

- Register Job Radar in the workflow group and make it a primary route.
- Keep dense desktop layout usable at minimum window size.
- Reuse the registry and mobile full-screen routing.
- Do not hide source warnings or make refresh automatic on first render.
- Use accessible names for scores, statuses, and filters.
- Respect reduced motion and mobile safe areas.
- Keep networking in a controller/service layer with generation IDs or fingerprints
  so stale responses cannot replace newer filters or source settings.

### Component tests

- Empty state and first source setup.
- Refresh success, partial success, rate limit, cancellation, and retry.
- Save/ignore reversal.
- Filter and keyboard behavior.
- Preliminary explanation and unknown-data presentation.
- Closed posting remains visible in application history.
- Mobile actions and reduced-motion rendering.

### Iteration check

```bash
corepack pnpm@11.17.0 test components/apps/job-radar-app.test.tsx lib/desktop/app-registry.test.ts
```

## Phase 7 — Promote A Posting Into The Existing Target-Job Workflow

### Files

- Create: `lib/jobs/job-promotion.ts`
- Create: `lib/jobs/job-promotion.test.ts`
- Modify: `components/apps/jd-match-app.tsx`
- Modify: `components/apps/jd-match-app.test.tsx`
- Modify as needed: `lib/agent/workflow-persistence.ts`

### Work

1. Convert one current open posting into the existing JD analysis input without
   bypassing model-output validation or requirement review.
2. Reuse an existing target job when the posting identity and content fingerprint
   match; otherwise create a new target job and preserve the prior run.
3. Persist a relationship from recommendation/application to target job instead of
   adding fragile source fields to old records without migration.
4. Require every extracted requirement to be user-confirmed before starting the
   existing optimization run.
5. Invalidate the promoted analysis when the posting content changes.
6. Keep Demo/Sandbox source drafts blocked.

### Tests

- Successful promotion with source attribution.
- Duplicate Analyze action is idempotent.
- Updated posting requires re-analysis.
- Closed posting warns before analysis but does not delete prior work.
- Wrong draft, untrusted draft, stale recommendation, and broken reference are
  rejected.
- Existing evidence, scoring, plan approval, change approval, and variant tests remain
  unchanged and passing.

### Iteration check

```bash
corepack pnpm@11.17.0 test lib/jobs/job-promotion.test.ts components/apps/jd-match-app.test.tsx
```

## Phase 8 — Add Local Application Records And Packet Readiness

### Files

- Create: `lib/jobs/application-record.ts`
- Create: `lib/jobs/application-record.test.ts`
- Create: `components/apps/application-pipeline.tsx`
- Create: `components/apps/application-pipeline.test.tsx`
- Modify: `components/apps/job-radar-app.tsx`
- Modify: `components/apps/classic-resume-app.tsx`

### Work

1. Define a deterministic application-state transition function. Do not mutate status
   ad hoc in components.
2. Allow Save and Analyze before a variant exists.
3. Mark `ready-to-apply` only when:
   - the posting is still reviewable;
   - the target-job run is applied;
   - the referenced variant exists and belongs to the same source draft and target
     job;
   - no relevant posting, resume, or evidence fingerprint is stale.
4. Build an application checklist containing source verification, resume variant,
   evidence gaps, and user notes.
5. Open the original application URL only after showing the packet and stale warnings.
6. Require the user to explicitly mark `applied`; opening the URL does not transition
   state.
7. Preserve records and variants through rejected, withdrawn, and archived states.

### Tests

- Valid and invalid state transitions.
- Variant and posting referential integrity.
- Stale packet cannot appear ready.
- Opening original does not mark applied.
- Submitted timestamp requires an explicit applied event.
- Source resume deletion remains restricted while application data depends on it.
- Accessible pipeline and mobile behavior.

### Iteration check

```bash
corepack pnpm@11.17.0 test lib/jobs/application-record.test.ts components/apps/application-pipeline.test.tsx
```

## Phase 9 — Documentation, Security Review, And End-To-End Coverage

### Documentation

- Update `README.md`, `docs/deployment.md`, and both locales to match the shipped
  behavior.
- Explain that JobSeeker Agent discovers from authorized public sources, keeps private
  matching local, and does not automatically submit.
- Document source configuration, limits, privacy flow, retry behavior, and unsupported
  platform policy.
- Do not claim background discovery while the browser is closed.

### End-to-end scenarios

1. Add a synthetic Greenhouse source, refresh, save a posting, analyze it, confirm
   requirements, map evidence, approve a plan, approve changes, create a variant, open
   the original URL, and explicitly mark applied.
2. Repeat source discovery through a synthetic Lever response.
3. Cancel a refresh and verify that no partial source state commits.
4. Change a posting after packet creation and verify that the recommendation and packet
   become stale.
5. Use a Demo/Sandbox resume and verify that analysis/application preparation is
   blocked.
6. Attempt an unsupported source URL and verify that it is rejected without a network
   request.
7. Exercise the primary flow on desktop and mobile.
8. Verify reduced-motion behavior and keyboard navigation.

### Security review

- No arbitrary URL fetch path.
- Exact upstream host and protocol validation.
- No redirects, cookies, authorization passthrough, or credential fields.
- Bounded request, response, record, description, and collection sizes.
- Cancellation reaches upstream fetch and late results are ignored.
- Logs contain no career data, provider keys, cookies, or full application packets.
- Career evidence is never sent to source adapters.
- Browser AI/cloud routing retains explicit provider and fallback consent.
- No final submission automation exists.

### Required verification

During implementation, run the narrowest relevant Vitest files for every phase. Before
handoff of the material feature, run:

```bash
corepack pnpm@11.17.0 check
corepack pnpm@11.17.0 test:e2e
```

If the new route, parser, or deployment configuration affects production bundling or
document extraction boundaries, also run:

```bash
corepack pnpm@11.17.0 test:production-extraction
```

Do not update Playwright snapshots merely to make them pass. Inspect and explain every
intentional visual change.

## MVP Definition Of Done

- The Job Radar product promise is visible without displacing evidence and approval
  safeguards.
- Public-source discovery works through dedicated Greenhouse and Lever adapters.
- Source requests cannot become generic SSRF or authenticated scraping mechanisms.
- Existing browser data migrates without loss.
- Job postings, recommendations, and application records are stored locally with
  referential integrity.
- Preliminary relevance is deterministic, versioned, and explainable.
- Deep evidence analysis reuses the existing requirement matrix and score.
- Applying resume changes still creates a separate `ResumeVariant`.
- The final application is opened for user review and never submitted automatically.
- English and Chinese, desktop and mobile, keyboard access, reduced motion,
  cancellation, stale-input protection, and failure states are covered.
- Authoritative documentation matches runtime behavior.
- Required checks pass, or every skipped check is reported with its reason.

## Post-MVP Decision Gates

Do not begin these items as ordinary follow-up implementation. Each requires a new
decision and threat/compliance review:

1. **Scheduled server discovery** — requires server-side public-job persistence,
   source retention, operational cost, and freshness ownership.
2. **Email/notification connectors** — requires connector permissions, content
   minimization, revocation, and local/cloud boundaries.
3. **Screening-answer drafts** — requires protected-field schemas, evidence validators,
   and per-answer approval.
4. **Browser form assistance** — requires per-site terms review, explicit user gesture,
   field-level preview, and no prohibited platform automation.
5. **Official one-click apply** — requires platform or employer authorization,
   submission receipts, idempotency, correction handling, and explicit final consent.
6. **Application status sync** — requires a reliable authorized event source and must
   not infer outcomes from page visits.
