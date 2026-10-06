/* SPDX-License-Identifier: GPL-3.0-or-later
 * Native window.print -> Chrome print preview -> Save as PDF regression.
 * Node 22+, headed Chrome; Linux: xvfb-run -a node tests/pdf-native-print.browser.cjs
 * Text verification: pdftotext on PATH/PDFTOTEXT_BINARY, or PDF_PYTHON with pypdf.
 * Only a fresh offscreen profile is used, with Save as PDF explicitly selected.
 * No user browser/profile, native printer, mocked print or Page.printToPDF.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn, execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'engine-fixtures');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const withoutGuard = process.argv.includes('--without-print-guard');
const HOST_PRINT_CSS = `@layer components { @media print {
  :is(html:has(.printDocument-v_w5Ax),body:has(> .printDocument-v_w5Ax)){height:auto!important;min-height:0!important;overflow:visible!important}
  body:has(> .printDocument-v_w5Ax)>:not(.printDocument-v_w5Ax){display:none!important}
  .printDocument-v_w5Ax :is(.turn-action-controls,[data-block-actions],[role="toolbar"],[role="scrollbar"]){display:none!important}
} }`;

function browserBinary() {
  if (process.env.CHROME_BINARY) return process.env.CHROME_BINARY;
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe')
  ] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find(candidate => fsSync.existsSync(candidate));
  if (!found) throw Error('Chrome not found. Set CHROME_BINARY; this native-print test requires a headed browser.');
  return found;
}
function textExtractor() {
  const executable = process.env.PDFTOTEXT_BINARY || 'pdftotext';
  try {
    execFileSync(executable, ['-v'], {stdio:'pipe', windowsHide:true, timeout:5000});
    return {name:'pdftotext', extract:file => execFileSync(executable, ['-layout', file, '-'], {encoding:'utf8', windowsHide:true, timeout:10000, maxBuffer:4 * 1024 * 1024})};
  } catch (error) { if (process.env.PDFTOTEXT_BINARY) throw error; }
  const python = process.env.PDF_PYTHON || 'python';
  try { execFileSync(python, ['-c', 'import pypdf'], {stdio:'pipe', windowsHide:true, timeout:5000}); }
  catch { throw Error('PDF text verification needs pdftotext, or PDF_PYTHON pointing to Python with pypdf. No package is installed by this test.'); }
  return {name:'pypdf', extract:file => execFileSync(python, ['-c', 'import sys; from pypdf import PdfReader; print("\\n".join(p.extract_text() or "" for p in PdfReader(sys.argv[1]).pages))', file], {encoding:'utf8', windowsHide:true, timeout:10000, maxBuffer:4 * 1024 * 1024})};
}
async function until(read, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await read(); if (result) return result; await sleep(100); }
  throw Error(label + ' timed out');
}
class CDP {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map(); this.errors = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error('Browser closed')); }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once:true}); socket.addEventListener('error', reject, {once:true}); });
    return new CDP(socket);
  }
  call(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 60000);
      this.pending.set(id, {resolve, reject, timer}); this.socket.send(JSON.stringify({id, method, params}));
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true, userGesture:true});
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
}
function fixture() {
  const paragraphs = Array.from({length:48}, (_, index) => `<p>Paragraph ${index + 1}: This intentionally synthetic scientific explanation must remain present after native printing. Preview and repeat export use the same prepared document.</p>`).join('');
  return `<!doctype html><html class="dark"><head><meta charset="utf-8"><title>Native PDF lifecycle - ChatGPT</title><style>
    html,body{margin:0;color:#ececec;background:#212121;font:16px/1.6 Arial,sans-serif}main{max-width:760px;margin:auto;padding:24px}
    dialog.li-export{width:820px;max-width:90vw;background:#292929;color:#eee;border:0;border-radius:20px;padding:20px}
    .li-export-pdf-preview{height:590px;overflow:auto;background:#ddd}.printDocument-v_w5Ax{display:none}
    ${HOST_PRINT_CSS}
  </style></head><body><main>
    <div data-message-author-role="user" data-message-id="synthetic-prompt">NATIVE_PRINT_PROMPT_SENTINEL Explain this synthetic fixture.</div>
    <div data-message-author-role="assistant" data-message-id="synthetic-answer"><h2>NATIVE_PRINT_ANSWER_SENTINEL</h2>
      ${paragraphs}<svg xmlns="http://www.w3.org/2000/svg" width="180" height="60"><rect x="2" y="2" width="176" height="56" fill="none" stroke="blue"/><text x="12" y="35" fill="blue">Native SVG</text></svg>
      <p>NATIVE_PRINT_FINAL_SENTINEL</p>
    </div>
  </main><div class="printDocument-v_w5Ax"></div>
  <dialog class="li-export"><button id="print-pdf">Print to PDF</button><div class="li-export-pdf-preview"></div></dialog>
  <script src="/chatgpt-dom.js"></script><script src="/export-pdf.js"></script>
  <script>
    window.printEvents=[];window.beforePrintStates=[];
    addEventListener('beforeprint',()=>{printEvents.push('beforeprint');const r=document.querySelector('.li-pdf-active');beforePrintStates.push({exists:!!r,display:r?getComputedStyle(r).display:null,inline:r?.style.getPropertyValue('display'),priority:r?.style.getPropertyPriority('display')});});
    addEventListener('afterprint',()=>printEvents.push('afterprint'));
    document.getElementById('print-pdf').addEventListener('click',()=>window.prepared.print());
    window.fixtureReady=(async()=>{window.prepared=await LatexIslandsPDF.prepare();prepared.mountPreview(document.querySelector('.li-export-pdf-preview'));document.querySelector('dialog').showModal();return true;})();
  </script></body></html>`;
}

async function main() {
  const extractor = textExtractor(), binary = browserBinary();
  if (process.platform === 'linux' && !process.env.DISPLAY) throw Error('Native print requires a display. Run with xvfb-run -a on Linux.');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-islands-native-print-'));
  const profile = path.join(temporary, 'profile'), downloads = path.join(temporary, 'pdf-output');
  await fs.mkdir(path.join(profile, 'Default'), {recursive:true}); await fs.mkdir(downloads); await fs.mkdir(output, {recursive:true});
  // A fresh profile has no remembered physical printer. Kiosk mode may only be
  // started after these exact Save as PDF preferences have been written/read.
  const state = {version:2, recentDestinations:[{id:'Save as PDF', origin:'local', account:''}], selectedDestinationId:'Save as PDF', isHeaderFooterEnabled:false, isCssBackgroundEnabled:true};
  const preferences = {printing:{print_preview_sticky_settings:{appState:JSON.stringify(state)}}, savefile:{default_directory:downloads}, download:{default_directory:downloads, prompt_for_download:false}};
  const preferenceFile = path.join(profile, 'Default', 'Preferences');
  await fs.writeFile(preferenceFile, JSON.stringify(preferences));
  const verified = JSON.parse(await fs.readFile(preferenceFile, 'utf8'));
  const selected = JSON.parse(verified.printing.print_preview_sticky_settings.appState);
  assert.equal(selected.selectedDestinationId, 'Save as PDF');
  assert.deepEqual(selected.recentDestinations, [{id:'Save as PDF', origin:'local', account:''}]);
  assert.equal(verified.savefile.default_directory, downloads);
  let child, cdp, stderr = '', browser = '', failure; const cases = [];
  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      if (req.url?.startsWith('/c/')) { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(fixture()); return; }
      if (req.url === '/chatgpt-dom.js' || req.url === '/export-pdf.js') {
        let source = await fs.readFile(path.join(root, req.url.slice(1)), 'utf8');
        if (withoutGuard && req.url === '/export-pdf.js') {
          const guard = "root.style.setProperty('display', 'block', 'important');";
          assert(source.includes(guard), 'Negative control must find the production print guard');
          source = source.replace(guard, '/* negative control: print guard removed in this served copy */');
        }
        res.setHeader('Content-Type', 'text/javascript'); res.end(source); return;
      }
      res.writeHead(404); res.end();
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    // Intentionally headed: native print preview and afterprint are the path
    // under test. Position the isolated window offscreen, never open a user tab.
    child = spawn(binary, ['--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--disable-extensions','--disable-component-update','--kiosk-printing','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir=' + profile,'--window-size=1000,850','--window-position=-32000,-32000','about:blank'], {windowsHide:true, stdio:['ignore','ignore','pipe']});
    let spawnError; child.on('error', error => { spawnError = error; }); child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-6000); });
    const port = await until(async () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw Error('Chrome exited before starting: ' + stderr);
      try { return (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]; } catch { return false; }
    }, 'Chrome startup', 20000);
    const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', {method:'PUT'})).json();
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.call('Page.enable'); await cdp.call('Runtime.enable');
    browser = (await cdp.call('Browser.getVersion')).product;
    await cdp.call('Page.navigate', {url:'http://127.0.0.1:' + server.address().port + '/c/12345678-1234-4123-8123-123456789abc'});
    await until(() => cdp.evaluate('Boolean(window.fixtureReady)'), 'Fixture scripts');
    await cdp.evaluate('window.fixtureReady');
    assert.equal(await cdp.evaluate('/\\[native code\\]/.test(String(window.print))'), true, 'window.print must not be mocked');
    const previewState = () => cdp.evaluate(`(()=>{const r=window.prepared.root;return {connected:r.isConnected,parent:r.parentElement?.className,display:getComputedStyle(r).display,height:r.getBoundingClientRect().height,messages:r.querySelectorAll('.li-pdf-message').length,printing:document.body.classList.contains('li-pdf-printing'),open:document.querySelector('dialog').open,events:[...window.printEvents],sameRoot:document.querySelector('.li-export-pdf-preview>.li-pdf-preview')===r,finalText:r.textContent.includes('NATIVE_PRINT_FINAL_SENTINEL')};})()`);
    const initial = await previewState();
    assert.equal(initial.sameRoot, true); assert.equal(initial.messages, 2); assert(initial.height > 0);
    for (let run = 1; run <= 2; run++) {
      assert.equal((await fs.readdir(downloads)).filter(name => name.endsWith('.pdf')).length, 0);
      // The production button handler invokes native window.print; this call
      // may not return until Chromium finishes its own preview/Save as PDF.
      await cdp.evaluate('document.getElementById("print-pdf").click()');
      const generated = await until(async () => {
        const files = (await fs.readdir(downloads)).filter(name => name.endsWith('.pdf'));
        if (files.length !== 1) return false;
        const file = path.join(downloads, files[0]);
        try { const bytes = await fs.readFile(file); return bytes.length && bytes.includes(Buffer.from('%%EOF')) ? {file, bytes} : false; } catch { return false; }
      }, 'Native Save as PDF output ' + run, 60000);
      assert.equal(generated.bytes.subarray(0, 5).toString(), '%PDF-');
      const pages = (generated.bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
      const text = extractor.extract(generated.file);
      const restored = await until(async () => {
        const state = await previewState();
        return state.events.filter(event => event === 'afterprint').length >= run && !state.printing ? state : false;
      }, 'Native afterprint and preview restoration ' + run);
      const artifact = path.join(output, 'pdf-native-print-' + (withoutGuard ? 'without-guard-' : '') + run + '.pdf');
      await fs.writeFile(artifact, generated.bytes); await fs.unlink(generated.file);
      cases.push({run, bytes:generated.bytes.length, pages, textCharacters:text.length, prompt:text.includes('NATIVE_PRINT_PROMPT_SENTINEL'), answer:text.includes('NATIVE_PRINT_ANSWER_SENTINEL'), final:text.includes('NATIVE_PRINT_FINAL_SENTINEL'), restored});
      assert(generated.bytes.length > 10000, 'Native PDF must contain real content, not a blank page');
      assert(pages >= 2, 'The long fixture must print multiple pages');
      for (const marker of ['NATIVE_PRINT_PROMPT_SENTINEL','NATIVE_PRINT_ANSWER_SENTINEL','NATIVE_PRINT_FINAL_SENTINEL']) assert(text.includes(marker), 'Native PDF lacks ' + marker);
      assert.equal(restored.sameRoot, true); assert.equal(restored.open, true); assert.equal(restored.messages, 2); assert.equal(restored.finalText, true); assert(restored.height > 0); assert.notEqual(restored.display, 'none');
      const screenshot = await cdp.call('Page.captureScreenshot', {format:'png'});
      await fs.writeFile(path.join(output, 'pdf-native-print-' + run + '-restored.png'), Buffer.from(screenshot.data, 'base64'));
    }
    assert.deepEqual(cdp.errors, []);
    assert.deepEqual(await cdp.evaluate('window.printEvents'), ['beforeprint','afterprint','beforeprint','afterprint']);
  } catch (error) { failure = error; }
  finally {
    const beforePrintStates = cdp ? await cdp.evaluate('window.beforePrintStates || []').catch(() => []) : [];
    const report = {ok:!failure, browser, nativeWindowPrint:true, mockedPrint:false, destination:selected.selectedDestinationId, source:'synthetic local conversation with the 2026-10-06 layered print CSS', negativeControl:withoutGuard, extractor:extractor.name, cases, beforePrintStates, error:failure?.message, browserErrors:cdp?.errors || []};
    await fs.writeFile(path.join(output, 'pdf-native-print-' + (withoutGuard ? 'without-guard-' : '') + 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (cdp) { try { await cdp.call('Browser.close'); } catch {} cdp.socket.close(); }
    if (child && child.exitCode === null) { await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(3000)]); if (child.exitCode === null) child.kill(); }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    // The only recursive cleanup target was freshly returned by mkdtemp.
    const target = path.resolve(temporary);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('latex-islands-native-print-')) throw Error('Unsafe temporary cleanup path');
    await fs.rm(target, {recursive:true, force:true, maxRetries:10, retryDelay:200});
  }
  if (failure) throw failure;
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
