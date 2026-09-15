# Security

Security-sensitive boundaries include untrusted TeX source, SVG sanitization, export preview rendering, the page/extension messaging bridge, and local-only engine asset loading.

## Reporting

If private vulnerability reporting is enabled in the repository's Security tab, use it. Otherwise, open a minimal issue requesting a private contact channel, without publishing an exploit, account data or credentials. The project has no guaranteed response time or paid support program.

Useful report details include the affected version, browser, a minimal synthetic reproduction, expected impact and which boundary is crossed. Never include live session tokens, cookies or private conversation exports in a public issue.

## Security model

- TeX runs in a dedicated worker using bundled files. Compilation timeouts terminate the worker. Unsupported external inputs must not trigger arbitrary URL fetching.
- Generated SVG must be sanitized before display. Exports must preserve that boundary.
- The conversation bridge accepts bounded GET requests for the current conversation, validates message origin/source/request identifiers, and keeps authentication tokens out of the isolated script and downloads.
- A page-side bridge remains in ChatGPT's trust context. It is not isolation against a compromised ChatGPT page or another extension with equivalent access.
- Preview content must never execute markup from a conversation or automatically load attachment URLs.

Supported fixes target the latest project release. Browser stores and internal ChatGPT APIs may change independently of the project.
