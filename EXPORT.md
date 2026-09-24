# Export a ChatGPT conversation

The **Export conversation** button in the header of a saved conversation opens a window with two panels: settings and preview. Markdown, text and JSON exports retrieve ChatGPT's saved data. PDF captures the rendered conversation after scrolling the page to load earlier messages.

## Choose content and format

| Format | Content |
| --- | --- |
| **Markdown (.md)** | A readable transcript with user messages, ChatGPT replies, code and TeX, without repeating technical JSON under each message. |
| **Plain text (.txt)** | The same message selection, with common Markdown formatting removed. Code and TeX expressions are preserved. |
| **Complete archive (.json)** | Every JSON page received, its metadata and a combined message list. Transcript options do not filter this archive. |
| **PDF (.pdf)** | A clean printable copy of selected messages from the rendered page, with equations, tables, code, images and LaTeX Islands diagrams. |

## Choose individual messages

For PDF, Markdown and plain text, choose **Conversation**, **Answers only** or **Prompts only** under **Content**. Use **Choose messages** to load the message list, then check the messages you want to export. You can select a single message or any combination; the export keeps their conversation order. Search helps locate messages, and **All** and **None** make longer selections easier.

The **Messages** view shows the selection. Switch back to **Preview** for PDF or **Conversation** for a transcript to review the result. **Reload** captures or retrieves the conversation again. Message selections stay in memory for the open export window; they are not saved as preferences.

The complete JSON archive is always unfiltered. Message selection and transcript options apply only to the other formats.

## Save a rich PDF

Select **PDF (.pdf)**, choose the messages and click **Preview** to inspect the printable content in the export window. **Save PDF** opens the browser's print dialog; choose **Save as PDF** there. The **PDF** button below an assistant reply starts with that reply selected. Enable **Include prompt** to add its preceding user message.

PDF uses ChatGPT's actual rendered content. The extension scrolls the conversation so ChatGPT can load and render earlier messages, captures each message as it becomes available, and restores the scroll position afterward. Captured messages remain available for selection even if ChatGPT removes them from the live page while scrolling. This can take longer for a large conversation and can be cancelled.

The PDF exporter does not request the conversation API or reconstruct messages from JSON. Scrolling can trigger ChatGPT's own normal network requests. Content that the site cannot load cannot be recovered by this export. Hidden tool details and collapsed interactive content are not expanded automatically.

The print copy removes navigation, composers and action buttons, uses a light background with page margins, wraps code, and preserves the page's rendered math and rich content. Browser print settings control paper size and optional browser headers and footers; the in-window preview shows the content, while the print dialog shows final pagination.

Diagrams are exported as complete vector SVGs with embedded fonts, using their intrinsic proportions and fitting within the page. Preview pan and zoom do not affect their size or crop the drawing. Updated local diagram edits are included. Finish generating replies, render every diagram and apply pending editor changes before exporting; the extension reports unavailable diagrams instead of silently leaving them out.

The browser loads the page's existing image resources as needed for the print copy. PDF does not download attachment files. Temporary capture and preview data remain in the tab and are cleared when the export window closes.

## Transcript options

Markdown and plain text also offer a **Detailed context** preset. Under **Customize transcript**, you can choose each option separately:

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
2. Click **Preview** or **Choose messages** to retrieve the conversation.
3. Adjust the message selection and options, then check the result.
4. Use **Copy** or **Download**.

The **Conversation** view presents messages for reading; the **File** view shows the generated content. JSON uses the file view. Common Markdown is formatted in the conversation view; **equations remain TeX source**, without mathematical rendering. The file view and downloads preserve TeX and source code.

To keep the preview manageable, it initially shows **20 messages** in conversation view or **50,000 characters** in file view. **Show more** displays the next messages or characters. **Copy** and **Download** always use the entire file, regardless of how much of the preview is visible.

Changing options updates the loaded preview without making another request. If ChatGPT's messages change, the interface indicates that the preview needs refreshing; the next action retrieves the current version. Options are saved locally, while the retrieved conversation stays in memory. Selecting a format or changing an option does not itself trigger a conversation request.

Retrieval must finish before copying or downloading. An HTTP failure, unknown format, missing or repeated cursor, conversation change or cancellation stops the export. Closing the window cancels any retrieval in progress. A partial file is never presented as complete.

## Archive scope

The archive contains the data ChatGPT returns at the time of retrieval. Every retrieved page and its fields are preserved in `raw_pages`. The `messages` list combines the pages and deduplicates message IDs: when multiple copies of a message overlap, the most recent copy is used in this list; all copies remain in the original pages.

The paginated format covers the current conversation exposed by the server. It cannot include older branches or versions that the API does not return. Any version fields that are present are preserved. When the older `mapping` format is available, all its nodes and parent/child links are retained in `raw_pages`; the transcript follows the branch selected by `current_node`.

Messages in the paginated format keep the server's order. Parent and turn IDs may be incomplete or reused, so they are not used to arbitrarily reconstruct the conversation. The JSON archive is the reference for structure, unknown fields, media resources and the different message copies received.

A reply that is still being generated may change after a transcript export. Local edits in the extension's TikZ editor do not change the messages saved by ChatGPT and are therefore not part of Markdown, text or JSON exports. PDF includes the current successfully rendered diagram instead.

## How retrieval works

Markdown, text and JSON retrieval uses these internal endpoints. PDF does not use this bridge.

1. `GET /backend-api/conversations/{id}?include_has_versions=true&num_turns=10`
2. If `page_info.has_previous_page` is `true`, `GET /backend-api/conversations/{id}/messages?include_has_versions=true&num_turns=10&before={start_cursor}`, continuing back to the first page.
3. If the first endpoint returns HTTP 404 or 405, try the older `GET /backend-api/conversation/{id}` and check that it contains a `mapping`.

`conversation-bridge.js`, declared in the `MAIN` world, makes requests using the page's cookies. After an HTTP 401, it may read `/api/auth/session` and retry with the session token. This token stays in the bridge's memory and is cleared when the export finishes or is cancelled. It is not sent to the isolated content script, saved or added to the exported file. The extension adds no transfer to a third-party service.

The bridge accepts only GET requests to allowed endpoints for the currently open conversation, on the same origin, with bounded parameters. Retrieval checks the origin, source window and request ID. The bridge remains within the ChatGPT site's trust context.

Each bridge request times out after 45 seconds, and retrieval is limited to 500 pages. The site's API is internal and may change; unknown formats produce an explicit error. Reload ChatGPT tabs after installing or reloading the extension to activate the bridge.

## Validation

```powershell
npm test
npm run test:pdf
```

The fixtures are synthetic. They check pagination and its failure cases, preservation of pages and metadata, transcript filters, attachments, citations, code and TeX, fallback to the older format, bridge restrictions, token isolation, cancellation and navigation.

Automated tests alone do not establish compatibility with an active authenticated ChatGPT session. Validation results for this version are documented in [VALIDATION.md](VALIDATION.md).
