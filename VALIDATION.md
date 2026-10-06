# Validation — 1.5.8

This file describes reproducible checks and their scope. It does not claim Chrome Web Store or Mozilla approval. No private conversations, account exports, HAR captures or credentials are part of the public fixtures.

## Reproduce

From the repository root with Node.js 22+ and npm:

```sh
npm ci
npm test
npm run test:engine
npm run test:fonts
npm run test:pdf
npm run test:chrome
npm run build
npm run lint:firefox
node tests/firefox-smoke.mjs
```

`npm test` exercises synthetic DOM/API fixtures. The engine tests run the packaged WebAssembly TeX engine with local-file adapters, including compilation failure recovery and a real timeout. The package build creates browser-specific archives; Firefox lint checks the generated Firefox target. Record the actual output and browser versions when performing a release validation.

The Firefox smoke test requires Firefox installed locally. Set `FIREFOX_BINARY` to its executable if it is not at the default location. It copies `dist/firefox` into a temporary directory, installs that copy into a new temporary profile, runs headless, then removes its own test directory. The test copy adds a localhost fixture origin and reporting instrumentation; the release package and personal browser profiles are not modified.

The font regression test requires Chrome or Edge (`CHROME_BINARY` can override discovery). It opens an isolated headless profile, serves the production island with a synthetic cached compilation, and deliberately delays bundled WOFF2 responses. It verifies that the loading indicator remains until the required faces load, then compares diagram pixels before and after hover in dark, light and native color modes. Screenshots and a report remain in the temporary directory printed by the test; the browser profile is removed.

## Version 1.5.8 PDF print lifecycle and compatibility checks — 2026-10-06

The current public ChatGPT stylesheet contains a layered `!important` rule that hides body children other than its native print document. That rule outranks the export's former unlayered ID selector. A synthetic reproduction using that observed CSS and native Chrome `window.print()` produced one blank page with no message text when the new inline display protection was disabled. With the protection enabled, two consecutive native Save as PDF operations each produced four pages containing all expected text, and both actual `afterprint` events restored the same preview. All four PDF pages were rendered and visually checked.

- All 394 unit/integration tests passed, including print restoration and disposal, code-widget hydration, genuine edits, lazy image cards, mixed diagram failures, cancellation and source/route changes.
- The production TeX engine, first-paint font test and actual Chrome extension navigation/repair-prompt regression passed in isolated profiles.
- The Chromium PDF suite passed with the current layered print rule, repeated printing, scrolling history, arbitrary selection, dark-mode contrast and a real invalid TeX diagram. The failed diagram's source/error was printed while the three valid diagrams and surrounding messages remained; its PDF fallback was visually checked.
- Chrome 154.0.8037.97 was used for the local browser tests. Firefox package lint reported zero errors and the existing Android minimum-version metadata warning; desktop Firefox native printing was not newly verified by this change.
- Daily CI repeats the regression suite and retains synthetic evidence. The optional public DOM sentinel is explicitly unconfigured until a public synthetic share URL is supplied; fixture success is not a claim of authenticated live-site coverage. See [compatibility testing](docs/compatibility-testing.md).

## Version 1.5.7 Accented text labels in math — 2026-09-27

The reported circuit now loads Circuitikz, but its `V_{\mathrm{à\,vide}}` label reproduced a math-accent error in the packaged engine. The targeted compiler-copy adaptation to `\text{\normalfont à\,vide}` compiles the unchanged user source. A separate italic-node fixture checks that the labels remain upright and use the bundled `cmr10`, `cmr7` and `cmr5` fonts at 10/7/5pt for normal text, subscripts and nested subscripts. Explicit TeX accent forms are also covered.

All 375 unit/integration tests pass. The actual compiler suite passes 61 diagram fixtures plus cache, error and timeout recovery checks. Unit regressions cover balanced groups, preamble macros, comments, verbatim and literal commands, custom definitions, explicit Unicode declarations and package options. Mathematical expressions and ordinary unaccented `\mathrm` remain unchanged.

## Version 1.5.6 Circuitikz component inference — 2026-09-27

An ordinary `tikzpicture` using `node[ground]` and `to[sV]`, `to[D]`, `to[C]` and `to[R]` reproduced the missing `/tikz/ground` key with the previous normalizer in the bundled WebAssembly engine. Loading Circuitikz explicitly compiled the same source without edits. The fixed normalizer now infers the package; its SVG is byte-for-byte identical to the explicit-package output.

All 371 unit/integration tests pass. The actual compiler suite passes 58 diagram fixtures, including six new regressions for the reported circuit, standalone components, custom styles and native TikZ circuits, plus cache, error and timeout recovery checks. Robustness fixtures also check the availability of emitted fonts. Component inference preserves package options and ignores comments, node labels and inline verbatim text. Unrecognized components or arbitrary path macros may still require an explicit package declaration.

This change is limited to pre-compilation dependency inference. It does not establish new live ChatGPT or store-publication validation.

## Version 1.5.5 PDF dark-theme text — 2026-09-26

