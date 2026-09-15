# Validation — 1.4.0

This file describes reproducible checks and their scope. It does not claim Chrome Web Store or Mozilla approval. No private conversations, account exports, HAR captures or credentials are part of the public fixtures.

## Reproduce

From the repository root with Node.js 22+ and npm:

```sh
npm ci
npm test
npm run test:engine
npm run build
npm run lint:firefox
node tests/firefox-smoke.mjs
```

`npm test` exercises synthetic DOM/API fixtures. The engine tests run the packaged WebAssembly TeX engine with local-file adapters, including compilation failure recovery and a real timeout. The package build creates browser-specific archives; Firefox lint checks the generated Firefox target. Record the actual output and browser versions when performing a release validation.

The Firefox smoke test requires Firefox installed locally. Set `FIREFOX_BINARY` to its executable if it is not at the default location. It copies `dist/firefox` into a temporary directory, installs that copy into a new temporary profile, runs headless, then removes its own test directory. The test copy adds a localhost fixture origin and reporting instrumentation; the release package and personal browser profiles are not modified.

## Release results — 2026-09-15

- **Unit and integration tests:** `npm test` passed all 142 tests, with no failures. Conversation and DOM inputs are synthetic fixtures.
- **Real compiler:** `npm run test:engine` passed using the packaged WebAssembly TeX engine, including invalid-input recovery and timeout recovery. These tests use local-file adapters.
- **Firefox 155.0.1, Windows:** `node tests/firefox-smoke.mjs` passed with a temporarily installed extension. It verified actual content-script injection, a real TikZ-to-SVG compilation through the Firefox background page, one shared worker, the editor and popup, native colors, and updating existing diagrams when color preferences change. The MAIN-world bridge fetched one synthetic conversation from the local fixture API, and the export preview displayed its answer.
- **Chromium UI:** the editor with TeX and the conversation-export preview were visually checked in a real Chromium browser at 1280-pixel width. These preview pages use production UI scripts with synthetic extension/API adapters.
- **Firefox package lint:** zero errors, zero notices, and one warning about Android's later introduction of data-collection declarations. The Firefox package targets desktop Firefox 140 and later; Android support is not declared.

The Firefox test exercises a real browser, extension runtime and compiler, while its conversation API is a local fixture. Neither these tests nor the Chromium screenshots validate a signed-in ChatGPT session, current production API responses, store installation or store approval. Firefox 140 is the declared minimum; the recorded runtime smoke test used Firefox 155.0.1.

## Functional coverage

- Diagram detection, streaming readiness, loader state, worker sharing, caching and timeout recovery.
- Theme preferences, remembered ChatGPT palette, native LaTeX colors and white-background image exports.
- Popup/editor controls, source changes, fullscreen editing and stale compilation results.
- Readable transcript filters, active branches where available, multimodal references, citations, preserved TeX and code, and full raw-page archives.
- Export pagination, cancellation, navigation, missing pages, request-origin/source/identifier validation and keeping credentials out of exports.
- Safe preview DOM, keyboard/focus handling, incremental preview, complete clipboard/download contents and preference storage without conversation snapshots.

Local browser preview pages use the production scripts with synthetic extension/API adapters. Serve them using `node tests/preview-server.cjs`: `/demo.html`, `/tests/popup-preview.html`, `/tests/export-preview.html` and `/tests/browser-preview.html`. These pages do not establish authenticated ChatGPT transport compatibility or install the packaged extension into a normal browser profile.

## Release checks that need the actual browser/service

Load each generated target in its browser and verify local engine startup, a supported diagram, an invalid diagram, theme switching, editor controls, PNG/SVG downloads and keyboard access. In a signed-in ChatGPT session, check that the rendered block finishes during streaming and that a paginated conversation exports correctly. A passing linter or synthetic test is not a substitute for these checks. Firefox temporary loading is not Mozilla signing.

## Historical performance measurements

[tests/performance-results.md](tests/performance-results.md) retains a single-machine v1.2 benchmark for comparison. Those timings omit browser messaging, frame setup and painting; they are not current v1.4 measurements or performance guarantees. Re-run the engine tests to obtain measurements for your own environment.

## Known boundaries

The exporter preserves pages actually returned by ChatGPT. Attachment binaries and unreturned branches are not reconstructed. The internal API may change. The diagram runtime uses packaged upstream WASM/core artifacts; complete core-dump reconstruction from preferred source has not been established. See [export details](EXPORT.md) and [reviewer build notes](docs/reviewer-build.md).
