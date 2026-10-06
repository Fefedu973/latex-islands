# LaTeX Islands 1.5.8

## PDF export

- Protect the printable document from ChatGPT's layered print styles, which could hide it and produce a blank PDF.
- Restore the preview after saving or cancelling the browser print dialog. The same preview can be printed again, filtered or closed normally.
- Keep diagram frames and export controls intact while the browser switches between print and screen media.
- Export healthy diagrams and surrounding messages when another diagram fails. The failed diagram is replaced with its source and a concise error, with a warning in the preview.
- Treat code-block hydration as a presentation change, avoiding a false conversation-change error while loading history.

## Compatibility checks

The regression workflow now runs daily and retains synthetic PDF, screenshot and diagnostic artifacts on failure. An optional public ChatGPT DOM sentinel reports live coverage separately; it requires an intentionally public synthetic share URL and never uses a signed-in session. See [compatibility testing](compatibility-testing.md) for setup and limits.

This release includes the Circuitikz dependency inference and accented math-label handling from 1.5.6–1.5.7. No runtime permissions or dependencies were added.
