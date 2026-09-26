/* SPDX-License-Identifier: GPL-3.0-or-later */
(() => {
  'use strict';
  if (globalThis.LatexIslandsPDF) return;
  const chatgpt = globalThis.LatexIslandsChatGPT;
  const OWN = '.li-export, .li-export-reply, .latex-islands-editor';
  const OMIT = 'script, style, link, meta, base, iframe, object, embed, form, input, textarea, select, button, dialog, nav, [role="button"], [role="toolbar"], [role="menu"], [contenteditable="true"], [data-testid="composer"], [data-markdown-copy="exclude"], h4[data-conversation-role], .li-export, .li-export-reply, .latex-islands-editor, animate, animateMotion, animateTransform, set';
  const ASSET_TIMEOUT = 15000;
  const HISTORY_TIMEOUT = 600000, MAX_SCROLL_STEPS = 2000;
  const MAX_CAPTURE_RETRIES = 2;
  const transientCaptureError = message => /still loading|still rendering|not ready|wait for .*render|finish rendering|did not finish loading|diagram is unavailable/i.test(message || '');
  const captures = new WeakMap(), elementKeys = new WeakMap(), copyVersions = new WeakMap();
  let sequence = 0, activePrint = null;
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
  const aborted = () => new DOMException('PDF export cancelled.', 'AbortError');
  function check(signal) { if (signal?.aborted) throw aborted(); }
  function bounded(promise, signal, message) {
    check(signal);
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); callback(value); };
      const cancel = () => finish(reject, aborted());
      const timer = setTimeout(() => finish(reject, Error(message)), ASSET_TIMEOUT);
      signal?.addEventListener('abort', cancel, {once:true});
      Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
    });
  }
  function visible(element) {
    // KaTeX deliberately hides its visual HTML from assistive technology. It is
    // still the part that must print; MathML is kept but visually hidden below.
    if (element.closest('.katex, mjx-container, math, svg')) return true;
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const css = getComputedStyle(element);
    return css.display !== 'none' && css.visibility !== 'hidden' && css.visibility !== 'collapse';
  }
  function url(value, image = false) {
    if (!value) return null;
    try {
      if (value.startsWith('#')) return value;
      const parsed = new URL(value, document.baseURI);
      if (['http:', 'https:'].includes(parsed.protocol)) return parsed.href;
      if (!image && (value.startsWith('#') || parsed.protocol === 'mailto:')) return value;
      if (image && (parsed.protocol === 'blob:' || /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)(?:;|,)/i.test(value))) return value;
    } catch {}
    return null;
  }
  function lightNeutral(value) {
    const color = String(value || '').trim().toLowerCase();
    const rgb = color.match(/^rgba?\(([^)]+)\)$/), srgb = color.match(/^color\(srgb\s+([^)]+)\)$/);
    if (!rgb && !srgb) return false;
    const parts = (rgb || srgb)[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return false;
    const channels = parts.slice(0, 3).map(part => parseFloat(part) * (part.endsWith('%') ? 2.55 : srgb ? 255 : 1));
    const alpha = parts[3] == null ? 1 : parseFloat(parts[3]) / (parts[3].endsWith('%') ? 100 : 1);
    return channels.every(Number.isFinite) && alpha > 0 && Math.min(...channels) >= 128 && Math.max(...channels) - Math.min(...channels) <= 24;
  }
  function attributes(source, clone) {
    for (const {name, value} of [...clone.attributes]) {
      const lower = name.toLowerCase();
      if (lower.startsWith('on') || ['srcdoc', 'srcset', 'sizes', 'autofocus', 'tabindex', 'contenteditable', 'nonce', 'integrity', 'ping', 'download', 'popover', 'data-latex-islands-hidden'].includes(lower)) clone.removeAttribute(name);
      else if (['href', 'xlink:href', 'src', 'poster', 'action', 'formaction', 'background'].includes(lower)) {
        const safe = url(value, lower === 'src' || lower === 'poster' || source.localName === 'image');
        if (safe) clone.setAttribute(name, safe); else clone.removeAttribute(name);
      } else if (lower !== 'style' && /url\s*\(/i.test(value) && !/^url\(\s*['"]?#[\w:.-]+['"]?\s*\)$/.test(value)) clone.removeAttribute(name);
    }
    // Preserve geometry used by native math while excluding CSS resource loads.
    for (const property of Array.from(clone.style || [])) {
      const value = clone.style.getPropertyValue(property).replace(/url\(\s*['"]?#[\w:.-]+['"]?\s*\)/g, '');
      if (/url\s*\(|expression\s*\(|@import|behavior|javascript:/i.test(value)) clone.style.removeProperty(property);
    }
    // A copied HTML theme boundary must not reintroduce dark paper surfaces.
    // SVG paint is captured from the live source separately and stays intact.
    if (source.namespaceURI === 'http://www.w3.org/1999/xhtml' && /^(dark|light|system)$/.test(clone.getAttribute('data-theme') || '')) clone.setAttribute('data-theme', 'light');
    if (clone.localName === 'a') { clone.setAttribute('rel', 'noopener noreferrer'); clone.removeAttribute('target'); }
    if (clone.localName === 'img') {
      const src = url(source.currentSrc || source.getAttribute('src'), true);
      if (!src) throw Error('An image in this reply cannot be included safely in the PDF.');
      clone.src = src; clone.loading = 'eager'; clone.decoding = 'sync';
    }
    if (clone.localName === 'image' && !url(source.getAttribute('href') || source.getAttribute('xlink:href'), true)) throw Error('An SVG image in this reply cannot be included safely in the PDF.');
    let svg = source.closest('svg');
    while (svg?.parentElement?.closest('svg')) svg = svg.parentElement.closest('svg');
    const math = source.closest('.katex, mjx-container, math');
    const paperText = !svg || (math && math.contains(svg));
    const css = source.isConnected && clone.style ? getComputedStyle(source) : null;
    if (svg && css) {
      // Mermaid and native SVG charts may have a <style> scoped to their live
      // ID. Keep bounded computed paint/type properties before changing IDs,
      // without copying executable markup or globally effective CSS rules.
      for (const property of ['color','fill','fill-opacity','fill-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','stroke-opacity','opacity','font-family','font-size','font-weight','font-style','letter-spacing','text-anchor','dominant-baseline','paint-order','marker-start','marker-mid','marker-end','background-color','clip-path','mask','filter','transform','transform-origin','transform-box']) {
        let value = css.getPropertyValue(property);
        if (!value) continue;
        value = value.replace(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g, (match, target) => {
          try { const parsed = new URL(target, document.baseURI); if (parsed.hash && parsed.href.split('#')[0] === document.URL.split('#')[0]) return 'url(' + parsed.hash + ')'; } catch {}
          return match;
        });
        if (!/url\s*\(/i.test(value.replace(/url\(#[\w:.-]+\)/g, ''))) clone.style.setProperty(property, value);
      }
    }
    // Host typography can set pale ink on each assistant wrapper (including
    // local theme variables and !important rules), overriding the paper root.
    // Normalize only light neutral text, retaining semantic colors and all
    // standalone diagram paint. Native math SVGs are text, not diagrams.
    if (paperText && css) {
      for (const property of ['color', '-webkit-text-fill-color', ...(svg ? ['fill', 'stroke'] : [])]) {
        if (lightNeutral(css.getPropertyValue(property))) clone.style.setProperty(property, '#171717', 'important');
      }
    }
    if (source.localName === 'svg' && !source.parentElement?.closest('svg')) {
      // Large native diagrams need an intrinsic ratio to shrink onto paper.
      // Preserve transforms on their children, but constrain the outer viewport.
      const box = (source.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      const size = name => /^\d+(?:\.\d+)?(?:px)?$/.test(source.getAttribute(name) || '') ? parseFloat(source.getAttribute(name)) : source.getBoundingClientRect()[name];
      const width = box.length === 4 && box[2] > 0 ? box[2] : size('width');
      const height = box.length === 4 && box[3] > 0 ? box[3] : size('height');
      if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
        if (!source.hasAttribute('viewBox')) clone.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        clone.style.width = width + 'px'; clone.style.aspectRatio = width + ' / ' + height;
      }
      clone.style.setProperty('max-width', '100%', 'important'); clone.style.setProperty('height', 'auto', 'important');
      clone.style.setProperty('max-height', '180mm', 'important');
    }
  }
  function diagramImage(snapshot) {
    const width = Number(snapshot.width), height = Number(snapshot.height);
    if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)) || !/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(snapshot.svg || '')) throw Error('A LaTeX Island has no valid rendered size. Render it again before exporting.');
    const figure = make('figure', 'li-pdf-island'), image = make('img', 'li-pdf-island-image');
    image.alt = 'LaTeX diagram'; image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(snapshot.svg);
    image.width = width; image.height = height;
    image.style.width = width + 'px'; image.style.height = 'auto';
    image.style.maxWidth = '100%'; image.style.maxHeight = '180mm'; image.style.objectFit = 'contain';
    figure.append(image); return figure;
  }
  function rawDiagram(element, snapshot) {
    const tokens = globalThis.LatexIslandsCore?.splitIslands(element.textContent);
    if (!tokens || tokens.filter(token => token.type === 'latex').length !== 1) return diagramImage(snapshot);
    const wrapper = make('div', 'li-pdf-raw-island'), positions = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let offset = 0, text;
    while ((text = walker.nextNode())) { positions.push({node:text, start:offset, end:offset + text.length}); offset += text.length; }
    for (const token of tokens) {
      if (token.type === 'latex') { wrapper.append(diagramImage(snapshot)); continue; }
      if (!token.value) continue;
      // DOM ranges preserve emphasis, native math, and links in the prose on
      // either side, even when the TeX itself spans several text nodes.
      const first = positions.find(position => position.end > token.start), last = positions.find(position => position.end >= token.end);
      if (!first || !last) continue;
      const range = document.createRange(); range.setStart(first.node, token.start - first.start); range.setEnd(last.node, token.end - last.start);
      const fragment = range.cloneContents(), prose = make('div', 'li-pdf-raw-text');
      for (const child of fragment.childNodes) { const copy = cloneContent(child, new Map(), new Set()); if (copy) prose.append(copy); }
      wrapper.append(prose);
    }
    return wrapper;
  }
  function cloneContent(element, replacements, removed) {
    if (element.nodeType === Node.TEXT_NODE) return document.createTextNode(element.data);
    if (element.nodeType !== Node.ELEMENT_NODE) return null;
    if (replacements.has(element)) return element.matches('pre, code, .katex-error, [data-markdown-copy="code-block"]') ? diagramImage(replacements.get(element)) : rawDiagram(element, replacements.get(element));
    const containsDiagram = [...replacements.keys()].some(source => element.contains(source));
    if (element.matches('button, [role="button"]') && !element.closest('[role="toolbar"], nav, ' + OWN) && visible(element) && !removed.has(element)) {
      // Generated pictures open a viewer through a button-shaped card. Preserve
      // its actual images, without copying the viewer trigger or action icons.
      const images = [...element.querySelectorAll('img')];
      if (images.length) {
        const figure = make('figure', 'li-pdf-media');
        for (const image of images) { const copy = cloneContent(image, replacements, removed); if (copy) figure.append(copy); }
        return figure.childNodes.length ? figure : null;
      }
    }
    if (removed.has(element) || element.matches(OMIT) || (!visible(element) && !containsDiagram)) return null;
    if (element.matches('.latex-islands-container')) throw Error('A LaTeX Island is not ready. Finish rendering it before exporting.');
    if (element.localName === 'canvas') {
      const image = make('img');
      try { image.src = element.toDataURL('image/png'); } catch { throw Error('A canvas in this reply cannot be read for PDF export.'); }
      image.alt = element.getAttribute('aria-label') || 'Chart'; image.width = element.width; image.height = element.height; return image;
    }
    // ChatGPT code widgets may use nested <pre>s or a plain <code> in a div.
    // Retain the actual highlighted code and CodeMirror line boundaries only.
    if (element.matches('pre, [data-markdown-copy="code-block"]') && !containsDiagram && !element.closest('pre pre')) {
      const content = element.querySelector('.cm-content, code');
      if (content) {
        const pre = make('pre'), code = make('code');
        const lines = [...content.querySelectorAll('.cm-line')];
        if (lines.length) code.textContent = lines.map(line => line.textContent).join('\n');
        else for (const child of content.childNodes) { const copy = cloneContent(child, replacements, removed); if (copy) code.append(copy); }
        pre.append(code); return pre;
      }
    }
    const clone = element.cloneNode(false);
    attributes(element, clone);
    if (containsDiagram && !visible(element)) { clone.removeAttribute('hidden'); clone.classList.remove('latex-islands-original-hidden'); clone.style.setProperty('display', 'block', 'important'); }
    for (const child of element.childNodes) { const copy = cloneContent(child, replacements, removed); if (copy) clone.append(copy); }
    return clone;
  }
  function uniqueIds(root, prefix) {
    let number = 0;
    const global = new Map(), scopes = new Map();
    for (const element of root.querySelectorAll('[id]')) {
      const scope = element.closest('svg') || root;
      if (!scopes.has(scope)) scopes.set(scope, new Map());
      const id = prefix + (++number), old = element.id;
      scopes.get(scope).set(old, id); if (!global.has(old)) global.set(old, id);
      element.id = id;
    }
    for (const element of root.querySelectorAll('*')) {
      const ids = scopes.get(element.closest('svg') || root) || global;
      for (const {name, value} of [...element.attributes]) {
        let next = value;
        if (['href', 'xlink:href'].includes(name) && value.startsWith('#')) next = '#' + (ids.get(value.slice(1)) || global.get(value.slice(1)) || value.slice(1));
        else if (['aria-labelledby', 'aria-describedby', 'headers'].includes(name)) next = value.split(/\s+/).map(id => ids.get(id) || global.get(id) || id).join(' ');
        else next = value.replace(/url\(\s*(['"]?)#([\w:.-]+)\1\s*\)/g, (_, quote, id) => 'url(#' + (ids.get(id) || global.get(id) || id) + ')');
        if (next !== value) element.setAttribute(name, next);
      }
    }
  }
  async function imageReady(image, signal) {
    check(signal);
    if (typeof image.decode === 'function') {
      await bounded(image.decode(), signal, 'An image did not finish loading. Wait for it to load and try the PDF export again.');
      if (!image.naturalWidth) throw Error('An image failed to load for PDF export.');
      return;
    }
    if (image.complete) { if (!image.naturalWidth) throw Error('An image failed to load for PDF export.'); return; }
    let loaded, failed;
    try {
      await bounded(new Promise((resolve, reject) => {
        loaded = () => image.naturalWidth ? resolve() : reject(Error('An image failed to load for PDF export.'));
        failed = () => reject(Error('An image failed to load for PDF export.'));
        image.addEventListener('load', loaded, {once:true}); image.addEventListener('error', failed, {once:true});
      }), signal, 'An image did not finish loading. Wait for it to load and try the PDF export again.');
    } finally { image.removeEventListener('load', loaded); image.removeEventListener('error', failed); }
  }
  function stylesheet(id) {
    return `
#${id} { display:none !important; }
#${id} { --text-primary:#171717; --text-secondary:#555; --text-tertiary:#666; --bg-primary:#fff; --bg-secondary:#f5f5f5; --border-light:#ddd; --border-default:#ccc; --tw-prose-body:#171717; --tw-prose-headings:#171717; --tw-prose-bold:#171717; --tw-prose-code:#171717; --tw-prose-links:#171717; color-scheme:light; color:#171717; background:#fff; font:11pt/1.55 system-ui,sans-serif; text-align:left; }
#${id}, #${id} .li-pdf-content [data-theme]:not(svg *) { --color-text-primary:#171717; --color-text-secondary:#555; --color-text-tertiary:#666; --color-surface-base:#fff; --color-surface-primary:#fff; --color-surface-secondary:#f5f5f5; --color-surface-tertiary:#eee; --color-surface-elevated:#fff; --color-surface-elevated-secondary:#f5f5f5; --color-surface-hover:#eee; --color-token-main-surface-primary:#fff; --color-border-subtle:#ddd; --color-border-default:#ccc; color-scheme:light; }
#${id} .li-pdf-title { font-size:20pt; line-height:1.25; margin:0 0 18pt; font-weight:650; }
#${id} .li-pdf-message { margin:0 0 20pt; padding:0; break-inside:auto; }
#${id} .li-pdf-role { font-size:9pt; font-weight:650; color:#555; margin:0 0 7pt; padding-top:10pt; border-top:1px solid #ddd; break-after:avoid; }
#${id} .li-pdf-content { font-size:11pt; line-height:1.55; }
#${id} .li-pdf-content [data-user-message-bubble]:not(svg *) { color:#171717 !important; background:#f5f5f5 !important; border-color:#ddd !important; }
#${id} .li-pdf-content :is(div, section, article):not(svg *) { max-width:100% !important; max-height:none !important; height:auto !important; overflow:visible !important; position:static !important; }
#${id} .li-pdf-content :is(p, ul, ol, blockquote, pre, table) { margin-top:8pt; margin-bottom:8pt; }
#${id} .li-pdf-content :is(h1,h2,h3,h4,h5,h6) { break-after:avoid; }
#${id} .li-pdf-content :is(p,li) { orphans:3; widows:3; }
#${id} .li-pdf-content pre { white-space:pre-wrap !important; overflow-wrap:anywhere; word-break:normal; max-width:100% !important; height:auto !important; max-height:none !important; overflow:visible !important; padding:9pt; border:1px solid #ddd; border-radius:5pt; background:#f7f7f7 !important; color:#171717 !important; font-size:9pt; break-inside:auto; }
#${id} .li-pdf-content pre * { white-space:pre-wrap !important; color:#171717 !important; background:transparent !important; }
#${id} .li-pdf-content table { width:100% !important; max-width:100% !important; table-layout:fixed; border-collapse:collapse; }
#${id} .li-pdf-content :is(th,td) { overflow-wrap:anywhere; padding:6pt; border:1px solid #ddd; }
#${id} .li-pdf-content thead { display:table-header-group; }
#${id} .li-pdf-content tr { break-inside:avoid; }
#${id} .li-pdf-content :is(img,canvas) { max-width:100% !important; height:auto; object-fit:contain; break-inside:avoid; }
#${id} .li-pdf-content svg:not(svg svg) { display:block; max-width:100% !important; height:auto !important; max-height:180mm !important; break-inside:avoid; }
#${id} .li-pdf-island { display:block; max-width:100%; margin:12pt 0; padding:0; break-inside:avoid; page-break-inside:avoid; }
#${id} .li-pdf-raw-text { white-space:pre-wrap; }
#${id} .li-pdf-island-image { display:block; max-width:100% !important; max-height:180mm !important; height:auto !important; object-fit:contain; margin:0 auto; }
#${id} .katex-mathml, #${id} mjx-assistive-mml { display:none !important; }
#${id} :is(.katex-display, mjx-container[display="true"]) { max-width:100%; overflow:visible !important; break-inside:avoid; }
#${id}.li-pdf-preview { display:block !important; box-sizing:border-box; width:210mm; max-width:100%; padding:16mm; margin:0 auto; }
@media print {
  @page li-pdf-export { size:A4; margin:16mm; }
  html:has(body.li-pdf-printing), body.li-pdf-printing { display:block !important; height:auto !important; min-height:0 !important; max-height:none !important; overflow:visible !important; position:static !important; width:auto !important; margin:0 !important; padding:0 !important; background:#fff !important; }
  body.li-pdf-printing > :not(.li-pdf-active) { display:none !important; }
  body.li-pdf-printing > #${id}.li-pdf-active { display:block !important; page:li-pdf-export; position:static !important; float:none !important; width:100% !important; max-width:none !important; height:auto !important; margin:0 !important; padding:0 !important; overflow:visible !important; contain:none !important; box-shadow:none !important; border:0 !important; }
  body.li-pdf-printing :is(dialog, [popover]), body.li-pdf-printing ::backdrop { display:none !important; }
  #${id}, #${id} * { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
  #${id} :is(.li-pdf-content, .markdown, .prose) { color:#171717 !important; background:#fff !important; --tw-prose-body:#171717; --tw-prose-headings:#171717; --tw-prose-bold:#171717; --tw-prose-code:#171717; --tw-prose-links:#171717; }
  #${id} a { color:inherit !important; text-decoration:underline; }
  #${id} a::after { content:none !important; }
}`;
  }
  function hasIsland(element) {
    if (element.querySelector('.latex-islands-container, .latex-islands-original-hidden')) return true;
    const core = globalThis.LatexIslandsCore;
    return Boolean(core && [...element.querySelectorAll('pre, code, .katex-error')].some(node => core.detectKind(node.getAttribute('data-latex') || node.textContent)));
  }
  function pageMessages() {
    return chatgpt.getMessages().filter(element => !element.closest(OWN));
  }
  function messageKey(element) {
    const id = chatgpt.messageId(element);
    if (id) return 'message:' + id;
    if (!elementKeys.has(element)) elementKeys.set(element, 'dom:' + (++sequence));
    return elementKeys.get(element);
  }
  function mediaSignature(element) {
    return [...element.querySelectorAll('img, svg, canvas, .latex-islands-container')].map(node => node.localName === 'img' ? (node.currentSrc || node.getAttribute('src') || '') + ':' + node.naturalWidth : node.outerHTML).join('|');
  }
  function messageText(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node, text = '';
    // The host loader changes while the iframe connects; it is extension UI,
    // not a streamed change to the user's actual message or source code.
    while ((node = walker.nextNode())) if (!node.parentElement?.closest(OMIT + ', ' + OWN + ', .latex-islands-container')) text += node.data;
    return text;
  }
  function turnIndex(element) {
    return chatgpt.turnIndex(element);
  }
  const conversationURL = () => location.origin + location.pathname;
  const conversationTitle = () => (document.title || '').replace(/\s*[-–|]\s*ChatGPT\s*$/i, '').trim() || 'ChatGPT conversation';
  function assertFinished(selected) {
    if (selected.some(element => chatgpt.isStreaming(element))) throw Error('Wait for the selected reply to finish generating before exporting to PDF.');
  }
  function pause(ms, signal) {
    check(signal);
    return new Promise((resolve, reject) => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); resolve(); };
      const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(aborted()); };
      const timer = setTimeout(finish, ms); signal?.addEventListener('abort', cancel, {once:true});
    });
  }
  async function readyAssets(root, signal) {
    const images = [...root.querySelectorAll('img')];
    for (const element of root.querySelectorAll('svg image')) {
      const href = element.getAttribute('href') || element.getAttribute('xlink:href');
      if (href && !href.startsWith('#')) { const image = make('img'); image.src = href; images.push(image); }
    }
    await Promise.all(images.map(image => imageReady(image, signal)));
    if (document.fonts?.ready) await bounded(document.fonts.ready, signal, 'Fonts did not finish loading for PDF export.');
    check(signal);
  }
  async function copyMessage(source, signal, waitForDiagram = false, deadline = Date.now() + ASSET_TIMEOUT) {
    const originalText = messageText(source);
    let snapshots;
    for (;;) {
      check(signal);
      if (!source.isConnected || messageText(source) !== originalText) throw Error('The conversation changed during PDF export. Try again.');
      const snapshotter = globalThis.LatexIslandsDiagramExport?.snapshot;
      if (!snapshotter && hasIsland(source)) throw Error('LaTeX Island export is unavailable. Reload the page and render the diagrams before exporting.');
      try {
        snapshots = snapshotter ? await bounded(snapshotter(source, {signal}), signal, 'A diagram did not finish rendering for PDF export.') : [];
        if (waitForDiagram && hasIsland(source) && !snapshots.length) throw Error('A LaTeX Island is not ready.');
        break;
      } catch (error) {
        if (!waitForDiagram || Date.now() >= deadline || !transientCaptureError(error.message)) throw error;
        await pause(150, signal);
      }
    }
    check(signal);
    const replacements = new Map(), removed = new Set();
    for (const snapshot of snapshots) {
      if (!snapshot.sourceElement || !source.contains(snapshot.sourceElement)) throw Error('A LaTeX Island changed during PDF export. Try again.');
      replacements.set(snapshot.sourceElement, snapshot);
      if (snapshot.containerElement) removed.add(snapshot.containerElement);
    }
    const copiedMedia = mediaSignature(source);
    const section = make('section', 'li-pdf-message'), role = chatgpt.role(source);
    section.append(make('h2', 'li-pdf-role', role === 'user' ? 'You' : 'ChatGPT'));
    const content = make('div', 'li-pdf-content'), copy = cloneContent(source, replacements, removed);
    if (copy) content.append(copy);
    section.append(content);
    if (waitForDiagram) await readyAssets(section, signal);
    if (!source.isConnected || messageText(source) !== originalText) throw Error('The conversation changed during PDF export. Try again.');
    if (waitForDiagram && mediaSignature(source) !== copiedMedia) {
      if (Date.now() >= deadline) throw Error('An image or diagram kept changing during PDF capture. Wait for it to finish loading and try again.');
      await pause(150, signal);
      return copyMessage(source, signal, true, deadline);
    }
    copyVersions.set(section, {text:originalText, media:copiedMedia});
    return section;
  }
  function loadingHistory(main, scroller) {
    const scope = scroller === document.documentElement || scroller === document.body ? document.body : scroller;
    return [...scope.querySelectorAll('[aria-busy="true"], [role="progressbar"], [data-testid*="loading"], [data-testid*="spinner"]')].some(node => !node.closest(OWN) && !chatgpt.getMessage(node) && visible(node)) || main?.getAttribute('aria-busy') === 'true';
  }
  async function settleHistory(main, scroller, signal, sourceURL) {
    const deadline = Date.now() + ASSET_TIMEOUT;
    let previous = '', stable = 0;
    while (Date.now() < deadline) {
      await pause(120, signal);
      if (!main.isConnected || sourceURL !== conversationURL()) throw Error('The conversation changed while loading its history. Try again.');
      const messages = pageMessages();
      const signature = scroller.scrollHeight + ':' + messages.map(element => messageKey(element) + ':' + messageText(element).length).join('|');
      if (signature === previous && !loadingHistory(main, scroller)) stable++; else stable = 0;
      previous = signature;
      if (stable >= 3) return messages;
    }
    throw Error('The conversation history did not finish loading. Wait for ChatGPT and try again.');
  }
  function replySelection(replyElement, messages, includePrecedingPrompt) {
    const reply = chatgpt.getMessage(replyElement) || chatgpt.getMessages(replyElement).find(element => chatgpt.role(element) === 'assistant');
    if (!reply || chatgpt.role(reply) !== 'assistant' || !messages.includes(reply)) throw Error('This reply is no longer on the page. Open it again before exporting.');
    const prompt = includePrecedingPrompt ? messages.slice(0, messages.indexOf(reply)).findLast(element => chatgpt.role(element) === 'user') : null;
    return prompt ? [prompt, reply] : [reply];
  }
  async function collect({replyElement = null, includePrecedingPrompt = true, signal, onProgress = () => {}} = {}) {
    check(signal);
    const sourceURL = conversationURL(), title = conversationTitle(), main = chatgpt.getConversationRoot(), collectionDeadline = Date.now() + HISTORY_TIMEOUT;
    if (!main) throw Error('There are no rendered messages to export on this page.');
    let messages = pageMessages();
    const records = new Map(), order = [], initialReply = replyElement ? replySelection(replyElement, messages, includePrecedingPrompt) : null;
    async function captureWindow(windowMessages) {
      check(signal);
      const keys = windowMessages.map(messageKey);
      if (new Set(keys).size !== keys.length) throw Error('ChatGPT exposed duplicate message identifiers. Reload the conversation before exporting.');
      if (order.length && keys.length) {
        const known = keys.filter(key => records.has(key)), positions = known.map(key => order.indexOf(key));
        if (!known.length || positions.some((position, index) => index && position <= positions[index - 1]) || (keys.some(key => !records.has(key)) && (positions.at(-1) !== order.length - 1 || keys.slice(0, keys.lastIndexOf(known.at(-1)) + 1).some(key => !records.has(key))))) throw Error('Some messages were skipped while ChatGPT loaded its history. Try again with the conversation open.');
      }
      for (const element of windowMessages) {
        check(signal);
        if (Date.now() > collectionDeadline) throw Error('The conversation is too long to capture safely in one pass. Try again.');
        const key = messageKey(element), old = records.get(key), currentMedia = mediaSignature(element);
        const unchangedMedia = old?.mediaSignature === currentMedia;
        if (old) {
          if (old.originalText !== messageText(element)) throw Error('The conversation changed while loading its history. Try again.');
          if (unchangedMedia && (!old.error || !transientCaptureError(old.error) || old.retryCount >= MAX_CAPTURE_RETRIES)) continue;
        }
        let content = null, error = '';
        const retryCount = old?.error && unchangedMedia ? old.retryCount + 1 : 0;
        // An iframe can become ready without changing its parent's DOM. Retry
        // transient failures when revisiting it, but do not repeat a full
        // readiness wait at every viewport or keep retrying invalid TeX.
        const messageDeadline = Math.min(collectionDeadline, Date.now() + (retryCount ? 0 : ASSET_TIMEOUT));
        try { assertFinished([element]); content = await copyMessage(element, signal, true, messageDeadline); }
        catch (failure) {
          if (failure.name === 'AbortError' || /conversation changed|diagram or conversation changed/i.test(failure.message) || !element.isConnected || sourceURL !== conversationURL()) throw failure;
          error = failure.message || 'This message could not be captured for PDF export.';
        }
        const role = chatgpt.role(element);
        const copiedVersion = content && copyVersions.get(content);
        records.set(key, {key, role, content, error, retryCount, originalText:copiedVersion?.text ?? messageText(element), turnIndex:turnIndex(element), mediaSignature:copiedVersion?.media ?? mediaSignature(element), preview:(content?.querySelector('.li-pdf-content').textContent || messageText(element)).replace(/\s+/g, ' ').trim().slice(0, 180)});
        if (!old) order.push(key); onProgress({phase:'messages', completed:order.length, total:null});
      }
    }
    if (initialReply) await captureWindow(initialReply);
    else {
      const scroller = chatgpt.getScrollRoot(messages[0] || main), originalTop = scroller.scrollTop, originalLeft = scroller.scrollLeft;
      const oldBehavior = scroller.style.getPropertyValue('scroll-behavior'), oldPriority = scroller.style.getPropertyPriority('scroll-behavior');
      const deadline = collectionDeadline;
      const reverse = getComputedStyle(scroller).flexDirection === 'column-reverse';
      const maximum = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      // Reverse flex scrollers use negative scrollTop for older history and
      // zero at the newest messages. Traverse in chronological coordinates.
      const position = () => Math.max(0, Math.min(maximum(), reverse ? maximum() + scroller.scrollTop : scroller.scrollTop));
      scroller.style.setProperty('scroll-behavior', 'auto', 'important');
      const moveRaw = top => { if (typeof scroller.scrollTo === 'function') scroller.scrollTo({top, left:originalLeft, behavior:'instant'}); else scroller.scrollTop = top; };
      const move = top => moveRaw(reverse ? top - maximum() : top);
      try {
        onProgress({phase:'history', completed:0, total:null});
        // Recompute the oldest position after each load because adding turns
        // changes the negative limit of a reverse scroller.
        let topStable = 0, topSignature = '';
        for (let attempt = 0; attempt < 30 && topStable < 2; attempt++) {
          if (Date.now() > deadline) throw Error('The conversation is too long to capture safely in one pass. Try again.');
          move(0); messages = await settleHistory(main, scroller, signal, sourceURL);
          const signature = scroller.scrollHeight + ':' + messages.map(messageKey).join('|');
          const firstTurn = messages.length ? turnIndex(messages[0]) : null;
          topStable = position() <= 2 && (firstTurn === null || firstTurn === 0) && signature === topSignature ? topStable + 1 : 0; topSignature = signature;
        }
        if (topStable < 2) throw Error('Could not reach the beginning of the conversation. Load the earlier messages and try again.');
        if ([...main.querySelectorAll('button')].some(button => visible(button) && /(?:load|show) (?:older|earlier|previous|more) messages|charger .*messages|afficher .*messages précédents/i.test(button.textContent))) throw Error('ChatGPT is asking to load earlier messages. Load them first, then try exporting again.');
        let bottomStable = 0, lastBottom = '', finished = false;
        for (let step = 0; step < MAX_SCROLL_STEPS; step++) {
          if (Date.now() > deadline) throw Error('The conversation is too long to capture safely in one pass. Try again.');
          messages = await settleHistory(main, scroller, signal, sourceURL);
          if (!messages.length) throw Error('ChatGPT has not loaded this part of the conversation. Try again.');
          await captureWindow(messages);
          const limit = maximum(), current = position(), atBottom = current >= limit - 2;
          const signature = limit + ':' + messages.map(messageKey).join('|');
          bottomStable = atBottom && signature === lastBottom ? bottomStable + 1 : 0; lastBottom = signature;
          if (bottomStable >= 2) { finished = true; break; }
          const next = atBottom ? limit : Math.min(limit, current + Math.max(1, scroller.clientHeight * .6));
          if (!atBottom && (scroller.clientHeight <= 0 || next <= current)) throw Error('Could not scroll through the complete conversation. Try again.');
          move(next);
        }
        if (!finished) throw Error('Could not reach the end of the conversation safely. Try again.');
        const turns = order.map(key => records.get(key).turnIndex);
        if (turns.every(index => index !== null)) {
          const unique = [...new Set(turns)];
          if (unique[0] !== 0 || unique.some((index, position) => position && index !== unique[position - 1] + 1)) throw Error('Some conversation turns are missing from the rendered history. Load the conversation again before exporting.');
        }
      } finally {
        if (scroller.isConnected && sourceURL === conversationURL()) { moveRaw(originalTop); scroller.scrollLeft = originalLeft; }
        if (oldBehavior) scroller.style.setProperty('scroll-behavior', oldBehavior, oldPriority); else scroller.style.removeProperty('scroll-behavior');
      }
    }
    check(signal);
    if (!order.length) throw Error('There are no rendered messages to export on this page.');
    if (sourceURL !== conversationURL()) throw Error('The conversation changed while loading its history. Try again.');
    const descriptors = Object.freeze(order.map(key => { const {role, preview, error} = records.get(key); return Object.freeze({key, role, preview, error}); }));
    const dispose = () => { captures.delete(capture); records.clear(); window.removeEventListener('pagehide', dispose); };
    const capture = Object.freeze({messages:descriptors, title, sourceUrl:sourceURL, scope:initialReply ? 'reply' : 'conversation', replyKey:initialReply ? messageKey(initialReply.at(-1)) : null, precedingPromptKey:initialReply?.length > 1 ? messageKey(initialReply[0]) : null, dispose});
    captures.set(capture, {records, order, sourceURL, title}); window.addEventListener('pagehide', dispose, {once:true});
    onProgress({phase:'ready', completed:order.length, total:order.length}); return capture;
  }
  async function prepare({capture = null, selectedKeys = null, roleMode, replyElement = null, includePrecedingPrompt = false, includeUser = true, signal, onProgress = () => {}} = {}) {
    check(signal);
    const stored = capture ? captures.get(capture) : null;
    if (capture && (!stored || stored.sourceURL !== conversationURL())) throw Error('This PDF capture has expired. Load the conversation again.');
    const mode = ['conversation', 'answers', 'prompts'].includes(roleMode) ? roleMode : includeUser ? 'conversation' : 'answers';
    const acceptsRole = role => (includeUser || role !== 'user') && (mode === 'conversation' || role === (mode === 'prompts' ? 'user' : 'assistant'));
    const messages = stored ? [] : pageMessages();
    let selected;
    const availableKeys = stored ? stored.order : messages.map(messageKey);
    if (selectedKeys !== null && (!Array.isArray(selectedKeys) || selectedKeys.some(key => !availableKeys.includes(key)))) throw Error('The selected messages are no longer available. Load the conversation again.');
    const wanted = selectedKeys === null ? null : new Set(selectedKeys);
    if (stored) selected = stored.order.filter(key => (!wanted || wanted.has(key)) && acceptsRole(stored.records.get(key).role));
    else {
      selected = replyElement ? replySelection(replyElement, messages, includePrecedingPrompt) : messages;
      selected = selected.filter(element => (!wanted || wanted.has(messageKey(element))) && acceptsRole(chatgpt.role(element)));
      assertFinished(selected);
    }
    if (!selected.length) throw Error('There are no rendered messages to export on this page.');
    if (stored) for (const key of selected) if (stored.records.get(key).error) throw Error(stored.records.get(key).error);
    const title = stored ? stored.title : conversationTitle();
    const id = 'li-pdf-document-' + (++sequence), root = make('div', 'li-export li-pdf-root li-pdf-document'), style = make('style');
    root.id = id; root.setAttribute('role', 'document'); root.setAttribute('aria-label', title);
    style.textContent = stylesheet(id); style.dataset.latexIslandsPdf = id;
    root.append(make('h1', 'li-pdf-title', title));
    let disposed = false, printing = false, previousTitle = null;
    const dispose = () => {
      if (disposed) return; disposed = true;
      window.removeEventListener('afterprint', dispose); window.removeEventListener('pagehide', dispose); signal?.removeEventListener('abort', dispose);
      if (activePrint === root) { activePrint = null; document.body.classList.remove('li-pdf-printing'); }
      if (previousTitle !== null && document.title === title) document.title = previousTitle;
      root.remove(); style.remove();
    };
    signal?.addEventListener('abort', dispose, {once:true});
    window.addEventListener('pagehide', dispose, {once:true});
    try {
      const originals = stored ? [] : selected.map(source => ({source, text:messageText(source), media:mediaSignature(source)}));
      for (let index = 0; index < selected.length; index++) {
        check(signal);
        onProgress({phase:'messages', completed:index, total:selected.length});
        root.append(stored ? stored.records.get(selected[index]).content.cloneNode(true) : await copyMessage(selected[index], signal));
      }
      check(signal); uniqueIds(root, id + '-'); document.head.append(style); document.body.append(root);
      onProgress({phase:'assets', completed:selected.length, total:selected.length});
      await readyAssets(root, signal);
      check(signal);
      if (stored && (!captures.has(capture) || stored.sourceURL !== conversationURL())) throw Error('This PDF capture has expired. Load the conversation again.');
      if (originals.some(({source,text,media}) => !source.isConnected || messageText(source) !== text || mediaSignature(source) !== media)) throw Error('The conversation changed during PDF export. Try again.');
      onProgress({phase:'ready', completed:selected.length, total:selected.length});
      return {root, count:selected.length, title, dispose, mountPreview(container) {
        check(signal);
        if (disposed || printing || !container?.isConnected) throw Error('This PDF preview is no longer available. Prepare it again.');
        root.classList.add('li-pdf-preview'); container.append(root); return root;
      }, print() {
        check(signal);
        if (disposed || !root.isConnected) throw Error('This PDF export has expired. Prepare it again.');
        if (printing || activePrint) throw Error('A PDF print dialog is already open.');
        printing = true; activePrint = root; previousTitle = document.title; document.title = title;
        root.classList.remove('li-pdf-preview'); document.body.append(root);
        root.classList.add('li-pdf-active'); document.body.classList.add('li-pdf-printing'); window.addEventListener('afterprint', dispose, {once:true});
        try { window.print(); } catch (error) { dispose(); throw error; }
      }};
    } catch (error) { dispose(); throw error; }
  }
  globalThis.LatexIslandsPDF = {collect, prepare};
})();
