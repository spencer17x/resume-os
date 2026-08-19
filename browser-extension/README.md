# Resume OS Browser Agent

This unpacked Manifest V3 extension is the local bridge between Resume OS and job
platform tabs. Version `0.1.0` detects open platform tabs and reports verified session
signals for BOSS Zhipin, LinkedIn, and 51job; other platforms remain `unknown` until
their probes are verified. It never reads or exports cookies.

Message sending is deliberately not enabled in this version. Platform-specific send
adapters require verified selectors, a deterministic final-content check, and a
platform receipt before they can be marked successful.

For local development, load this directory with Chrome's **Load unpacked** action.
The extension responds only on the bundled Resume OS production origin and loopback
development origins declared in `manifest.json`.
