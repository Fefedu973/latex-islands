# LaTeX Islands 1.5.4

- Recover discarded diagram documents during navigation, with a bounded retry and access to the source if another script keeps replacing the frame. Check the private connection after a document reload and keep drafts tied to their original message.
- Zoom inline diagrams around the pointer after clicking or keyboard-focusing their preview. Leave the preview or press Escape to return to conversation scrolling.
- Add **Ask ChatGPT to fix** to compilation errors. It appends the failed code and error to the composer, preserves an existing draft and waits for the user to send the message.
- Preserve PDF previews when stale conversation controls are cleaned up.
- Add local technical details to connection errors. The bounded report excludes conversation URLs, message identifiers, source code and compiler content. It is copied only through **Copy diagnostics**.

Includes the September ChatGPT integration and export/editor updates described in [1.5.2](release-1.5.2.md).

The reported repeated interruption was reproduced in an automation-controlled Chrome tab, where an external writer added `srcdoc` before the renderer loaded. The user confirmed normal navigation in a fresh tab outside that control. This build preserves origin and connection checks; it does not override browser automation protections.

Reload the unpacked extension, verify **1.5.4**, then reload ChatGPT.
