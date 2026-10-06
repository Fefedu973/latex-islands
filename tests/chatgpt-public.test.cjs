/* SPDX-License-Identifier: GPL-3.0-or-later */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const load = () => import('../scripts/check-public-chatgpt.mjs');
const adapter = () => fs.readFile(path.join(__dirname, '../chatgpt-dom.js'), 'utf8');
const fixture = '<main><div data-message-author-role="user">Synthetic prompt</div><div data-message-author-role="assistant"><pre><code class="language-tikz">Synthetic code</code></pre></div></main>';

test('public sentinel accepts only credential-free, query-free HTTPS shared pages', async () => {
  const {publicShareURL} = await load();
  assert.equal(publicShareURL('https://chatgpt.com/share/synthetic-123').hostname, 'chatgpt.com');
  for (const url of ['http://chatgpt.com/share/id','https://chatgpt.com/c/private','https://chatgpt.com.evil.example/share/id','https://person:token@chatgpt.com/share/id','https://chatgpt.com/share/id?token=secret','https://chatgpt.com/share/id#secret','https://chatgpt.com:1234/share/id','file:///private']) assert.throws(() => publicShareURL(url));
});

test('unconfigured sentinel reports missing live coverage without making a request', async () => {
  const {checkPublicSite} = await load();
  const result = await checkPublicSite('', {fetcher:() => { throw Error('must not fetch'); }});
  assert.equal(result.status, 'not-configured');
  assert.match(result.reason, /not tested/);
});

test('public HTML is checked with the real adapter without executing page scripts or logging text', async () => {
  const {analyzeHTML} = await load();
  const result = await analyzeHTML(fixture + '<script>document.querySelector("main").remove()</script>', await adapter());
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.counts, {messages:2, prompts:1, answers:1, codeBlocks:1});
  assert(!JSON.stringify(result).includes('Synthetic prompt'));
  assert(!JSON.stringify(result).includes('Synthetic code'));
});

test('challenge, login, changed selectors and missing code are not compatibility passes', async () => {
  const {analyzeHTML} = await load();
  const source = await adapter();
  for (const html of ['<h1>Verify you are human</h1>', '<main><p>Private answer unavailable</p></main>', fixture.replace(/<pre>[\s\S]*?<\/pre>/, '')]) {
    assert.equal((await analyzeHTML(html, source)).status, 'inconclusive');
  }
});

test('HTTP errors and redirects are not followed and do not expose their response body', async () => {
  const {checkPublicSite} = await load();
  for (const status of [302, 403, 429, 503]) {
    let options;
    const result = await checkPublicSite('https://chatgpt.com/share/synthetic', {fetcher:async (_url, init) => {
      options = init; return new Response('PRIVATE ERROR TEXT', {status, headers:{Location:'https://example.com', 'Content-Type':'text/html'}});
    }});
    assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit');
    assert.equal(result.status, 'unavailable'); assert(!JSON.stringify(result).includes('PRIVATE'));
  }
});

test('fetch errors, non-HTML responses and oversize pages give a bounded failure', async () => {
  const {checkPublicSite} = await load();
  for (const fetcher of [async () => { throw Error('private URL or cookie'); }, async () => new Response('{}', {headers:{'Content-Type':'application/json'}}), async () => new Response('a'.repeat(8 * 1024 * 1024 + 1), {headers:{'Content-Type':'text/html'}})]) {
    const result = await checkPublicSite('https://chatgpt.com/share/synthetic', {fetcher});
    assert.equal(result.status, 'unavailable'); assert(!JSON.stringify(result).includes('private URL'));
  }
});
