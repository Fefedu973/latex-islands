# LaTeX Islands 1.4.2

- Fix missing labels and square glyphs on the first diagram render. Required TeX fonts load before the SVG appears, and dark-mode filtering no longer shares the transformed HTML layer that could retain incomplete text until hover.
- Match ChatGPT's menu triggers, dropdowns and blue switches across export options, the popup and the standalone editor. Controls support keyboard navigation and follow the selected theme.
- Match the conversation export button's hover shape and tooltip to the surrounding header controls. Match the native dialog close button's 36-pixel size, 8-pixel corner radius, centered 20-pixel icon and theme colors.
- Keep the diagram editor within the conversation area, leaving the sidebar visible and adjusting when the sidebar or window resizes.
- Use the full available height for standalone previews, with zoom and menu controls anchored at the top. Standalone fullscreen shows only the diagram; ChatGPT's integrated editor retains its code pane.
- Zoom around the mouse pointer with the wheel in editor and fullscreen views while keeping normal conversation scrolling over inline ChatGPT previews.
- Show a temporary checkmark after copying code, remove the code field's focus border, render the Command shortcut as a square icon and add an Update button hover state.
- Align export labels and menu triggers on the same row, modernize the transcript disclosure and remove redundant status text from extension pages.
- Show export progress as a spinner in the active button, without fetching or success messages in the footer; retain actionable errors and cancellation.
- Group diagram errors, retry and source actions in a compact centered panel, with expandable details for long logs. Remove the white focus outline from inline diagram previews.
- Reveal inline zoom and menu controls on hover or keyboard interaction; keep controls visible on touch devices and while the menu is open.
- Fix iframe origin errors by waiting for the verified diagram document to establish a dedicated message channel. Reconnect after reload or back/forward cache restoration, and stop sending to detached diagrams.

The locally signed Chrome `.crx` is a development distribution with its own signing identity. It is not signed by the Chrome Web Store and does not replace a store installation automatically. Chrome on Windows/macOS restricts installations outside the store. The private signing key is kept outside the repository and release packages.

For an existing unpacked Chrome installation, replace the files in its installation folder with the new Chrome ZIP, click **Reload** on its card at `chrome://extensions`, then reload open ChatGPT tabs. Check that the extension card shows **1.4.2**. Reloading ChatGPT alone does not update an unpacked extension's files.

The Firefox ZIP is an unsigned developer package; persistent installation requires Mozilla signing.
