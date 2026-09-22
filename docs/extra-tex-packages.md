# Additional TeX packages and reproducible assets

These assets supplement the TeX files shipped by TikZJax 1.6.0. The TeX kernel,
core dump and upstream package implementations are unchanged. Rendering uses
packaged files only; the extension never downloads TeX packages at runtime.

## Pinned upstream inputs

The complete upstream archives are retained in
`vendor/tikzjax/extra-tex-source/` and accompany the source release. The machine
readable `manifest.json` records each archive's origin, version, SHA-256, selected
entry paths, original entry SHA-256 and resulting gzip SHA-256. Runtime ZIPs need
only the selected compressed files, plus the extension's third-party notices.

| Input | Added runtime files | Upstream reference |
| --- | --- | --- |
| siunitx 3.6.2 | `siunitx.sty.gz` | [Source revision](https://github.com/josephwright/siunitx/tree/13267cf0e0b303ac81a001aa894d6cfd8594ce6c), [CTAN](https://ctan.org/pkg/siunitx) |
| mathtools 1.31 / mhsetup 1.4 | `mhsetup.sty.gz`, required by the already bundled mathtools | [mhsetup source revision](https://github.com/latex3/mathtools/blob/f1ac125db25e6ddc455854e695a164794eefaa49/mhsetup.dtx), [CTAN](https://ctan.org/pkg/mhsetup) |
| translations 1.12 | `translations.sty.gz` and its eight dictionaries, required by siunitx | [Source revision](https://github.com/cgnieder/translations/tree/ab3c4b55cfcff64e865de66d7701d808e9743422), [CTAN](https://ctan.org/pkg/translations) |
| AMSFonts 3.04 | `ueuf.fd.gz` and Euler Fraktur medium/bold TFM metrics at sizes 5, 7 and 10 | [Official package](https://ctan.org/pkg/amsfonts) |
| PGFPlots 1.18.2 | `fillbetween`, `groupplots`, `statistics`, `polar`, `dateplot` libraries and four fillbetween/softclip dependencies | [Exact release revision](https://github.com/pgf-tikz/pgfplots/tree/d8d5424dafa7424df3fbf77022b8f662fffaa4fb) |

The selected PGFPlots files match the already bundled PGFPlots version. Existing
`amstext`, `array`, `etoolbox`, `pdftexcmds`, PGF and TikZ dependencies are reused.
No complete TeX distribution or kernel upgrade is introduced.

The CTAN download endpoints may change with later upstream releases. The
committed archives and their pinned hashes identify the actual inputs; do not
replace them with an unverified current download. As an additional provenance
check, `siunitx.dtx`, `mhsetup.dtx` and `translations.sty` in these archives were
compared byte for byte with the immutable source revisions linked above. Their
source hashes are also checked by the reproduction script.

### Archive SHA-256 values

```text
bba8de10e66490b88974495a1330515e475e7e3a48ed3287ab128985fe42b058  siunitx-3.6.2.tds.zip
7d74ed7f3abe7db3a6fc1f9e14704658f845203a5917942a8260021fb1240a61  mathtools-1.31.tds.zip
6a2626d9eb7e0046ae4d26b9e56977eadb7faf4230dcadc1ccc2c85c1fccf606  translations-1.12.zip
dd763ca89b712d096e952ca43c3b60409bfca174f04c5743da68468d063fe7b6  amsfonts-3.04.tds.zip
3d654fea4e23fda7a60fe0128730f286f196b1106f0a3292906263e8c52e738b  pgfplots-1.18.2-d8d5424.zip
```

## Reproduction

With Node.js 22 and the repository's locked dependencies installed:

```sh
npm ci
node scripts/vendor-tex-packages.mjs --check
node scripts/vendor-tex-packages.mjs --write
node scripts/vendor-tex-packages.mjs --check
```

`--check` is the default and performs no writes. `--write` reproduces the 28
compressed assets from the five local archives and one readable local adapter.
Both modes verify all archive and file hashes before writing or comparing the
runtime files. Extraction is restricted to the declared archive entries.
The script does not fetch files, run upstream installers or execute TeX.

Upstream entry bytes are preserved, including original headers. Compression uses
gzip level 9, a zero timestamp and OS byte 255 for a platform-independent header.
Local adapter line endings are normalized to LF. This reproduces packaging of
upstream generated `.sty` files; it does not claim that docstrip or the upstream
TeX toolchain was rebuilt. The archives include the original `.dtx`/`.ins` sources
and their installation instructions for that separate process.

## siunitx font adapter

`latex-islands-siunitx.sty` is a small, clearly separate first-party adapter,
loaded after siunitx and before the user's preamble. It re-declares the `micro`
prefix using the bundled Computer Modern math mu. The default siunitx upright
text mu requires the unavailable `tcrm1000` font and otherwise fails in this
TikZJax converter. The prefix retains its value of 10^-6; its mu has the math
shape instead of the upright text shape. Later user declarations take precedence.
The adapter does not force siunitx's mode or change any upstream package file.

Both `physics` and siunitx define `\qty` with different meanings. When physics is
loaded, use siunitx's unambiguous `\SI{value}{unit}` for quantities and physics's
`\qty(...)` for delimiters. Loading packages cannot make a single command mean
both syntaxes without an explicit compatibility rule.

## Validation scope

The real bundled WASM engine successfully renders siunitx `\SI`, `\qty`, `\unit`,
`\num`, `\ang`, microfarads with the adapter, degrees Celsius, percentages,
quantity ranges and complex quantities; mathtools `\coloneqq` and `\mathclap`;
and representative plots using each of the five added PGFPlots libraries.
These checks run offline against the actual packaged TeX files.

Adding a TeX font definition and TFM alone does not add support to the SVG
converter's font tables. Euler Fraktur requires the corresponding converter
support as well as the assets listed here. Other fonts and explicit siunitx text
font modes remain subject to the bundled renderer's font support.

## Licenses

siunitx, mhsetup and translations retain their LPPL 1.3c-or-later notices. A copy
of LPPL is in `docs/licenses/LPPL-1.3c.txt`. The complete original bundles and
their preferred source files are included in the source archives.

The selected PGFPlots libraries retain their GPL 3.0-or-later notices; the
extension's root `LICENSE` supplies that license. The AMSFonts archive retains
its original notices, including the unmodified-file copying permission in
`ueuf.fd` and the OFL license for the font software in
`doc/fonts/amsfonts/OFL.txt`. The separate first-party siunitx adapter is licensed
under GPL 3.0-or-later.
