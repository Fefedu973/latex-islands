/* SPDX-License-Identifier: GPL-3.0-or-later
 * Optional, unauthenticated public-share DOM contract sentinel, Node.js 22+.
 * Does not execute ChatGPT scripts, use cookies or reconstruct API messages.
 * Only counts/status leave this process; conversation HTML/text is not saved.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {JSDOM, VirtualConsole} from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharePath = /^\/share\/[a-zA-Z0-9-]+\/?$/;
const coverage = 'Public shared-page server HTML only; authenticated UI, hydration, streaming and PDF print are not exercised.';

export function publicShareURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || url.port || url.username || url.password || url.search || url.hash || !sharePath.test(url.pathname)) {
    throw new Error('CHATGPT_SMOKE_URL must be an HTTPS chatgpt.com/share/... URL without credentials, query parameters or a fragment.');
  }
  return url;
}

export async function analyzeHTML(html, adapterSource) {
  // outside-only allows our checked-in adapter, never scripts in the fetched HTML.
  // No resources option means no images, stylesheets, frames or scripts are fetched.
  const dom = new JSDOM(html, {url:'https://chatgpt.com/share/compatibility-fixture', runScripts:'outside-only', virtualConsole:new VirtualConsole()});
  try {
    dom.window.eval(adapterSource);
    const adapter = dom.window.LatexIslandsChatGPT;
    const messages = adapter.getMessages();
    const counts = {
      messages:messages.length,
      prompts:messages.filter(message => adapter.role(message) === 'user').length,
      answers:messages.filter(message => adapter.role(message) === 'assistant').length,
      codeBlocks:messages.reduce((total, message) => total + adapter.getCodeBlocks(message).length, 0)
    };
    const hasConversation = counts.prompts > 0 && counts.answers > 0;
    return hasConversation && counts.codeBlocks > 0
      ? {status:'passed', counts, reason:'Production DOM adapter recognizes prompts, answers and code blocks in public server HTML.', coverage}
      : {status:'inconclusive', counts, reason:hasConversation
        ? 'The public fixture contains no recognizable code block. Check its content and the code-block selectors.'
        : 'No complete conversation is recognizable. The site may require hydration/login, block automation, or have changed its DOM. This is not a compatibility pass.', coverage};
  } finally { dom.window.close(); }
}

export async function fetchPublicHTML(url, fetcher = fetch) {
  const response = await fetcher(publicShareURL(url), {
    redirect:'manual', credentials:'omit', signal:AbortSignal.timeout(25000),
    headers:{Accept:'text/html', 'User-Agent':'LaTeX-Islands-Compatibility-Check/1.0 (public synthetic share only)'}
  });
  // Do not follow a login/challenge redirect or forward credentials to another host.
  if (!response.ok) { await response.body?.cancel(); throw new Error('Public page returned HTTP ' + response.status + '; live compatibility was not verified.'); }
  if (!/\btext\/html\b/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel(); throw new Error('Public page did not return HTML; live compatibility was not verified.');
  }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 8 * 1024 * 1024) throw new Error('Public HTML exceeds the 8 MiB safety limit.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function checkPublicSite(value, {fetcher = fetch, adapterSource} = {}) {
  if (!value?.trim()) return {status:'not-configured', reason:'Set the CHATGPT_SMOKE_URL repository variable to an intentionally public, synthetic shared conversation. Live ChatGPT was not tested.', coverage};
  try {
    const html = await fetchPublicHTML(value.trim(), fetcher);
    return await analyzeHTML(html, adapterSource ?? await fs.readFile(path.join(root, 'chatgpt-dom.js'), 'utf8'));
  } catch (error) {
    // Never include a request URL, response body, arbitrary remote error or page text.
    return {status:'unavailable', reason:error?.message?.startsWith('Public ') || error?.message?.startsWith('CHATGPT_SMOKE_URL ')
      ? error.message : 'Could not complete the public-page request or DOM check; live compatibility was not verified.', coverage};
  }
}

async function main() {
  const result = await checkPublicSite(process.env.CHATGPT_SMOKE_URL);
  const report = {...result, checkedAt:new Date().toISOString()};
  const output = path.join(root, 'tests/engine-fixtures/public-chatgpt-report.json');
  await fs.mkdir(path.dirname(output), {recursive:true});
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
    '## Public ChatGPT compatibility\n\n**' + result.status + '** — ' + result.reason + '\n\n' + coverage + '\n');
  if (result.status === 'not-configured') console.warn('::warning::Live ChatGPT was NOT tested: CHATGPT_SMOKE_URL is not configured.');
  else if (result.status !== 'passed') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
