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
2. The user chooses platforms. The initial catalog includes Greenhouse, Lever, BOSS
   Zhipin, 51job, Lagou, Liepin, LinkedIn, Indeed, and 58.com.
3. The user chooses an automation level:
   - **Copilot:** analyze and draft only.
   - **Approval:** automatically discover, rank, and draft; confirm every external
     message and application action.
   - **Autopilot:** execute explicitly allowed actions only through an authorized
     official connector. Unsupported, sensitive, or evidence-deficient questions
     pause for the user.
4. The agent continuously discovers and deduplicates roles, explains its ranking,
   and rejects roles outside hard constraints.
5. For a selected role, the agent maps requirements to saved evidence, creates a
   job-specific resume variant, and prepares an evidence-grounded opening message.
6. A conversation inbox groups recruiter messages, follow-ups, interview scheduling,
   and negotiation by job. Each outbound action records its source, approval policy,
   final content, timestamp, and provider receipt when available.
7. The user records or confirms outcomes. The agent improves targeting, timing, and
   message strategy while keeping learned strategy separate from career facts.

## Platform capability model

Platform selection does not imply access. Every platform exposes independent
capabilities for discovery, messaging, scheduling, and application submission:

- **Built-in public discovery:** currently available for reviewed Greenhouse and
  Lever public boards.
- **Official search:** opens a fixed-host platform search without reading login state.
- **Authorized connector:** uses an official API, approved partnership, or other
  platform-supported integration after user authorization.
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
preferences and strategy locally, uses reviewed public discovery, and prepares drafts
for platforms without a connector.

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

