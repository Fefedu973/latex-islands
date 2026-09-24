# LaTeX Islands 1.5.0

- Export rich PDFs with rendered equations, tables, code, images and complete vector diagrams. The extension scrolls the conversation to load earlier messages and captures them as they appear, including messages later removed from the live page. PDF uses the displayed content rather than reconstructing it from the conversation API.
- Choose individual messages or any combination for PDF, Markdown and plain text. Export the conversation, answers only or prompts only, with search and selection controls. The complete JSON archive remains unfiltered.
- Save one assistant reply using its **PDF** button, with an optional preceding prompt. Review the selected content in the export window before **Save PDF** opens the browser's print dialog.
- Preserve diagram proportions and embedded fonts independently of preview zoom and pan, including successfully rendered local edits. Missing or unfinished diagrams produce an error instead of being silently omitted.

PDF does not expand hidden tool details or collapsed interactive content, and attachment files are not downloaded. ChatGPT can make its normal loading requests while the extension scrolls the page. See the [export guide](https://github.com/Fefedu973/latex-islands/blob/v1.5.0/EXPORT.md) for format differences and limits.

For an unpacked Chrome installation, replace its files with the Chrome package, click **Reload** at `chrome://extensions`, then reload ChatGPT. Check that the extension card shows **1.5.0**. Store installations receive updates after their store approves the submitted version.
