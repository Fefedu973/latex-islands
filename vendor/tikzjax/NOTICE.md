# Bundled TikZJax runtime

Upstream: https://github.com/rod2ik/tikzjax/tree/v1.6.0

Runtime package: @rod2ik/tikzjax 1.6.0
https://registry.npmjs.org/@rod2ik/tikzjax/-/tikzjax-1.6.0.tgz

Authors: Jim Fowler, Glenn Rice, Rodrigo Schwencke and contributors.
Licensed GPL-3.0-or-later; full license in `LICENSE`. Dependency notices in
`run-tex.js.LICENSE.txt`. The TeX packages retain their respective upstream licenses and original license
headers inside `tex_files/*.gz`. Font license: `FONTS-LICENSE.txt`, BaKoMa font
collection by Basil K. Malyshev, converted to WOFF2 by upstream TikZJax.

Original preferred-form source: `upstream-source-v1.6.0.tar.gz`.
The readable local modifications to `src/run-tex.js` and `src/library.js` are
provided in `source/`. `patch-runtime.py` reproduces the runtime modifications
on a pristine npm `dist/run-tex.js`. Runtime `tex.wasm.gz` decompresses to the
same byte-for-byte WASM as `tex.wasm` in the tagged upstream source archive.

Local changes by the Latex Islands contributors, 2026-09-15:

- Removed the TeX virtual filesystem fallback that fetched arbitrary URLs.
- Restricted asset reads to packaged core/WASM and flat gzip TeX filenames.
- Removed Webpack's dormant `new Function` global-object fallback. MV3 provides
  `globalThis` and allows the bundled WebAssembly with `wasm-unsafe-eval`.

The engine receives only the selected diagram source. All execution and font
loading use bundled files. No remote executable code or compilation service is
used. Callers must sanitize generated SVG before rendering it and terminate the
worker on compilation timeout.

## Worker API

Use a classic dedicated Worker pointing to `vendor/tikzjax/run-tex.js`.
Only one compilation may run in each worker at a time.

Initialization event:

```js
{ type: 'init', exposed: { type: 'module', methods: ['load', 'texify'] } }
```

First request (asset root is the folder containing this file):

```js
worker.postMessage({
  type: 'run', uid: 1, method: 'load',
  args: [chrome.runtime.getURL('vendor/tikzjax/')]
});
```

Then compile a document body; standalone and TikZ are already loaded:

```js
worker.postMessage({
  type: 'run', uid: 2, method: 'texify',
  args: [body, {
    texPackages: { circuitikz: 'american' },
    tikzLibraries: 'arrows.meta,positioning',
    addToPreamble: ''
  }]
});
```

The engine wraps the body in `\begin{document}` / `\end{document}`. Remove any
outer document environment and `\documentclass` before calling it.

Success: `{type:'result',uid,complete:true,payload:svgHtmlString}`.
Failure: `{type:'error',uid,error:{message,name,stack,__error_marker:'$$error'}}`.
Ignore `running` messages. `load()` returns an undefined payload on success.

SVG text uses bundled TeX fonts; load `fonts.css` for previews and inline the
referenced font files when exporting standalone SVG. General LaTeX outside a
TikZ diagram can produce positioned HTML instead of SVG; this extension's scope
is TikZ-based diagram rendering.

## Verified package examples

Actual local WASM compilation passes for TikZ, circuitikz, pgfplots and tikzcd.
Invalid TeX returns a diagnostic log; a valid diagram compiles after that error.
Remote `\input` fails without a remote request and the worker remains usable.

Run: `node tests/engine.test.cjs` from the extension folder, or use an absolute
path to the test. The test uses real worker_threads and real bundled WebAssembly;
only browser Worker events and local-file fetching are shimmed. Typical runtime
startup is 2 seconds, simple diagrams compile in 0.1–1.4 seconds in this runtime.
Each worker uses roughly 160 MiB for TeX memory plus its cached 160 MiB core dump.
Use one serial worker and terminate it after idle time.

## Additional corresponding sources

`dvi2html-source-0.0.7-beta7.tar.gz` is the exact dependency git revision
5c7ee7365f9f94feea772e2ac48d97479049cfec reported by the pinned npm release:
https://github.com/rod2ik/dvi2html/tree/5c7ee7365f9f94feea772e2ac48d97479049cfec

`web2js-source-1.0.3.tar.gz` contains the TeX compiler toolchain and its build
instructions from https://github.com/rod2ik/web2js. Its included `tex.wasm` is
byte-identical to this runtime (SHA-256
`e52568b6707eff2a5bd4bf0f237d9c67129acec416deb1f15ba12fef59d022bc`).
Its preloaded `core.dump.gz` is a newer snapshot; the extension deliberately uses
the original core packaged with TikZJax 1.6.0. `tex_files` in this extension
contains the matching TeX sources compressed individually.

The full integration test `node tests/compiler.test.cjs` exercises the actual
extension `compiler.js`, its source normalization, all four shipped examples,
queueing, caching, malformed-code recovery, an actual infinite TeX loop timeout,
and successful compilation after recreating the worker.
