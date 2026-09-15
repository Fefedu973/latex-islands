# Contributing

Keep changes focused and preserve the distinction between local rendering and authenticated conversation retrieval.

## Development

Use Node.js 22 or newer and npm:

```sh
npm ci
npm test
npm run test:engine
npm run build
npm run lint:firefox
```

`npm test` uses synthetic fixtures. Engine tests run the bundled TeX WebAssembly, including error recovery and timeout behavior. `npm run build` writes unpacked Chrome/Firefox directories and distribution/source ZIPs under `dist/`. See [README.md](README.md) for loading these locally.

For visual checks, `node tests/preview-server.cjs` serves local test pages. Use synthetic conversations and the included examples. Production extension files must not depend on these test adapters.

## Tests and reports

Include reproduction steps, browser/version, expected behavior and a minimal diagram or synthetic API fixture. Test dark and light themes, keyboard navigation, small windows and export fidelity when relevant. Do not add real conversation exports, HAR files, cookies, tokens, user identifiers, downloaded files, machine-specific paths or private screenshots to the repository.

Use actual TeX and browser checks for rendering changes; a passing DOM test alone does not prove engine or browser integration. Document any verification you could not perform. Do not claim store approval from local linting.

## Runtime and distribution changes

First-party JavaScript is shipped as source. The bundled TeX worker is an upstream Webpack artifact with documented local hardening changes. Keep its readable sources, patch script, notices, hashes and corresponding source material together. [Reviewer build notes](docs/reviewer-build.md) explain the current reproduction boundary.

Include complete license notices with runtime packages and corresponding sources with each release. Do not remove bundled licenses to reduce package size. If modifying an upstream dependency, reassess source reproducibility and store policies before submission.

## Pull requests

Explain the concrete behavior change and relevant validation. Contributions to the extension are under GPL-3.0-or-later, matching [LICENSE](LICENSE). Third-party material must have a compatible, documented license. Do not commit generated distribution archives or dependencies installed under `node_modules`.
