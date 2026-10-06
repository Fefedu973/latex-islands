# Compatibility checks

The **Validate, package and release** GitHub Actions workflow runs on pushes, pull requests, manual dispatch and every day at **04:23 UTC**. Scheduled runs use the repository's default branch, so the schedule becomes active after this workflow is merged there. GitHub may delay scheduled jobs; the Actions page shows the actual run time and results.

## Automated behavior coverage

The daily run repeats the same regression suite used before packaging:

- Unit and DOM tests: message discovery, streaming, navigation, settings, export formats, selection, cancellation and print cleanup.
- The bundled real TeX engine: supported examples, inferred packages, fonts, compilation errors, recovery and cache behavior.
- Real Chromium: font loading and first paint; PDF preview, layout, selection, printing and return to preview; inline controls and navigation between synthetic conversations.
- Native Chrome printing: actual `window.print()`, Save as PDF and `afterprint`, repeated twice with the same prepared preview, with PDF page counts and extracted text checked.
- Actual unpacked Chrome extension: content scripts, renderer isolation, private messaging, rendering, export and settings on controlled local pages.
- Reproducible Chrome/Firefox/source packages and Firefox manifest linting.

Browser tests create temporary isolated profiles and use synthetic conversations. They never attach to a logged-in user profile. Browser versions are recorded by the tests; [GitHub's hosted runner images](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md) supply Chrome and its updates, which may lag the latest browser release. The actual-extension test requires Chrome 138 or newer and fails explicitly on older versions. Relevant synthetic PDF, screenshot and diagnostic artifacts are retained for seven days even when a check fails. No browser profile, cookies, HAR, user conversation or real-page screenshot is uploaded. The actual Firefox smoke remains a separate release check: its current Windows process cleanup needs hardening before it can reliably become a scheduled gate. Firefox unit/runtime tests and manifest linting still run daily.

The suite exercises known ChatGPT layouts. Passing these tests **does not prove compatibility with an unobserved ChatGPT rollout**, account-specific experiment, private conversation API change or the native print dialog on every OS. Each newly observed integration failure should become a minimal synthetic regression before it is fixed.

### Native print regression

`tests/pdf-native-print.browser.cjs` uses a headed Chrome window with a fresh profile and **Save as PDF** explicitly configured. It never uses a physical printer. On Linux, CI runs it under Xvfb and installs `xvfb`, `xauth` and `poppler-utils` from the runner's Ubuntu repositories only if needed. Unlike the broader PDF layout harness, this test does not mock `window.print()` or use `Page.printToPDF`.

The synthetic page includes the layered ChatGPT print CSS observed on October 6, 2026, an empty native print document, and an open export dialog. The Windows verification in Chrome 154.0.8037.97 produced two four-page PDFs, each 53,283 bytes with 8,272 extracted text characters; the original prepared preview remained mounted and visible after both real `afterprint` events. Byte counts are recorded evidence, not assertions that must remain identical across operating systems or browser versions.

The `--without-print-guard` negative control removes only the protective inline display declaration from a test-served copy. It reproduced one blank page (1,066 bytes, no expected text) and failed the test. Run it when investigating the regression; its nonzero exit is intentional. No production file is changed by this control.

## Optional current public-site sentinel

To detect some upstream DOM changes without storing a login:

1. Create a short ChatGPT conversation containing only intentionally public synthetic content: one prompt, one answer and a fenced code block. Share it publicly.
2. In this GitHub repository, open **Settings → Secrets and variables → Actions → Variables**.
3. Set `CHATGPT_SMOKE_URL` to its `https://chatgpt.com/share/...` link.
4. Run **Validate, package and release → Run workflow** and inspect the **Public ChatGPT DOM contract** job.

The sentinel fetches public HTML without cookies, refuses redirects and never runs remote scripts. It applies the extension's actual `chatgpt-dom.js` adapter and checks that prompts, answers and code blocks are recognized. Its report contains only counts, timestamp and coverage status; neither the URL nor conversation content is saved in artifacts.

Statuses are deliberately distinct:

| Status | Meaning |
| --- | --- |
| `passed` | The adapter recognizes the expected content in public server HTML. |
| `not-configured` | No public link configured; a workflow warning explicitly says live ChatGPT was not tested. |
| `inconclusive` | Expected DOM is missing; inspect the share content, a hydration-only response, challenge page or changed selectors. The job fails for investigation. |
| `unavailable` | Request failed, was redirected or blocked, or exceeded the response limit. The job fails; this is not proof of a product regression. |

This sentinel covers **server-rendered public share markup only**, which may differ from signed-in conversation markup. It cannot verify hydration, authenticated controls/API exports, live streaming or printing. An automated challenge is reported as unavailable/inconclusive; no login or challenge bypass is attempted.

## Local reproduction

With Node.js 22+ and local Chrome/Firefox installed:

```sh
npm ci
npm test
node --test tests/chatgpt-public.test.cjs
npm run test:engine
npm run test:fonts
npm run test:pdf
npm run test:pdf:native
npm run test:chrome
npm run build
node tests/firefox-smoke.mjs
npm run lint:firefox
node scripts/check-public-chatgpt.mjs
```

Set `CHROME_BINARY` or `FIREFOX_BINARY` if browser discovery needs an explicit path. The final command reports `not-configured` unless `CHATGPT_SMOKE_URL` is supplied in the environment. These commands do not publish an extension or a release.

For native printing on headless Linux, use `xvfb-run -a npm run test:pdf:native`. Text verification requires `pdftotext` (`PDFTOTEXT_BINARY` overrides its path), or an existing Python with `pypdf` selected by `PDF_PYTHON`. The test does not install dependencies or use your Chrome profile. To run the intentional negative control: `npm run test:pdf:native -- --without-print-guard`.

## Live release check

After a ChatGPT rollout, also test with a real, non-sensitive conversation and the packaged extension: navigate away and back, stream a diagram, preview a long selected-message PDF, print/save it, close or cancel printing, then preview/export again. Include a deliberately invalid diagram and confirm surrounding messages still export. Open the saved PDF and check content on every page. This authenticated, OS-specific check remains necessary alongside CI; do not label it passed without running it.
