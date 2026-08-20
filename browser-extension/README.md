# Resume OS Browser Agent

This unpacked Manifest V3 extension is the local bridge between Resume OS and job
platform tabs. Version `0.1.0` is scoped only to BOSS Zhipin and reports its verified
session signals. On a visible BOSS search-results page it can also return at most 50
bounded job cards to Resume OS for local validation, scoring, and queuing. It never
reads or exports cookies.

Given a bounded title query, the background worker constructs the fixed
`https://www.zhipin.com/web/geek/job` URL itself, opens it in an inactive temporary
tab, collects results from registered frames, and closes the tab. The page cannot
supply an arbitrary URL or host.

When Job Agent is enabled, the worker stores only its enabled flag and bounded polling
interval. A Chrome alarm wakes an already-open Resume OS tab every 15 minutes so the
page can run another local discovery cycle. Job results, career data, and inbox content
are not persisted in extension storage.

On the same schedule, an already-open BOSS chat may be checked for an explicit,
incoming interview-and-scheduling signal. The page probe returns only a hashed signal
identifier and conversation identifier—not the message body. New signals are
deduplicated in extension storage and produce a generic Chrome notification. Unknown
or ambiguous message direction, missing platform message IDs, and unreviewed live DOM
shapes fail closed.

For a verified resume request, Resume OS may provide a bounded, locally generated
PDF or compatibility DOCX to the extension. PDF is selected whenever the active
conversation exposes exactly one PDF-capable input. The probe verifies the recipient,
conversation, filename, MIME type, byte length, content fingerprint, and a unique compatible file input before firing
the native change event. It reports success only when one platform attachment node
contains the exact filename and a platform attachment ID. File bytes are never stored
in extension storage.

The `diagnose-boss-adapter` action exposes only bounded selector counts and readiness
booleans for open BOSS frames. It is intended for live selector review without
returning job content, recipient names, or message bodies. Readiness requires unique
conversation identity/editor/send controls, and default resume readiness additionally
requires one PDF-capable file input. DOCX counts are reported separately for fallback.

Conversation inspection runs in all matching frames, including BOSS `about:blank`
child frames. It returns a recipient only when one frame contains exactly one visible
recipient identity, conversation identity, editor, and send control. Ambiguous or
missing controls fail closed; inspection does not type or send a message.

After the exact message is approved, the send adapter repeats the same recipient and
conversation checks, recomputes the FNV-1a body fingerprint, writes through the native
editor setter, verifies the rendered editor value, and clicks the unique send control.
It returns success only after one message-content node exactly matches the body and its
platform message node exposes an ID plus sent, delivered, or read status. Otherwise it
returns no receipt and Resume OS records a failed—not sent—attempt.

Message sending remains fail-closed and must not be treated as production-ready until
the current live BOSS selectors are reviewed. A send can be marked successful only
after deterministic recipient and final-content checks plus a platform receipt.

For local development, load this directory with Chrome's **Load unpacked** action.
The extension responds only on the bundled Resume OS production origin and loopback
development origins declared in `manifest.json`.
