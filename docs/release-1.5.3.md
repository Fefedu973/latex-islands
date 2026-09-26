# LaTeX Islands 1.5.3

- Recover a diagram when its iframe document is replaced during conversation navigation. Recreate it from the extension's known URL once, then offer Retry if the connection is lost again. Keep strict origin, document and message-channel validation.
- Zoom inline diagrams with the mouse wheel after clicking or keyboard-focusing their preview. Zoom follows the pointer. Leaving the preview or pressing Escape restores normal conversation scrolling.
- Add **Ask ChatGPT to fix** to compilation errors in ChatGPT. It appends the failed code and error to the composer, preserves an existing draft and never sends the message automatically.
- Preserve the PDF preview when conversation controls are refreshed.

Includes the September ChatGPT integration and export/editor updates described in [1.5.2](release-1.5.2.md).

For an unpacked installation, reload the extension at `chrome://extensions`, verify **1.5.3**, then reload ChatGPT.
