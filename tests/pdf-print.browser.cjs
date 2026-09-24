/* SPDX-License-Identifier: GPL-3.0-or-later
 * Real Chromium print regression (Node.js 22+; no browser automation dependency).
 * Run: node tests/pdf-print.browser.cjs
 * Set CHROME_BINARY to override Chrome/Edge discovery. Uses an isolated profile.
 * Production content scripts, iframe, TeX worker and fonts are served unchanged.
 * Only extension storage/URL APIs and window.print are supplied by the fixture.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'engine-fixtures');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const conversationPath = '/c/12345678-1234-4123-8123-123456789abc';
const escapeHTML = value => value.replace(/[&<>\"]/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[character]));

function browserBinary() {
  if (process.env.CHROME_BINARY) return process.env.CHROME_BINARY;
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  const found = candidates.find(candidate => fsSync.existsSync(candidate));
  if (!found) throw Error('Chromium browser not found. Set CHROME_BINARY to a Chrome or Edge executable.');
  return found;
}
async function until(read, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(40);
  }
  throw Error(label + ' timed out');
}
class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 0; this.pending = new Map(); this.errors = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timeout);
      if (message.error) pending.reject(Error(message.error.message)); else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(Error('Browser connection closed')); }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, {once:true});
      socket.addEventListener('error', () => reject(Error('Could not connect to browser')), {once:true});
    });
    return new CDP(socket);
  }
  call(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 45000);
      this.pending.set(id, {resolve, reject, timeout}); this.socket.send(JSON.stringify({id, method, params}));
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
}

const diagrams = [
  String.raw`\begin{tikzpicture}\draw[blue,thick] (0,0) rectangle (4,2);\node at (2,1) {$E=mc^2$};\end{tikzpicture}`,
  String.raw`\begin{tikzpicture}\draw[blue,thick] (0,0) rectangle (28,4);\node at (14,2) {$\int_0^1 x^2\,dx=\frac13$};\end{tikzpicture}`,
  String.raw`\begin{tikzpicture}\draw[red,thick] (0,0) rectangle (4,35);\node at (2,17.5) {$a^2+b^2=c^2$};\end{tikzpicture}`
];
function fixture() {
  const diagram = index => '<pre data-fixture-diagram="' + index + '"><code class="language-tikz">' + escapeHTML(diagrams[index]) + '</code></pre>';
  const longCode = '// Preserve long code and wrap it without clipping\nconst longValue = "' + 'abcdef'.repeat(75) + '";\n' + Array.from({length:36}, (_, index) => 'console.log("Code line ' + (index + 1) + '");').join('\n');
  return `<!doctype html><html class="dark"><head><meta charset="utf-8"><title>Rich PDF regression - ChatGPT</title>
    <link rel="stylesheet" href="/content.css"><style>
      *{box-sizing:border-box}html,body{margin:0;background:#212121;color:#ececec;font:16px/1.6 Arial,sans-serif}
      #app{height:100vh;overflow:auto}main{max-width:820px;margin:auto;padding:24px}header{padding:12px}
      [data-message-author-role]{margin:28px 0}.prose h2{font-size:25px;line-height:1.3}.prose p{margin:12px 0}
      .scroll-wrapper{max-height:120px;overflow:auto}pre{white-space:pre;overflow:auto;background:#303030;padding:12px}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #555;padding:8px}
      .katex{font:1.18em Georgia,serif}.katex-display{display:block;text-align:center;margin:14px 0}
      .katex-html{display:inline-block}.katex .frac{display:inline-flex;vertical-align:middle;flex-direction:column;line-height:1.25;text-align:center}
      .katex .frac .num{border-bottom:1px solid currentColor;padding:0 5px}.katex-mathml{position:absolute;clip:rect(1px,1px,1px,1px);width:1px;height:1px;overflow:hidden}
      .native-math-label{font-weight:bold}.screen-only-hidden{display:none}
    </style><script>
      window.testPrintCalls=0;window.testBridgeRequests=[];window.print=()=>{window.testPrintCalls++;};
      window.addEventListener('message',event=>{if(event.data?.channel==='latex-islands-conversation-export-v1'&&event.data.type==='request')window.testBridgeRequests.push(event.data.path);});
      const storage={autoRender:false};globalThis.chrome={runtime:{getURL:path=>location.origin+'/'+path,lastError:null},storage:{local:{
        get(defaults,callback){const value={...defaults,...storage};if(callback)queueMicrotask(()=>callback(value));return Promise.resolve(value);},
        set(value,callback){Object.assign(storage,value);if(callback)queueMicrotask(callback);return Promise.resolve();}
      },onChanged:{addListener(){}}}};
    </script></head><body><div id="app"><header><div id="conversation-header-actions"></div><button>APP_CHROME_CONTROL</button></header><main>
      <article data-message-author-role="user"><div class="whitespace-pre-wrap">USER_MESSAGE_ONLY: Explain the equations and keep the diagram proportions.</div></article>
      <article data-message-author-role="assistant" data-fixture-reply="first"><div class="markdown prose">
        <h2>FIRST_REPLY_ONLY: A rich mathematical answer</h2><p>Keep <strong>bold emphasis</strong>, <em>italics</em>, <a href="https://example.org/reference">a reference link</a> and native equations.</p>
        <span class="katex-display"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mn>1</mn><mn>3</mn></mfrac></math></span><span class="katex-html" aria-hidden="true"><span class="native-math-label">∫₀¹ x² dx = </span><span class="frac"><span class="num">1</span><span class="den">3</span></span></span></span></span>
        <svg id="mermaid-native" class="native-mermaid" xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100"><style>#mermaid-native .node rect{fill:rgb(210,236,255);stroke:rgb(18,52,86);stroke-width:2px}#mermaid-native .label{font:16px Arial,sans-serif;color:rgb(18,52,86)}</style><g class="node"><rect x="20" y="20" width="340" height="60" rx="8"/><foreignObject x="40" y="35" width="300" height="35"><div xmlns="http://www.w3.org/1999/xhtml" class="label">Native Mermaid HTML label</div></foreignObject></g></svg>
        <p>Small diagram, then one wider than an A4 page:</p>${diagram(0)}${diagram(1)}
        <h3>A formatted table</h3><div class="scroll-wrapper"><table><thead><tr><th>Quantity</th><th>Value</th></tr></thead><tbody>${Array.from({length:6}, (_, index) => '<tr><td>Measurement ' + (index + 1) + '</td><td>' + (index + 1) / 3 + '</td></tr>').join('')}</tbody></table></div>
        <h3>Long code remains readable</h3><pre><div><button>COPY_CODE_CONTROL</button><code class="language-javascript">${escapeHTML(longCode)}</code></div></pre>
        <p><img alt="Inline illustration" width="90" height="45" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='45'%3E%3Crect width='90' height='45' fill='%23abc'/%3E%3C/svg%3E"></p>
        <button>COPY_REPLY_CONTROL</button><span hidden>HIDDEN_CONTROL</span><div class="screen-only-hidden">CSS_HIDDEN_CONTROL</div><div aria-hidden="true">ARIA_HIDDEN_CONTROL</div>
      </div></article>
      <article data-message-author-role="assistant" data-fixture-reply="second"><div class="markdown prose"><h2>SECOND_REPLY_ONLY: Tall diagram</h2><p>The complete diagram must fit vertically on a page.</p>${diagram(2)}<p>END_OF_SECOND_REPLY</p></div></article>
    </main><form data-testid="composer"><textarea>COMPOSER_CONTROL</textarea></form></div>
    ${['core.js','export-core.js','export-preview-renderer.js','native-controls.js','content.js','export-pdf.js','conversation-export.js'].map(filename => '<script src="/' + filename + '"></script>').join('')}
    </body></html>`;
}

async function main() {
  await fs.mkdir(output, {recursive:true});
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-islands-pdf-print-'));
  const profile = path.join(temporary, 'profile'); await fs.mkdir(profile);
  const requests = [], heldFonts = new Set(), reports = [];
  let holdFonts = false, child, cdp, stderr = '';
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      requests.push(pathname); response.setHeader('Cache-Control', 'no-store');
      if (pathname === conversationPath) { response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end(fixture()); return; }
      if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const target = path.resolve(root, '.' + pathname);
      if (!target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
      const data = await fs.readFile(target);
      const mime = {'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.woff2':'font/woff2','.svg':'image/svg+xml'};
      response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
      // The initial HTML already says "idle"; delay the script to exercise the
      // source/channel handshake instead of accidentally clicking before setup.
      if (pathname === '/island.js') await sleep(200);
      if (holdFonts && pathname.endsWith('.woff2')) { heldFonts.add({response, data}); return; }
      response.end(data);
    } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500); response.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const releaseFonts = () => { holdFonts = false; for (const {response, data} of heldFonts) response.end(data); heldFonts.clear(); };
  try {
    child = spawn(browserBinary(), ['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--disable-extensions','--disable-component-update','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir=' + profile,'--window-size=1000,900','--force-device-scale-factor=1','about:blank'], {windowsHide:true, stdio:['ignore','ignore','pipe']});
    let spawnError; child.on('error', error => { spawnError = error; }); child.stderr.on('data', data => { stderr = (stderr + data).slice(-6000); });
    const port = await until(async () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw Error('Browser exited: ' + stderr);
      try { return (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]; } catch { return false; }
    }, 'Browser startup');
    const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', {method:'PUT'})).json();
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.call('Page.enable'); await cdp.call('Runtime.enable'); await cdp.call('Network.enable');
    await cdp.call('Network.setCacheDisabled', {cacheDisabled:true});
    await cdp.call('Emulation.setDeviceMetricsOverride', {width:1000,height:900,deviceScaleFactor:1,mobile:false});
    const browser = (await cdp.call('Browser.getVersion')).product;
    await cdp.call('Page.navigate', {url:origin + conversationPath});
    await until(() => cdp.evaluate(`(() => {
      const sources=${JSON.stringify(diagrams)},frames=[...document.querySelectorAll('.latex-islands-container iframe')];
      return frames.length===sources.length&&frames.every((frame,index)=>{
        const doc=frame.contentDocument,button=doc?.getElementById('render-manual');
        return doc?.querySelector('.island')?.dataset.state==='idle'&&doc?.getElementById('source')?.value===sources[index]&&button&&!button.hidden;
      });
    })()`), 'Three initialized diagram frames');
    for (let index = 0; index < 3; index++) {
      await cdp.evaluate(`document.querySelectorAll('.latex-islands-container iframe')[${index}].contentDocument.getElementById('render-manual').click()`);
      await until(async () => {
        const state = await cdp.evaluate(`(() => {const doc=document.querySelectorAll('.latex-islands-container iframe')[${index}].contentDocument;return {state:doc.querySelector('.island').dataset.state,error:doc.getElementById('error').textContent};})()`);
        if (state.state === 'error') throw Error('Real TeX compile failed: ' + state.error);
        return state.state === 'ready';
      }, 'Real TeX diagram ' + (index + 1), 90000);
      console.log('Compiled real diagram ' + (index + 1) + '/3');
    }
    const original = await until(async () => {
      const state = await cdp.evaluate(`(() => {const frames=[...document.querySelectorAll('.latex-islands-container iframe')];return {states:frames.map(frame=>{const doc=frame.contentDocument;return {state:doc?.querySelector('.island')?.dataset.state,error:doc?.getElementById('error')?.textContent,svg:doc?.getElementById('output')?.querySelector('svg')?.outerHTML};}),buttons:document.querySelectorAll('.li-export-reply').length};})()`);
      const error = state.states.find(item => item.state === 'error'); if (error) throw Error('Real TeX compile failed: ' + error.error);
      return state.states.length === 3 && state.states.every(item => item.state === 'ready') && state.buttons === 2 ? state : false;
    }, 'Three real compiled diagrams', 90000);
    assert(original.states.every(item => /[\uE000-\uF8FF]|&#x[fF]/.test(item.svg)), 'Real engine output must contain TeX glyphs');

    // The interactive preview deliberately does not show the whole diagram.
    const transforms = await cdp.evaluate(`(() => [...document.querySelectorAll('.latex-islands-container iframe')].map(frame=>{const doc=frame.contentDocument;for(let i=0;i<3;i++)doc.getElementById('zoom-in').click();const output=doc.getElementById('output');output.style.transform+=' translate(71px, -29px)';return output.style.transform;}))()`);
    assert(transforms.every(value => value.includes('71px')), 'Pan/zoom fixture must exercise transformed previews');

    const openConversation = async () => cdp.evaluate(`(() => {document.querySelector('.li-export-toggle').click();const format=document.getElementById('li-export-format');format.value='pdf';format.dispatchEvent(new Event('change',{bubbles:true}));return !document.querySelector('.li-export-panel').hidden;})()`);
    assert(await openConversation());
    // Hold the actual font embedding fetch, then cancel via the production UI.
    holdFonts = true;
    await cdp.evaluate(`document.querySelector('.li-export-save').click()`);
    await until(() => heldFonts.size > 0, 'Pending diagram font embedding');
    await cdp.evaluate(`document.querySelector('.li-export-cancel').click()`);
    const cancelled = await until(() => cdp.evaluate(`(() => {const panel=document.querySelector('.li-export-panel');return panel.getAttribute('aria-busy')==='false'?{status:document.querySelector('.li-export-status').textContent,roots:document.querySelectorAll('.li-pdf-root,.li-pdf-document').length,printing:document.body.classList.contains('li-pdf-printing'),calls:window.testPrintCalls}:null;})()`), 'Cancelled PDF operation');
    assert.match(cancelled.status, /cancel/i); assert.equal(cancelled.roots, 0); assert.equal(cancelled.printing, false); assert.equal(cancelled.calls, 0);
    releaseFonts(); reports.push({case:'cancel during font embedding', ...cancelled});

    // Preview is an in-dialog document, not an unexpected print invocation.
    await cdp.call('Emulation.setDeviceMetricsOverride', {width:1180,height:900,deviceScaleFactor:1,mobile:false});
    await cdp.evaluate(`document.querySelector('.li-export-inspect').click()`);
    await until(() => cdp.evaluate(`document.querySelector('.li-export-panel').getAttribute('aria-busy')==='false'&&!!document.querySelector('.li-export-pdf-preview .li-pdf-preview')`), 'Rich in-dialog preview');
    assert.equal(await cdp.evaluate('window.testPrintCalls'), 0);
    let shot = await cdp.call('Page.captureScreenshot', {format:'png'});
    await fs.writeFile(path.join(output, 'pdf-dialog-preview.png'), Buffer.from(shot.data, 'base64'));
    await cdp.evaluate(`document.querySelector('.li-export-choose-messages').click()`);
    await until(() => cdp.evaluate(`document.querySelectorAll('.li-export-message-choice input').length===3&&document.querySelector('.li-export-panel').getAttribute('aria-busy')==='false'`), 'Message selection');
    await cdp.evaluate(`document.querySelector('.li-export-select-none').click();document.querySelectorAll('.li-export-message-choice input')[2].click()`);
    shot = await cdp.call('Page.captureScreenshot', {format:'png'});
    await fs.writeFile(path.join(output, 'pdf-dialog-selection.png'), Buffer.from(shot.data, 'base64'));
    await cdp.evaluate(`document.querySelector('.li-export-inspect').click()`);
    await until(() => cdp.evaluate(`document.querySelector('.li-export-panel').getAttribute('aria-busy')==='false'&&document.querySelectorAll('.li-export-pdf-preview .li-pdf-message').length===1`), 'Single selected message preview');
    assert.equal(await cdp.evaluate('window.testPrintCalls'), 0);
    await cdp.evaluate(`document.querySelector('.li-export-selection-mode').click();document.querySelector('.li-export-select-all').click()`);

    async function printCase(name, expectedMessages, expectedDiagrams, trigger) {
      await cdp.call('Emulation.setEmulatedMedia', {media:'screen'});
      const beforeCalls = await cdp.evaluate('window.testPrintCalls');
      await trigger();
      await until(async () => {
        const state = await cdp.evaluate(`({calls:window.testPrintCalls,status:document.querySelector('.li-export-status').textContent,state:document.querySelector('.li-export-status').dataset.state})`);
        if (state.state === 'error') throw Error(name + ': ' + state.status);
        return state.calls === beforeCalls + 1;
      }, name + ' print invocation');
      const screen = await cdp.evaluate(`(() => {const root=document.querySelector('.li-pdf-root,.li-pdf-document');return {display:getComputedStyle(root).display,title:document.title,body:document.body.classList.contains('li-pdf-printing')};})()`);
      assert.equal(screen.display, 'none', 'PDF clone must not affect the screen conversation'); assert.equal(screen.body, true);
      // 178 mm = A4 width minus two 16 mm margins, at 96 CSS pixels per inch.
      await cdp.call('Emulation.setDeviceMetricsOverride', {width:673,height:900,deviceScaleFactor:1,mobile:false});
      await cdp.call('Emulation.setEmulatedMedia', {media:'print'});
      await cdp.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const geometry = await cdp.evaluate(`(() => {
        const root=document.querySelector('.li-pdf-root,.li-pdf-document'),rect=root.getBoundingClientRect();
        const bounds=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
        return {display:getComputedStyle(root).display,root:bounds(root),messages:root.querySelectorAll('.li-pdf-message').length,text:root.innerText,
          appDisplay:getComputedStyle(document.getElementById('app')).display,openDialogs:[...document.querySelectorAll('dialog[open]')].map(node=>({display:getComputedStyle(node).display,bounds:bounds(node)})),
          overflow:root.scrollWidth>Math.ceil(rect.width)+1,controls:root.querySelectorAll('button,iframe,textarea,dialog,[role="toolbar"]').length,
          diagrams:[...root.querySelectorAll('.li-pdf-island-image')].map(image=>({box:bounds(image),naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,fit:getComputedStyle(image).objectFit,embeddedFonts:decodeURIComponent(image.src).includes('data:font/woff2;base64,'),transform:getComputedStyle(image).transform,filter:getComputedStyle(image).filter,svg:decodeURIComponent(image.src.split(',').slice(1).join(','))})),
          nativeMath:root.querySelector('.katex-html')?{box:bounds(root.querySelector('.katex-html')),display:getComputedStyle(root.querySelector('.katex-html')).display,font:getComputedStyle(root.querySelector('.katex')).fontFamily,fraction:bounds(root.querySelector('.frac')),mathml:getComputedStyle(root.querySelector('.katex-mathml')).display}:null,
          mermaid:root.querySelector('.native-mermaid')?{id:root.querySelector('.native-mermaid').id,label:root.querySelector('.native-mermaid foreignObject')?.textContent,labelBox:root.querySelector('.native-mermaid foreignObject .label')?bounds(root.querySelector('.native-mermaid foreignObject .label')):null,fill:getComputedStyle(root.querySelector('.native-mermaid rect')).fill,stroke:getComputedStyle(root.querySelector('.native-mermaid rect')).stroke}:null,
          tables:root.querySelectorAll('table').length,code:root.querySelector('pre code')?.textContent,
          imagesReady:[...root.querySelectorAll('img')].every(image=>image.complete&&image.naturalWidth>0)};
      })()`);
      assert.equal(geometry.display, 'block'); assert.equal(geometry.appDisplay, 'none');
      assert.equal(geometry.messages, expectedMessages); assert.equal(geometry.diagrams.length, expectedDiagrams);
      assert.equal(geometry.controls, 0); assert.equal(geometry.overflow, false, 'PDF content must not overflow the printable width');
      assert.equal(geometry.imagesReady, true); assert(!/APP_CHROME_CONTROL|COPY_CODE_CONTROL|COPY_REPLY_CONTROL|HIDDEN_CONTROL|COMPOSER_CONTROL/.test(geometry.text));
      assert(geometry.openDialogs.every(dialog => dialog.display === 'none' || !dialog.bounds.width || !dialog.bounds.height), 'Modal export controls must not cover the printed document');
      for (const diagram of geometry.diagrams) {
        assert(diagram.box.width > 0 && diagram.box.height > 0); assert(diagram.box.width <= geometry.root.width + 1); assert(diagram.box.height <= 180 * 96 / 25.4 + 1);
        assert.equal(diagram.fit, 'contain'); assert.equal(diagram.transform, 'none'); assert.equal(diagram.filter, 'none'); assert(diagram.embeddedFonts, 'TeX font bytes must travel with every exported SVG');
        assert(!diagram.svg.includes('71px'), 'Pan transform must never be exported'); delete diagram.svg;
      }
      if (name === 'conversation') {
        assert(geometry.text.includes('USER_MESSAGE_ONLY')); assert(geometry.text.includes('FIRST_REPLY_ONLY')); assert(geometry.text.includes('SECOND_REPLY_ONLY')); assert(geometry.text.includes('END_OF_SECOND_REPLY'));
        assert.equal(geometry.tables, 1); assert(geometry.code.includes('Code line 36')); assert(geometry.code.includes('abcdef'.repeat(75)));
        assert(geometry.nativeMath.box.width > 20 && geometry.nativeMath.box.height > 10); assert(geometry.nativeMath.fraction.height > 25); assert.match(geometry.nativeMath.font, /Georgia/); assert.equal(geometry.nativeMath.mathml, 'none');
        assert.equal(geometry.mermaid.label, 'Native Mermaid HTML label'); assert(geometry.mermaid.labelBox.width > 0 && geometry.mermaid.labelBox.height > 0); assert.notEqual(geometry.mermaid.id, 'mermaid-native');
        assert.equal(geometry.mermaid.fill, 'rgb(210, 236, 255)'); assert.equal(geometry.mermaid.stroke, 'rgb(18, 52, 86)');
      } else { assert(!geometry.text.includes('USER_MESSAGE_ONLY')); assert(!geometry.text.includes('FIRST_REPLY_ONLY')); assert(geometry.text.includes('SECOND_REPLY_ONLY')); }
      const screenshot = await cdp.call('Page.captureScreenshot', {format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:673,height:Math.ceil(geometry.root.height),scale:1}});
      await fs.writeFile(path.join(output, 'pdf-' + name + '.png'), Buffer.from(screenshot.data, 'base64'));
      const printed = await cdp.call('Page.printToPDF', {preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
      const pdf = Buffer.from(printed.data, 'base64'); assert.equal(pdf.subarray(0,5).toString(), '%PDF-'); assert(pdf.length > 10000);
      const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
      if (name === 'conversation') assert(pages >= 3);
      else assert.equal(pages, 1, 'Tall reply must leave room for the heading and context on the same page');
      await fs.writeFile(path.join(output, 'pdf-' + name + '.pdf'), pdf);
      // Chromium emits afterprint for printToPDF. Explicitly dispatching it also
      // covers browsers/CDP builds that omit the lifecycle event in headless mode.
      await cdp.evaluate(`window.dispatchEvent(new Event('afterprint'))`);
      await cdp.call('Emulation.setEmulatedMedia', {media:'screen'});
      const cleanup = await cdp.evaluate(`({roots:document.querySelectorAll('.li-pdf-root,.li-pdf-document').length,styles:document.querySelectorAll('style[data-latex-islands-pdf]').length,printing:document.body.classList.contains('li-pdf-printing'),title:document.title})`);
      assert.deepEqual(cleanup, {roots:0,styles:0,printing:false,title:'Rich PDF regression - ChatGPT'});
      const {text, code, ...summary} = geometry;
      reports.push({case:name,bytes:pdf.length,pages,geometry:summary,cleanup});
    }
    await printCase('conversation', 3, 3, () => cdp.evaluate(`document.querySelector('.li-export-save').click()`));
    await cdp.evaluate(`document.querySelector('.li-export-close').click();document.querySelector('[data-fixture-reply="second"] .li-export-reply').click()`);
    assert.equal(await cdp.evaluate(`document.getElementById('li-export-title').textContent`), 'Export reply');
    await printCase('reply', 1, 1, () => cdp.evaluate(`document.querySelector('.li-export-save').click()`));

    // A real scrolling DOM keeps only overlapping windows of messages mounted.
    // There is no JSON endpoint or reconstructed transcript in this fixture.
    await cdp.evaluate(`(() => {
      document.querySelector('.li-export-close').click();
      const main=document.querySelector('main'),scroller=document.getElementById('app');
      main.style.cssText='position:relative;height:2400px;margin:0;padding:0';scroller.dataset.scrollRoot='';
      window.virtualWindows=[];
      const paint=()=>{const start=Math.max(0,Math.min(6,Math.floor(scroller.scrollTop/200)-1));
        window.virtualWindows.push(start);
        main.replaceChildren(...Array.from({length:6},(_,offset)=>{const index=start+offset,node=document.createElement('article');
          node.dataset.messageAuthorRole=index%2?'assistant':'user';node.dataset.messageId='lazy-'+index;
          node.dataset.testid='conversation-turn-'+index;node.style.cssText='position:absolute;top:'+(index*200)+'px;height:180px;margin:0';
          const p=document.createElement('p');p.textContent='VISIBLE_DOM_MESSAGE_'+index;node.append(p);return node;}));};
      scroller.addEventListener('scroll',paint);scroller.scrollTop=700;paint();
      window.virtualStartTop=scroller.scrollTop;
    })()`);
    const lazy = await cdp.evaluate(`(async()=>{
      const capture=await LatexIslandsPDF.collect();window.virtualCapture=capture;
      return {keys:capture.messages.map(entry=>entry.key),windows:[...new Set(window.virtualWindows)],restored:document.getElementById('app').scrollTop,initial:window.virtualStartTop};
    })()`);
    assert.deepEqual(lazy.keys, Array.from({length:12}, (_,index) => 'message:lazy-'+index));
    assert(lazy.windows.length>3, 'The page must actually scroll through several mounted windows');
    assert.equal(lazy.restored,lazy.initial,'The original scroll position is restored');
    await cdp.evaluate(`(async()=>{window.virtualDocument=await LatexIslandsPDF.prepare({capture:window.virtualCapture,selectedKeys:['message:lazy-10','message:lazy-1']});window.virtualDocument.print();})()`);
    assert.deepEqual(await cdp.evaluate(`[...document.querySelectorAll('.li-pdf-active .li-pdf-content p')].map(node=>node.textContent)`),['VISIBLE_DOM_MESSAGE_1','VISIBLE_DOM_MESSAGE_10']);
    await cdp.call('Emulation.setEmulatedMedia',{media:'print'});
    assert.equal(await cdp.evaluate(`getComputedStyle(document.getElementById('app')).display`),'none');
    const lazyPDF=await cdp.call('Page.printToPDF',{preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
    await fs.writeFile(path.join(output,'pdf-selected-history.pdf'),Buffer.from(lazyPDF.data,'base64'));
    await cdp.evaluate(`window.dispatchEvent(new Event('afterprint'));window.virtualCapture.dispose()`);
    reports.push({case:'auto-scroll virtualized history and arbitrary selection',...lazy});
    assert.deepEqual(await cdp.evaluate('window.testBridgeRequests'), [], 'PDF export must not request the conversation backend');
    assert(!requests.some(request => request.includes('/backend-api/')));
    assert.deepEqual(cdp.errors, [], 'No browser exceptions');
    const report = {ok:true,browser,productionEngine:true,backendRequests:0,artifacts:output,cases:reports};
    await fs.writeFile(path.join(output, 'pdf-print-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify({browserErrors:cdp?.errors,requests:requests.slice(-15),stderr}, null, 2));
    throw error;
  } finally {
    releaseFonts();
    if (cdp) { try { await cdp.call('Browser.close'); } catch {} cdp.socket.close(); }
    if (child && child.exitCode === null) { await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(3000)]); if (child.exitCode === null) child.kill(); }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    // Only the freshly created isolated profile is removed, never a user profile.
    const target = path.resolve(profile);
    if (path.dirname(target) !== path.resolve(temporary) || !path.basename(temporary).startsWith('latex-islands-pdf-print-')) throw Error('Unsafe temporary profile path');
    await fs.rm(target, {recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
