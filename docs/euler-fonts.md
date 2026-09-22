# Euler Fraktur support

The extension already includes BaKoMa Euler WOFF2 fonts and CSS. Loading
`amsfonts` and its `.tfm` files lets TeX typeset `\mathfrak`, but the SVG
converter maintains its own embedded metric and glyph-encoding tables.
Upstream `@rod2ik/dvi2html` 0.0.7-beta7 omitted the Euler entries in those
tables, causing `Could not find font eufm10` after successful TeX compilation.

## Local converter patch

`vendor/tikzjax/patch-runtime.py` now adds regular and bold Euler font data at
optical sizes 5, 7 and 10 to the converter's existing tables. It reads genuine
TFM bytes from the packaged assets and verified glyph mappings from
`vendor/tikzjax/source/euler-fonts.json`. Each TFM and WOFF2 file must match the
SHA-256 recorded in that metadata before patching succeeds.

The patch also fixes an upstream TFM parser boundary: the last character code
(`ec`) is inclusive. Using `<` instead of `<=` silently omitted that glyph.
Euler uses the final slot, 127, for its alternate digit one.

The three existing worker hardening patches remain in place. The converter
uses the same bundled fonts and local tables; no remote font loading,
unrestricted resource access or replacement glyphs are introduced.

## Provenance and reproduction

The original AFM encodings and TFM metrics come from the official
[AMSFonts](https://ctan.org/pkg/amsfonts) 3.04 TDS archive, retained at
`vendor/tikzjax/extra-tex-source/amsfonts-3.04.tds.zip` with SHA-256
`dd763ca89b712d096e952ca43c3b60409bfca174f04c5743da68468d063fe7b6`.
The font files keep their upstream licenses; this does not relabel them as
first-party code.

The checked-in generator `vendor/tikzjax/source/generate-euler-fonts.py` reads
that pinned archive and the existing WOFF2 files. It joins AFM glyph names to
the WOFF2 Unicode cmap. For custom names discarded by WOFF2's `post` table,
the duplicate legacy encoding slots recorded in the AFM identify the BaKoMa
private-use codepoints. Every assigned TFM slot must resolve to a real WOFF2
glyph. No character positions are guessed from alphabet order.

Regenerating the JSON requires FontTools with Brotli support (verified with
FontTools 4.65.0 and Brotli 1.2.0):

```sh
python vendor/tikzjax/source/generate-euler-fonts.py
```

Normal worker reproduction requires only Python's standard library:

```sh
python vendor/tikzjax/patch-runtime.py /path/to/pristine/tikzjax-1.6.0/dist/run-tex.js /path/to/output/run-tex.js
```

Reproduction from the pristine official npm worker is byte-identical to the
checked-in result. The patched worker SHA-256 is
`1034539f12fd0df04682db2ad8027c9810c4b3fdbd06bbadeb79e81599f297db`.

## Validation

`node tests/euler-engine.test.cjs` uses the actual bundled TeX/WASM engine and
SVG converter offline. It checks regular and bold alphabets and digits, all
six optical fonts in nested scripts, the eight alternate letter glyphs, and
the final TFM slot. Tests assert the selected font family and Unicode mapping,
so an accidental fallback to Computer Modern cannot pass. Headless Chrome
visual inspection also confirms the regular/bold glyphs and script sizes.
