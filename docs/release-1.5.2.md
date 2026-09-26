# LaTeX Islands 1.5.2

- Restore inline diagrams in the September 2026 ChatGPT web interface, including its new message structure and code widgets. Previous ChatGPT layouts remain supported during the rollout.
- Show a loading preview while code streams and start rendering when a diagram closes, even if the answer continues. Recognize the new composer stop control.
- Replace existing code blocks with a loader before the diagram frame initializes. Keep the previous preview height during re-rendering and preserve access to the source if loading fails.
- Keep code hidden when ChatGPT rewrites widget classes. Reuse the existing diagram when the site replaces only its unchanged source widget, preserving the rendered SVG and local edits without restarting the loader.
- Resume interrupted rendering after page restoration and ignore responses from abandoned renders. Bound connection, compiler-response and font waits; unavailable previews offer recovery instead of an endless spinner.
- Retire discarded iframe documents when ChatGPT detaches and immediately restores a cached conversation. Remove stale copies of diagram and export controls before mounting live ones. The loading preview's source button now toggles between Show code and Hide code.
- Integrate conversation export and reply PDF actions into the current native toolbars, including the export button's rectangular hover with 8 px corners. Follow the updated light/dark theme and keep the diagram editor inside the conversation viewport, beside the sidebar.
- Match native tooltip typography, spacing, colors and rounded corners. Use a compact icon for reply PDF export and hide it while that reply streams.
- Redesign the export dialog around a larger preview, separate message selection and source views, and collapsed advanced options. Preview transcripts on opening, keep selection counts visible and prevent empty exports. Full-conversation PDF capture still starts explicitly because it scrolls the page.
- Make Content a role filter: Conversation, Answers only or Prompts only. Transcript options remain independent, with existing preferences preserved.
- Match the editor's icon tooltips and header hover styles to ChatGPT. Correct the Command shortcut icon's proportions.
- Load PDF history correctly in ChatGPT's reversed scroll container, capture messages in chronological order and restore the starting scroll position. Preserve readable prompt bubbles and code in the PDF preview.
- Recover extension controls removed by page updates, retain compiled diagrams and local edits through PDF printing, and retry temporary diagram-readiness failures during history capture.

For an unpacked installation, reload the extension at `chrome://extensions`, verify **1.5.2**, then reload ChatGPT. Keep only one LaTeX Islands installation enabled to avoid duplicate controls. Store installations receive updates after store approval.
