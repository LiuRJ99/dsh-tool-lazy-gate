# Changelog

All notable changes to this project will be documented in this file.

## [0.1.6] - 2026-10-09

- Fix the real Host catalog snapshot: tools are collected before the assembly waterfall, so restrictions must also project the current assembly.
- Restore newly unlocked gate-hidden schemas before downstream transforms, without bypassing other restrictions.
- Add regression coverage using the official 0.2.0-rc.2 SystemPrompt implementation.

## [0.1.5] - 2026-10-09

- Synchronize trusted claimed user gestures, tool visibility, prompts and guards before the first request on official DSH 0.2.0-rc.2.
- Refresh resource discovery after plugin registrations change, retain inactive declarations, and show distinct plugin/resource/session states.
- Add regression coverage for first assembly, model non-grants and dynamic discovery.

## [0.1.4] - 2026-09-25

### Changed

- Moved Lazy Gate settings to the first-level DSH Settings sidebar.

## [0.1.2] - 2026-09-11

### Fixed

- Added a temporary Web bundle patch for the DSH 0.1.5 `@deepseek-ai/dsh-client-connection` RPC registration regression. Without it, `/tool-lazy-gate` cannot be mounted from the third-party plugin scope, so adapted associations such as `taskboard` and `open-record-replay` are hidden behind the built-in fallback and the browser reports HTTP 405. Remove the patch after the official connection package fixes its registration context.
