# LaTeX Islands 1.5.1

- Restore inline diagrams in the September 2026 ChatGPT web interface, including its new message structure and code widgets. Previous ChatGPT layouts remain supported during the rollout.
- Show a loading preview while code streams and start rendering when a diagram closes, even if the answer continues. Recognize the new composer stop control.
- Replace existing code blocks with a loader before the diagram frame initializes. Keep the previous preview height during re-rendering and preserve access to the source if loading fails.
- Integrate conversation export and reply PDF actions into the current native toolbars, including the export button's rectangular hover with 8 px corners. Follow the updated light/dark theme and keep the diagram editor inside the conversation viewport, beside the sidebar.
- Load PDF history correctly in ChatGPT's reversed scroll container, capture messages in chronological order and restore the starting scroll position. Preserve readable prompt bubbles and code in the PDF preview.
- Recover extension controls removed by page updates, retain compiled diagrams and local edits through PDF printing, and retry temporary diagram-readiness failures during history capture.

For an unpacked installation, reload the extension at `chrome://extensions`, verify **1.5.1**, then reload ChatGPT. Keep only one LaTeX Islands installation enabled to avoid duplicate controls. Store installations receive updates after store approval.
