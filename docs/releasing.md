# Releasing

## Automatic GitHub releases

The `Validate, package and release` workflow validates every push, pull request and manual run. Only a **pushed tag starting with `v`** can publish a GitHub release, after validation succeeds. A manual workflow run performs validation only.

Before tagging:

1. Update the version in `package.json`, its lockfile and `manifest.json` together. The Firefox manifest inherits this version during the build.
2. Add `docs/release-<version>.md` describing the final changes and relevant installation notes.
3. Commit the release changes and push the commit. Create and push the corresponding tag, for example:

   ```sh
   git tag v1.4.2
   git push origin v1.4.2
   ```

The publish job rejects a tag that differs from `v` plus the package version or has no matching release-notes file. It downloads the **same workflow run's validated artifact**, checks `SHA256SUMS`, and attaches:

- `latex-islands-chrome-<version>.zip`
- `latex-islands-firefox-<version>.zip`
- `latex-islands-source-<version>.zip`
- `SHA256SUMS`

It creates a draft with those assets and the checked-in release notes, then publishes it after the uploads succeed. Only this job receives `contents: write`; validation keeps read-only repository permissions. The built-in GitHub token is sufficient. No additional release credential is required.

Do not create the same release manually while the tag workflow is running. An existing release causes creation to fail rather than silently replacing its assets. If uploading or publishing fails after creating a draft, inspect the draft and job log before completing or removing that draft and rerunning the publish job. Do not move an already published version tag to different code; release a new version instead.

The CI does not sign or upload a local Chrome `.crx`. A maintainer may separately attach the locally signed development CRX for this version. Keep its signing key outside Git, workflow artifacts and release assets. Such a CRX is not Chrome Web Store signed. The Firefox ZIP is unsigned and remains a development package until Mozilla signs it.

## Store publishing is not enabled

This repository currently has no Chrome Web Store or Mozilla AMO publishing job. Publishing a GitHub release does not submit either store. The existing [listing text](store-listing.md), [privacy policy](../PRIVACY.md), [screenshots](store-assets/README.md) and [reviewer build notes](reviewer-build.md) are preparation materials.

Once the publisher accounts and listings are ready, separate jobs can submit the validated browser packages after a tagged release. Store review and approval remain separate from a successful CI run.

### Chrome Web Store

- Enable two-step verification on the publisher's Google account, create the store item and complete its listing and privacy fields in the Developer Dashboard.
- Enable the Chrome Web Store API in a Google Cloud project. Record the publisher ID and extension ID as workflow configuration.
- Choose one supported authentication method:
  - OAuth client ID, client secret and refresh token with the `https://www.googleapis.com/auth/chromewebstore` scope; store credentials as GitHub Actions secrets.
  - A Google Cloud service account linked to the publisher in the Developer Dashboard; configure its authentication separately. This avoids an interactive user OAuth flow during CI.
- Upload the Chrome ZIP through API v2, wait for upload processing if needed, then submit it with `publish`. An update must use a greater manifest version. Publication occurs after store approval; changed visibility may require a manual dashboard publication before API publishing resumes.

Official documentation: [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api), [service-account authentication](https://developer.chrome.com/docs/webstore/service-accounts).

### Firefox AMO

- Create an AMO developer account and obtain its API credentials. Configure `WEB_EXT_API_KEY` (JWT issuer) and `WEB_EXT_API_SECRET` (JWT secret) as GitHub Actions secrets, without putting their values into source files or command output.
- Keep the existing ID `latex-islands@fefedu973` in `config/firefox.json` when updating the same add-on.
- Use the already pinned `web-ext` tool with `--source-dir dist/firefox`. `web-ext sign --channel=listed` submits a public AMO listing or an update. `--channel=unlisted` requests signing for self-distribution instead.
- For a first listed version, provide `--amo-metadata` with a localized summary, categories and the version's license. Updates can reuse listing metadata. Supply the matching source archive using `--upload-source-code`, together with accurate reviewer notes about the bundled TeX runtime.
- Account for asynchronous validation: `--approval-timeout=0` disables waiting for approval in the command. It does not skip Mozilla review or prove that the submission is published.

Official documentation: [web-ext signing options](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign), [signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/), [source submission](https://extensionworkshop.com/documentation/publish/source-code-submission/).

The project's modified third-party worker and incomplete reproduction of the upstream TeX core are documented in the [reviewer build notes](reviewer-build.md). Supply these details for review; passing lint or automating submission does not establish store acceptance.
