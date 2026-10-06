# LaTeX Islands 1.5.7

- Render plain accented text labels mistakenly placed in `\mathrm`, such as `V_{\mathrm{à\,vide}}`, using upright text with correct subscript sizing.
- Apply the correction only to the compiler copy and show a compatibility notice. The original code, ordinary formulas, custom command definitions and explicit Unicode declarations are preserved.

Includes Circuitikz component inference in [1.5.6](release-1.5.6.md).

For an unpacked installation, reload the extension and refresh ChatGPT. For portable LaTeX source, write words in mathematical labels with `\text{...}`.
