# Validation — 1.5.0

This file describes reproducible checks and their scope. It does not claim Chrome Web Store or Mozilla approval. No private conversations, account exports, HAR captures or credentials are part of the public fixtures.

## Reproduce

From the repository root with Node.js 22+ and npm:

```sh
npm ci
npm test
npm run test:engine
npm run test:fonts
npm run test:pdf
npm run build
npm run lint:firefox
node tests/firefox-smoke.mjs
```

`npm test` exercises synthetic DOM/API fixtures. The engine tests run the packaged WebAssembly TeX engine with local-file adapters, including compilation failure recovery and a real timeout. The package build creates browser-specific archives; Firefox lint checks the generated Firefox target. Record the actual output and browser versions when performing a release validation.

The Firefox smoke test requires Firefox installed locally. Set `FIREFOX_BINARY` to its executable if it is not at the default location. It copies `dist/firefox` into a temporary directory, installs that copy into a new temporary profile, runs headless, then removes its own test directory. The test copy adds a localhost fixture origin and reporting instrumentation; the release package and personal browser profiles are not modified.

The font regression test requires Chrome or Edge (`CHROME_BINARY` can override discovery). It opens an isolated headless profile, serves the production island with a synthetic cached compilation, and deliberately delays bundled WOFF2 responses. It verifies that the loading indicator remains until the required faces load, then compares diagram pixels before and after hover in dark, light and native color modes. Screenshots and a report remain in the temporary directory printed by the test; the browser profile is removed.

## Version 1.5.0 release validation — 2026-09-24

The final integration adds automatic rendered-page loading, snapshots of virtualized messages, arbitrary message selection, prompts-only and answers-only modes, an optional prompt for a single-reply PDF, and an in-window PDF preview.

- All 257 unit/integration tests passed, including 37 PDF tests. New coverage checks delayed earlier messages, incomplete history, virtualized windows, media changes during capture, selection across refresh, empty selection, role filters, cancellation and stale preview results.
- The full offline engine suite and verification of all 28 pinned TeX assets passed. The delayed-font visual regression passed with zero changed pixels after hover.
- Chrome 153.0.8010.53 passed the production PDF browser regression with three real TeX diagrams. The conversation fixture produces four pages and the tall single-reply fixture one page. PDF pages were rendered with Poppler and visually inspected; dialog preview and selection screenshots were also inspected.
- A real scrolling synthetic page mounts overlapping windows from twelve messages. Automatic capture retained all twelve, restored the starting scroll position, and printed only messages 1 and 10 in chronological order. No conversation API requests occurred in any PDF browser case.
- The browser test now waits for the island source and visible render button before compiling, including an intentionally delayed script. This fixes the initialization race behind the PR's intermittent CI timeout.
- Chrome and Firefox packages built successfully. Firefox 156.0 passed temporary-extension rendering, shared-worker, colors, popup and transcript-export smoke checks. Firefox lint reported zero errors, zero notices and the existing Android compatibility warning; the extension targets desktop Firefox.
- PDF printing was verified in Chrome. Firefox's native print dialog and a fully paginated live ChatGPT conversation were not part of the print regression; the long-history fixtures are synthetic. Store review remains separate from these checks.

A read-only inspection of an authenticated ChatGPT conversation on 2026-09-24 confirmed that the thread's `div[data-scroll-root]` is an ancestor of `main`, separate from sidebar scrolling, and that message nodes expose `data-message-author-role` and `data-message-id`. The inspected conversation had only two messages; this does not establish long-history loading or virtualization behavior.

## Initial PDF PR baseline — 2026-09-24

- All 225 unit/integration tests passed. PDF cases cover rendered-message selection, safe rich content, private diagram snapshot ports, local edits, missing assets, stale sources, navigation, cancellation and cleanup.
- The full offline engine suite and pinned TeX asset verification passed unchanged.
- `npm run test:pdf` passed in Chrome 153.0.8010.53 on Windows using isolated synthetic conversations and the real TeX engine. Conversation and single-reply PDFs preserve native math, Mermaid HTML labels, tables, code, images and embedded diagram fonts. Wide diagrams fit the printable width; tall diagrams are proportionally capped at 180 mm. The tall single-reply fixture fits on one page. Every generated page was rendered with Poppler and visually inspected.
- The existing first-paint font regression passed in dark, light and native color modes, with zero changed pixels after hover.
- Chrome and Firefox packages built successfully. Firefox 156.0 temporary-extension smoke passed for rendering, shared worker, colors, popup and existing transcript export. Firefox lint has zero errors, zero notices and the existing desktop-unrelated Android minimum-version warning.
- PDF printing itself was verified in Chrome, not Firefox. These checks use synthetic local pages and do not claim verification against an authenticated live ChatGPT session or a store release. This initial implementation captured only messages already loaded on the page; automatic loading and the new selection UI were added afterward.

