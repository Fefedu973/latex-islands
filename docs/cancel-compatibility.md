# Cancellation marks in the SVG renderer

The bundled [cancel package](https://ctan.org/pkg/cancel) draws its diagonals and
arrows using LaTeX picture primitives. Those primitives normally use the `line10`
or `linew10` fonts. TikZJax's SVG converter does not contain the corresponding
font metrics and cannot convert the resulting DVI without an adapter.

`vendor/tikzjax/source/latex-islands-cancel.sty` is a first-party, GPL-3.0-or-later
adapter. It requires the unchanged upstream `cancel.sty`, then replaces the
picture primitives **locally inside cancellation commands** with PGF paths.
It leaves unrelated picture commands alone. It does not remove cancellation
marks or replace them with plain text.

The upstream package still controls expression layout, math styles, diagonal
slopes, target positioning, `\CancelColor`, and its options (`makeroom`,
`overlap`, `thicklines`, `samesize`, `smaller`, and `Smaller`). The arrowhead is
PGF's vector arrowhead, so its outline can differ slightly from the traditional
picture-font arrowhead. The resulting diagonal marks and arrows are ordinary
SVG paths and require no additional font downloads.

PGF paths inside SVG text must set their stroke color explicitly: otherwise
they inherit the text container's `stroke="none"` and become invisible despite
a successful compilation. The adapter sets the current color, including a
user-supplied `\CancelColor`.

## Integration and validation

Load `cancel` with its requested options, followed by `latex-islands-cancel`.
The adapter's `\RequirePackage{cancel}` also supports loading it by itself with
the upstream defaults. The compressed runtime file is
`vendor/tikzjax/tex_files/latex-islands-cancel.sty.gz`; builds copy this local
file, and source archives include the readable `.sty` source.

Run `node tests/cancel-engine.test.cjs` to exercise the real bundled TeX engine
and SVG converter offline. This checks all four commands (`\cancel`,
`\bcancel`, `\xcancel`, `\cancelto`), text mode, nested expressions, fractions,
subscript sizes, every upstream package option, custom color, and visible SVG
strokes. It also checks that the packaged gzip file matches the readable source.

To regenerate the deterministic gzip file after editing the adapter:

```sh
node -e "const fs=require('node:fs'),zlib=require('node:zlib'); fs.writeFileSync('vendor/tikzjax/tex_files/latex-islands-cancel.sty.gz',zlib.gzipSync(fs.readFileSync('vendor/tikzjax/source/latex-islands-cancel.sty'),{level:9}));"
```

The adapter is tested against the bundled `cancel` version 2.2. Its two private
entry points are deliberately isolated in this small file; re-run the engine
tests when updating that upstream package.
