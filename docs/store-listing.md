# Store listing drafts — 1.4.0

These are submission materials, not a claim that either store has published or approved the extension. Use the browser-specific build. The repository URL is https://github.com/Fefedu973/latex-islands. Privacy policy: https://github.com/Fefedu973/latex-islands/blob/main/PRIVACY.md. Check that public URLs resolve before entering them into a store dashboard.

## Texte français prêt à coller

### Nom

LaTeX Islands — TikZ & Export pour ChatGPT

### Description courte

Affichez vos schémas TikZ dans ChatGPT et exportez les conversations en Markdown, texte ou JSON.

### Description détaillée

Rendez vos conversations techniques ChatGPT plus faciles à lire et à réutiliser.

LaTeX Islands affiche directement les schémas TikZ, Circuitikz, PGFPlots, tikz-cd, Chemfig et TikZ-3DPlot pris en charge dans les réponses ChatGPT. Zoomez, déplacez le dessin, modifiez son code dans un éditeur plein écran et téléchargez le résultat en PNG ou SVG. Le moteur TeX WebAssembly est inclus dans l’extension : la compilation reste sur votre appareil, sans service de compilation distant. Un indicateur apparaît pendant la rédaction de la réponse ; le rendu commence dès que le bloc de schéma est prêt.

Exportez aussi la conversation ouverte en Markdown, texte brut ou archive JSON complète. Choisissez le dialogue, le contexte détaillé ou les réponses uniquement, puis ajustez les options : vos messages, références des pièces jointes, sources et citations, dates, étapes intermédiaires et outils. Vérifiez le résultat dans les vues Dialogue et Fichier avant de copier ou télécharger. Le code et les formules LaTeX sont conservés dans l’export. Dans l’aperçu d’export, les formules restent sous forme de source TeX. Les pièces jointes sont mentionnées ou liées ; leurs fichiers ne sont pas intégrés.

L’export est déclenché par votre action. Il relit les pages de la conversation auprès de ChatGPT avec votre session connectée, puis prépare le fichier localement. L’authentification et l’identifiant de la conversation sont utilisés uniquement pour ces requêtes à ChatGPT. Aucun contenu de conversation n’est envoyé au développeur. L’extension ne comporte ni statistiques d’usage, ni publicité, ni serveur du développeur.

L’interface est en français. Elle propose les apparences claire, sombre, système ou le dernier thème ChatGPT observé. Les schémas peuvent s’adapter au thème ou conserver leurs couleurs LaTeX sur fond blanc, y compris dans les exports.

LaTeX Islands est un outil pour schémas, pas une distribution complète de TeX. Les fichiers externes et les packages absents ne sont pas pris en charge. L’API interne de ChatGPT peut évoluer et nécessiter une mise à jour de l’export.

Projet indépendant et open source, sans affiliation ni approbation d’OpenAI, Google ou Mozilla.

### Usage unique — Chrome

Améliorer la lecture et la réutilisation du contenu technique de la conversation ChatGPT ouverte : rendre ses schémas LaTeX localement et permettre son export à la demande dans un format lisible ou archivable. Les deux fonctions sont limitées au contenu ChatGPT et décrites dans l’interface.

### Justifications des permissions — français

- **storage** : conserver localement les réglages d’affichage et d’export ainsi que le dernier code de l’éditeur autonome, sans enregistrer les conversations exportées ni les jetons de session.
- **offscreen, Chrome uniquement** : héberger un moteur TeX local partagé entre les onglets pour préparer, compiler et mettre en cache les schémas sans ouvrir un onglet auxiliaire visible.
- **clipboardWrite, Firefox uniquement** : exécuter l’action Copier après la récupération asynchrone des pages de la conversation, lorsque l’activation initiale du clic n’est plus disponible. L’extension écrit le résultat demandé ; elle ne lit pas le presse-papiers.
- **Accès à chatgpt.com et chat.openai.com** : détecter les schémas dans les réponses, ajouter les contrôles et récupérer la conversation ouverte lorsque l’utilisateur demande un aperçu, une copie ou un téléchargement. Aucun accès aux autres sites.
- **wasm-unsafe-eval dans la CSP** : exécuter le moteur TeX WebAssembly fourni dans le paquet. Aucun code distant n’est téléchargé.

### Déclaration de données — Firefox

Le paquet Firefox déclare **authenticationInfo** et **browsingActivity**. À la demande d’export, il utilise la session ChatGPT existante et transmet à ChatGPT l’identifiant de la conversation ainsi que les curseurs de pagination. Le contenu reçu est transformé localement. Aucun contenu de conversation ni jeton n’est envoyé au développeur. Firefox desktop 140 ou ultérieur est requis pour présenter ces déclarations dans son interface de consentement.

## English copy

### Name

LaTeX Islands — TikZ & Export pour ChatGPT

### Short description

Render TikZ diagrams locally in ChatGPT and export readable conversations as Markdown, text or JSON.

### Detailed description

Make technical ChatGPT conversations easier to read and reuse.