## Release results — 2026-09-22 (1.4.3)

- All 188 unit/integration tests passed, including dependency inference, custom macros, comments, preamble placement, conflicting `\\qty` meanings and useful compilation diagnostics.
- The full offline engine suite passed: 9 base engine cases, 51 compiler snippets, 15 cancellation renders and 5 Euler renders. It covers AMS maths/symbols, Fraktur, mathtools, scientific units (including microfarads), chemistry, physics, custom columns, Unicode labels and five additional PGFPlots libraries. Cache, recoverable errors and real timeout recovery also passed.
- The reported binary-number diagram fails with the released 1.4.2 normalizer because `decorations.pathreplacing` is absent. It compiles unchanged with 1.4.3. Both its braced decoration syntax and the valid `decoration=brace` shorthand have real-engine regression fixtures.
- Targeted checks additionally cover a final preamble comment, body commands before a diagram, and comments inside custom macro declarations.
- An additional real-engine fixture verifies SI quantities with comments before and between arguments, including optional rounding settings, bringing compiler coverage to 52 positive snippets.
- All emitted font families in the scientific-fragment fixtures have a bundled WOFF2 and CSS declaration. Headless Chrome visual checks confirm cancellation strokes, Euler glyphs, bold and script sizes. The delayed-font first-paint regression passed in Chrome 153.0.8010.53 in dark, light and native modes, with zero changed pixels after hover.
- Offline vendoring checks verified all 28 additional compressed assets against five pinned archives and one readable adapter. Applying the worker patch to the pristine npm artifact reproduced the checked-in worker byte for byte.
- Firefox 156.0 on Windows passed the temporary-extension smoke test with real compilation, one shared worker, live colors, popup and synthetic conversation export. Firefox package lint reported zero errors, zero notices and the existing Android minimum-version warning; the extension targets desktop Firefox.

See [renderer support](docs/renderer-support.md) for compatibility behavior and remaining boundaries. Store review is separate from these release checks.

## Release results — 2026-09-17 (1.4.2)

- **Unit and integration tests:** all 173 passed, including delayed fonts, stale rendering results, shared dropdown keyboard interactions, sidebar-aware editor positioning, standalone preview/fullscreen transitions, mouse-wheel zoom anchored under the pointer, export loading indicators, diagram error recovery and verified iframe message channels.
- **Chrome 152.0.7977.83, Windows:** first-paint regression passed with delayed local fonts in dark, light and native modes. No diagram pixels changed on hover. The previous code reported ready before its fonts loaded; loading fonts alone still reproduced missing dark-mode glyphs until the filter moved from the transformed HTML wrapper to the SVG.
- **Editor layout in isolated Chrome:** measured bounds matched the conversation viewport with expanded/collapsed sidebars, a right panel, window resizing and a 390-pixel mobile viewport. Sidebar clicks remained usable, and the iframe and compiled diagram were retained.
- **Firefox 156.0, Windows:** temporary-extension smoke passed with a real TeX compilation, one shared worker, live color settings, popup and synthetic API conversation export.
- **UI inspection in Chrome:** export dropdown keyboard selection, disclosure styling, transparent menu triggers and blue switches were checked against ChatGPT's settings. The close icon's measured center offset was zero on both axes.
- **Loading and error UI in Chrome:** active export buttons retain their size and show a centered spinner; the footer remains stable down to 320 pixels. Diagram errors stay grouped and centered in inline, editor, preview and fullscreen modes; long logs remain expandable, retry restores the SVG, and inline clicking/dragging has no white focus outline.
- **Inline controls in Chrome:** hidden until hover or keyboard interaction, hidden again after pointer exit even after dragging, retained for an open menu and always visible on touch devices and in editor/standalone views.
- **Iframe messaging:** generic load events do not trigger messages to the iframe window. Tests cover allowed origins, window identity, transferred document ports, updated settings on startup, reload, detached frames and back/forward cache restoration. The real Firefox extension smoke passed with the new channel. Isolated Chromium also rendered again after iframe reload and removal/reinsertion, with no origin errors.
- **Firefox lint:** zero errors, zero notices and the existing Android minimum-version warning; the package targets desktop Firefox.

