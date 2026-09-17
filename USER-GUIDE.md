# LaTeX Islands — TikZ & Export for ChatGPT

Chrome and Firefox desktop Manifest V3 extension · **Version 1.4.2** · English interface

Render TikZ diagrams in ChatGPT replies with an interface inspired by its native diagrams: an integrated preview, zoom, drag and a fullscreen editor. ChatGPT continues to display formulas, Markdown and Mermaid. The popup and editor use a monochrome interface. Conversation export provides a configurable transcript and preview based on the site's JSON data.

## Installation and updates

The Chrome package requires Chrome 116 or newer. The Firefox package requires Firefox desktop 140 or newer. No commands, server, TeX Live, Python or Node installation are needed to use the extension.

### First installation

1. Fully extract the **Chrome v1.4.2** ZIP into a permanent folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the extracted folder that directly contains `manifest.json`.
5. Reload any open ChatGPT tabs.

Keep this folder: Chrome reads the extension's files from it. Double-clicking the ZIP does not install it.

### Updating an existing installation

Replace the files in the folder Chrome already uses, then click **Reload** on the extension's card in `chrome://extensions` and reload ChatGPT. The folder can keep its old name; `manifest.json` determines the installed version.

To use a newly extracted folder, disable the old copy and load the new folder containing `manifest.json`. Avoid keeping two copies active on the same site.

### Firefox development installation