The previous fixtures checked prompt bubbles and diagram colors but did not assert the assistant's prose or formula color. A response wrapper with locally defined pale ink reproduced the reported defect in both the export preview and a real Chromium PDF: headings, paragraphs, fraction rules and native math glyphs had only 1.17:1 contrast on white paper.

The capture now converts light neutral text paint to paper ink, including native math glyphs, while preserving colored text and standalone SVG diagrams. The original ChatGPT DOM remains unchanged. The regression fails before the fix and passes afterward: text contrast is 17.93:1, and the native navy diagram with a white label keeps its original paints. Chrome 154 produced the actual PDF through `Page.printToPDF`; the print and preview screenshots were also inspected visually. `node tests/pdf-print.browser.cjs --contrast-only` reproduces this check.

All 365 unit/integration tests pass, including 49 PDF tests. The Chrome UI suite also passes with the updated fixture in dark, light and mobile layouts. Generated reports, screenshots and PDFs are local test artifacts and are excluded from the source package.

## Version 1.5.4 navigation diagnosis — 2026-09-26

Final checks passed: 364 unit/integration tests, the complete Chromium PDF/layout suite, the combined Chrome 154 MV3 navigation and repair-prompt test, and the Firefox 156 extension smoke test. Firefox lint reports zero errors, zero notices and the existing Firefox for Android minimum-version warning. The font regression remains unchanged and passed in dark, light and native colors.

The 1.5.4 runtime diagnostic showed an external `srcdoc` attribute being added 6–7 ms after each frame was created, before any load, ready or compilation event. The first replacement was affected too. The user then confirmed that the same conversation navigation works in a fresh Chrome tab opened manually outside Codex browser control. The repeated live failure is isolated to the controlled-tab context, not reproduced by normal navigation. No attempt hides frames from browser protections or removes an overriding attribute in place.

An actual Chrome 154.0.8037.57 MV3 test uses a temporary extension copy and a new isolated profile, with the production service worker, offscreen compiler and private ports. Cloned cache, hidden connected cache and synchronous detach/reinsert each pass A → B → A, with successful vector snapshots and no unexpected recreation. Private liveness replies arrive in 0–13 ms. `node tests/chromium-extension-navigation.mjs` reproduces that check; only the temporary copy permits its synthetic localhost parent.

The same MV3 test compiles invalid TeX, clicks the production repair button and checks insertion through the real contenteditable editor. Its two-paragraph draft and original bold node survive, the full failed source and compiler error are present, and no submit or Send click occurs. It caught a false failure from CSS-collapsed `innerText`; verification now reads DOM text and line boundaries while retaining no-op, partial-insertion and framework-revert checks. This actual-extension test is included in CI and requires Chrome 138+ (`CHROME_BINARY` overrides executable discovery).

The connection error exposes a bounded local technical report with relative times and frame state, excluding source code, conversation URLs and message identifiers. Additional tests validate the report and explicit clipboard copying. Temporary MAIN-world writer hooks were removed after the manual isolation test; they are not included in the extension.

## Version 1.5.3 navigation and interaction validation — 2026-09-26

The user still reproduced the unavailable preview after navigating A → B → A with 1.5.2. This update covers a replaced document inside a retained iframe, rather than only detached or cloned conversation DOM.

- All 361 unit/integration tests passed. New cases cover one automatic recovery after a delayed `srcdoc` or `src` override, a finite second failure with explicit Retry, missing private-port acknowledgements, ready-before-load ordering, and fresh identity when a different conversation reuses the same DOM and TeX. An invalid frame no longer causes an observer loop by repeatedly rewriting its unchanged Show code label.
- Chrome 154.0.8037.57 passed the isolated navigation regression with production code and the real TeX engine. After a delayed document override the replacement renders and provides a PDF snapshot. A second override stays on one frame for twenty animation frames, shows a finite error, and successfully renders after Retry. The old overridden document is retired without modifying its attributes or relaxing origin/port checks.
- Real mouse input scrolls the conversation by 100 px while the inline preview is inactive, changes only diagram zoom after clicking it, and resumes page scrolling after leaving and returning. The point under the pointer remains fixed; no white focus outline appears. Keyboard Escape, focus transfer and window blur release activation; blur also cancels a captured drag.
- A real TeX failure keeps its message and Retry/Show code actions inside the preview without overflow. Ask ChatGPT is intentionally unavailable in the standalone localhost fixture. DOM tests verify that a compilation repair appends exact code and error to an existing textarea or rich editable draft, checks accepted text after input reconciliation, ignores old/public channels, and never submits. Missing, read-only, reverted and partially accepting editors return an error without a second insertion.
- The first-paint font regression passed in dark, light and native colors, with zero changed diagram pixels after hover.
- A separate export regression preserves the PDF document across two delayed toolbar-cleanup passes. This fixes the prior CI failure where cleanup removed its `.li-pdf-root` alongside stale controls.

These are controlled browser and DOM fixtures. The user still reproduced "The diagram preview was interrupted again" with 1.5.3. Version 1.5.4 subsequently isolated that failure to the automation-controlled tab, as recorded above. These tests do not establish compatibility with every ChatGPT rollout or store approval.

