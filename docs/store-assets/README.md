# Store assets

English-language assets for release **1.4.1**. Product screenshots use the bundled optics example and a synthetic RC conversation. No private conversation or account data is included.

- `editor-1280x800.png`: local editor in dark mode, real TeX output.
- `export-1280x800.png`: export dialog with production UI and synthetic English conversation data.
- `promo-440x280.png`: English promotional tile, rendered from `promo.html`.
- Store icon: `../../icons/128.png`.

## Reproduce the captures

Run `node tests/preview-server.cjs` and use a browser test profile:

1. Open `/demo.html`, select **Dark** and **TikZ · converging lens**, and wait for the diagram to finish rendering. Capture the content area at a 1280 × 800 viewport.
2. Open `/tests/export-preview.html` and use the production export button to open the conversation preview. Capture the dialog at a 1280 × 800 viewport.
3. Open `/docs/store-assets/promo.html` and capture its `main` element at exactly 440 × 280 pixels.

The editor and synthetic fixtures are in English. The editor uses the bundled TeX engine; the export preview uses the synthetic conversation fixture. These captures do not establish store approval or live ChatGPT API compatibility. Save new captures under the same filenames when changing the visible interface.
