# LaTeX Islands 1.5.9

- Keep the diagram options button opaque on hover, including dark controls over a native white diagram canvas.
- Follow the current explicit ChatGPT theme and surface palette during hydration. Background tabs no longer overwrite the theme remembered for the active tab; popup/editor palettes accept current browser color formats.
- Preserve favicon dimensions and inline positioning in PDFs. Source badges keep their text instead of becoming oversized image cards.
- Fix the content observer crashing when ChatGPT changes an SVG class. Native diagram and icon hover updates no longer interrupt diagram discovery.
- Recognize content-search message wrappers during hydration, alongside the existing conversation wrappers, without counting a message twice.
- Retry an unauthenticated conversation request reported as HTTP 404 once using the existing ChatGPT session. Credentials remain in the page bridge and are never included in an export.
- Use the complete conversation mapping when a paginated endpoint changes its response envelope or an older-message endpoint disappears. Never mix a partial page set with a mapping or silently accept an incomplete export.
- Keep visible TeX source printable when it is in a prompt, inline code, or rendering is disabled. It no longer makes PDF export wait for a nonexistent diagram.
- Dispose of PDF captures that complete after cancellation or navigation, and preserve the preferred conversation export format after a reply-only PDF.

No runtime dependencies or permissions were added. The daily regression workflow includes the new DOM, authentication, pagination and cancellation cases.

The November 4 live inspection reproduced the SVG observer exception and an HTTP 404 export failure in the installed 1.5.8. Header/reply export controls and message discovery were present. Automated browser control then stopped because it could not verify the current URL; the corrected package has been tested with isolated synthetic conversations, not revalidated in that signed-in tab. In particular, successful recovery from that account's HTTP 404 remains to be confirmed.
