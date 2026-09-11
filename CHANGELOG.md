# Changelog

All notable changes to this project will be documented in this file.

## [0.1.2] - 2026-09-11

### Fixed

- Added a temporary Web bundle patch for the DSH 0.1.5 `@deepseek-ai/dsh-client-connection` RPC registration regression. Without it, `/tool-lazy-gate` cannot be mounted from the third-party plugin scope, so adapted associations such as `taskboard` and `open-record-replay` are hidden behind the built-in fallback and the browser reports HTTP 405. Remove the patch after the official connection package fixes its registration context.
