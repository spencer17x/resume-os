# JobSeeker Agent Job Radar Product Design

## Status

Implemented as of 2026-08-01. The shipped MVP includes local job-domain contracts,
backward-compatible IndexedDB schema version 2, Greenhouse/Lever adapters, the bounded
same-origin discovery route, transactional refresh, conservative duplicate suggestions,
versioned preliminary relevance, bilingual Job Radar UI, fingerprinted Target Job
promotion, application-packet readiness, and explicit user-confirmed submission state.
This document does not authorize scraping, automated platform activity, server-side
career-data persistence, or unattended application submission.

## Product Decision

Extend JobSeeker Agent from a resume-tailoring workflow into an evidence-grounded job
search copilot:

> JobSeeker Agent discovers relevant jobs, explains which verified career facts support
> each match, prepares a job-specific application packet, and leaves the final
> submission decision with the user.

The initial product promise is:

> Find the roles worth applying to, prepare a truthful application for each one, and
> never submit on the user's behalf without review.

The short Chinese positioning is:

> 每天替你筛岗位，不替你乱投。

This is an adjacent extension of the existing evidence workflow, not a replacement
for it. Career evidence remains the boundary for claims, models remain proposal
engines, and the master resume remains unchanged.

## Problem

The existing product starts after a user already has a job description. It can build
a careful target-job variant, but it does not solve the recurring work before and
after that moment:

- discovering newly published roles across multiple employers;
- deciding which roles are worth the application effort;
- comparing opportunities consistently instead of by title alone;
- avoiding duplicate, stale, misleading, or poorly matched postings;
- preparing one coherent set of application materials;
- remembering what was submitted and what happened next.

A generic job alert solves discovery but not evidence-based fit. A generic AI resume
writer produces text but does not maintain claim provenance. An unattended auto-apply
bot increases application count but can submit unsuitable roles, inaccurate answers,
or unreviewed personal information.

JobSeeker Agent should connect discovery to its existing evidence and approval model.

## Target User

The first release targets mid-to-senior technical and product candidates who:

- have enough career evidence to benefit from role-specific positioning;
- monitor roles at a known set of companies or public company career pages;
- apply selectively rather than optimizing for raw submission volume;
- want to understand why a role matches and where the real gaps are;
- value factual accuracy, privacy, and control over final submissions;
- may use Chinese or English resumes and job descriptions.

The first release is not optimized for high-volume hourly-work marketplaces, campus
bulk applications, staffing-agency workflows, or users who want a fully autonomous
bot to operate platform accounts.

## Product Principles

1. **Recommendation before automation** — identify the best next action instead of
   maximizing the number of automated actions.
2. **Evidence before fit** — explain job fit through saved career facts, not only
   keyword similarity or a model-authored percentage.
3. **Quality before volume** — help the user submit fewer, stronger applications.
4. **User review before representation** — the user reviews any material or answer
   that will represent them to an employer.
5. **Authorized sources only** — use public, documented, user-supplied, or explicitly
   partnered sources. Do not evade platform controls.
6. **Local private matching** — keep career evidence in the browser and avoid sending
   it to job sources.
7. **Transparent freshness** — show where a posting came from, when it was checked,
   and whether its availability is uncertain.
8. **Recoverable state** — job decisions, packets, and application states must remain
   resumable without silently mutating existing resume data.

## Non-Goals

The first release will not:

- log in to LinkedIn, BOSS, Indeed, Liepin, Lagou, or another job marketplace;
- store or replay platform passwords, cookies, sessions, or device fingerprints;
- scrape logged-in pages or bypass robots rules, CAPTCHAs, rate limits, or anti-bot
  systems;
- run browser automation against a platform that prohibits third-party automation;
- submit applications in the background or click a final Submit/Apply control;
- generate unsupported screening answers, salary expectations, identity attributes,
  work authorization, demographic data, or legal attestations;
- claim to predict an interview, offer, or ATS pass probability;
- introduce a hosted user account, career-profile database, or cloud sync;
- collect public job listings into a permanent server-side catalog in the MVP;
- send bulk recruiter messages or optimize for application count;
- ingest private recruiter or candidate data from job platforms.

## Platform And Source Boundary

The source policy is part of the product contract, not an implementation detail.

### Allowed source classes

1. **Documented public job-board reads**
   - Greenhouse public Job Board GET endpoints.
   - Lever public Postings GET endpoints.
   - Additional sources only after their official documentation and terms are
     reviewed and encoded in a dedicated adapter.
2. **User-provided content**
   - A pasted job description.
   - A recognized public job URL.
   - A local text export or explicitly selected alert content in a later release.
3. **Partner APIs**
   - A platform or employer integration supported by a written agreement and a
     dedicated credential boundary.