Build the Firefox package by running `npm ci` and then `npm run build` in the repository. Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/firefox/manifest.json`. This installation is removed when Firefox closes. A normal persistent installation requires a package signed by Mozilla. See [README.md](README.md) for Chrome/Firefox builds and [PRIVACY.md](PRIVACY.md) for data disclosures.

## Diagrams in ChatGPT

The extension recognizes `tikzpicture`, `circuitikz`, `axis`, `tikzcd`, `\chemfig` and `\tdplot...` constructs, among others. Markdown blocks labeled `tikz`, `latex`, `tex`, `circuitikz` or `pgfplots` work when they contain a diagram. A preamble and common `\usepackage` / `\usetikzlibrary` declarations are accepted.

The preview follows the conversation's colors and provides:

- **− / +** to zoom, and drag to move the diagram;
- an **…** menu with **Fit diagram**, **Open editor**, **Copy code**, **Download PNG** and **Download SVG**;
- a fullscreen editor with code on the left, a preview on the right and **Hide code**;
- **Update** or **Ctrl / ⌘ + Enter** to compile a local edit;
- a readable error, **Retry** and access to the code if compilation fails.

PNG output matches the preview's appearance. SVG output preserves the vector drawing and embeds the fonts it uses. Downloads contain the entire diagram, regardless of the preview's pan position. **LaTeX colors · white background** preserves the drawing's original colors and includes a white background in PNG and SVG exports.

Edits in the integrated editor remain an in-memory draft in the extension: they do not change the ChatGPT message or any request sent to the model. Copy the code to keep this draft. Reloading the page discards it; a source change from ChatGPT replaces it. Conversation export retrieves the source saved by ChatGPT, not this local draft.

The popup provides **Enable in ChatGPT** to enable diagrams, **Automatic rendering** to render them automatically and **Initial zoom** to set their starting size. **Open editor** opens a full page with examples, code, a preview and compilation through **Compile** or **Ctrl / ⌘ + Enter**. When automatic rendering is disabled, use **Render diagram** in the integrated preview.

### Appearance and colors

The **Appearance** setting, shared by the popup and editor, offers:

- **ChatGPT**: uses the last theme observed in a ChatGPT tab, falling back to the system theme until a site theme has been observed;
- **System**: follows the device's light or dark preference;
- **Light** or **Dark**: sets the appearance of the extension's pages.

The separate **Diagram colors** setting offers **Match theme** to blend the drawing into its surroundings, or **LaTeX colors · white background** to preserve its original colors. It applies to previews and PNG/SVG downloads. Preferences are saved locally; changing the appearance does not require recompiling the TeX source.

## While ChatGPT generates a reply

A loading indicator appears as soon as a diagram block is recognized. The local engine prepares while ChatGPT continues writing; incomplete code is not submitted to the compiler yet.

Compilation can begin before the reply ends. A following Markdown block indicates that the code block is complete. When ChatGPT does not expose this boundary, the extension uses a fallback: source that has remained unchanged for **180 ms**, with balanced braces and closed TeX environments, can be compiled. This structural detection remains an approximation; if the source continues changing, the same preview updates.

Detection also covers the currently observed ChatGPT structure, where a block contains several nested `pre` elements. Changes are processed within the affected reply to avoid scanning the entire conversation for each token.

## Exporting a conversation

The **Export conversation** button added to a saved conversation's header opens a dialog with settings on the left and a preview on the right. Three formats are available:

- **Markdown (.md)**: a readable transcript with user messages and ChatGPT replies, without repeated technical JSON; code and TeX are preserved;
- **Plain text (.txt)**: the same content with common Markdown formatting removed, while preserving code and TeX expressions;
- **Complete archive (.json)**: all retrieved API responses, their fields and metadata, plus a combined message list, without applying transcript filters.

Choose **Conversation**, **Detailed context** or **Answers only** under **Content**, or adjust the six options under **Customize transcript**: your messages, attachments, sources and citations, timestamps, intermediate steps, and tool calls and results. Transcript options do not remove any data from the JSON archive.

Click **Preview** to retrieve the conversation. The **Conversation** view displays readable messages; **File** displays the exported content. Formulas remain TeX source, without mathematical typesetting in the preview. The initial display contains up to 20 messages or 50,000 characters; **Show more** continues it. **Copy** and **Download** always use the entire file. Options update the preview without fetching the conversation again; if it changes, a message prompts you to refresh it.

Export retrieves every conversation page from ChatGPT instead of copying the text visible on the page. Retrieval must succeed before a file is downloaded; errors and cancellations do not produce an export presented as complete. The default view omits internal context and technical messages while preserving references to generated images.

Attachments remain references and metadata: their binary files are not downloaded. Older branches or versions absent from the server responses cannot be reconstructed. JSON is the most complete format; Markdown prioritizes readability. ChatGPT's internal API has no stability guarantee, and site changes may require an update. See [EXPORT.md](EXPORT.md).

## Engine, performance and limits

The bundled TikZJax engine compiles real TeX in WebAssembly and produces SVG. It includes TikZ/PGF and selected packages, including Circuitikz, PGFPlots, tikz-cd, Chemfig and tikz-3dplot.

The engine is shared, prewarmed during streaming and reused across diagrams. Identical requests already in progress share their result. An in-memory cache keeps up to 24 results, with an estimated limit of 20 MiB of source/SVG strings. The worker is released after 90 seconds of inactivity.

Prewarming reduces the wait after a block closes when the engine has had time to load during streaming. Complex PGFPlots surfaces remain expensive. The figures in [tests/performance-results.md](tests/performance-results.md) describe a historical v1.2 measurement on one machine; they are not a v1.4.2 performance measurement or guarantee.

A few adaptations apply only to the copy sent to the compiler: inferring common TikZ libraries, loading Chemfig and TikZ-3DPlot, protecting Circuitikz labels containing `=`, and replacing `shader=interp` with `shader=flat` with a warning for PGFPlots.

The extension is not a complete TeX Live distribution. Custom classes, document pagination, BibTeX, external files, imported images, shell calls, gnuplot and LuaLaTeX/XeLaTeX engines are outside its scope. A missing package or incorrect code can produce an error.

TikZ code must be present in the reply's accessible content. For a diagram written directly in a paragraph, the preview is added after that paragraph and its text stays visible. Multiple raw diagrams in the same paragraph are not detected; separate code blocks work independently.

## Privacy and operation

- **Compilation** stays on your device, using the bundled engine and fonts. It uses the extension's local resources and no remote compilation service.
- **Export**, triggered by **Preview**, **Copy** or **Download**, makes read requests to ChatGPT using the tab's session. Choosing a format or changing an option does not trigger a network request. Any authentication token stays in memory and is neither saved nor included in the exported file. No transfer to a third-party service is added.
- Conversation code, drafts and the cache are not stored in settings. Export preferences and the last observed ChatGPT theme are saved locally. The standalone editor saves its last source locally.
- Diagrams are detected in assistant replies on `chatgpt.com` and `chat.openai.com`. The input field, user messages and already rendered formulas are not reprocessed.
- `storage` saves preferences. Chrome also uses `offscreen` for the shared engine; Firefox uses its background page and `clipboardWrite` to finish copying after an asynchronous fetch, without reading the clipboard. Site access is limited to ChatGPT domains. Firefox declares the authentication and browsing activity data needed for export requests to ChatGPT.
- Source is limited to 60,000 characters and compilation to 30 seconds. Recoverable TeX errors keep the engine loaded; internal errors and timeouts stop it.

## Troubleshooting and validation

**No preview or export after an update:** reload the extension, then reload ChatGPT. The export bridge is installed when the page loads. For diagrams, check the settings and try **Open editor**.

**Manifest not found:** select the folder that directly contains `manifest.json`, not the ZIP or its parent folder.

**Compilation error:** reduce the code to a minimal example. The engine does not download missing packages.

**Export rejected:** make sure the saved conversation is open in a signed-in session, then reload the page. An API change may require an update.

Repository tests use synthetic fixtures to check transcripts, pagination, media references and preservation of code and TeX. Local tests do not replace testing the transport in an authenticated ChatGPT session or store validation. Results and limits: [VALIDATION.md](VALIDATION.md).

## Source and licenses

Extension code: GPL-3.0-or-later. The source is included, without a compilation step.

Engine: `@rod2ik/tikzjax` 1.6.0, with TeX files, fonts, notices, source and documented modifications in `vendor/tikzjax/`. Third-party components retain their own licenses.

- [Load a local Chrome extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)
- [Content Security Policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [TikZJax](https://github.com/rod2ik/tikzjax)
- [Reference Markdown/TikZ integration](https://github.com/artisticat1/obsidian-tikzjax)
