# Export a ChatGPT conversation — v1.4.2

The **Export conversation** button in the header of a saved conversation opens a window with two panels: settings and preview. The export retrieves ChatGPT's JSON data instead of reconstructing the conversation from the text displayed on the page.

## Choose content and format

| Format | Content |
| --- | --- |
| **Markdown (.md)** | A readable transcript with user messages, ChatGPT replies, code and TeX, without repeating technical JSON under each message. |
| **Plain text (.txt)** | The same message selection, with common Markdown formatting removed. Code and TeX expressions are preserved. |
| **Complete archive (.json)** | Every JSON page received, its metadata and a combined message list. Transcript options do not filter this archive. |

For Markdown and plain text, the **Content** menu offers three presets: **Conversation**, **Detailed context** and **Answers only**. Under **Customize transcript**, you can choose each option separately:

- **Include my messages**;
- **Include attachment references**;
- **Include sources and citations**;
- **Show dates and times**, in UTC;
- **Include progress updates** that can be displayed;
- **Include tool calls and results**.

By default, the transcript includes user messages and final replies, along with references to generated media. Internal context, system messages, hidden analysis and empty tool outputs are omitted. The detailed preset adds displayable progress updates and tools; it does not turn the transcript into a complete copy of every internal field. Those fields remain in the JSON archive.

Available structured sources become readable links. Citations with missing sources are flagged; no URLs are invented. Images and attachments are mentioned once when their content and metadata refer to the same file. A usable link is preserved when available; internal pointers become readable descriptions. **Binary files are neither downloaded nor embedded in the export.**

## Preview, copy and download

1. Choose a format under **Format** and a preset under **Content**.
2. Click **Preview** to retrieve the conversation.
3. Adjust the options and check the result.
4. Use **Copy** or **Download**.

The **Conversation** view presents messages for reading; the **File** view shows the generated content. JSON uses the file view. Common Markdown is formatted in the conversation view; **equations remain TeX source**, without mathematical rendering. The file view and downloads preserve TeX and source code.

To keep the preview manageable, it initially shows **20 messages** in conversation view or **50,000 characters** in file view. **Show more** displays the next messages or characters. **Copy** and **Download** always use the entire file, regardless of how much of the preview is visible.

Changing options updates the loaded preview without making another request. If ChatGPT's messages change, the interface indicates that the preview needs refreshing; the next action retrieves the current version. Options are saved locally, while the retrieved conversation stays in memory. Selecting a format or changing an option does not itself trigger a conversation request.

Retrieval must finish before copying or downloading. An HTTP failure, unknown format, missing or repeated cursor, conversation change or cancellation stops the export. Closing the window cancels any retrieval in progress. A partial file is never presented as complete.

## Archive scope

The archive contains the data ChatGPT returns at the time of retrieval. Every retrieved page and its fields are preserved in `raw_pages`. The `messages` list combines the pages and deduplicates message IDs: when multiple copies of a message overlap, the most recent copy is used in this list; all copies remain in the original pages.

The paginated format covers the current conversation exposed by the server. It cannot include older branches or versions that the API does not return. Any version fields that are present are preserved. When the older `mapping` format is available, all its nodes and parent/child links are retained in `raw_pages`; the transcript follows the branch selected by `current_node`.

Messages in the paginated format keep the server's order. Parent and turn IDs may be incomplete or reused, so they are not used to arbitrarily reconstruct the conversation. The JSON archive is the reference for structure, unknown fields, media resources and the different message copies received.

A reply that is still being generated may change after export. Local edits in the extension's TikZ editor do not change the messages saved by ChatGPT and are therefore not part of this export.

## How retrieval works

Retrieval uses these internal endpoints:

1. `GET /backend-api/conversations/{id}?include_has_versions=true&num_turns=10`
2. If `page_info.has_previous_page` is `true`, `GET /backend-api/conversations/{id}/messages?include_has_versions=true&num_turns=10&before={start_cursor}`, continuing back to the first page.
3. If the first endpoint returns HTTP 404 or 405, try the older `GET /backend-api/conversation/{id}` and check that it contains a `mapping`.

`conversation-bridge.js`, declared in the `MAIN` world, makes requests using the page's cookies. After an HTTP 401, it may read `/api/auth/session` and retry with the session token. This token stays in the bridge's memory and is cleared when the export finishes or is cancelled. It is not sent to the isolated content script, saved or added to the exported file. The extension adds no transfer to a third-party service.

The bridge accepts only GET requests to allowed endpoints for the currently open conversation, on the same origin, with bounded parameters. Retrieval checks the origin, source window and request ID. The bridge remains within the ChatGPT site's trust context.

Each bridge request times out after 45 seconds, and retrieval is limited to 500 pages. The site's API is internal and may change; unknown formats produce an explicit error. Reload ChatGPT tabs after installing or reloading the extension to activate the bridge.

## Validation

```powershell
node --test tests/export.test.cjs tests/export-bridge.test.cjs tests/export-ui.test.cjs
```

The fixtures are synthetic. They check pagination and its failure cases, preservation of pages and metadata, transcript filters, attachments, citations, code and TeX, fallback to the older format, bridge restrictions, token isolation, cancellation and navigation.

Automated tests alone do not establish compatibility with an active authenticated ChatGPT session. Validation results for this version are documented in [VALIDATION.md](VALIDATION.md).
