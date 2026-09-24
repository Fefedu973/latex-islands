/* SPDX-License-Identifier: GPL-3.0-or-later */
(() => {
  'use strict';
  if (globalThis.LatexIslandsPDF) return;
  const MESSAGE = '[data-message-author-role="user"], [data-message-author-role="assistant"]';
  const OWN = '.li-export, .li-export-reply, .latex-islands-editor';
  const STREAMING = '[data-is-streaming="true"], .result-streaming, .streaming-animation, [aria-busy="true"]';
  const OMIT = 'script, style, link, meta, base, iframe, object, embed, form, input, textarea, select, button, dialog, nav, [role="button"], [role="toolbar"], [role="menu"], [contenteditable="true"], [data-testid="composer"], .li-export, .li-export-reply, .latex-islands-editor, animate, animateMotion, animateTransform, set';
  const ASSET_TIMEOUT = 15000;
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
  function attributes(source, clone) {
    for (const {name, value} of [...clone.attributes]) {
      const lower = name.toLowerCase();
      if (lower.startsWith('on') || ['srcdoc', 'srcset', 'sizes', 'autofocus', 'tabindex', 'contenteditable', 'nonce', 'integrity', 'ping', 'download', 'popover'].includes(lower)) clone.removeAttribute(name);
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
    if (clone.localName === 'a') { clone.setAttribute('rel', 'noopener noreferrer'); clone.removeAttribute('target'); }
    if (clone.localName === 'img') {
      const src = url(source.currentSrc || source.getAttribute('src'), true);
      if (!src) throw Error('An image in this reply cannot be included safely in the PDF.');
      clone.src = src; clone.loading = 'eager'; clone.decoding = 'sync';
    }
    if (clone.localName === 'image' && !url(source.getAttribute('href') || source.getAttribute('xlink:href'), true)) throw Error('An SVG image in this reply cannot be included safely in the PDF.');
    if (source.closest('svg') && source.isConnected) {
      // Mermaid and native SVG charts may have a <style> scoped to their live
      // ID. Keep bounded computed paint/type properties before changing IDs,
      // without copying executable markup or globally effective CSS rules.
      const css = getComputedStyle(source);
      for (const property of ['color','fill','fill-opacity','fill-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','stroke-opacity','opacity','font-family','font-size','font-weight','font-style','letter-spacing','text-anchor','dominant-baseline','paint-order','marker-start','marker-mid','marker-end','background-color']) {
        let value = css.getPropertyValue(property);
        if (!value) continue;
        value = value.replace(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g, (match, target) => {
          try { const parsed = new URL(target, document.baseURI); if (parsed.hash && parsed.href.split('#')[0] === document.URL.split('#')[0]) return 'url(' + parsed.hash + ')'; } catch {}
          return match;
        });
        if (!/url\s*\(/i.test(value.replace(/url\(#[\w:.-]+\)/g, ''))) clone.style.setProperty(property, value);
      }
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
    if (replacements.has(element)) return element.matches('pre, code, .katex-error') ? diagramImage(replacements.get(element)) : rawDiagram(element, replacements.get(element));
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
    // ChatGPT code widgets contain copy/download controls and nested <pre>s.
    // Retain the actual highlighted code and CodeMirror line boundaries only.
    if (element.localName === 'pre' && !containsDiagram && !element.closest('pre pre')) {
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
#${id} .li-pdf-title { font-size:20pt; line-height:1.25; margin:0 0 18pt; font-weight:650; }
#${id} .li-pdf-message { margin:0 0 20pt; padding:0; break-inside:auto; }
#${id} .li-pdf-role { font-size:9pt; font-weight:650; color:#555; margin:0 0 7pt; padding-top:10pt; border-top:1px solid #ddd; break-after:avoid; }
#${id} .li-pdf-content { font-size:11pt; line-height:1.55; }
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
#${id} .li-pdf-island { display:block; max-width:100%; margin:12pt 0; padding:0; break-inside:avoid; page-break-inside:avoid; }
#${id} .li-pdf-raw-text { white-space:pre-wrap; }
#${id} .li-pdf-island-image { display:block; max-width:100% !important; max-height:180mm !important; height:auto !important; object-fit:contain; margin:0 auto; }
#${id} .katex-mathml, #${id} mjx-assistive-mml { display:none !important; }
#${id} :is(.katex-display, mjx-container[display="true"]) { max-width:100%; overflow:visible !important; break-inside:avoid; }
#${id}.li-pdf-preview { display:block !important; width:210mm; max-width:100%; padding:16mm; margin:0 auto; }
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
  async function prepare({replyElement = null, includeUser = true, signal, onProgress = () => {}} = {}) {
    check(signal);
    const main = document.querySelector('main, [role="main"]');
    const messages = [...main?.querySelectorAll(MESSAGE) || []].filter(element => {
      if (element.closest(OWN) || element.parentElement?.closest(MESSAGE)) return false;
      for (let parent = element; parent && parent !== main; parent = parent.parentElement) if (!visible(parent)) return false;
      return true;
    });
    let selected;
    if (replyElement) {
      const reply = replyElement.closest?.('[data-message-author-role="assistant"]') || replyElement.querySelector?.('[data-message-author-role="assistant"]');
      if (!reply || !messages.includes(reply)) throw Error('This reply is no longer on the page. Open it again before exporting.');
      selected = [reply];
    } else selected = messages.filter(element => includeUser || element.getAttribute('data-message-author-role') === 'assistant');
    if (!selected.length) throw Error('There are no rendered messages to export on this page.');
    const lastAssistant = messages.filter(element => element.getAttribute('data-message-author-role') === 'assistant').at(-1);
    if (selected.some(element => element.closest(STREAMING) || element.querySelector(STREAMING) || (element === lastAssistant && document.querySelector('[data-testid="stop-button"]')))) throw Error('Wait for the selected reply to finish generating before exporting to PDF.');
    const title = (document.title || '').replace(/\s*[-–|]\s*ChatGPT\s*$/i, '').trim() || 'ChatGPT conversation';
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
      const originals = selected.map(source => ({source, text:source.textContent}));
      for (let index = 0; index < selected.length; index++) {
        check(signal);
        const source = selected[index];
        if (!source.isConnected) throw Error('The conversation changed during PDF export. Try again.');
        onProgress({phase:'messages', completed:index, total:selected.length});
        const snapshotter = globalThis.LatexIslandsDiagramExport?.snapshot;
        if (!snapshotter && hasIsland(source)) throw Error('LaTeX Island export is unavailable. Reload the page and render the diagrams before exporting.');
        const snapshots = snapshotter ? await snapshotter(source, {signal}) : [];
        check(signal);
        const replacements = new Map(), removed = new Set();
        for (const snapshot of snapshots) {
          if (!snapshot.sourceElement || !source.contains(snapshot.sourceElement)) throw Error('A LaTeX Island changed during PDF export. Try again.');
          replacements.set(snapshot.sourceElement, snapshot);
          if (snapshot.containerElement) removed.add(snapshot.containerElement);
        }
        const section = make('section', 'li-pdf-message'), label = source.getAttribute('data-message-author-role') === 'user' ? 'You' : 'ChatGPT';
        section.append(make('h2', 'li-pdf-role', label));
        const content = make('div', 'li-pdf-content'), copy = cloneContent(source, replacements, removed);
        if (copy) content.append(copy);
        section.append(content); root.append(section);
      }
      check(signal); uniqueIds(root, id + '-'); document.head.append(style); document.body.append(root);
      onProgress({phase:'assets', completed:selected.length, total:selected.length});
      const images = [...root.querySelectorAll('img')];
      for (const element of root.querySelectorAll('svg image')) {
        const href = element.getAttribute('href') || element.getAttribute('xlink:href');
        if (href && !href.startsWith('#')) { const image = make('img'); image.src = href; images.push(image); }
      }
      await Promise.all(images.map(image => imageReady(image, signal)));
      if (document.fonts?.ready) await bounded(document.fonts.ready, signal, 'Fonts did not finish loading for PDF export.');
      check(signal);
      if (originals.some(({source,text}) => !source.isConnected || source.textContent !== text)) throw Error('The conversation changed during PDF export. Try again.');
      onProgress({phase:'ready', completed:selected.length, total:selected.length});
      return {root, count:selected.length, title, dispose, print() {
        check(signal);
        if (disposed || !root.isConnected) throw Error('This PDF export has expired. Prepare it again.');
        if (printing || activePrint) throw Error('A PDF print dialog is already open.');
        printing = true; activePrint = root; previousTitle = document.title; document.title = title;
        root.classList.add('li-pdf-active'); document.body.classList.add('li-pdf-printing'); window.addEventListener('afterprint', dispose, {once:true});
        try { window.print(); } catch (error) { dispose(); throw error; }
      }};
    } catch (error) { dispose(); throw error; }
  }
  globalThis.LatexIslandsPDF = {prepare};
})();
