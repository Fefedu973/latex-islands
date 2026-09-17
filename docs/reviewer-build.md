# Reviewer build and runtime provenance — 1.4.2

## Extension packages

The extension's first-party JavaScript, HTML and CSS are maintained directly in this repository. There is no first-party minification or remote build service. With Node.js 22+ and npm on Windows, macOS or Linux:

```sh
npm ci
npm test
npm run test:engine
npm run build
npm run lint:firefox
```

`npm ci` installs development/test/packaging dependencies from the locked npm dependency set. These tools are not installed or downloaded by the running extension.

Build outputs are `dist/chrome/`, `dist/firefox/`, `dist/latex-islands-chrome-1.4.2.zip`, `dist/latex-islands-firefox-1.4.2.zip`, and `dist/latex-islands-source-1.4.2.zip`. Browser ZIPs have `manifest.json` at their root. The source ZIP includes first-party code, scripts, tests, lockfiles, notices, readable worker modifications and the upstream archives listed below. The build does not recompile the upstream TeX toolchain.

## Bundled upstream inputs

| Input | Source and role |
| --- | --- |
| `upstream-source-v1.6.0.tar.gz` | TikZJax 1.6.0 release source, including source files, Webpack configuration and Yarn lockfile. [Tagged source](https://github.com/rod2ik/tikzjax/tree/v1.6.0). |
| `dvi2html-source-0.0.7-beta7.tar.gz` | Source corresponding to the pinned npm package's recorded commit. [Revision](https://github.com/rod2ik/dvi2html/tree/5c7ee7365f9f94feea772e2ac48d97479049cfec). |
| `web2js-source-1.0.3.tar.gz` | Archived web2js tree whose package declares version 1.0.3, containing the compiler/toolchain, TeX source material and build instructions. Archive root is `web2js-main`; its content hash below identifies this snapshot. [Project](https://github.com/rod2ik/web2js). |
| `source/run-tex.js`, `source/library.js` | Readable copies of the locally modified worker sources. |
| `patch-runtime.py` | Reproduces the three local hardening replacements in the pristine TikZJax npm worker artifact. |

All these paths are under `vendor/tikzjax/`. Complete notices and links for the worker dependency tree are in [runtime-dependency-licenses.md](runtime-dependency-licenses.md), including dependencies eliminated from some browser bundles.

## Runtime worker changes

The installed `run-tex.js` originated in the official `@rod2ik/tikzjax` 1.6.0 npm package. Local changes remove arbitrary-URL fallback for virtual TeX files, allow only the packaged WASM/core/flat gzip-TeX paths, and replace Webpack's dormant dynamic-function global lookup with `globalThis`.

To compare the hardened artifact with the official release, use a temporary working directory, Python 3 and a standard `tar` tool. On Linux/macOS:

```sh
mkdir -p .review-work
npm pack @rod2ik/tikzjax@1.6.0 --pack-destination .review-work
tar -xzf .review-work/rod2ik-tikzjax-1.6.0.tgz -C .review-work
python3 vendor/tikzjax/patch-runtime.py .review-work/package/dist/run-tex.js .review-work/run-tex.js
cmp .review-work/run-tex.js vendor/tikzjax/run-tex.js
```

The patcher requires exactly one match for each documented replacement and exits if upstream bytes differ. This comparison checks transformation of the released worker artifact. It is **not** proof of rebuilding the whole upstream dependency bundle and TeX compiler from preferred source.

## WASM and core dump reproduction boundary

`tex.wasm.gz` decompresses to the same WASM bytes present in the TikZJax archive and the web2js archive. SHA-256 of the decompressed WASM is `e52568b6707eff2a5bd4bf0f237d9c67129acec416deb1f15ba12fef59d022bc`.

The extension uses the original TikZJax 1.6.0 `core.dump.gz`. The web2js archive contains a newer core snapshot, so substituting it would change runtime contents. Its build pipeline requires upstream TeX tooling and dependencies described in that archive. Rebuilding an identical original core dump from that toolchain has not been independently demonstrated. The package build copies the known runtime files rather than claiming such a rebuild.

The 245 `tex_files/*.gz` assets contain the compressed TeX sources loaded by the worker, with original headers. Fonts are upstream BaKoMa-derived WOFF2 files. Runtime packages include license notices; corresponding sources accompany the source ZIP.

## Recorded SHA-256 values

These identify the currently archived inputs; they do not substitute for source review.

```text
86025eb6f234460e1cc8010cf165a861d4cd47818be83030e9ba0e073d33f717  upstream-source-v1.6.0.tar.gz
f08397e02c77796951ae419b54edbaa47fa0d8bd0c5e1e9dd7e97e40f91dc356  dvi2html-source-0.0.7-beta7.tar.gz
1a7d45d0aaa1a14b62c37cb07a166f28a30b5fe365ecd24b841e83c251e03324  web2js-source-1.0.3.tar.gz
7a5e8fe686a9460c3a98e0aad4ee626c8f2351f6010a00cbae8bccfabbe1ebeb  run-tex.js
f2ff86f07aa35522c5a39f67eb4f42b675e9c207456f0c6b238fb6908548186a  tex.wasm.gz
d554a06d2d508fd9b504626ead2f77f68a62bb7bc56efe52957ca72d1a5cb67b  core.dump.gz
```

## Store review limits

Supply matching source material for each submitted version and explicitly disclose the local worker changes. Mozilla's [source rules](https://extensionworkshop.com/documentation/publish/source-code-submission/) require reviewable sources and reproducible build instructions, while its [third-party guidance](https://extensionworkshop.com/documentation/publish/third-party-library-usage/) requires exact release provenance. These materials describe what can currently be reproduced and what remains an upstream-artifact dependency. Neither local tests nor package generation certify store acceptance.
