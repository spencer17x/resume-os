# Resume OS Multi-Platform Market Search Implementation Plan

## Status

Implemented on 2026-08-01 and extended into the cross-platform Job Copilot loop.

## Objective

Change Job Radar from a company-board-first workflow into a resume-driven market
search. A target company is optional. Users select job platforms, Resume OS derives
an initial search profile from a trusted resume, refreshes every reviewed automatic
source in the selected supported market, and presents one locally ranked inbox.

The implementation must not imply that a platform is automatically integrated when
it only permits an official search link or requires a commercial partner API.

## Capability model

| Capability | Current platforms | Product behavior |
| --- | --- | --- |
| Automatic public source | Greenhouse, Lever | Refresh a curated directory plus optional user-added public boards through existing bounded adapters |
| Official search | BOSS Zhipin, 51job | Build an HTTPS link on the platform's fixed official host using the primary target title |
| Partner API required | 58.com | Explain the integration requirement and open the official jobs page; do not scrape |

## Implementation slices

1. Add a typed marketplace registry and fixed-host official-search builders.
2. Add a reviewed, bounded Greenhouse/Lever source catalog.
3. Extend saved search profiles with optional platform scope and preferred companies,
   preserving profiles written by the older schema.
4. Derive initial titles, location, and preferred terms from a trusted structured
   resume.
5. Refresh selected automatic sources with cancellation, per-source transaction
   commits, partial-failure reporting, and a ten-source batch cap.
6. Replace the provider-first UI with platform multi-select and a single market-search
   action. Keep custom company boards under an optional advanced control.
7. Keep ranking, Target Job promotion, Agent approval, ResumeVariant, application
   packet, and explicit submitted confirmation unchanged.
8. Cover capability boundaries, old-profile parsing, derivation, batch refresh,
   component behavior, desktop flow, and mobile overflow.
9. Add a user-driven “bring back a job” path that validates the selected platform's
   official hostname, stores only pasted fields locally, scores the role, and opens
   Target Job without fetching the marketplace page.
10. Add bounded, deterministic quick-paste parsing for Chinese and English labeled
    job shares. Parsed values remain editable proposals and require explicit import.

## Deliberate limits

- “Supported market” means the reviewed source catalog, not every job on the internet.
- The bundled catalog is a versioned seed, not a server-side job database.
- BOSS Zhipin and 51job are not scraped or automated without written authorization.
- 58.com automatic discovery remains disabled until an approved Open Platform
  integration is available.
- Search runs while the browser request is active. Background daily discovery still
  requires a separate account, scheduler, retention, and notification decision.
- Opening any platform or employer page never records an application as submitted.

## Verification

- Old `JobSearchProfile` records without platform fields still parse.
- Only marketplace definitions with reviewed automatic adapters create source calls.
- Official-search URL builders cannot accept a caller-controlled host.
- Cancellation prevents the active source from committing and stops later sources.
- A failed source does not roll back already completed independent sources.
- Platform selection, resume-derived defaults, company-optional search, bilingual
  copy, keyboard access, and mobile containment are covered by tests.