4. **Direct employer application links**
   - Open the original employer-hosted form for the user to review and submit.

### Disallowed source classes

- a generic arbitrary-URL server fetcher;
- HTML scraping of authenticated job marketplaces;
- hidden or reverse-engineered mobile APIs;
- session-cookie reuse;
- CAPTCHA-solving or rotating identities/proxies;
- DOM automation whose purpose is to imitate a human on a prohibited platform;
- aggregating personal profiles, recruiter details, or non-public platform data.

### Verified external constraints

The Greenhouse Job Board documentation classifies board data as public and requires
no authentication for GET endpoints. Lever describes its Postings API as publicly
accessible for published postings and documents the fixed `/v0/postings/{site}` GET.
The separate application POST endpoints require credentials or candidate data and
remain outside this MVP; JobSeeker Agent opens the provider-hosted form instead. These
source classifications and endpoints were re-checked on 2026-08-01.

As of 2026-08-01, LinkedIn states that unauthorized third-party software and browser
extensions may not scrape or automate activity on its site. Indeed prohibits
unauthorized automated access and automated application submission outside its
official tooling. Lagou and Liepin agreements also restrict bots, scripts, crawlers,
or simulated-user programs. The implementation must re-check terms before enabling a
new source or action.

References:

- <https://www.linkedin.com/help/linkedin/answer/a1340567/automated-activity-on-linkedin?lang=en>
- <https://www.indeed.com/legal?hl=en>
- <https://lagou-zhaopin-fe.lagou.com/activities/20230221/1676948198060.pdf>
- <https://image0.lietou-static.com/img/66a85a9cb1f15833544b120f07u.pdf>
- <https://developer.greenhouse.io/job-board.html>
- <https://github.com/lever/postings-api>
- <https://hire.lever.co/developer/support>
- <https://help.lever.co/hc/en-us/articles/20087346449437-Lever-career-site-options>

## Primary User Journey

### 1. Establish a trusted career profile

The user imports or pastes a real resume through the existing trusted flow and
reviews the resulting career facts. Demo and AI-generated resumes remain excluded
from real job matching.

### 2. Configure a search profile

The user defines:

- target titles and acceptable adjacent titles;
- preferred and excluded locations;
- remote, hybrid, and onsite preferences;
- employment types;
- seniority range;
- optional compensation floor and currency;
- required, preferred, and excluded terms;
- employers or public ATS boards to monitor;
- maximum posting age.

Hard exclusions are applied before ranking. An absent field is unknown, not a match.

### 3. Refresh Job Radar

The user explicitly starts a refresh. JobSeeker Agent fetches only configured, authorized
public sources. The MVP may continue refreshing while the application is open, but
does not promise execution while the browser is closed.

The result is a local inbox of normalized job postings with source attribution,
freshness, and deduplication.

### 4. Review recommendations

For each posting, the UI shows:

- title, company, location, workplace type, and employment type when available;
- original source and application URL;
- first seen, last checked, source-updated, and stale/closed status;
- hard-filter result;
- preliminary relevance with transparent reasons;
- verified strengths and likely gaps after deep analysis;
- whether the result is preliminary or evidence-mapped;
- actions: Save, Ignore, Analyze, Prepare application, and Open original.

The recommendation score is labeled **JobSeeker Agent relevance**, not interview chance or
ATS probability.

### 5. Promote a posting to a target job

Analyze creates or reuses the existing `TargetJob`, requirement matrix, and
optimization workflow. Source attribution is preserved without weakening the current
requirement-confirmation gate.

### 6. Prepare an application packet

The first packet contains:

- the validated job-specific `ResumeVariant`;
- the original posting URL and a posting snapshot/fingerprint;
- a concise evidence and gap summary;
- an application checklist;
- user-authored notes.

Evidence-grounded cover letters, recruiter notes, and screening-answer drafts are
later phases. They require their own schemas and validators and must not be treated as
free-form model output.

### 7. Submit with user control

JobSeeker Agent opens the original application page and provides the approved packet. The
user completes platform-specific questions and performs the final submission.

Afterward, the user explicitly marks the application as submitted and records the
date. JobSeeker Agent never assumes that opening an application page means it was submitted.

### 8. Track outcomes

The user moves an application through a small local pipeline:

```text
saved -> analyzing -> preparing -> ready-to-apply -> applied
      -> interviewing -> offered / rejected / withdrawn / archived
```

External statuses are not inferred unless a future authorized integration provides a
reliable event.

## Information Architecture

Add one primary application and extend one existing review surface:

1. **Career Profile** — current Studio and career evidence.
2. **Job Radar** — search profiles, source configuration, refresh, filters, and job
   recommendations.