## Version 1.5.2 integration validation — 2026-09-26

Read-only inspection of the current authenticated public ChatGPT page confirmed the new search-unit message attributes, code widgets without `<pre>`, `data-theme` palette, native titlebar actions and an inner timeline scroller using `flex-direction: column-reverse` with negative `scrollTop`. Temporary test conversations also confirmed that the composer stop button remains present during code streaming after the old streaming attributes disappear. The original conversation was reopened afterward.

- All 345 unit/integration tests passed. The added cases cover the September markup and previous layouts, late hydration, hidden header clones and messages, remounting removed controls, streaming through the new composer, print lifecycle, reversed scrolling, message identity, PDF contrast and bounded recovery from temporary diagram-readiness failures. Loader tests cover immediate code replacement, source access on failure, manual rendering and stable height during re-rendering. Visual-only message changes retain the transcript cache and selection. Additional cases cover lost connections, interrupted runtime/font waits, page restoration, automatic transcript previews, delayed saved preferences, editable options during retrieval and hiding reply PDF actions during streaming.
- Chrome 154.0.8037.57 passed the browser regression using production scripts and the real TeX engine. Both conversation and single-reply PDFs still print; the new-layout fixture renders inline, mounts header/reply actions, follows the dark theme, opens the editor beside a 180 px sidebar and previews the captured diagram in the export dialog.
- A real reversed browser scroller captured all twelve messages from overlapping virtualized windows, in chronological order, and restored `scrollTop` to -800. The older positive-scroll fixture also passed. Neither PDF fixture fetched a conversation API endpoint.
- PDF preview screenshots were inspected. The new prompt bubble keeps readable dark text on a light background; copied SVG colors and embedded diagram fonts remain intact.
- The redesigned export dialog was inspected in dark and light themes at 1280 px and at a 390 px mobile width. Geometry checks found no horizontal overflow and a centered close icon. Message search, selecting a single reply, restoring all messages and returning to the PDF preview remain usable at both widths. A separate interactive transcript fixture verified automatic preview and single-message selection.
- A delayed iframe-script browser test confirms that existing code is already hidden and a 222 px host loader is visible before the renderer connects. The initialized renderer then replaces that loader and compiles the diagram successfully.
- The hydration regression samples twenty animation frames while the host rewrites widget classes and replaces the source widget. No frame exposes the original code, restarts the loader or replaces the compiled iframe/SVG. A newly inserted diagram also stays hidden before its first sampled paint. These controlled mutations reproduce the code/loader flashes seen in the user's recording; the private recording is excluded from published fixtures.
- The browser navigation case unmounts a ready conversation, returns with renderer initialization deliberately delayed, leaves again before the handshake and returns a final time. Both returns sample ten animation frames without visible source code or duplicate iframes. The final real render completes, removes its loader and remains available for PDF capture.
- Cached-conversation regressions also restore a cloned message containing a stale iframe placeholder and hide/reveal the original connected DOM. Each returns to one live renderer with a real SVG and a valid PDF snapshot. A unit regression catches synchronous detach/reinsert of the same iframe before the mutation callback: the discarded document is retired while the source and editor draft survive. An active iframe changed only through an external `srcdoc` override is not rewritten.
- Cached copies of header/reply export actions are removed without closing the real dialog or losing its selection. Content filters now select roles independently of advanced transcript options; tests cover migration from saved presets and preserving these options when the role filter changes.
- Browser hover checks display the native-style editor, header-export and reply-export tooltips. Their typography, spacing and 16 px radius match the measured ChatGPT controls. Editor header buttons measure 36 px with 8 px corners and centered 20 px icons; the Command glyph has a square bounding box. The reply action disappears during streaming and the same live button returns afterward.
- The delayed-font regression passes in dark, light and native color modes with zero changed diagram pixels after hover. This check uses the updated render lifecycle and bounded font waits.
- Firefox 156.0 passed the temporary-extension smoke with the new message/code/header markup, real rendering, shared worker, live colors, popup and synthetic API export. Its real private-port PDF snapshot embeds fonts, the DOM preview image decodes, and mocked native-print cleanup preserves the iframe and permits a second snapshot. PDF adds no API request. Firefox package lint returned zero errors, zero notices and the existing Android-only compatibility warning.
- After the user reloaded the unpacked build, the authenticated ChatGPT page contained nine rendered diagrams, one correctly mounted conversation export button and three native-toolbar reply PDF actions. The live Markdown preview loaded successfully and showed six messages.

The long-history virtualization cases are synthetic and do not establish behavior for every ChatGPT rollout. Automated PDF verification on the authenticated Chrome page was inconclusive: the browser controller intermittently refused extension-frame access, and an empty `srcdoc` frame was observed before export. The extension does not set that attribute; no workaround strips it or weakens the frame checks. The production-script Chromium and real-extension Firefox tests above are separate from this live-browser limitation. No private conversation content, account identifiers or authentication data is included in the committed fixtures. Store approval remains separate from these checks.

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
