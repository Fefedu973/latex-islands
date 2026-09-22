# LaTeX Islands 1.4.3

- Load common LaTeX packages and TikZ libraries automatically for diagram fragments, including math text, symbols, scientific units, chemistry and physics notation. Explicit package options and custom macros remain respected.
- Fix braces in decorations, including both `decoration={brace,...}` and `decoration=brace`. The reported binary-number diagram now renders without adding a preamble.
- Support more plot types, fills between curves, grouped plots, statistical plots and dates with bundled PGFPlots libraries.
- Preserve declarations before diagrams, comments and body commands when preparing the TeX document. Add common Unicode math characters without changing the original source.
- Fix cancellation strokes and Fraktur characters with packaged drawing adapters and verified Euler font metrics. Scientific units include a compatible micro prefix.
- Explain missing dependencies, unsupported fonts and unavailable engine features in compilation errors. Invalid inputs leave a warmed compiler available for the next diagram.
- Add real-engine regression fixtures and offline checks for pinned dependencies, source archives and font mappings. All compiler assets remain bundled with the extension.

See [renderer support](https://github.com/Fefedu973/latex-islands/blob/v1.4.3/docs/renderer-support.md) for supported fragments and engine limitations. This remains an embedded TeX renderer, not a complete TeX distribution.

For an unpacked Chrome installation, extract the Chrome ZIP into its installation folder, click **Reload** at `chrome://extensions`, then reload ChatGPT. Check that the extension card shows **1.4.3**. Store installations receive updates after their store approves the submitted version.

The GitHub Firefox ZIP is an unsigned developer package. A locally signed Chrome CRX, if attached, is a development build with a different signing identity from the Chrome Web Store version.
