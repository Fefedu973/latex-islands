# Store assets

Actual product UI captured at 1280 × 800 using the bundled optics example and the synthetic RC conversation fixture. No private conversation or account data is included.

- `editor-1280x800.png`: local editor in dark mode, real TeX output.
- `export-1280x800.png`: export dialog with production UI and synthetic conversation data.
- `promo-440x280.png`: promotional tile, rendered from `promo.html`.
- Store icon: `../../icons/128.png`.

To reproduce, run `node tests/preview-server.cjs`, visit `/demo.html` and `/tests/export-preview.html`, set a 1280 × 800 viewport, and capture the content area. The promo uses a 440 × 280 element capture. These previews exercise local product UI; they do not establish store approval or live ChatGPT API compatibility.
