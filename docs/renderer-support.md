# Rendering TikZ fragments

LaTeX Islands accepts a Markdown `tikz` block containing a diagram fragment. A full LaTeX document and a hand-written preamble are optional. The extension supplies the document wrapper and infers common dependencies before compiling locally.

For example, this fragment needs no package declarations:

```tikz
\begin{circuitikz}[american]
\draw (0,0) to[R,l={$R=\SI{10}{\kilo\ohm}$}] (3,0)
  to[generic,l=$\text{load}$] (3,-2);
\end{circuitikz}
```

## Automatic dependencies

| Content in the fragment | Dependency |
| --- | --- |
| Text inside math, fractions, matrices, aligned equations, named operators | `amstext` / `amsmath` |
| Blackboard bold, Fraktur and additional mathematical symbols | `amsfonts` / `amssymb` |
| Paired delimiters, `\coloneqq`, `\mathclap`, extended matrices | `mathtools` |
| Bold mathematical symbols such as `\bm{v}` | `bm` |
| Quantities, units, numbers and angles (`\SI`, `\qty`, `\unit`, `\num`, `\ang`) | `siunitx` |
| Chemical formulae and reactions (`\ce`) | `mhchem` |
| Derivatives, vectors and bra-ket notation | `physics` |
| Custom table columns | `array` |
| Cancelled mathematical terms | `cancel`, with the extension's PGF drawing adapter |
| Circuits, plots, commutative diagrams, chemical structures, rotated 3D coordinates | Corresponding diagram package |

The extension detects command names, ignores comments, escaped backslashes and inline verbatim text, and preserves explicitly declared package options. User-defined commands are excluded from automatic command inference. Packages are loaded only when needed. Additional commands and packages can still require an explicit `\usepackage{...}` declaration.

Circuitikz is also inferred inside an ordinary `tikzpicture`: common component options such as `node[ground]`, `node[op amp]`, `to[R]`, `to[C]`, `to[D]` and `to[sV]` load the package. Component names in labels or comments do not trigger it, custom styles retain their definitions, and TikZ's separate `circuits.*` libraries take precedence over this inference. Unrecognized components can still use an explicit `\usepackage{circuitikz}` declaration or a `circuitikz` environment.

Common TikZ libraries are inferred for positioning, coordinate calculations, shapes, arrows, fitting, matrices, intersections, patterns, decorations, background layers, automata, chains and 3D planes. PGFPlots libraries are inferred for grouped plots, filled regions, statistical plots, polar axes and date coordinates. Explicit `\usetikzlibrary` and `\usepgfplotslibrary` declarations remain supported for bundled libraries.

Declarations before the first diagram, such as `\DeclareMathOperator`, `\DeclarePairedDelimiter`, `\definecolor`, `\tikzset` or `\pgfplotsset`, are placed in the generated preamble. Bare drawing commands and bare plot axes receive a TikZ picture wrapper. The original source remains available in the editor and when copied.

Common Unicode Greek letters, mathematical relations, arrows and set symbols in labels receive equivalent TeX declarations (`α`, `≤`, `Ω`, `µ`, `→`, `ℝ`, etc.). This also works outside math mode. User-provided Unicode declarations follow these defaults and take precedence.

## Ambiguous commands

`physics` and `siunitx` both define `\qty` with different meanings. A standalone `\qty(x)` selects physics delimiters; a standalone `\qty{5}{\metre}` selects a physical quantity. In diagrams that combine both packages, use `\SI{5}{\metre}` for units and `\quantity(x)` for physics delimiters. The renderer reports ambiguous automatically inferred combinations instead of silently interpreting a unit as unrelated mathematical text. Explicit package declarations retain their normal LaTeX meaning and loading order.

## Compatibility and limits

Plain accented words in `\mathrm`, such as `V_{\mathrm{à\,vide}}`, are adapted to upright text in the compiler copy, with a compatibility notice. `\mathrm` stays in math mode; `V_{\text{à\,vide}}` is the appropriate source for a textual label. The adaptation handles common Unicode and explicit TeX accents, loads text support and preserves subscript sizing. It leaves ordinary math alphabets, mathematical expressions, custom macros and explicit Unicode declarations unchanged. The original editor/copy source is preserved.

This is a local TikZ/TeX-to-SVG engine, not a complete TeX distribution. Unknown commands, unavailable packages and unsupported fonts produce diagnostics with the underlying log. The extension does not silently remove them or download TeX code at runtime.

LuaTeX graph-drawing layouts, externalization, external images/data files, shell processes and full document pagination are not supported. For graphs, use explicit positions or layouts supported by ordinary TikZ. PGFPlots interpolated surface shading falls back to flat shading with a visible compatibility notice.

The cancellation adapter preserves upstream mathematical layout, sizing and options while replacing picture-font strokes with PGF paths. Its arrowheads can differ slightly from the original font-based arrows. See [cancellation compatibility](cancel-compatibility.md) and [extra package provenance](extra-tex-packages.md).

The siunitx micro prefix retains its value of 10^-6 and uses the available Computer Modern math mu instead of an unavailable upright text-font mu. Euler Fraktur uses genuine metrics and verified glyph mappings in the SVG converter; see [Euler font support](euler-fonts.md).

## Verification

`npm test` checks inference, options, normalization and error handling. `npm run test:engine` compiles representative fragments with the real bundled offline WASM engine, including scientific labels, units, chemistry, matrices, advanced plot libraries and cancellation. These tests also check SVG font availability and recovery after invalid TeX or a compilation timeout.