The browser tests use isolated profiles and synthetic fixtures. They do not claim store approval or that an existing user installation has been updated.

## Earlier release results — 2026-09-15

- **Unit and integration tests:** `npm test` passed all 142 tests, with no failures. Conversation and DOM inputs are synthetic fixtures.
- **Real compiler:** `npm run test:engine` passed using the packaged WebAssembly TeX engine, including invalid-input recovery and timeout recovery. These tests use local-file adapters.
- **Firefox 155.0.1, Windows:** `node tests/firefox-smoke.mjs` passed with a temporarily installed extension. It verified actual content-script injection, a real TikZ-to-SVG compilation through the Firefox background page, one shared worker, the editor and popup, native colors, and updating existing diagrams when color preferences change. The MAIN-world bridge fetched one synthetic conversation from the local fixture API, and the export preview displayed its answer.
- **Chromium UI:** the editor with TeX and the conversation-export preview were visually checked in a real Chromium browser at 1280-pixel width. These preview pages use production UI scripts with synthetic extension/API adapters.
- **Firefox package lint:** zero errors, zero notices, and one warning about Android's later introduction of data-collection declarations. The Firefox package targets desktop Firefox 140 and later; Android support is not declared.

The Firefox test exercises a real browser, extension runtime and compiler, while its conversation API is a local fixture. Neither these tests nor the Chromium screenshots validate a signed-in ChatGPT session, current production API responses, store installation or store approval. Firefox 140 is the declared minimum; the recorded runtime smoke test used Firefox 155.0.1.

## Functional coverage

- Diagram detection, streaming readiness, loader state, worker sharing, caching and timeout recovery.
- Theme preferences, remembered ChatGPT palette, native LaTeX colors and white-background image exports.
- Popup/editor controls, source changes, diagram-only standalone fullscreen, ChatGPT's integrated code editor and stale compilation results.
- Readable transcript filters, active branches where available, multimodal references, citations, preserved TeX and code, and full raw-page archives.
- Export pagination, cancellation, navigation, missing pages, request-origin/source/identifier validation and keeping credentials out of exports.
- Safe preview DOM, keyboard/focus handling, incremental preview, complete clipboard/download contents and preference storage without conversation snapshots.
- Rich PDF capture from the displayed page, message selection and role filters, optional preceding prompts, and in-window preview before browser printing. See the version-specific results above for validation status.

Local browser preview pages use the production scripts with synthetic extension/API adapters. Serve them using `node tests/preview-server.cjs`: `/demo.html`, `/tests/popup-preview.html`, `/tests/export-preview.html` and `/tests/browser-preview.html`. These pages do not establish authenticated ChatGPT transport compatibility or install the packaged extension into a normal browser profile.

## Release checks that need the actual browser/service

Load each generated target in its browser and verify local engine startup, a supported diagram, an invalid diagram, theme switching, editor controls, PNG/SVG downloads and keyboard access. In a signed-in ChatGPT session, check that the rendered block finishes during streaming and that a paginated conversation exports correctly. A passing linter or synthetic test is not a substitute for these checks. Firefox temporary loading is not Mozilla signing.

## Historical performance measurements

[tests/performance-results.md](tests/performance-results.md) retains a single-machine v1.2 benchmark for comparison. Those timings omit browser messaging, frame setup and painting; they are not current v1.4 measurements or performance guarantees. Re-run the engine tests to obtain measurements for your own environment.

## Known boundaries

Markdown, text and JSON preserve conversation pages actually returned by ChatGPT. PDF captures content the site renders while scrolling; it cannot recover content the site fails to load or automatically expand hidden details. Attachment binaries and unreturned branches are not reconstructed. The internal API and page structure may change. The diagram runtime uses packaged upstream WASM/core artifacts; complete core-dump reconstruction from preferred source has not been established. See [export details](EXPORT.md) and [reviewer build notes](docs/reviewer-build.md).
