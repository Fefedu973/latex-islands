# LaTeX Islands 1.4.0

First public release of the Chrome and Firefox desktop extension.

- Local TikZ, Circuitikz, PGFPlots and other supported diagrams inside ChatGPT replies.
- Streaming preparation, a shared TeX worker and cached results.
- Integrated zoom/drag controls, a full editor, and PNG/SVG downloads.
- Monochrome popup/editor, ChatGPT/system/light/dark themes, and original LaTeX colors on white.
- Configurable Markdown, text and raw JSON conversation export with a preview.
- Separate Chrome and Firefox packages, reproducible packaging and public source/licensing documentation.

## Downloads

- `latex-islands-chrome-1.4.0.zip`: extract, then load unpacked in Chrome 116+.
- `latex-islands-firefox-1.4.0.zip`: unsigned developer package for temporary loading in Firefox 140+; persistent installation requires Mozilla signing.
- `latex-islands-source-1.4.0.zip`: matching source and upstream materials for review.
- `SHA256SUMS`: package checksums.

These GitHub ZIPs are developer packages. Store submission and approval are separate steps; this release does not claim that either store has approved them.

Diagram compilation is local. Conversation export uses the existing ChatGPT session to read the current conversation, and saves the export locally. See [Privacy](https://github.com/Fefedu973/latex-islands/blob/main/PRIVACY.md) and [source/build notes](https://github.com/Fefedu973/latex-islands/blob/main/docs/reviewer-build.md).
