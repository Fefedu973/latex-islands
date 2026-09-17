# Privacy policy

Applies to LaTeX Islands 1.4.2. Last updated: 2026-09-17.

LaTeX Islands is an independent browser extension maintained through [Fefedu973/latex-islands](https://github.com/Fefedu973/latex-islands). It provides local diagram rendering and user-requested export of the current ChatGPT conversation.

## Data used on your device

- The content script reads assistant replies on `chatgpt.com` and `chat.openai.com` to identify supported diagrams. Selected diagram source is passed to the bundled local TeX worker.
- Diagram results and compilation queues are cached in memory. The worker is released after inactivity. Embedded engine files and fonts are loaded from the extension package.
- Local extension storage holds preferences, export options, the last observed ChatGPT theme, and the standalone editor's last source. It does not store exported conversations or credentials. Local editor source can contain anything you paste into it.
- A conversation retrieved for export is held in memory for preview, filtering, copying and downloading. Closing the export dialog clears its cached snapshot. Reopening or updating a changed conversation can request it again.

## Network requests for conversation export

Selecting **Preview**, **Copy** or **Download** can request the current conversation's JSON pages from the same ChatGPT origin as the open tab. Requests contain the conversation identifier and pagination cursor, use your existing session cookies, and expose ordinary request information such as IP address to ChatGPT.

If a conversation request returns HTTP 401, the page-side bridge can read ChatGPT's `/api/auth/session` endpoint and retry with its session token. The token stays in the bridge's memory and is cleared at completion or cancellation. It is not sent to the isolated content script, saved in extension storage or added to the exported file.

ChatGPT returns the conversation text, roles, metadata and attachment references to your browser. The extension does not submit new chat messages or send diagram source to a compilation server. These authenticated requests are real network activity; describing the entire extension as “offline” or “no data transmission” would be inaccurate.

There is no developer-operated server, analytics endpoint, advertising system or sale of user data. No conversation is uploaded to the project maintainer. ChatGPT's handling of requests remains governed by its own service policies.

The Firefox package declares `authenticationInfo` and `browsingActivity` as required data-transmission categories: the export uses the existing ChatGPT session and sends the current conversation identifier and pagination cursors to ChatGPT. It does not send conversation text to a developer server. Firefox 140 or newer presents these declarations through its built-in consent interface. These declarations do not grant access to unrelated sites or to browser history.

User data is used only for the diagram-rendering and conversation-export features described here. Its use complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. The extension does not use Google account APIs to read account data.

## Exported files, clipboard and links

When you request it, the extension writes the selected transcript or archive to the clipboard or a local download. JSON archives may contain personal information and internal conversation metadata returned by ChatGPT. Markdown and text apply your selected filters. Attachment binaries are not fetched; references and available links may remain in the export.

The Firefox package requests `clipboardWrite` so your Copy action can complete after asynchronous conversation retrieval. It does not request clipboard-read access or inspect existing clipboard contents.

The preview does not automatically fetch remote images or attachment links. Opening a link is a separate browser action and contacts that destination. Files you download and anything you subsequently share are outside extension storage.

## Control and deletion

Rendering can be disabled in the popup. Export runs only after an explicit action; it can be cancelled, and closing the export dialog cancels an in-flight retrieval. Uninstalling the extension removes its browser-managed local storage; independently saved downloads and clipboard contents must be removed separately. Browser behavior such as extension updates, browser synchronization and browser telemetry is governed by the browser vendor's settings and policies.

## Questions

Use the [project issue tracker](https://github.com/Fefedu973/latex-islands/issues) for privacy questions without posting private conversations or credentials. For sensitive reports, see [SECURITY.md](SECURITY.md).