3. **Target Job** — existing JD requirement review for one selected posting.
4. **Tailor Agent** — existing gap, plan, change, and variant workflow.
5. **Applications** — packet readiness and user-maintained application status. This
   may begin as a Job Radar tab before becoming a separate application.
6. **Review & Export** — existing variant comparison and export.
7. **Settings** — provider, privacy, source-policy explanation, language, theme, and
   motion.

Showcase applications remain secondary and must not interrupt the job-search path.

## Matching Model

Job Radar uses progressive analysis so a refresh does not require cloud inference for
every posting.

### Stage A: eligibility gate

Pure deterministic rules exclude postings that contradict explicit hard preferences,
for example an excluded location or employment type. Missing source fields remain
unknown and require user judgment.

### Stage B: preliminary relevance

Pure local code uses normalized title terms, structured source fields, career-fact
tags, user preferences, and freshness. It produces reasons and contributions, not a
single opaque embedding result.

Suggested V1 rubric:

```text
title and role-family relevance  40%
career-fact tag overlap          30%
soft preference fit             20%
posting freshness               10%
```

The rubric is versioned. A posting with insufficient structured content is marked
`needs-analysis` instead of receiving invented confidence.

### Stage C: evidence-mapped relevance

For a user-selected posting or an explicitly approved small batch, reuse the current
requirement extraction and evidence mapping. The authoritative evidence result is the
existing deterministic requirement coverage and evidence completeness. Model output
may propose requirements but may not author the final score.

The UI must keep preliminary relevance and evidence-mapped alignment distinct.

## Proposed Local Domain Contracts

The exact schemas may be refined during implementation, but persisted relationships
must preserve these concepts:

```ts
type JobSource = {
  id: string
  kind: 'greenhouse' | 'lever' | 'manual'
  label: string
  sourceKey?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

type JobSearchProfile = {
  id: string
  name: string
  titles: string[]
  adjacentTitles: string[]
  locations: string[]
  excludedLocations: string[]
  workplaceTypes: Array<'remote' | 'hybrid' | 'onsite'>
  employmentTypes: Array<'full-time' | 'part-time' | 'contract' | 'internship' | 'other'>
  requiredTerms: string[]
  preferredTerms: string[]
  excludedTerms: string[]
  maximumAgeDays: number
  createdAt: string
  updatedAt: string
}

type JobPosting = {
  id: string
  sourceId: string
  externalId: string
  canonicalUrl: string
  applyUrl: string
  title: string
  company: string
  description: string
  locale: 'zh' | 'en'
  location?: string
  workplaceType?: 'remote' | 'hybrid' | 'onsite'
  employmentType?: 'full-time' | 'part-time' | 'contract' | 'internship' | 'other'
  compensation?: { minimum?: number; maximum?: number; currency: string; period?: string }
  sourceUpdatedAt?: string
  firstSeenAt: string
  lastCheckedAt: string
  status: 'open' | 'closed' | 'stale' | 'unknown'
  contentHash: string
}

type JobRecommendation = {
  id: string
  postingId: string
  searchProfileId: string
  sourceDraftId: string
  rubricVersion: string
  inputFingerprint: string
  eligibility: 'eligible' | 'excluded' | 'unknown'
  preliminaryScore?: number
  reasons: Array<{ code: string; contribution: number; evidenceRefs: string[] }>
  analyzedTargetJobId?: string
  createdAt: string
  updatedAt: string
}

type ApplicationRecord = {
  id: string
  postingId: string
  sourceDraftId: string
  targetJobId?: string
  resumeVariantId?: string
  status:
    | 'saved' | 'analyzing' | 'preparing' | 'ready-to-apply' | 'applied'
    | 'interviewing' | 'offered' | 'rejected' | 'withdrawn' | 'archived'
  submittedAt?: string
  notes: string
  createdAt: string
  updatedAt: string
}
```

Requirements:

- IDs and content hashes are stable across refreshes.
- Duplicate postings from the same source update in place.
- Cross-source deduplication is conservative and reversible; it must not merge solely
  because titles match.
- Relationships use IndexedDB transactions and deletion restrictions.
- Every persisted schema has bounded text, collection, and serialized-size limits.
- Schema version 1 data must migrate to the new schema without clearing browser data.
- A recommendation becomes stale when the posting, search profile, source resume, or
  referenced career facts change.
- Closing a posting does not delete its application history or prepared variant.

## Fetch And Privacy Architecture

The MVP remains local-first:

```text
Authorized public ATS
  -> bounded same-origin source adapter
  -> normalized public posting
  -> IndexedDB in this browser
  -> local deterministic matching against career facts
  -> optional explicitly selected AI task
```

