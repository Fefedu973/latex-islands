/* SPDX-License-Identifier: GPL-3.0-or-later
 * Real Chromium print regression (Node.js 22+; no browser automation dependency).
 * Run: node tests/pdf-print.browser.cjs (or --ui-only / --navigation-only / --contrast-only)
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
    this.lastExpression=expression.slice(0,300);
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
    ${['core.js','export-core.js','export-preview-renderer.js','native-controls.js','chatgpt-dom.js','content.js','export-pdf.js','conversation-export.js'].map(filename => '<script src="/' + filename + '"></script>').join('')}
    </body></html>`;
}

// Public ChatGPT layout observed on 2026-09-26; content is entirely synthetic.
function modernFixture() {
  return `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><title>ChatGPT September layout</title><link rel="stylesheet" href="/content.css"><style>
  *{box-sizing:border-box}html,body{margin:0;height:100%;font:15px/1.6 system-ui;color:#ededed;background:#000}
  :root{--color-text-primary:#ededed;--color-text-secondary:#cdcdcd;--color-surface-elevated:#1b1b1b;--color-border-subtle:#ffffff0d;--radius-button-toolbar:9999px}
  html[data-theme="light"],html[data-theme="light"] body{color:#171717;background:#fff;--color-text-primary:#171717;--color-text-secondary:#616161;--color-surface-elevated:#fff;--color-border-subtle:#0000001a}
  aside{position:fixed;inset:0 auto 0 0;width:180px;border-right:1px solid #ffffff26;padding:20px}main{margin-left:180px;height:100dvh}
  header{position:fixed;top:0;right:0;left:180px;height:52px;pointer-events:none;z-index:20;display:flex;justify-content:flex-end}
  [data-app-shell-header-obstacle]{display:flex;pointer-events:auto;padding:8px}[data-app-shell-header-obstacle]>div{display:flex;align-items:center}
  button{font:inherit;color:inherit;border:0;background:transparent;padding:8px;border-radius:999px}
  [data-app-action-timeline-scroll]{height:100%;display:flex;flex-direction:column-reverse;overflow-y:auto}
  [data-chatgpt-conversation-selection-target]{width:min(100%,740px);margin:auto;flex-shrink:0;padding:64px 24px}
  [data-chatgpt-search-unit-key]{margin:24px 0}[data-user-message-bubble]{margin-left:auto;width:fit-content;border-radius:24px;background:#1b1b1b;padding:12px 20px}
  /* The real site colors the rich response itself, not just html/body. Its
     retained selectors still match cloned messages inside the light PDF. */
  html[data-theme="dark"] [data-markdown-text-style="assistant-message"]{--fixture-prose-text:#ededed;color:#ededed}
  [data-pdf-color-test="heading"],[data-pdf-color-test="paragraph"],.fixture-native-math{color:var(--fixture-prose-text,inherit)}
  .fixture-native-math{font:1.15em Georgia,serif}.fixture-native-math .katex-html{display:inline-flex;align-items:center;gap:8px}.fixture-native-math .katex-html svg{display:inline-block}
  .fixture-native-math .frac{display:inline-flex;vertical-align:middle;flex-direction:column;line-height:1.2;text-align:center}.fixture-native-math .num{border-bottom:1px solid currentColor;padding:0 6px}
  [data-markdown-copy="code-block"]{border-radius:24px;background:#1b1b1b;overflow:hidden}[data-markdown-copy="exclude"]{display:flex;justify-content:space-between;padding:10px 20px}
  code{display:block;white-space:pre;overflow:auto;padding:20px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
  </style><script>window.testPrintCalls=0;window.testBridgeRequests=[];window.print=()=>{window.testPrintCalls++};window.addEventListener('message',e=>{if(e.data?.channel==='latex-islands-conversation-export-v1'&&e.data.type==='request')window.testBridgeRequests.push(e.data.path)});
  globalThis.chrome={runtime:{getURL:p=>location.origin+'/'+p,lastError:null},storage:{local:{get(d,c){const v={...d,autoRender:true};if(c)queueMicrotask(()=>c(v));return Promise.resolve(v)},set(v,c){if(c)queueMicrotask(c);return Promise.resolve()}},onChanged:{addListener(){}}}};
  </script></head><body><aside>ChatGPT<br>New chat</aside><main data-app-shell-main-surface="browser"><header><div data-app-shell-main-titlebar="true"><div data-app-shell-header-obstacle><div id="modern-actions"><span><button>Share</button></span><button>More</button></div></div></div></header>
  <div data-app-action-timeline-scroll><div data-chatgpt-conversation-selection-target><div data-content-search-turn-key="fallback-turn-0"><div data-chatgpt-search-unit-key="fallback-turn-0:0:user" data-chatgpt-search-message-ids="modern-prompt"><div data-user-message-bubble>Draw a rectangle in TikZ.</div></div>
  <div data-chatgpt-search-unit-key="fallback-turn-0:2:assistant" data-chatgpt-search-message-ids="modern-answer modern-answer"><h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4><div data-chatgpt-selection-message-id="modern-answer"><div data-markdown-text-style="assistant-message"><h3 data-pdf-color-test="heading">A readable scientific answer</h3><p data-pdf-color-test="paragraph">Here is the diagram. Its explanation must remain readable on white paper.</p><p><span class="katex fixture-native-math"><span class="katex-html" aria-hidden="true"><span data-pdf-color-test="math">∫₀¹ x² dx = </span><span class="frac"><span class="num" data-pdf-color-test="fraction">1</span><span>3</span></span><svg xmlns="http://www.w3.org/2000/svg" width="28" height="18" viewBox="0 0 28 18"><path data-pdf-color-test="math-glyph" fill="currentColor" d="M0 8H20V3L28 9L20 15V10H0Z"/></svg></span></span></p><div><div data-markdown-copy="code-block"><div data-markdown-copy="exclude"><div>tikz</div><button>Copy code</button></div><div><code><span>${escapeHTML(diagrams[0])}</span></code></div></div></div><p>Its mathematical label is rendered locally.</p><svg data-pdf-color-test="diagram" xmlns="http://www.w3.org/2000/svg" width="260" height="55" viewBox="0 0 260 55"><rect width="260" height="55" rx="8" fill="#123456"/><text x="20" y="34" fill="#fff" font-size="18">Preserve native SVG colors</text></svg></div></div></div>
  <div class="turn-action-controls"><button>Copy response</button><button>Share response</button></div></div></div></div></main>
  ${['core.js','export-core.js','export-preview-renderer.js','native-controls.js','chatgpt-dom.js','content.js','export-pdf.js','conversation-export.js'].map(name=>'<script src="/'+name+'"></script>').join('')}</body></html>`;
}

async function main() {
  await fs.mkdir(output, {recursive:true});
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-islands-pdf-print-'));
  const profile = path.join(temporary, 'profile'); await fs.mkdir(profile);
  const requests = [], heldFonts = new Set(), heldIslands = new Set(), reports = [];
  let holdFonts = false, holdIslands = false, child, cdp, stderr = '';
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      requests.push(pathname); response.setHeader('Cache-Control', 'no-store');
      if (pathname === conversationPath) { response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end(new URL(request.url,'http://localhost').searchParams.has('modern') ? modernFixture() : fixture()); return; }
      if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const target = path.resolve(root, '.' + pathname);
      if (!target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
      const data = await fs.readFile(target);
      const mime = {'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.woff2':'font/woff2','.svg':'image/svg+xml'};
      response.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
      // The initial HTML already says "idle"; delay the script to exercise the
      // source/channel handshake instead of accidentally clicking before setup.
      if (pathname === '/island.js' && holdIslands) { heldIslands.add({response, data}); return; }
      if (pathname === '/island.js') await sleep(200);
      if (holdFonts && pathname.endsWith('.woff2')) { heldFonts.add({response, data}); return; }
      response.end(data);
    } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500); response.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const releaseFonts = () => { holdFonts = false; for (const {response, data} of heldFonts) response.end(data); heldFonts.clear(); };
  const releaseIslands = () => { holdIslands = false; for (const {response, data} of heldIslands) response.end(data); heldIslands.clear(); };
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
    let shot;
    const openConversation = async () => cdp.evaluate(`(() => {document.querySelector('.li-export-toggle').click();const format=document.getElementById('li-export-format');format.value='pdf';format.dispatchEvent(new Event('change',{bubbles:true}));return !document.querySelector('.li-export-panel').hidden;})()`);
    async function checkDarkPDFContrast(){
      const sourceBefore=await cdp.evaluate(`(()=>{const paragraph=document.querySelector('[data-chatgpt-conversation-selection-target] [data-pdf-color-test="paragraph"]');return {text:getComputedStyle(paragraph).color,glyph:getComputedStyle(document.querySelector('[data-chatgpt-conversation-selection-target] [data-pdf-color-test="math-glyph"]')).fill}})()`);
      assert.equal(sourceBefore.text,'rgb(237, 237, 237)','The fixture must exercise locally colored dark prose, not only inherited body color');
      const paints=scope=>cdp.evaluate(`(()=>{
        const root=document.querySelector(${JSON.stringify(scope)});
        const rgb=value=>value.match(/[\\d.]+/g).slice(0,3).map(Number);
        const luminance=color=>rgb(color).map(value=>{value/=255;return value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4)}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
        const sample=(name,selector,property='color')=>{const node=root.querySelector(selector),css=getComputedStyle(node),paint=css[property],rect=node.getBoundingClientRect();return {name,paint,contrast:1.05/(luminance(paint)+.05),width:rect.width,height:rect.height}};
        return {paper:getComputedStyle(root).backgroundColor,samples:[sample('export title','.li-pdf-title'),sample('speaker','.li-pdf-role'),...['heading','paragraph','math','fraction'].map(name=>sample(name,'[data-pdf-color-test="'+name+'"]')),sample('fraction rule','[data-pdf-color-test="fraction"]','borderBottomColor'),sample('math SVG glyph','[data-pdf-color-test="math-glyph"]','fill')],nativeSVG:{fill:getComputedStyle(root.querySelector('[data-pdf-color-test="diagram"] rect')).fill,label:getComputedStyle(root.querySelector('[data-pdf-color-test="diagram"] text')).fill},diagrams:root.querySelectorAll('.li-pdf-island-image').length,height:root.getBoundingClientRect().height};
      })()`);
      const preview=await paints('.li-export-pdf-preview .li-pdf-preview');
      shot=await cdp.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'pdf-dark-prose-preview.png'),Buffer.from(shot.data,'base64'));
      const beforePrint=await cdp.evaluate('window.testPrintCalls');await cdp.evaluate(`document.querySelector('.li-export-save').click()`);
      await until(()=>cdp.evaluate(`window.testPrintCalls===${beforePrint+1}`),'Dark prose PDF print invocation');
      await cdp.call('Emulation.setDeviceMetricsOverride',{width:673,height:900,deviceScaleFactor:1,mobile:false});await cdp.call('Emulation.setEmulatedMedia',{media:'print'});
      await cdp.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const printed=await paints('.li-pdf-active');
      shot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:673,height:Math.ceil(printed.height),scale:1}});await fs.writeFile(path.join(output,'pdf-dark-prose-print.png'),Buffer.from(shot.data,'base64'));
      const pdf=await cdp.call('Page.printToPDF',{preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});await fs.writeFile(path.join(output,'pdf-dark-prose.pdf'),Buffer.from(pdf.data,'base64'));
      await cdp.evaluate(`window.dispatchEvent(new Event('afterprint'))`);await cdp.call('Emulation.setEmulatedMedia',{media:'screen'});await cdp.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
      const sourceAfter=await cdp.evaluate(`(()=>{const paragraph=document.querySelector('[data-chatgpt-conversation-selection-target] [data-pdf-color-test="paragraph"]');return {text:getComputedStyle(paragraph).color,glyph:getComputedStyle(document.querySelector('[data-chatgpt-conversation-selection-target] [data-pdf-color-test="math-glyph"]')).fill}})()`);
      const report={case:'Dark assistant prose, headings, HTML math and SVG math retain print contrast',preview,printed,sourceBefore,sourceAfter,pdfBytes:Buffer.from(pdf.data,'base64').length};
      await fs.writeFile(path.join(output,'pdf-dark-prose-contrast.json'),JSON.stringify(report,null,2));
      for(const [stage,state] of [['preview',preview],['print',printed]]){
        assert.equal(state.paper,'rgb(255, 255, 255)');assert.equal(state.diagrams,1);
        for(const sample of state.samples){assert(sample.width>0&&sample.height>0,stage+' '+sample.name+' must be visible');assert(sample.contrast>=7,stage+' '+sample.name+' contrast '+sample.contrast.toFixed(2)+' is unreadable on white paper ('+sample.paint+')');}
        assert.deepEqual(state.nativeSVG,{fill:'rgb(18, 52, 86)',label:'rgb(255, 255, 255)'},'Native colored SVGs must retain their own paint');
      }
      assert.deepEqual(sourceAfter,sourceBefore,'Export must not recolor the source conversation');reports.push(report);
      await cdp.evaluate(`document.querySelector('.li-export-inspect').click()`);await until(()=>cdp.evaluate(`document.querySelector('.li-export-panel').getAttribute('aria-busy')==='false'&&document.querySelectorAll('.li-export-pdf-preview .li-pdf-message').length===2`),'PDF preview restored after contrast check');
    }
    if(process.argv.includes('--contrast-only')){
      await cdp.call('Page.navigate',{url:origin+conversationPath+'?modern=1'});await until(()=>cdp.evaluate(`document.querySelector('.latex-islands-container iframe')?.contentDocument?.querySelector('.island')?.dataset.state==='ready'`),'Dark prose fixture real TeX render',90000);
      await openConversation();await cdp.evaluate(`document.querySelector('.li-export-inspect').click()`);await until(()=>cdp.evaluate(`document.querySelector('.li-export-panel').getAttribute('aria-busy')==='false'&&document.querySelectorAll('.li-export-pdf-preview .li-pdf-message').length===2`),'Dark prose preview');
      await checkDarkPDFContrast();assert.deepEqual(cdp.errors,[]);console.log(JSON.stringify({ok:true,browser,cases:reports},null,2));return;
    }
    if(!process.argv.includes('--ui-only')&&!process.argv.includes('--navigation-only')) {
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
    shot = await cdp.call('Page.captureScreenshot', {format:'png'});
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
    }
    // The new public renderer has no <pre> or data-message-author-role, and
    // its scroll root lives inside main with negative scrollTop coordinates.
    holdIslands=true;
    await cdp.call('Page.navigate',{url:origin+conversationPath+'?modern=1'});
    await until(()=>heldIslands.size>0,'Delayed existing-chat diagram bootstrap');
    const boot=await cdp.evaluate(`(()=>{const frame=document.querySelector('.latex-islands-container iframe'),loader=document.querySelector('.latex-islands-boot'),source=document.querySelector('[data-markdown-copy="code-block"]');return {sourceDisplay:getComputedStyle(source).display,frameVisibility:getComputedStyle(frame).visibility,height:frame.getBoundingClientRect().height,loaderHeight:loader.getBoundingClientRect().height,label:loader.querySelector('[role="status"]').textContent}})()`);
    assert.equal(boot.sourceDisplay,'none','Existing code must be replaced before the renderer handshake');
    assert.equal(boot.frameVisibility,'hidden','Do not flash an uninitialized iframe');
    assert.equal(boot.height,222);assert.equal(boot.loaderHeight,boot.height);assert.match(boot.label,/Rendering diagram/);
    shot=await cdp.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'chatgpt-september-loading.png'),Buffer.from(shot.data,'base64'));
    releaseIslands();
    await until(()=>cdp.evaluate(`document.querySelector('.latex-islands-container iframe')?.contentDocument?.querySelector('.island')?.dataset.state==='ready'`),'September layout real TeX render',90000);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.latex-islands-boot').length`),0,'The bootstrap loader leaves after the iframe is ready');
    reports.push({case:'Existing-chat loader before renderer initialization',...boot});
    const modernState=await cdp.evaluate(`(()=>{const frame=document.querySelector('.latex-islands-container iframe');return {messages:LatexIslandsChatGPT.getMessages().length,sourceHidden:document.querySelector('[data-markdown-copy="code-block"]').classList.contains('latex-islands-original-hidden'),header:!!document.querySelector('#modern-actions > .li-export'),reply:!!document.querySelector('.turn-action-controls > .li-export-reply'),theme:frame.contentDocument.documentElement.dataset.theme,oldRoles:document.querySelectorAll('[data-message-author-role]').length,oldPre:document.querySelectorAll('[data-chatgpt-conversation-selection-target] pre').length}})()`);
    assert.equal(modernState.messages,2);assert(modernState.sourceHidden);assert(modernState.header);assert(modernState.reply);assert.equal(modernState.oldRoles,0);assert.equal(modernState.oldPre,0);
    assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('.li-export-toggle')).borderRadius`),'8px','header export must use the rounded-square control shape, even when toolbar token is fully round');
    const hydration=await cdp.evaluate(`(async()=>{
      let source=document.querySelector('[data-markdown-copy="code-block"]');
      const frame=document.querySelector('.latex-islands-container iframe'),svg=frame.contentDocument.querySelector('#output svg'),samples=[];
      source.className='host-hydrated-code';
      for(let index=0;index<20;index++){
        if(index===4){const fresh=source.cloneNode(true);fresh.className='host-rebuilt-code';fresh.removeAttribute('data-latex-islands-hidden');source.replaceWith(fresh);source=fresh;}
        if(index===8)source.className='host-final-code';
        await new Promise(resolve=>requestAnimationFrame(resolve));
        samples.push({visible:getComputedStyle(source).display!=='none',sameFrame:document.querySelector('.latex-islands-container iframe')===frame,boot:!!document.querySelector('.latex-islands-boot')});
      }
      const sameSVG=frame.contentDocument?.querySelector('#output svg')===svg;
      const fresh=source.cloneNode(true);fresh.className='host-new-code';fresh.removeAttribute('data-latex-islands-hidden');fresh.querySelector('code').textContent='\\\\begin{tikzpicture}\\\\node {Late diagram};\\\\end{tikzpicture}';source.parentElement.append(fresh);
      const newSamples=[];for(let index=0;index<4;index++){await new Promise(resolve=>requestAnimationFrame(resolve));newSamples.push(getComputedStyle(fresh).display!=='none');}
      fresh.remove();
      return {frames:samples.length,visibleFrames:samples.filter(s=>s.visible).length,recreatedFrame:samples.some(s=>!s.sameFrame),restartedLoader:samples.some(s=>s.boot),sameSVG,newVisibleFrames:newSamples.filter(Boolean).length};
    })()`);
    assert.equal(hydration.visibleFrames,0,'Host class rewrites and widget replacement must never paint original code again');
    assert.equal(hydration.recreatedFrame,false,'An adjacent unchanged diagram retains its connected frame during hydration');
    assert.equal(hydration.restartedLoader,false);assert(hydration.sameSVG);assert.equal(hydration.newVisibleFrames,0,'A newly hydrated diagram must be concealed before its first frame');
    await until(()=>cdp.evaluate(`document.querySelectorAll('.latex-islands-container iframe').length===1`),'Hydration test diagram cleanup');
    reports.push({case:'No code flashes across host hydration animation frames',...hydration});

    // ChatGPT navigation replaces message DOM while keeping content scripts
    // alive. Visit another conversation, revisit this one, then leave during
    // an unfinished iframe startup before returning for a real complete render.
    // Retain only host markup: React does not recreate our injected containers.
    holdIslands=true;
    const leave=await cdp.evaluate(`(async()=>{
      const root=document.querySelector('[data-chatgpt-conversation-selection-target]'),template=root.cloneNode(true);
      template.querySelectorAll('.latex-islands-container,.li-export-reply').forEach(node=>node.remove());
      template.querySelectorAll('.latex-islands-original-hidden,[data-latex-islands-hidden]').forEach(node=>{node.classList.remove('latex-islands-original-hidden');node.removeAttribute('data-latex-islands-hidden');});
      window.spaNavigation={template,url:location.href,firstFrame:document.querySelector('.latex-islands-container iframe')};
      history.pushState({},'', '/c/87654321-4321-4321-8321-cba987654321');
      root.replaceChildren(Object.assign(document.createElement('p'),{textContent:'Another conversation is open.'}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return {frames:document.querySelectorAll('.latex-islands-container iframe').length,oldConnected:window.spaNavigation.firstFrame.isConnected};
    })()`);
    assert.deepEqual(leave,{frames:0,oldConnected:false});
    const returnAndSample=()=>cdp.evaluate(`(async()=>{
      const navigation=window.spaNavigation,root=navigation.template.cloneNode(true);history.pushState({},'',navigation.url);
      document.querySelector('[data-chatgpt-conversation-selection-target]').replaceWith(root);
      const source=root.querySelector('[data-markdown-copy="code-block"]'),samples=[];
      for(let i=0;i<10;i++){await new Promise(resolve=>requestAnimationFrame(resolve));samples.push({visible:getComputedStyle(source).display!=='none',frames:root.querySelectorAll('.latex-islands-container iframe').length});}
      const frame=root.querySelector('.latex-islands-container iframe');navigation.currentFrame=frame;
      return {sampledFrames:samples.length,visibleFrames:samples.filter(s=>s.visible).length,maxIslands:Math.max(...samples.map(s=>s.frames)),sameOriginalFrame:frame===navigation.firstFrame,boot:!!root.querySelector('.latex-islands-boot')};
    })()`);
    const pendingReturn=await returnAndSample();
    await until(()=>heldIslands.size>0,'SPA revisit waiting for iframe startup');
    assert.equal(pendingReturn.visibleFrames,0);assert.equal(pendingReturn.maxIslands,1);assert.equal(pendingReturn.sameOriginalFrame,false);assert.equal(pendingReturn.boot,true);
    const abandoned=await cdp.evaluate(`(async()=>{
      const frame=window.spaNavigation.currentFrame;history.pushState({},'', '/c/87654321-4321-4321-8321-cba987654321');
      document.querySelector('[data-chatgpt-conversation-selection-target]').replaceChildren(Object.assign(document.createElement('p'),{textContent:'The loading conversation was left.'}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return {frames:document.querySelectorAll('.latex-islands-container iframe').length,oldConnected:frame.isConnected};
    })()`);
    assert.deepEqual(abandoned,{frames:0,oldConnected:false});releaseIslands();
    const finalReturn=await returnAndSample();assert.equal(finalReturn.visibleFrames,0);assert.equal(finalReturn.maxIslands,1);assert.equal(finalReturn.sameOriginalFrame,false);
    await until(async()=>{
      const state=await cdp.evaluate(`(()=>{const frame=document.querySelector('.latex-islands-container iframe'),doc=frame?.contentDocument;return {frames:document.querySelectorAll('.latex-islands-container iframe').length,state:doc?.querySelector('.island')?.dataset.state,error:doc?.getElementById('error')?.textContent,bootError:document.querySelector('.latex-islands-boot [role="alert"]')?.textContent,boot:!!document.querySelector('.latex-islands-boot'),source:doc?.getElementById('source')?.value,svg:!!doc?.querySelector('#output svg')}})()`);
      if(state.state==='error'||state.bootError)throw Error('SPA navigation recovery failed: '+(state.bootError||state.error));
      return state.frames===1&&state.state==='ready'&&!state.boot&&state.source===diagrams[0]&&state.svg;
    },'SPA revisit real diagram recovery',90000);
    const restored=await cdp.evaluate(`(async()=>{
      const frame=window.spaNavigation.currentFrame,svg=frame.contentDocument.querySelector('#output svg'),source=document.querySelector('[data-markdown-copy="code-block"]');
      for(let i=0;i<10;i++)await new Promise(resolve=>requestAnimationFrame(resolve));
      return {frames:document.querySelectorAll('.latex-islands-container iframe').length,sameFrame:document.querySelector('.latex-islands-container iframe')===frame,sameSVG:frame.contentDocument.querySelector('#output svg')===svg,boot:!!document.querySelector('.latex-islands-boot'),sourceHidden:getComputedStyle(source).display==='none',messages:LatexIslandsChatGPT.getMessages().length};
    })()`);
    assert.deepEqual(restored,{frames:1,sameFrame:true,sameSVG:true,boot:false,sourceHidden:true,messages:2});
    reports.push({case:'SPA leave and revisit, including an abandoned loading diagram',leave,pendingReturn,abandoned,finalReturn,restored});

    const cachedNavigations=[];
    for(const mode of ['cloned-cache','hidden-connected-cache']) {
      const cached=await cdp.evaluate(`(async()=>{
        const root=document.querySelector('[data-chatgpt-conversation-selection-target]'),frame=root.querySelector('.latex-islands-container iframe'),mode=${JSON.stringify(mode)};
        const cached=mode==='cloned-cache'?root.cloneNode(true):root;
        // A host cache can serialize iframe placeholders. This override belongs
        // only to the detached clone: the live owned frame is never modified.
        if(mode==='cloned-cache')cached.querySelectorAll('.latex-islands-container iframe').forEach(node=>node.setAttribute('srcdoc',''));
        window.cachedNavigation={root,cached,frame,clonedFrame:cached.querySelector('.latex-islands-container iframe'),url:location.href};
        history.pushState({},'', '/c/11223344-5566-4788-8999-aabbccddeeff');
        const other=document.createElement('div');other.setAttribute('data-chatgpt-conversation-selection-target','');other.id='fixture-other-conversation';other.textContent='A different conversation is active.';
        if(mode==='cloned-cache')root.replaceWith(other);else {root.hidden=true;root.inert=true;root.after(other);}
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return {activeMessages:LatexIslandsChatGPT.getMessages().length,frames:document.querySelectorAll('.latex-islands-container iframe').length,liveOverride:frame.hasAttribute('srcdoc')};
      })()`);
      assert.equal(cached.activeMessages,0);assert.equal(cached.liveOverride,false);
      await until(()=>cdp.evaluate(`document.querySelectorAll('.latex-islands-container iframe').length===0`),mode+' inactive frame cleanup');cached.frames=0;
      const revisit=await cdp.evaluate(`(async()=>{
        const cache=window.cachedNavigation;history.pushState({},'',cache.url);
        if(${JSON.stringify(mode)}==='cloned-cache')document.getElementById('fixture-other-conversation').replaceWith(cache.cached);
        else {document.getElementById('fixture-other-conversation').remove();cache.cached.hidden=false;cache.cached.inert=false;}
        const source=cache.cached.querySelector('[data-markdown-copy="code-block"]'),samples=[];
        for(let i=0;i<10;i++){await new Promise(resolve=>requestAnimationFrame(resolve));samples.push({visible:getComputedStyle(source).display!=='none',frames:cache.cached.querySelectorAll('.latex-islands-container iframe').length});}
        return {visibleFrames:samples.filter(sample=>sample.visible).length,maxIslands:Math.max(...samples.map(sample=>sample.frames)),oldPlaceholderConnected:cache.clonedFrame.isConnected,overrides:cache.cached.querySelectorAll('iframe[srcdoc]').length};
      })()`);
      assert.equal(revisit.visibleFrames,0,mode+' must conceal restored code before paint');assert.equal(revisit.maxIslands,1,mode+' must not retain a stale island next to the new one');assert.equal(revisit.oldPlaceholderConnected,false);assert.equal(revisit.overrides,0);
      await until(async()=>{
        const state=await cdp.evaluate(`(()=>{const frames=[...document.querySelectorAll('.latex-islands-container iframe')],doc=frames[0]?.contentDocument;return {frames:frames.length,state:doc?.querySelector('.island')?.dataset.state,error:doc?.getElementById('error')?.textContent,alert:document.querySelector('.latex-islands-boot [role="alert"]')?.textContent,boot:!!document.querySelector('.latex-islands-boot'),svg:!!doc?.querySelector('#output svg')}})()`);
        if(state.state==='error'||state.alert)throw Error('Cached DOM navigation failed: '+(state.alert||state.error));
        return state.frames===1&&state.state==='ready'&&!state.boot&&state.svg;
      },mode+' real render after returning',90000);
      const snapshot=await cdp.evaluate(`(async()=>{const source=document.querySelector('[data-markdown-copy="code-block"]'),items=await LatexIslandsDiagramExport.snapshot(source);return {items:items.length,svg:items[0]?.svg.includes('<svg'),sourceMatches:items[0]?.sourceElement===source}})()`);
      assert.deepEqual(snapshot,{items:1,svg:true,sourceMatches:true});
      await until(()=>cdp.evaluate(`document.querySelectorAll('.li-export-reply').length===1&&document.querySelectorAll('.li-export-toggle').length===1`),mode+' live export controls without cached duplicates');
      cachedNavigations.push({mode,cached,revisit,snapshot,replyButtons:1,headerButtons:1});
    }
    reports.push({case:'Restored cached conversation DOM, including stale iframe placeholders',navigations:cachedNavigations});

    // A cached page may override the new iframe only after it has connected.
    // Exercise a real document navigation on the active node, not just a stale
    // detached clone. Recovery must replace the document once, then stop.
    const waitModernReady=label=>until(async()=>{
      const state=await cdp.evaluate(`(()=>{const frames=[...document.querySelectorAll('.latex-islands-container iframe')],doc=frames[0]?.contentDocument;return {frames:frames.length,state:doc?.querySelector('.island')?.dataset.state,error:doc?.getElementById('error')?.textContent,alert:document.querySelector('.latex-islands-boot [role="alert"]')?.textContent,boot:!!document.querySelector('.latex-islands-boot'),svg:!!doc?.querySelector('#output svg')}})()`);
      if(state.state==='error'||state.alert)throw Error(label+': '+(state.alert||state.error));
      return state.frames===1&&state.state==='ready'&&!state.boot&&state.svg;
    },label,90000);
    const beforeRecoveryRequests=requests.filter(request=>request==='/island.js').length;
    await cdp.evaluate(`(()=>{
      window.documentRecovery={source:document.querySelector('[data-markdown-copy="code-block"]'),root:document.querySelector('[data-chatgpt-conversation-selection-target]'),original:document.querySelector('.latex-islands-container iframe')};
      setTimeout(()=>window.documentRecovery.original.setAttribute('srcdoc',''),120);
    })()`);
    await until(()=>cdp.evaluate(`document.querySelector('.latex-islands-container iframe')!==window.documentRecovery.original`),'Delayed restored iframe replacement');
    await waitModernReady('One automatic recovery after delayed cached-page override');
    const automaticRecovery=await cdp.evaluate(`(async()=>{
      const recovery=window.documentRecovery;recovery.replacement=document.querySelector('.latex-islands-container iframe');
      const items=await LatexIslandsDiagramExport.snapshot(recovery.source);
      return {sameSource:recovery.source===document.querySelector('[data-markdown-copy="code-block"]'),sameRoot:recovery.root===document.querySelector('[data-chatgpt-conversation-selection-target]'),oldConnected:recovery.original.isConnected,oldOverrideRetained:recovery.original.hasAttribute('srcdoc'),newOverride:recovery.replacement.hasAttribute('srcdoc'),snapshot:items.length===1&&items[0].sourceElement===recovery.source&&items[0].svg.includes('<svg')};
    })()`);
    assert.deepEqual(automaticRecovery,{sameSource:true,sameRoot:true,oldConnected:false,oldOverrideRetained:true,newOverride:false,snapshot:true});
    assert.equal(requests.filter(request=>request==='/island.js').length-beforeRecoveryRequests,1,'A delayed override creates exactly one new renderer');
    await cdp.evaluate(`window.documentRecovery.replacement.setAttribute('srcdoc','')`);
    await until(()=>cdp.evaluate(`!!document.querySelector('.latex-islands-boot [role="alert"]')`),'Repeated active-frame override stops with explicit recovery controls');
    const boundedRecovery=await cdp.evaluate(`(async()=>{
      const recovery=window.documentRecovery,samples=[];
      for(let i=0;i<20;i++){await new Promise(resolve=>requestAnimationFrame(resolve));samples.push({sameFrame:document.querySelector('.latex-islands-container iframe')===recovery.replacement,frames:document.querySelectorAll('.latex-islands-container iframe').length});}
      const boot=document.querySelector('.latex-islands-boot');
      return {alert:boot.querySelector('[role="alert"]').textContent,retryVisible:!boot.querySelector('.latex-islands-boot-retry').hidden,spinnerHidden:boot.querySelector('.latex-islands-boot-spinner').hidden,sourceHidden:getComputedStyle(recovery.source).display==='none',sameFrame:samples.every(sample=>sample.sameFrame),maxFrames:Math.max(...samples.map(sample=>sample.frames)),overrideRetained:recovery.replacement.hasAttribute('srcdoc')};
    })()`);
    assert.match(boundedRecovery.alert,/interrupted again/i);assert(boundedRecovery.retryVisible&&boundedRecovery.spinnerHidden&&boundedRecovery.sourceHidden&&boundedRecovery.sameFrame&&boundedRecovery.overrideRetained);assert.equal(boundedRecovery.maxFrames,1);
    assert.equal(requests.filter(request=>request==='/island.js').length-beforeRecoveryRequests,1,'Repeated overrides cannot cause an automatic reload loop');
    await cdp.evaluate(`document.querySelector('.latex-islands-boot-retry').click()`);
    await waitModernReady('Explicit Retry recovers the interrupted active iframe');
    const explicitRecovery=await cdp.evaluate(`(async()=>{
      const recovery=window.documentRecovery,frame=document.querySelector('.latex-islands-container iframe'),items=await LatexIslandsDiagramExport.snapshot(recovery.source);
      return {freshFrame:frame!==recovery.replacement,oldConnected:recovery.replacement.isConnected,oldOverrideRetained:recovery.replacement.hasAttribute('srcdoc'),sourceMatches:frame.contentDocument.getElementById('source').value===${JSON.stringify(diagrams[0])},snapshot:items.length===1&&items[0].svg.includes('<svg')};
    })()`);
    assert.deepEqual(explicitRecovery,{freshFrame:true,oldConnected:false,oldOverrideRetained:true,sourceMatches:true,snapshot:true});
    assert.equal(requests.filter(request=>request==='/island.js').length-beforeRecoveryRequests,2);
    reports.push({case:'Delayed active iframe override after restoration: one automatic recovery, bounded repeat, explicit Retry',automaticRecovery,boundedRecovery,explicitRecovery});

    // Real browser input also checks scroll chaining across the iframe boundary.
    // Give the synthetic conversation room on either side of the diagram.
    await cdp.evaluate(`(async()=>{
      const root=document.querySelector('[data-chatgpt-conversation-selection-target]'),scroll=document.querySelector('[data-app-action-timeline-scroll]');
      window.wheelFixture={root,scroll,top:scroll.scrollTop,spacers:[]};
      for(const position of ['prepend','append']){const spacer=document.createElement('div');spacer.style.height='700px';spacer.setAttribute('data-wheel-fixture','');root[position](spacer);window.wheelFixture.spacers.push(spacer);}
      document.querySelector('.latex-islands-container iframe').scrollIntoView({block:'center'});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.wheelFixture.top=scroll.scrollTop;
    })()`);
    const wheelPoint=()=>cdp.evaluate(`(()=>{const f=document.querySelector('.latex-islands-container iframe'),r=f.getBoundingClientRect(),v=f.contentDocument.getElementById('viewport').getBoundingClientRect();return {x:r.left+v.left+v.width*.62,y:r.top+v.top+v.height*.56}})()`);
    const wheelState=()=>cdp.evaluate(`(()=>{const doc=document.querySelector('.latex-islands-container iframe').contentDocument,v=doc.getElementById('viewport');return {top:window.wheelFixture.scroll.scrollTop,transform:doc.getElementById('output').style.transform,focused:doc.activeElement===v,outline:doc.defaultView.getComputedStyle(v).outlineStyle}})()`);
    const clickAt=async point=>{await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});};
    await clickAt({x:30,y:150});
    let point=await wheelPoint();await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    const unfocusedBefore=await wheelState();assert.equal(unfocusedBefore.focused,false);
    await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:100});
    await until(async()=>Math.abs((await wheelState()).top-unfocusedBefore.top)>10,'Unfocused wheel scrolls the conversation through the iframe');
    const unfocusedAfter=await wheelState();assert.equal(unfocusedAfter.transform,unfocusedBefore.transform);
    await cdp.evaluate(`(async()=>{window.wheelFixture.scroll.scrollTop=window.wheelFixture.top;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`);
    point=await wheelPoint();await clickAt(point);
    const focusedBefore=await wheelState();assert.equal(focusedBefore.focused,true);assert.equal(focusedBefore.outline,'none');
    const anchorBefore=await cdp.evaluate(`(()=>{const f=document.querySelector('.latex-islands-container iframe'),r=f.getBoundingClientRect(),v=f.contentDocument.getElementById('viewport').getBoundingClientRect();return {x:${point.x}-r.left-v.left-v.width/2,y:${point.y}-r.top-v.top-v.height/2}})()`);
    await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-100});
    await until(async()=>(await wheelState()).transform!==focusedBefore.transform,'Focused ordinary wheel zooms the diagram');
    const focusedAfter=await wheelState();assert(Math.abs(focusedAfter.top-focusedBefore.top)<1,'Focused zoom must preserve conversation position');
    const transform=value=>{const match=value.match(/translate\(([-.\d]+)px,\s*([-.\d]+)px\)\s*scale\(([-.\d]+)\)/);assert(match,'Expected a measured diagram transform: '+value);return {x:+match[1],y:+match[2],scale:+match[3]};};
    const from=transform(focusedBefore.transform),to=transform(focusedAfter.transform);
    assert(to.scale>from.scale);assert(Math.abs((anchorBefore.x-from.x)/from.scale-(anchorBefore.x-to.x)/to.scale)<.1);assert(Math.abs((anchorBefore.y-from.y)/from.scale-(anchorBefore.y-to.y)/to.scale)<.1);
    await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:30,y:150});
    point=await wheelPoint();await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    const reenteredBefore=await wheelState();assert.equal(reenteredBefore.focused,false,'Leaving deactivates ordinary wheel zoom; re-entering alone does not activate it');
    await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:100});
    await until(async()=>Math.abs((await wheelState()).top-reenteredBefore.top)>10,'Wheel scrolls the conversation after leaving and re-entering');
    const reenteredAfter=await wheelState();assert.equal(reenteredAfter.transform,reenteredBefore.transform);
    await cdp.evaluate(`(async()=>{const fixture=window.wheelFixture;fixture.spacers.forEach(node=>node.remove());fixture.scroll.scrollTop=0;const doc=document.querySelector('.latex-islands-container iframe').contentDocument;doc.getElementById('viewport').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`);
    reports.push({case:'Real mouse wheel: page scroll until clicked, pointer-anchored zoom, scroll restored on leave',unfocusedScroll:unfocusedAfter.top-unfocusedBefore.top,focusedScroll:focusedAfter.top-focusedBefore.top,scaleBefore:from.scale,scaleAfter:to.scale,reenteredScroll:reenteredAfter.top-reenteredBefore.top,focusOutline:focusedBefore.outline});
    await cdp.evaluate(`(()=>{
      const source=document.querySelector('[data-markdown-copy="code-block"]'),broken=source.cloneNode(true);
      broken.classList.remove('latex-islands-original-hidden');broken.removeAttribute('data-latex-islands-hidden');broken.setAttribute('data-error-fixture','');
      broken.querySelector('code').textContent=${JSON.stringify(String.raw`\begin{tikzpicture}\node {\FixtureUndefinedCommand};\end{tikzpicture}`)};
      source.parentElement.append(broken);window.errorFixture=broken;
    })()`);
    await until(()=>cdp.evaluate(`window.errorFixture.nextElementSibling?.querySelector('iframe')?.contentDocument?.querySelector('.island')?.dataset.state==='error'`),'Real compiler error panel',90000);
    const errorLayout=await cdp.evaluate(`(()=>{
      const frame=window.errorFixture.nextElementSibling.querySelector('iframe'),doc=frame.contentDocument,panel=doc.getElementById('error-panel'),rect=panel.getBoundingClientRect();
      return {visible:!panel.hidden,width:rect.width,left:rect.left,right:rect.right,viewportWidth:doc.documentElement.clientWidth,overflow:doc.documentElement.scrollWidth-doc.documentElement.clientWidth,title:doc.getElementById('error-title').textContent,message:doc.getElementById('error').textContent,retry:!doc.getElementById('retry').hidden&&doc.getElementById('retry').getBoundingClientRect().width>0,showCode:doc.getElementById('error-source').getBoundingClientRect().width>0,askFixHidden:doc.getElementById('ask-fix').hidden};
    })()`);
    assert(errorLayout.visible&&errorLayout.width>100&&errorLayout.left>=0&&errorLayout.right<=errorLayout.viewportWidth+1);assert(errorLayout.overflow<=1);assert.match(errorLayout.title,/Could not render/);assert(errorLayout.message.length>0);assert(errorLayout.retry&&errorLayout.showCode);assert(errorLayout.askFixHidden,'ChatGPT-only composition stays unavailable on the local test origin');
    shot=await cdp.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'chatgpt-compiler-error.png'),Buffer.from(shot.data,'base64'));
    reports.push({case:'Real compiler error keeps finite readable actions within the inline viewport',...errorLayout});
    await cdp.evaluate(`window.errorFixture.remove()`);
    await until(()=>cdp.evaluate(`document.querySelectorAll('.latex-islands-container iframe').length===1`),'Broken test diagram cleanup');
    shot=await cdp.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'chatgpt-september-inline.png'),Buffer.from(shot.data,'base64'));
    await cdp.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await cdp.evaluate(`window.modernFrame=document.querySelector('.latex-islands-container iframe');window.modernFrame.contentDocument.getElementById('open-editor').click()`);
    await until(()=>cdp.evaluate(`!!document.querySelector('.latex-islands-is-editing')`),'September sidebar-aware editor');
    const editor=await cdp.evaluate(`(()=>{const r=document.querySelector('.latex-islands-is-editing').getBoundingClientRect(),s=document.querySelector('[data-app-action-timeline-scroll]').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,expectedLeft:s.left,expectedWidth:s.width,sameFrame:window.modernFrame===document.querySelector('.latex-islands-container iframe')};})()`);
    assert.equal(editor.left,180);assert.equal(editor.left,editor.expectedLeft);assert.equal(editor.width,editor.expectedWidth);assert(editor.sameFrame);
    const copyPoint=await cdp.evaluate(`(()=>{const f=window.modernFrame.getBoundingClientRect(),b=window.modernFrame.contentDocument.getElementById('copy-header').getBoundingClientRect();return {x:f.left+b.left+b.width/2,y:f.top+b.top+b.height/2}})()`);
    await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...copyPoint});
    await until(()=>cdp.evaluate(`!window.modernFrame.contentDocument.getElementById('control-tooltip').hidden`),'Editor Copy code tooltip after pointer hover');
    const editorControls=await cdp.evaluate(`(()=>{
      const doc=window.modernFrame.contentDocument,view=doc.defaultView,tip=doc.getElementById('control-tooltip'),r=tip.getBoundingClientRect(),css=view.getComputedStyle(tip),command=doc.querySelector('#edit-hint svg'),bbox=command.querySelector('path').getBBox();
      return {tooltip:{label:tip.textContent,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,font:css.fontSize,line:css.lineHeight,padding:css.padding,radius:css.borderRadius},viewport:{width:view.innerWidth,height:view.innerHeight},titles:doc.querySelectorAll('button[title]').length,
        buttons:['close-editor','copy-header','png-header'].map(id=>{const button=doc.getElementById(id),r=button.getBoundingClientRect(),i=button.querySelector('svg').getBoundingClientRect();return {id,width:r.width,height:r.height,radius:view.getComputedStyle(button).borderRadius,iconWidth:i.width,iconHeight:i.height,centerX:Math.abs(r.left+r.width/2-i.left-i.width/2),centerY:Math.abs(r.top+r.height/2-i.top-i.height/2)}}),command:{width:command.getBoundingClientRect().width,height:command.getBoundingClientRect().height,pathAspect:bbox.width/bbox.height}};
    })()`);
    assert.equal(editorControls.titles,0);assert.equal(editorControls.tooltip.label,'Copy code');assert.equal(editorControls.tooltip.height,30);assert.equal(editorControls.tooltip.font,'14px');assert.equal(editorControls.tooltip.line,'18px');assert.equal(editorControls.tooltip.padding,'5px 12px');assert.equal(editorControls.tooltip.radius,'16px');
    assert(editorControls.tooltip.left>=8&&editorControls.tooltip.top>=8&&editorControls.tooltip.right<=editorControls.viewport.width-8&&editorControls.tooltip.bottom<=editorControls.viewport.height-8);
    for(const button of editorControls.buttons){assert.equal(button.width,36);assert.equal(button.height,36);assert.equal(button.radius,'8px');assert.equal(button.iconWidth,20);assert.equal(button.iconHeight,20);assert(button.centerX<.6&&button.centerY<.6);}
    assert.equal(editorControls.command.width,14);assert.equal(editorControls.command.height,14);assert(Math.abs(editorControls.command.pathAspect-1)<.01);
    shot=await cdp.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'chatgpt-editor-controls-tooltip.png'),Buffer.from(shot.data,'base64'));reports.push({case:'Editor icon controls and native tooltip geometry',...editorControls});
    await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});
    await cdp.evaluate(`window.modernFrame.contentDocument.getElementById('close-editor').click()`);
    await until(()=>cdp.evaluate(`!document.querySelector('.latex-islands-is-editing')`),'September editor close');
    await cdp.evaluate(`document.querySelector('.li-export-toggle').click();const f=document.getElementById('li-export-format');f.value='pdf';f.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.li-export-inspect').click()`);
    await until(()=>cdp.evaluate(`document.querySelectorAll('.li-export-pdf-preview .li-pdf-message').length===2&&document.querySelector('.li-export-panel').getAttribute('aria-busy')==='false'`),'September layout DOM PDF preview');
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.li-export-pdf-preview .li-pdf-island-image').length`),1);
    assert.deepEqual(await cdp.evaluate(`(()=>{const b=document.querySelector('.li-export-pdf-preview [data-user-message-bubble]'),s=getComputedStyle(b);return {color:s.color,background:s.backgroundColor}})()`),{color:'rgb(23, 23, 23)',background:'rgb(245, 245, 245)'});
    assert.deepEqual(await cdp.evaluate('window.testBridgeRequests'),[]);
    shot=await cdp.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'chatgpt-september-export.png'),Buffer.from(shot.data,'base64'));
    reports.push({case:'September 26 public layout real render and DOM PDF preview',...modernState});

    if(!process.argv.includes('--navigation-only')) {
    await checkDarkPDFContrast();
    // Measure the production dialog under both site palettes and a narrow
    // viewport. These are layout assertions, not screenshot pixel baselines.
    const dialogLayouts=[];
    for(const [name,width,height,theme] of [['desktop-dark',1280,900,'dark'],['desktop-light',1280,900,'light'],['mobile-dark',390,844,'dark']]) {
      await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await cdp.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const geometry=await cdp.evaluate(`(()=>{
        const panel=document.querySelector('.li-export-panel'),close=panel.querySelector('.li-export-close'),icon=close.querySelector('svg'),preview=panel.querySelector('.li-export-pdf-preview');
        const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
        return {panel:box(panel),background:getComputedStyle(panel).backgroundColor,color:getComputedStyle(panel).color,close:box(close),icon:box(icon),preview:box(preview),messages:preview.querySelectorAll('.li-pdf-message').length,documentOverflow:document.documentElement.scrollWidth>innerWidth+1,
          overflow:['.li-export-panel','.li-export-layout','.li-export-settings','.li-export-preview-pane','.li-export-pdf-preview'].map(selector=>{const node=document.querySelector(selector);return {selector,overflow:node.scrollWidth>node.clientWidth+1}})};
      })()`);
      assert.equal(geometry.documentOverflow,false,name+' must not overflow the page horizontally');
      assert(geometry.overflow.every(item=>!item.overflow),name+' must not clip content in a horizontally scrolling dialog: '+JSON.stringify(geometry.overflow));
      assert(geometry.panel.left>=0&&geometry.panel.right<=width+1&&geometry.panel.top>=0&&geometry.panel.bottom<=height+1);
      assert.equal(geometry.close.width,36);assert.equal(geometry.close.height,36);assert.equal(geometry.icon.width,20);assert.equal(geometry.icon.height,20);
      assert(Math.abs((geometry.close.left+18)-(geometry.icon.left+10))<.6&&Math.abs((geometry.close.top+18)-(geometry.icon.top+10))<.6,name+' close icon must remain centered');
      assert(geometry.preview.width>100&&geometry.preview.height>100);assert.equal(geometry.messages,2);
      assert.equal(geometry.background,theme==='dark'?'rgb(27, 27, 27)':'rgb(255, 255, 255)');
      assert.equal(geometry.color,theme==='dark'?'rgb(237, 237, 237)':'rgb(23, 23, 23)');
      shot=await cdp.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'chatgpt-export-'+name+'.png'),Buffer.from(shot.data,'base64'));
      dialogLayouts.push({name,width,height,theme,...geometry});
    }
    // On mobile, the settings/preview stack may scroll vertically; both message
    // filtering and arbitrary selection must remain reachable and actionable.
    await cdp.evaluate(`document.querySelector('.li-export-selection-mode').click()`);
    await until(()=>cdp.evaluate(`document.querySelectorAll('.li-export-message-choice input').length===2&&!document.querySelector('.li-export-selection').hidden`),'Mobile message-selection view');
    const selection=await cdp.evaluate(`(()=>{
      const search=document.querySelector('.li-export-message-search');search.value='rectangle';search.dispatchEvent(new Event('input',{bubbles:true}));
      const filtered=[...document.querySelectorAll('.li-export-message-choice')].filter(node=>!node.hidden).map(node=>node.textContent);search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('.li-export-select-none').click();const choices=[...document.querySelectorAll('.li-export-message-choice input')];choices.at(-1).click();
      document.querySelector('.li-export-selection').scrollIntoView({block:'nearest'});const panel=document.querySelector('.li-export-panel'),layout=document.querySelector('.li-export-layout'),list=document.querySelector('.li-export-message-list'),first=choices.at(-1).getBoundingClientRect(),p=panel.getBoundingClientRect();
      return {filtered,selected:choices.filter(input=>input.checked).length,choices:choices.length,horizontalOverflow:panel.scrollWidth>panel.clientWidth+1||layout.scrollWidth>layout.clientWidth+1||list.scrollWidth>list.clientWidth+1,reachable:first.width>0&&first.height>0&&first.top>=p.top&&first.bottom<=p.bottom};
    })()`);
    assert.equal(selection.filtered.length,1);assert.match(selection.filtered[0],/Draw a rectangle/);assert.equal(selection.selected,1);assert.equal(selection.choices,2);assert.equal(selection.horizontalOverflow,false);assert.equal(selection.reachable,true);
    shot=await cdp.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,'chatgpt-export-mobile-selection.png'),Buffer.from(shot.data,'base64'));
    await cdp.evaluate(`document.querySelector('.li-export-dialogue-mode').click()`);
    await until(()=>cdp.evaluate(`document.querySelectorAll('.li-export-pdf-preview .li-pdf-message').length===1&&!document.querySelector('.li-export-pdf-preview').hidden`),'Mobile selected reply preview');
    await cdp.evaluate(`document.querySelector('.li-export-selection-mode').click();document.querySelector('.li-export-select-all').click();document.querySelector('.li-export-dialogue-mode').click()`);
    await until(()=>cdp.evaluate(`document.querySelectorAll('.li-export-pdf-preview .li-pdf-message').length===2`),'Restore full PDF selection');
    reports.push({case:'Dark, light and mobile export dialog geometry and message selection',layouts:dialogLayouts,selection});

    await cdp.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await cdp.evaluate(`document.querySelector('.li-export-close').click();document.querySelector('.li-export-toggle').blur()`);
    const tooltipCases=[];
    for(const [selector,label] of [['.li-export-toggle','Export conversation'],['.li-export-reply','Export reply as PDF']]) {
      // Verify stable CSS metrics here; tooltip events have separate UI tests.
      // Do not couple these geometry checks to focus timing after modal close.
      await cdp.evaluate(`(async()=>{const anchor=document.querySelector(${JSON.stringify(selector)});anchor.scrollIntoView({block:'nearest'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));anchor.focus({preventScroll:true});})()`);
      await sleep(350);
      const geometry=await cdp.evaluate(`(()=>{const anchor=document.querySelector(${JSON.stringify(selector)}),tip=document.querySelector('.li-export-tooltip'),css=getComputedStyle(tip),a=anchor.getBoundingClientRect(),r=tip.getBoundingClientRect(),i=anchor.querySelector('svg').getBoundingClientRect();return {label:tip.textContent,anchor:{width:a.width,height:a.height,radius:getComputedStyle(anchor).borderRadius},icon:{width:i.width,height:i.height,centerX:Math.abs(a.left+a.width/2-i.left-i.width/2),centerY:Math.abs(a.top+a.height/2-i.top-i.height/2)},tooltip:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,fontSize:css.fontSize,lineHeight:css.lineHeight,fontWeight:css.fontWeight,radius:css.borderRadius,padding:css.padding,border:css.borderTopWidth},expectedTop:Math.min(a.bottom+8,innerHeight-r.height-8)}})()`);
      assert.equal(geometry.tooltip.fontSize,'14px');assert.equal(geometry.tooltip.lineHeight,'18px');assert.equal(geometry.tooltip.fontWeight,'600');assert.equal(geometry.tooltip.radius,'16px');assert.equal(geometry.tooltip.padding,'5px 12px');assert.equal(geometry.tooltip.border,'1px');
      assert.equal(geometry.icon.width,20);assert.equal(geometry.icon.height,20);assert(geometry.icon.centerX<.6&&geometry.icon.centerY<.6);
      if(selector==='.li-export-reply'){assert.equal(geometry.anchor.width,32);assert.equal(geometry.anchor.height,32);assert.equal(geometry.anchor.radius,'8px');}
      if(geometry.tooltip.height>0){
        assert.equal(geometry.label,label);assert.equal(geometry.tooltip.height,30);
        // The production clamp uses integer offsetWidth; DOMRect retains the
        // label's fractional text width, so permit its subpixel rounding error.
        assert(geometry.tooltip.left>=7&&geometry.tooltip.right<=1273&&geometry.tooltip.bottom<=893,JSON.stringify(geometry.tooltip));
        shot=await cdp.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(output,selector==='.li-export-reply'?'chatgpt-reply-tooltip.png':'chatgpt-header-tooltip.png'),Buffer.from(shot.data,'base64'));
      }
      tooltipCases.push({selector,expectedLabel:label,...geometry});
      await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).blur()`);
    }
    await cdp.evaluate(`(()=>{window.streamingReplyAction=document.querySelector('.li-export-reply');window.streamingReplyAction.focus();const composer=document.createElement('div');composer.id='fixture-streaming-composer';composer.setAttribute('data-chatgpt-composer','');composer.innerHTML='<div data-composer-footer-responsive><button aria-label="Arrêter">■</button></div>';document.body.append(composer);})()`);
    await until(()=>cdp.evaluate(`window.streamingReplyAction.hidden&&getComputedStyle(window.streamingReplyAction).display==='none'&&document.querySelector('.li-export-tooltip').hidden`),'Reply export hidden while September composer is streaming');
    await cdp.evaluate(`document.getElementById('fixture-streaming-composer').remove()`);
    await until(()=>cdp.evaluate(`!window.streamingReplyAction.hidden&&getComputedStyle(window.streamingReplyAction).display!=='none'`),'Reply export restored after streaming');
    assert.equal(await cdp.evaluate(`document.querySelector('.li-export-reply')===window.streamingReplyAction`),true);
    reports.push({case:'Native export controls, compact tooltips and streaming visibility',tooltips:tooltipCases,hiddenDuringStreaming:true,sameReplyButton:true});
    // Leave the expected open PDF dialog for the following virtualized-history
    // scenario, with no synthetic transcript endpoint or backend requests.
    await openConversation();await cdp.evaluate(`document.querySelector('.li-export-inspect').click()`);
    await until(()=>cdp.evaluate(`document.querySelector('.li-export-panel').getAttribute('aria-busy')==='false'&&document.querySelectorAll('.li-export-pdf-preview .li-pdf-message').length===2`),'PDF preview restored after UI layout checks');
    }
    await cdp.evaluate(`(()=>{document.querySelector('.li-export-close').click();const root=document.querySelector('[data-chatgpt-conversation-selection-target]'),scroll=document.querySelector('[data-app-action-timeline-scroll]');root.style.cssText='height:2400px;position:relative;margin:0;padding:0';window.negativeWindows=[];
      const paint=()=>{const distance=Math.max(0,scroll.scrollHeight-scroll.clientHeight+scroll.scrollTop),start=Math.max(0,Math.min(6,Math.floor(distance/200)-1));window.negativeWindows.push({start,top:scroll.scrollTop});root.replaceChildren(...Array.from({length:6},(_,offset)=>{const i=start+offset,n=document.createElement('div'),role=i%2?'assistant':'user';n.setAttribute('data-chatgpt-search-unit-key','fallback-turn-'+Math.floor(i/2)+':'+(i%2?2:0)+':'+role);n.setAttribute('data-chatgpt-search-message-ids','modern-'+i);n.style.cssText='position:absolute;top:'+(i*200)+'px;height:180px;margin:0';n.textContent='REVERSED_VISIBLE_MESSAGE_'+i;return n;}));};scroll.addEventListener('scroll',paint);paint();scroll.scrollTop=700-(scroll.scrollHeight-scroll.clientHeight);paint();window.negativeStart=scroll.scrollTop;})()`);
    const reversed=await cdp.evaluate(`(async()=>{const c=await LatexIslandsPDF.collect();const r={keys:c.messages.map(m=>m.key),positions:window.negativeWindows.map(w=>w.top),windows:[...new Set(window.negativeWindows.map(w=>w.start))],restored:document.querySelector('[data-app-action-timeline-scroll]').scrollTop,initial:window.negativeStart};c.dispose();return r;})()`);
    assert.deepEqual(reversed.keys,Array.from({length:12},(_,i)=>'message:modern-'+i));assert(reversed.windows.length>3);assert(reversed.positions.some(top=>top<0));assert.equal(reversed.restored,reversed.initial);
    reports.push({case:'September reversed browser scroll and virtualized history',...reversed,editor});
    assert.deepEqual(cdp.errors, [], 'No browser exceptions');
    const report = {ok:true,browser,productionEngine:true,backendRequests:0,artifacts:output,cases:reports};
    await fs.writeFile(path.join(output, 'pdf-print-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify({completedCases:reports.map(report=>report.case),lastExpression:cdp?.lastExpression,browserErrors:cdp?.errors,requests:requests.slice(-15),stderr}, null, 2));
    throw error;
  } finally {
    releaseFonts();releaseIslands();
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