LaTeX Islands renders supported TikZ, Circuitikz, PGFPlots, tikz-cd, Chemfig and TikZ-3DPlot code blocks directly in ChatGPT replies. Zoom, drag, edit in a full-screen view and download PNG or SVG. A bundled WebAssembly TeX engine compiles diagrams locally, with no external compilation service. A loading indicator appears while a reply is being written, and rendering starts when a diagram block is ready.

The extension also exports the open conversation as Markdown, plain text or a complete JSON archive. Choose a dialogue, detailed context, or answers only; adjust individual options for user messages, attachment references, citations, timestamps and tool information. Preview the dialogue or file before copying or downloading. Code and LaTeX equations are preserved in exports; equations remain TeX source in the export preview. Attachment files are not embedded.

Export is user-initiated. It reads the current conversation's pages from ChatGPT using your existing signed-in session, then prepares the file on your device. Authentication information and the current conversation identifier/cursors are sent only to ChatGPT for those requests. There is no analytics, developer backend, advertising, or upload of conversations to the maintainer.

The interface is currently French. It supports light/dark/system appearance and the last observed ChatGPT theme, plus either adapted diagram colors or original LaTeX colors on white. This is a diagram renderer rather than a full TeX document editor. Missing packages and external files are not supported. ChatGPT's internal API may change and temporarily affect exports.

Independent open-source project; not affiliated with or endorsed by OpenAI, Google or Mozilla.

## Chrome single-purpose statement

Improve the readability and reuse of technical content in the current ChatGPT conversation: render its LaTeX diagrams locally and let the user export that conversation in readable or archival formats. Both functions are confined to ChatGPT content and are described in the listing and UI.

## Permission justifications

| Permission / access | Purpose |
| --- | --- |
| `storage` | Save rendering/theme/export preferences and the standalone editor's last source locally. Does not persist exported conversations or tokens. |
| `offscreen` — Chrome only | Keep one local TeX worker in an extension-owned document shared by tabs. Allows prewarming, serial compilation, caching and timeout recovery without a visible helper tab. |
| `clipboardWrite` — Firefox only | Complete the user's Copy action after asynchronous conversation retrieval has outlived transient click activation. Writes the requested export only; does not read the clipboard. |
| `https://chatgpt.com/*`, `https://chat.openai.com/*` | Detect diagrams in assistant replies, add preview/export controls and retrieve the current conversation when requested. No access to unrelated websites. |
| `wasm-unsafe-eval` in extension CSP | Compile and run the packaged TeX WebAssembly module. No remote executable code is fetched. |

The Firefox build uses an extension background page for the engine rather than the Chrome-only offscreen API. There are no cookies, history, webRequest, unrelated-host, or broad all-sites API permissions. Existing session cookies accompany same-origin page requests without requesting the cookies API.

## Privacy declarations

Do not declare the entire extension offline or claim that it never transmits data. It processes conversation text locally and makes authenticated same-origin export requests. Describe website content/personal communications handled locally, authentication information used for those requests, and the current conversation identifier as browsing-related information; the developer receives none of these data.

The Firefox manifest declares required `authenticationInfo` and `browsingActivity`, with desktop minimum version 140. The transmission is the current conversation URL/identifier/cursors and existing authentication, sent to ChatGPT as part of the requested export. There is no telemetry category. See [Mozilla's data-consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/) and the [project privacy policy](../PRIVACY.md).

For Chrome, accurately complete the current dashboard's data-handling questions using the policy above. Local-only processing still requires an accurate privacy policy. See [Chrome's user-data guidance](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) and [disclosure requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements).

## Reviewer notes

- Compile included examples from the popup's standalone editor without a ChatGPT account. Use the packaged engine; no TeX installation or compilation server is required.
- ChatGPT integration and live conversation export require a signed-in ChatGPT account. No credentials are embedded in the extension or public source. Provide any store-requested test access only through the store's private reviewer channel.
- The export dialog explains that it reads ChatGPT with the user's session and prepares a local export. All previous pages must load successfully before a download is produced.
- HTML from conversations is not executed in the preview. Attachment images are not automatically downloaded. The isolated/page bridge restricts the origin, conversation, request path and parameters.
- Attach the corresponding source ZIP and [reviewer build notes](reviewer-build.md). The local hardened worker differs from upstream: arbitrary URL input fallback is removed, asset paths are restricted, and an unused dynamic-function fallback is removed. Do not describe this as an unmodified vendor library.
- Mozilla's [development policy](https://extensionworkshop.com/documentation/publish/add-on-policies/#development-practices) restricts modifications to third-party libraries. The hardened worker and compiled TeX artifacts therefore need explicit reviewer evaluation; supplied sources and a successful lint result do not guarantee acceptance. Full upstream TeX-core reproduction has not been established; see the source notes.

## Listing assets

Use the included monochrome icon and screenshots made with synthetic conversations or the shipped examples: inline diagram, standalone editor, and configurable export preview. Do not upload private conversations, account identifiers or local machine paths. Add store URLs to the README only once the listings actually exist.
