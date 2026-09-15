# Store listing — 1.4.1

Repository: https://github.com/Fefedu973/latex-islands. Privacy policy: https://github.com/Fefedu973/latex-islands/blob/main/PRIVACY.md.

## Listing

### Name

LaTeX Islands — TikZ & Export for ChatGPT

### Short description

Render TikZ diagrams locally in ChatGPT and export readable conversations as Markdown, text or JSON.

### Detailed description

Make technical ChatGPT conversations easier to read and reuse.

LaTeX Islands renders supported TikZ, Circuitikz, PGFPlots, tikz-cd, Chemfig and TikZ-3DPlot code blocks directly in ChatGPT replies. Zoom, drag, edit in a full-screen view and download PNG or SVG. A bundled WebAssembly TeX engine compiles diagrams locally, with no external compilation service. A loading indicator appears while a reply is being written, and rendering starts when a diagram block is ready.

The extension also exports the open conversation as Markdown, plain text or a complete JSON archive. Choose a dialogue, detailed context, or answers only; adjust individual options for user messages, attachment references, citations, timestamps and tool information. Preview the dialogue or file before copying or downloading. Code and LaTeX equations are preserved in exports; equations remain TeX source in the export preview. Attachment files are not embedded.

Export is user-initiated. It reads the current conversation's pages from ChatGPT using your existing signed-in session, then prepares the file on your device. Authentication information and the current conversation identifier/cursors are sent only to ChatGPT for those requests. There is no analytics, developer backend, advertising, or upload of conversations to the maintainer.

Supports light/dark/system appearance and the last observed ChatGPT theme, plus either adapted diagram colors or original LaTeX colors on white. This is a diagram renderer rather than a full TeX document editor. Missing packages and external files are not supported. ChatGPT's internal API may change and temporarily affect exports.

Independent open-source project; not affiliated with or endorsed by OpenAI, Google or Mozilla.

## Chrome single-purpose statement

Improve the readability and reuse of technical content in the current ChatGPT conversation: render its LaTeX diagrams locally and let the user export that conversation in readable or archival formats. Both functions are confined to ChatGPT content and are described in the listing and UI.

## Permission justifications

| Permission / access | Purpose |
| --- | --- |
| `storage` | Save rendering/theme/export preferences and the standalone editor's last source locally. Does not persist exported conversations or tokens. |
| `offscreen` — Chrome only | Keep one local TeX worker in an extension-owned document shared by tabs. Allows prewarming, serial compilation, caching and timeout recovery without a visible helper tab. |
| `clipboardWrite` — Firefox only | Complete the user's Copy action after asynchronous conversation retrieval has outlived transient click activation. Writes the requested export only; does not read the clipboard. |
| `https://chatgpt.com/*`, `https://chat.openai.com/*` | Detect diagrams in assistant replies, add preview/export controls and retrieve the current conversation when requested. No access to unrelated websites. |
| `wasm-unsafe-eval` in extension CSP | Compile and run the packaged TeX WebAssembly module. No remote executable code is fetched. |

The Firefox build uses an extension background page for the engine rather than the Chrome-only offscreen API. There are no cookies, history, webRequest, unrelated-host, or broad all-sites API permissions. Existing session cookies accompany same-origin page requests without requesting the cookies API.

## Privacy declarations

Do not declare the entire extension offline or claim that it never transmits data. It processes conversation text locally and makes authenticated same-origin export requests. Describe website content/personal communications handled locally, authentication information used for those requests, and the current conversation identifier as browsing-related information; the developer receives none of these data.

The Firefox manifest declares required `authenticationInfo` and `browsingActivity`, with desktop minimum version 140. The transmission is the current conversation URL/identifier/cursors and existing authentication, sent to ChatGPT as part of the requested export. There is no telemetry category. See [Mozilla's data-consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/) and the [project privacy policy](../PRIVACY.md).

For Chrome, accurately complete the current dashboard's data-handling questions using the policy above. Local-only processing still requires an accurate privacy policy. See [Chrome's user-data guidance](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) and [disclosure requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements).

## Reviewer notes

- Compile included examples from the popup's standalone editor without a ChatGPT account. Use the packaged engine; no TeX installation or compilation server is required.
- ChatGPT integration and live conversation export require a signed-in ChatGPT account. No credentials are embedded in the extension or public source. Provide any store-requested test access only through the store's private reviewer channel.
- The export dialog explains that it reads ChatGPT with the user's session and prepares a local export. All previous pages must load successfully before a download is produced.
- HTML from conversations is not executed in the preview. Attachment images are not automatically downloaded. The isolated/page bridge restricts the origin, conversation, request path and parameters.
- Attach the corresponding source ZIP and [reviewer build notes](reviewer-build.md). The local hardened worker differs from upstream: arbitrary URL input fallback is removed, asset paths are restricted, and an unused dynamic-function fallback is removed. Do not describe this as an unmodified vendor library.
- Mozilla's [development policy](https://extensionworkshop.com/documentation/publish/add-on-policies/#development-practices) restricts modifications to third-party libraries. The hardened worker and compiled TeX artifacts therefore need explicit reviewer evaluation; supplied sources and a successful lint result do not guarantee acceptance. Full upstream TeX-core reproduction has not been established; see the source notes.

## Listing assets

Use the included monochrome icon and screenshots made with synthetic conversations or the shipped examples: inline diagram, standalone editor, and configurable export preview. Do not upload private conversations, account identifiers or local machine paths. Add store URLs to the README only once the listings actually exist.
