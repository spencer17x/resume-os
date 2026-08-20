# Resume OS Product Requirements

## Product direction

Resume OS is a user-controlled, cross-platform job-search agent. It uses a trusted
resume plus explicit job preferences to discover roles, qualify opportunities,
prepare job-specific material, manage recruiter conversations, and improve its
strategy from user corrections and real outcomes.

The agent is not a bulk-application bot. It must preserve career evidence, platform
rules, user intent, and a complete action history.

## Primary workflow

1. The user imports a trusted resume and confirms job goals, locations, compensation,
   exclusions, and communication preferences.
2. After the user configures the model, the agent enables BOSS Zhipin automatically.
   Per-platform API configuration and platform selection
   are not part of the primary flow.
3. The local Browser Agent detects platform sessions already available in Chrome and
   starts discovery automatically. A missing or expired session opens the relevant
   login page; login, QR code, SMS, 2FA, and CAPTCHA completion remain user actions.
   After the first successful login, the local browser session is reused without
   exporting cookies or credentials to Resume OS.
4. The agent continuously discovers and deduplicates roles, explains its ranking,
   and rejects roles outside hard constraints.
5. For a selected role, the agent maps requirements to saved evidence, creates a
   job-specific resume variant, and prepares an evidence-grounded opening message.
6. A conversation inbox groups recruiter messages, follow-ups, interview scheduling,
   and negotiation by job. Each outbound action records its source, approval policy,
   final content, timestamp, and provider receipt when available.
7. The user records or confirms outcomes. The agent improves targeting, timing, and
   message strategy while keeping learned strategy separate from career facts.
8. Interview rounds retain user-provided questions, answers, notes, and explicit
   outcomes. The agent may generate review suggestions and an advisory pass estimate,
   but it never records pass/fail without the user's confirmation.
9. A recruiter resume request selects only the application-linked job-specific
   variant. The browser generates a text-selectable PDF locally by default, with
   DOCX only as a verified compatibility fallback, and records `resume-sent` only
   after recipient, conversation, artifact fingerprint, filename, and platform
   attachment receipt all match.
10. De-identified recruiter events create at most one fixed-template reply proposal.
    Waiting threads may create a follow-up after 72 hours, capped at two. Autopilot
    still requires immutable recipient/conversation re-verification and an exact
    platform message receipt; otherwise the proposal remains reviewable.

## Job workspace information architecture

The Job Agent is a dedicated multi-route workspace rather than a single dense screen.
The localized product root redirects directly to this workspace; the former wallpaper,
desktop icon launcher, cinematic overview, and Dock are not part of the primary entry
experience. Legacy resume tools remain directly addressable while they are integrated
into the backend information architecture.
Its persistent navigation separates overview, opportunities, resume tasks,
conversations, applications, activity, and preferences. The overview emphasizes agent
state, the next actions requiring human attention, recent activity, and application
progress; opportunity review uses a list-detail layout.

## Platform capability model

Being in the automatic catalog does not imply access. Every platform exposes independent
capabilities for discovery, messaging, scheduling, and application submission:

- **Fixed-host official search:** currently available for BOSS Zhipin.
  Results remain on the platform until its reviewed browser adapter is enabled.
- **Official search:** opens a fixed-host platform search without reading login state.
- **Local browser adapter:** uses the user's existing Chrome session and visible
  platform UI. Each adapter must verify the recipient, final content, and a platform
  success receipt. It must fail closed when selectors, session state, or page content
  are unknown.
- **Authorized connector:** uses an official API, approved partnership, or other
  platform-supported integration when one is available.
- **Unavailable:** the UI may prepare a draft or handoff, but must not simulate an
  integration or claim that an action completed.

The product must not use cookie replay, credential capture, arbitrary marketplace
scraping, CAPTCHA bypass, stealth browser automation, or fabricated platform receipts.

## Self-improvement boundary

The agent may learn from explicit user edits, saves, ignores, recruiter replies,
response latency, interviews, offers, withdrawals, and rejection reasons. Learned
state may change search queries, ranking weights, outreach style, and follow-up timing.

Learning must never invent or mutate career facts, protected resume fields, salary
history, work authorization, demographic information, screening answers, or an
application status. Resume claims remain bounded by trusted evidence and reviewable
job-specific variants.

Users can inspect, disable, export, or clear strategy memory independently from their
resume and application records.

## Runtime and data model

The current MVP is local-first and runs only while the browser is active. It persists
preferences and strategy locally, uses reviewed public discovery, and includes a
Manifest V3 bridge that detects platform tabs without reading cookies. Platform send
adapters are enabled one at a time only after recipient, content, and receipt tests pass.

The BOSS first slice collects a maximum of 50 visible search-result cards, validates
every URL against the BOSS hostname, scores them deterministically, and queues open,
eligible roles at or above the saved threshold. The queue feeds the existing target-job
and evidence-grounded resume-variant workflow; it does not mark an application sent.

Opening Job Agent triggers a bounded BOSS search for the primary configured title.
The extension constructs the fixed host and path, uses an inactive temporary tab,
collects registered-frame results, and closes the tab. Callers cannot provide a URL.

Queued candidates are analyzed in bounded sequential batches. Each candidate owns a
posting-bound Target Job and stable draft OptimizationRun so similar descriptions from
different BOSS postings cannot overwrite one another. Extracted requirements remain
unconfirmed until review. The review surface reuses the queued analysis and promotes
the same run into evidence mapping after confirmation.

Validated applications create a separate BOSS conversation thread and evidence-linked
opening draft. Approval is bound to the exact recipient and body fingerprint. Any edit
invalidates approval. `sent`, `delivered`, and `read` states require a platform receipt
whose recipient and body fingerprints match the approved message. IndexedDB schema v3
adds these thread and message stores without clearing v1 or v2 data.

The local orchestrator watches applied optimization runs. Once every deterministic
packet check passes, it advances the application to `ready-to-apply` and creates the
single opening thread and draft idempotently, without a separate preparation click.

The browser send path is approval-bound and fail-closed. It repeats recipient and
conversation inspection, recomputes the approved body fingerprint, verifies the editor
after writing, and clicks only one unique send control. A successful response requires
one exact-body message node, a platform message ID, and an observed sent/delivered/read
state. Anything else is stored as `failed`, not `sent`.

Continuous background operation requires a later scheduler and encrypted server-side
workspace. That phase needs an explicit product and privacy decision covering account
identity, connector tokens, retention, revocation, audit logs, retries, rate limits,
provider webhooks, regional storage, and deletion. It must not be introduced as a
silent extension of the current browser-only data boundary.

## Success measures

- Qualified roles surfaced per week, with user-rated relevance.
- Recruiter reply and positive-reply rates by platform and strategy version.
- Interview and offer conversion, without optimizing for raw application volume.
- User corrections required per outbound draft.
- Unauthorized-action count, unsupported-claim count, and false-completion count:
  all must remain zero.
