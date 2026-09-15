# Third-party notices and corresponding sources

First-party extension code is GPL-3.0-or-later; see [LICENSE](LICENSE). This does not replace the licenses of bundled software, TeX packages or fonts.

## TikZJax worker and supporting JavaScript

- **@rod2ik/tikzjax 1.6.0** — Jim Fowler, Glenn Rice, Rodrigo Schwencke and contributors; upstream declares GPL-3.0-or-later. [Release source](https://github.com/rod2ik/tikzjax/tree/v1.6.0), [official npm package](https://registry.npmjs.org/@rod2ik/tikzjax/-/tikzjax-1.6.0.tgz).
- Bundled worker: `vendor/tikzjax/run-tex.js`. Its three local hardening changes restrict asset loading and remove the dormant dynamic-function fallback. Readable modified source, original source archive and patch script accompany the repository/source package. See [vendor notice](vendor/tikzjax/NOTICE.md).
- **@rod2ik/dvi2html 0.0.7-beta7** — [source revision](https://github.com/rod2ik/dvi2html/tree/5c7ee7365f9f94feea772e2ac48d97479049cfec). Its package metadata declares GPL-3.0; its shipped `LICENSE` contains MIT terms with copyright 2015 Mitch Anderson. Both upstream declarations are preserved here; this project does not resolve that upstream discrepancy by removing either notice.
- Runtime dependency notices, including full MIT, BSD, ISC and zlib terms and copyright statements, are in [runtime-dependency-licenses.md](docs/runtime-dependency-licenses.md). These are copied from official npm packages at versions resolved by TikZJax's bundled lockfile. Upstream's [extracted worker notices](vendor/tikzjax/run-tex.js.LICENSE.txt) are also retained.

## TeX engine and packages

The worker loads `tex.wasm.gz`, `core.dump.gz` and `tex_files/*.gz`. The corresponding **web2js 1.0.3** source archive accompanies the source distribution. Its package declares GPL-3.0; its `LICENSE.md` refers to GPL v3 and Apache License 2.0. Full [GPL v3](LICENSE) and [Apache 2.0](docs/licenses/Apache-2.0.txt) texts are included.

The 245 individually compressed TeX files are retained with their original headers. They are readable source after gzip decompression, not downloaded executable code. TeX packages have independent terms: for example PGFPlots declares GPL-3.0-or-later; Circuitikz provides LPPL/GPL alternatives; Chemfig declares LPPL-1.3c-or-later. The [LPPL 1.3c text](docs/licenses/LPPL-1.3c.txt) is included. Do not relabel all TeX files as first-party GPL code. Original file-level headers remain authoritative for each component.

The engine includes upstream compiled/preloaded artifacts. Rebuilding every TeX core-dump byte from the available upstream toolchain has not been independently established. [Reviewer build notes](docs/reviewer-build.md) describe the exact artifacts, hashes, matching source material and this limitation.

## Fonts

The bundled WOFF2 fonts derive from the **BaKoMa font collection**, copyright 1994–1995 Basil K. Malyshev, converted by upstream TikZJax. The complete [font license](vendor/tikzjax/FONTS-LICENSE.txt), including distribution/modification notices and original font location, accompanies the fonts. The license permits font embedding in SVG; its terms are not replaced by the extension license.

## Distribution

Browser runtime ZIPs include this notice, the extension GPL text, the vendor notices, font license, complete runtime dependency notices, and the additional license texts above. Corresponding source ZIPs also include the three upstream source archives, readable worker modifications, patch script, build scripts and lockfiles. Keep source material available alongside the matching release at [the project repository](https://github.com/Fefedu973/latex-islands).

Development-only dependencies installed by `npm ci`, including test and packaging tools, are not loaded by the browser runtime. Their licenses remain in their own installed packages and lockfile records.
