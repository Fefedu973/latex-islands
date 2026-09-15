const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ID = '01234567-89ab-4cde-8f01-23456789abcd';
const CHANNEL = 'latex-islands-conversation-export-v1';
const REQUEST = '/backend-api/conversations/' + ID + '?include_has_versions=true&num_turns=10';
function harness(fetcher) {
  const handlers = {}, replies = [], requests = [];
  const context = vm.createContext({URL, AbortController, setTimeout, clearTimeout, location: {origin: 'https://chatgpt.com', pathname: '/c/' + ID},
    fetch: async (url, options) => { requests.push({url, options}); return fetcher(url, options, requests.length); },
    addEventListener: (type, listener) => { handlers[type] = listener; }, postMessage: (data, origin) => replies.push({data, origin})});
  vm.runInContext('window = globalThis;', context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../conversation-bridge.js'), 'utf8'), context);
  async function send(data = {}, overrides = {}) {
    context.incoming = {origin: 'https://chatgpt.com', data: {channel: CHANNEL, type: 'request', requestId: 'request-12345', path: REQUEST, ...data}, ...overrides};
    vm.runInContext('incoming.source = window;', context);
    if (overrides.source) context.incoming.source = overrides.source;
    await handlers.message(context.incoming);
  }
  return {context, requests, replies, send, handlers};
}
const success = payload => ({ok: true, status: 200, json: async () => payload});

test('bridge uses same-origin GET without forwarding auth or request headers to the content world', async () => {
  const h = harness(async () => success({messages: [], page_info: {has_previous_page: false}}));
  await h.send();
  assert.equal(h.requests[0].url, REQUEST);
  assert.equal(h.requests[0].options.method, 'GET');
  assert.equal(h.requests[0].options.credentials, 'same-origin');
  assert.equal(h.requests[0].options.redirect, 'error');
  assert.equal(h.requests[0].options.headers.Authorization, undefined);
  assert.equal(h.replies[0].data.ok, true);
  assert.equal(h.replies[0].origin, 'https://chatgpt.com');
});

test('bridge validates origin, source, exact current conversation and bounded endpoint query', async () => {
  const h = harness(async () => success({}));
  await h.send({}, {origin: 'https://attacker.example'});
  await h.send({}, {source: {}});
  for (const bad of ['https://attacker.example/data', '//attacker.example/data', '/api/auth/session', '/backend-api/conversations/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', REQUEST + '&unknown=1', REQUEST + '&num_turns=1000', '/backend-api/conversations/' + ID + '/messages?before=' + 'x'.repeat(513), '/backend-api/conversation/' + ID + '?before=cursor', REQUEST + '#fragment']) await h.send({path: bad});
  assert.equal(h.requests.length, 0);
  assert.equal(h.replies.length, 9);
  assert.ok(h.replies.every(reply => reply.data.ok === false));
  await h.send({path: '/backend-api/conversations/' + ID + '/messages?before=cursor&include_has_versions=true&num_turns=10'});
  assert.equal(h.requests.length, 1);
});

test('401 session fallback retains credentials only in memory and release clears the token', async () => {
  const h = harness(async (url, options, index) => {
    if (index === 1) return {ok: false, status: 401};
    if (url === '/api/auth/session') return success({accessToken: 'synthetic-token-never-forwarded', user: {name: 'Synthetic'}});
    return success({messages: []});
  });
  await h.send();
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[1].url, '/api/auth/session');
  assert.equal(h.requests[2].options.headers.Authorization, 'Bearer synthetic-token-never-forwarded');
  assert.ok(!JSON.stringify(h.replies).includes('synthetic-token'));
  await h.send({type: 'release'});
  await h.send({requestId: 'request-12346'});
  assert.equal(h.requests[3].options.headers.Authorization, undefined);
});

test('API refusal exposes the HTTP status without copying response bodies', async () => {
  const h = harness(async () => ({ok: false, status: 403, json: async () => ({sensitive_debug: 'must not forward'})}));
  await h.send();
  assert.equal(h.requests.length, 1);
  assert.equal(h.replies[0].data.status, 403);
  assert.ok(!JSON.stringify(h.replies).includes('sensitive_debug'));
});

test('cancellation aborts the active request and no additional fetch is started', async () => {
  const h = harness(async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), {name: 'AbortError'})));
  }));
  const read = h.send();
  await h.send({type: 'cancel'});
  await read;
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.equal(h.replies[0].data.ok, false);
});
