/* SPDX-License-Identifier: GPL-3.0-or-later
 * Runs in MAIN world. Only GETs a strictly bounded ChatGPT API path on explicit
 * exporter requests; no tokens or request headers cross the world boundary. */
(() => {
  'use strict';
  if (globalThis.__latexIslandsExportBridge) return;
  globalThis.__latexIslandsExportBridge = true;
  const CHANNEL = 'latex-islands-conversation-export-v1';
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const modern = new RegExp('^/backend-api/conversations/(' + uuid + ')(/messages)?$', 'i');
  const legacy = new RegExp('^/backend-api/conversation/(' + uuid + ')$', 'i');
  let token = null, active = null;
  function reply(requestId, values) { window.postMessage({channel: CHANNEL, type: 'response', requestId, ...values}, location.origin); }
  function validPath(path) {
    if (typeof path !== 'string' || path.length > 1500 || !path.startsWith('/backend-api/')) return null;
    const url = new URL(path, location.origin);
    const match = url.pathname.match(modern) || url.pathname.match(legacy);
    const current = location.pathname.match(new RegExp('(?:^|/)c/(' + uuid + ')/?$', 'i'));
    if (url.origin !== location.origin || !match || !current || current[1] !== match[1] || url.hash) return null;
    const allowed = new Set(['include_has_versions', 'num_turns', 'before']);
    for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) return null;
    if (url.searchParams.has('include_has_versions') && url.searchParams.get('include_has_versions') !== 'true') return null;
    if (url.searchParams.has('num_turns') && url.searchParams.get('num_turns') !== '10') return null;
    if (url.searchParams.has('before') && (!match[2] || !url.searchParams.get('before') || url.searchParams.get('before').length > 512)) return null;
    return url.pathname + url.search;
  }
  async function get(path, signal) {
    const headers = {Accept: 'application/json'};
    if (token) headers.Authorization = 'Bearer ' + token;
    return nativeFetch(path, {method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers, signal});
  }
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || !event.data || event.data.channel !== CHANNEL) return;
    const {type, requestId, path} = event.data;
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(requestId)) return;
    if (type === 'cancel') {
      if (active && active.requestId === requestId) active.controller.abort();
      token = null;
      return;
    }
    if (type === 'release') { token = null; return; }
    if (type !== 'request') return;
    const safePath = validPath(path);
    if (!safePath) { reply(requestId, {ok: false, error: 'Export request path is not allowed.'}); return; }
    if (active) { reply(requestId, {ok: false, error: 'An export request is already in progress.'}); return; }
    const controller = new AbortController();
    active = {requestId, controller};
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      let response = await get(safePath, controller.signal);
      if (response.status === 401) {
        token = null;
        const sessionResponse = await nativeFetch('/api/auth/session', {method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal});
        if (sessionResponse.ok) {
          const session = await sessionResponse.json();
          if (typeof session.accessToken === 'string') token = session.accessToken;
        }
        if (token) response = await get(safePath, controller.signal);
      }
      if (!response.ok) { reply(requestId, {ok: false, status: response.status, error: 'ChatGPT refused the request (HTTP ' + response.status + '). Reload the page and try again.'}); return; }
      const payload = await response.json();
      reply(requestId, {ok: true, payload});
    } catch (error) {
      reply(requestId, {ok: false, error: error.name === 'AbortError' ? 'Request cancelled or timed out after 45 seconds.' : 'Could not read the conversation. Check your connection and try again.'});
    } finally { clearTimeout(timer); active = null; }
  });
  window.addEventListener('pagehide', () => { token = null; if (active) active.controller.abort(); });
})();