The source request must contain only the source kind and bounded public identifier
needed to retrieve public jobs. It must not contain the user's resume, career facts,
preferences, API key, or application history.

A server route may be introduced only as a bounded non-AI proxy for fixed official
hosts when browser CORS prevents a direct public GET. It must:

- accept a source enum rather than an arbitrary base URL;
- construct the upstream URL from validated bounded identifiers;
- enforce an exact-host allowlist and HTTPS;
- reject redirects;
- use request, response-size, item-count, and timeout limits;
- return only the normalized fields required by the client;
- avoid request/response logging that captures posting descriptions unnecessarily;
- remain stateless and store neither jobs nor user data;
- include allowed-path and rejected-path security tests.

The MVP does not run a server scheduler. A future public-job catalog would be a new
operational decision requiring retention rules, source licensing review, freshness
SLAs, abuse controls, deployment documentation, and a deliberate exception to the
current no-server-persistence product model.

## Safety And Trust UX

- Always show the original source and open it in a normal browser context.
- Label recommendations as preliminary until requirement analysis is complete.
- Explain each score contribution and hard exclusion.
- Display unknown source fields as unknown, not false.
- Warn when a posting is stale, closed, duplicated, or no longer verified at source.
- Keep compensation, work authorization, identity, and legal answers manual unless
  the user provides and approves a dedicated reusable answer.
- Do not treat a job advertisement or company identity as verified merely because it
  came from a supported ATS.
- Keep application status user-confirmed.
- Never generate or transmit a packet from a Demo/Sandbox resume.

## Failure And Cancellation Behavior

- A source failure does not remove previously saved postings.
- Partial source results are labeled partial and do not mark unseen jobs closed.
- Closing detection requires a successful complete refresh or direct job check.
- Refresh, analysis, and packet preparation accept `AbortSignal` and ignore late
  results after source/profile/input changes.
- Rate limits expose a retry time and do not trigger hidden alternate sources.
- Malformed source data is rejected by source-specific schemas.
- A stale recommendation cannot silently start an optimization run.
- A posting change after packet preparation requires review before opening the
  application page.

## Localization And Accessibility

- All user-facing text is present in `messages/en.json` and `messages/zh.json`.
- Scores are not represented by color alone.
- Job cards expose title, company, source, status, and primary action to assistive
  technology.
- Filters are keyboard accessible and retain visible labels.
- Refresh and analysis progress use non-disruptive live regions.
- Reduced-motion mode removes scanning and ranking animations.
- Mobile supports the same save, analyze, prepare, and open-original actions without
  desktop-only hover interactions.

## Success Metrics

Metrics remain local unless a separate analytics decision is approved. The UI may
show a personal summary computed from local data:

- time from refresh to first saved posting;
- saved-posting rate by source;
- percentage of saved postings promoted to evidence analysis;
- time from saved posting to ready application packet;
- percentage of packets marked applied;
- direct/partial evidence coverage of applied roles;
- duplicate and stale postings avoided;
- number of unsupported claims applied: target **zero**;
- number of submissions made without explicit user confirmation: target **zero**.

## MVP Acceptance Criteria

The first Job Radar release is complete only when:

- a user can configure at least one search profile and one authorized public source;
- Greenhouse and Lever public jobs can be refreshed through source-specific adapters;
- recognized public job URLs can be imported without an arbitrary-URL fetcher;
- postings are validated, normalized, deduplicated, and stored locally;
- the UI shows source, freshness, status, filters, and recommendation reasons;
- deterministic preliminary matching has a visible rubric version;
- a posting can be promoted into the existing target-job requirement workflow;
- the existing confirmation, evidence mapping, plan approval, and variant rules remain
  intact;
- an application record can reference the posting, target job, and validated resume
  variant;
- the user can open the original application page and explicitly mark the application
  as submitted;
- no code logs into or automates a prohibited recruitment platform;
- no platform credentials or cookies are stored;
- no career facts are sent to a job source;
- existing IndexedDB data migrates without loss;
- cancellation and stale-input checks cover refresh, analysis, and packet preparation;
- English and Chinese UI, keyboard access, reduced motion, desktop, and mobile behavior
  are covered;
- security tests cover allowed and rejected source requests;
- `corepack pnpm@11.17.0 check` and the relevant Playwright projects pass.

## Deferred Decisions

The following require separate product and security decisions after MVP evidence:

- server-side scheduled discovery while the browser is closed;
- a shared public job catalog;
- email or calendar connectors;
- browser form assistance;
- reusable screening answers;
- official platform partnerships and one-click apply;
- cover letters and recruiter messages;
- application-status synchronization;
- job-market analytics;
- accounts, sync, notifications, or team workflows.
