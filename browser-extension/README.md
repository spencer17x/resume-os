# Resume OS Browser Agent

This unpacked Manifest V3 extension is the local bridge between Resume OS and job
platform tabs. Version `0.1.0` is scoped only to BOSS Zhipin and reports its verified
session signals. It never reads or exports cookies.

Message sending is deliberately not enabled in this version. Platform-specific send
adapters require verified selectors, a deterministic final-content check, and a
platform receipt before they can be marked successful.

For local development, load this directory with Chrome's **Load unpacked** action.
The extension responds only on the bundled Resume OS production origin and loopback
development origins declared in `manifest.json`.
