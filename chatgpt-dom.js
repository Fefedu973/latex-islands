/* SPDX-License-Identifier: GPL-3.0-or-later */
(() => {
  'use strict';
  // Semantic attributes observed in the public web UI, September 2026. Keep
  // the previous renderer supported during staged rollouts and account changes.
  const OWN = '.latex-islands-container, .latex-islands-editor, .li-export, .li-export-reply, .li-pdf-root';
  const CANDIDATE = '[data-message-author-role], [data-chatgpt-search-unit-key], [data-chatgpt-selection-message-id]';
  const SCROLL = '[data-app-action-timeline-scroll], [data-scroll-root], [class~="group/scroll-root"]';
  const STREAM = '[data-is-streaming="true"], .result-streaming, .streaming-animation, [aria-busy="true"]';
  const element = node => node?.nodeType === 1 ? node : node?.parentElement;
  function visibility(ignoreOriginal = false) {
    // Share ancestor checks within one traversal only. Never retain visibility
    // across DOM changes, sidebar transitions, hydration or print styles.
    const cache = new Map();
    return function visible(node) {
      const el = element(node);
      if (!el?.isConnected) return false;
      if (cache.has(el)) return cache.get(el);
      const css = getComputedStyle(el), original = ignoreOriginal && (el.classList.contains('latex-islands-original-hidden') || el.getAttribute('data-latex-islands-hidden') === 'true');
      const own = !el.matches('[hidden], [inert], [aria-hidden="true"]') && (original || css.display !== 'none') && css.visibility !== 'hidden' && css.visibility !== 'collapse';
      const result = own && (!el.parentElement || visible(el.parentElement));
      cache.set(el, result);
      // Off-screen messages must remain eligible for PDF collection.
      return result;
    };
  }
  function isVisible(node) { return visibility()(node); }
  function role(el) {
    if (!el) return '';
    const legacy = el.getAttribute('data-message-author-role');
    if (legacy === 'assistant' || legacy === 'user') return legacy;
    const key = el.getAttribute('data-chatgpt-search-unit-key');
    const keyed = key?.match(/:(user|assistant)$/)?.[1];
    if (keyed) return keyed;
    if (el.hasAttribute('data-chatgpt-selection-message-id') && el.querySelector('[data-markdown-text-style="assistant-message"]')) return 'assistant';
    return '';
  }
  function eligible(el) { return role(el) && !el.closest(OWN) && isVisible(el); }
  function getConversationRoot() {
    const visible = visibility();
    const selectors = ['[data-chatgpt-conversation-selection-target]', '[data-thread-user-message-navigation-content]', 'main', '[role="main"]'];
    for (const selector of selectors) {
      const roots = [...document.querySelectorAll(selector)].filter(el => !el.closest(OWN) && visible(el));
      const populated = roots.find(el => [...el.querySelectorAll(CANDIDATE)].some(n => role(n) && !n.closest(OWN) && visible(n)));
      if (populated) return populated;
      if (roots.length && (selector === 'main' || selector === '[role="main"]')) return roots[0];
    }
    return document.body;
  }
  function getMessages(root = getConversationRoot()) {
    const visible = visibility();
    if (!root || !visible(root)) return [];
    const candidates = [...(root.matches?.(CANDIDATE) ? [root] : []), ...root.querySelectorAll(CANDIDATE)].filter(el => role(el) && !el.closest(OWN) && visible(el));
    const set = new Set(candidates);
    return candidates.filter(el => {
      for (let p = el.parentElement; p && root.contains(p); p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
  }
  function getMessage(node) {
    let el = element(node);
    if (!el || el.closest(OWN)) return null;
    let match = null;
    for (; el; el = el.parentElement) if (el.matches(CANDIDATE) && eligible(el)) match = el;
    return match;
  }
  function messageId(el) {
    const direct = el?.getAttribute('data-message-id') || el?.getAttribute('data-chatgpt-selection-message-id');
    if (direct) return direct;
    return el?.querySelector('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id') ||
      el?.getAttribute('data-chatgpt-search-message-ids')?.trim().split(/\s+/)[0] || '';
  }
  function turnIndex(el) {
    const old = el?.closest('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid')?.match(/^conversation-turn-(\d+)$/);
    if (old) return Number(old[1]);
    const key = el?.closest('[data-content-search-turn-key]')?.getAttribute('data-content-search-turn-key') || el?.getAttribute('data-chatgpt-search-unit-key') || '';
    const index = key.match(/^fallback-turn-(\d+)(?::|$)/);
    return index ? Number(index[1]) : null;
  }
  function getCodeBlocks(message) {
    return [...message.querySelectorAll('[data-markdown-copy="code-block"], pre, .cm-content')].filter(el =>
      !el.closest(OWN) && !el.closest('textarea, input, [contenteditable="true"], [role="textbox"]') &&
      !el.parentElement.closest('[data-markdown-copy="code-block"], pre, .cm-content'));
  }
  function source(block) {
    const code = block.matches('code, .cm-content') ? block : block.querySelector('code, .cm-content') || block;
    const lines = code.querySelectorAll('.cm-line');
    return lines.length ? [...lines].map(line => line.textContent || '').join('\n') : code.textContent || '';
  }
  function language(block) {
    const code = block.querySelector('code') || block;
    const explicit = code.getAttribute('data-language') || block.getAttribute('data-language');
    if (explicit) return explicit;
    const named = String(code.className).match(/(?:^|\s)language-([^\s]+)/)?.[1];
    if (named) return named;
    const labels = block.querySelectorAll('[data-testid="code-block-language"], .font-medium, [data-markdown-copy="exclude"] > div');
    for (const label of labels) {
      const text = label.textContent.trim();
      if (!label.closest('code, .cm-content, button, [role="button"]') && /^[a-z][a-z0-9#+_.-]{0,30}$/i.test(text)) return text;
    }
    return '';
  }
  function isStreaming(node) {
    const message = getMessage(node);
    if (!message || role(message) !== 'assistant') return false;
    const turn = message.closest('[data-content-search-turn-key], [data-testid^="conversation-turn-"]') || message;
    const visible = visibility(true), ancestor = message.closest(STREAM);
    if ((ancestor && visible(ancestor)) || [...turn.querySelectorAll(STREAM)].some(el => !el.closest(OWN) && visible(el))) return true;
    // Fallback for renderers that expose generation only through the composer.
    const stops = [...document.querySelectorAll('[data-testid="stop-button"], [data-test-id="stop-button"], [data-testid="composer-stop-button"]')];
    // The September composer exposes only a localized accessible name. Its
    // native stop glyph also identifies it independently of the account locale.
    const stopGlyph = 'M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z';
    for (const button of document.querySelectorAll('[data-chatgpt-composer] button, [data-composer-footer-responsive] button')) {
      if (/^(?:Stop(?: generating)?|Arrêter(?: la génération)?)$/i.test(button.getAttribute('aria-label') || '') ||
        [...button.querySelectorAll('svg.icon-primary-action path')].some(path => path.getAttribute('d') === stopGlyph)) stops.push(button);
    }
    if (!stops.some(visible)) return false;
    return getMessages().filter(el => role(el) === 'assistant').at(-1) === message;
  }
  function getScrollRoot(node = getConversationRoot()) {
    const el = element(node);
    const annotated = el?.closest(SCROLL) || [...(el?.querySelectorAll(SCROLL) || [])].find(isVisible);
    if (annotated) return annotated;
    const start = getMessages(el)[0] || el;
    for (let p = start; p && p !== document.body; p = p.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement || document.documentElement;
  }
  function getViewport(node) {
    const el = element(node), annotated = el?.closest(SCROLL);
    if (annotated) return annotated;
    const main = el?.closest('main, [role="main"]');
    const inside = [...(main?.querySelectorAll(SCROLL) || [])].find(n => n.contains(el) && isVisible(n));
    if (inside) return inside;
    for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
      const css = getComputedStyle(p), rect = p.getBoundingClientRect();
      if (/^(auto|scroll)$/.test(css.overflowY) && rect.width > 0 && rect.height > 0) return p;
    }
    return el?.closest('[class~="@container/main"]') || main;
  }
  function getHeaderActions() {
    for (const surface of document.querySelectorAll('[data-app-shell-main-titlebar="true"]')) {
      if (!isVisible(surface)) continue;
      for (const group of surface.querySelectorAll('[data-app-shell-header-obstacle]')) {
        const buttons = [...group.querySelectorAll('button')].filter(b => !b.closest(OWN) && isVisible(b));
        if (!buttons.length) continue;
        let parent = buttons.at(-1).parentElement;
        while (parent && parent !== group && !buttons.every(b => parent.contains(b))) parent = parent.parentElement;
        return parent || group;
      }
    }
    for (const selector of ['#conversation-header-actions', '[data-testid="thread-header-right-actions"]', '#conversation-header', '[data-testid="conversation-header"]', '#page-header', 'main header', 'header']) {
      const found = [...document.querySelectorAll(selector)].find(isVisible);
      if (found) return found;
    }
    return null;
  }
  function getReplyActions(message) {
    if (role(message) !== 'assistant') return null;
    const boundary = message.closest('[data-content-search-turn-key], [data-testid^="conversation-turn-"]');
    for (let parent = message; parent; parent = parent.parentElement) {
      const actions = [...parent.querySelectorAll('.turn-action-controls')].find(el =>
        isVisible(el) && !el.closest('[data-user-message-bubble], [data-chatgpt-search-unit-key$=":user"], [data-block-actions]') &&
        (!getMessage(el) || getMessage(el) === message));
      if (actions) return actions;
      if (parent === boundary || !boundary) break;
    }
    return null;
  }
  const observedAttributes = ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'aria-busy', 'data-is-streaming', 'data-theme', 'data-language',
    'data-message-author-role', 'data-message-id', 'data-chatgpt-search-unit-key', 'data-chatgpt-search-message-ids', 'data-chatgpt-selection-message-id',
    'data-conversation-role', 'data-markdown-text-style', 'data-markdown-copy', 'data-content-search-turn-key', 'data-turn-key',
    'data-app-shell-main-titlebar', 'data-app-shell-header-slot', 'data-app-shell-header-obstacle', 'data-testid', 'data-test-id', 'aria-label'];
  globalThis.LatexIslandsChatGPT = Object.freeze({getConversationRoot, getMessages, getMessage, role, messageId, turnIndex, getCodeBlocks, source, language,
    isStreaming, getScrollRoot, getViewport, getHeaderActions, getReplyActions, isVisible, observedAttributes});
})();
