const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom');
const DOM_SCRIPT=fs.readFileSync(path.join(__dirname,'../chatgpt-dom.js'),'utf8');
const SCRIPT=fs.readFileSync(path.join(__dirname,'../export-pdf.js'),'utf8');
const SVG='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300"><style>@font-face{font-family:TeX;src:url(data:font/woff2;base64,AA==)}</style><text x="20" y="30">Edited diagram</text></svg>';
function harness(t,html='<main><article data-message-author-role="user">Question</article><article data-message-author-role="assistant"><div class="markdown"><p>Answer</p></div></article></main>') {
  const dom=new JSDOM('<!doctype html><title>Sample conversation - ChatGPT</title>'+html,{url:'https://chatgpt.com/c/example',runScripts:'outside-only'});
  const w=dom.window,doc=w.document;
  Object.defineProperty(w.HTMLImageElement.prototype,'naturalWidth',{configurable:true,get(){return 600;}});
  w.HTMLImageElement.prototype.decode=async function(){};
  w.fetch=()=>{throw Error('PDF must not fetch conversation data');};
  const prints=[];w.print=()=>prints.push(doc.body.className);
  w.eval(DOM_SCRIPT);w.eval(SCRIPT);t.after(()=>w.close());
  return {w,doc,prints,collect:options=>w.LatexIslandsPDF.collect(options),prepare:options=>w.LatexIslandsPDF.prepare(options),get:selector=>doc.querySelector(selector)};
}

function fastCollection(h, virtualClock=false) {
  const timer=h.w.setTimeout.bind(h.w);let now=1000;
  if(virtualClock)h.w.Date.now=()=>now;
  h.w.setTimeout=(callback,ms,...args)=>timer(()=>{if(virtualClock&&ms===120)now+=ms;callback(...args);},ms===120||ms===150?0:ms);
}

function scrollFixture(h,{height=1200,viewport=450,start=500,reverse=false,render=()=>{}}={}) {
  const scroller=h.get('#scroll');let top=start;const positions=[];
  Object.defineProperties(scroller,{scrollHeight:{configurable:true,get:()=>typeof height==='function'?height():height},clientHeight:{get:()=>viewport},scrollTop:{get:()=>top,set:value=>{top=value;}}});
  scroller.scrollTo=({top:next})=>{const maximum=Math.max(0,scroller.scrollHeight-viewport);top=reverse?Math.max(-maximum,Math.min(next,0)):Math.max(0,Math.min(next,maximum));positions.push(top);render(top);};
  render(top);return {scroller,positions,get top(){return top;}};
}

function redesignedTurn(index,{prompt=`Prompt ${index}`,answer=`Answer ${index}`}={}) {
  return `<div data-turn-key="u${index}"><div data-content-search-turn-key="fallback-turn-${index}">
    <div data-chatgpt-search-unit-key="fallback-turn-${index}:user" data-chatgpt-search-message-ids="u${index}"><h4 class="sr-only" data-conversation-role="user">You said:</h4><div data-user-message-bubble>${prompt}</div><button>Edit message</button></div>
    <div data-chatgpt-search-unit-key="fallback-turn-${index}:assistant" data-chatgpt-search-message-ids="a${index} a${index}"><h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4><div data-chatgpt-selection-message-id="a${index}"><div data-markdown-text-style="assistant-message">${answer}</div></div></div>
    <div class="turn-action-controls"><button>Copy reply</button></div>
  </div></div>`;
}

test('captures only current main messages in order without backend access or UI',async t=>{
  const h=harness(t,`<aside data-message-author-role="assistant">Sidebar secret</aside><main>
  <article data-message-author-role="user">Question</article>
  <article data-message-author-role="assistant"><div class="markdown"><h3>A heading</h3><p>Rich <strong>answer</strong> with <em>emphasis</em>.</p><ul><li>Item</li></ul><table><tr><td>Cell</td></tr></table></div><button>Copy</button><div role="toolbar">Actions</div><span class="li-export-reply">PDF</span></article>
  <div hidden><article data-message-author-role="assistant">Hidden alternate answer</article></div>
  <div class="li-export"><article data-message-author-role="assistant">Old export</article></div>
  <form><textarea>Private unsent draft</textarea></form></main>`);
  const pdf=await h.prepare();t.after(pdf.dispose);
  assert.equal(pdf.count,2);assert.equal(pdf.title,'Sample conversation');
  assert.deepEqual([...pdf.root.querySelectorAll('.li-pdf-role')].map(x=>x.textContent),['You','ChatGPT']);
  assert.ok(pdf.root.querySelector('h3'));assert.ok(pdf.root.querySelector('strong'));assert.ok(pdf.root.querySelector('em'));assert.ok(pdf.root.querySelector('li'));assert.ok(pdf.root.querySelector('table'));
  assert.doesNotMatch(pdf.root.textContent,/Sidebar secret|Hidden alternate|Old export|Private unsent|Copy|Actions|PDF/);
  assert.equal(pdf.root.parentElement,h.doc.body);assert.equal(h.w.getComputedStyle(pdf.root).display,'none');
  assert.equal(h.doc.body.classList.contains('li-pdf-printing'),false);
});

test('single reply and answers-only selection leave unrelated messages out',async t=>{
  const h=harness(t,'<main><article data-message-author-role="user">Secret prompt</article><article id="first" data-message-author-role="assistant"><p>First answer</p></article><article id="last" data-message-author-role="assistant">Second answer</article></main>');
  const first=await h.prepare({replyElement:h.get('#first p')});
  assert.equal(first.count,1);assert.match(first.root.textContent,/First answer/);assert.doesNotMatch(first.root.textContent,/Secret prompt|Second answer/);first.dispose();
  const answers=await h.prepare({includeUser:false});t.after(answers.dispose);assert.equal(answers.count,2);assert.doesNotMatch(answers.root.textContent,/Secret prompt/);
  const stale=h.doc.createElement('article');stale.setAttribute('data-message-author-role','assistant');
  await assert.rejects(h.prepare({replyElement:stale}),/no longer on the page/);
});

test('native KaTeX visual HTML remains intact and MathML is not duplicated visually',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span><span class="katex-html" aria-hidden="true"><span class="base" style="height:1.2em;vertical-align:-0.2em">visual x</span></span></span><span aria-hidden="true">Hidden control</span></article></main>');
  const pdf=await h.prepare();t.after(pdf.dispose);
  assert.equal(pdf.root.querySelector('.katex-html').getAttribute('aria-hidden'),'true');
  assert.match(pdf.root.querySelector('.katex-html').textContent,/visual x/);
  assert.equal(pdf.root.querySelector('.base').style.verticalAlign,'-0.2em');
  assert.equal(h.w.getComputedStyle(pdf.root.querySelector('.katex-mathml')).display,'none');
  assert.doesNotMatch(pdf.root.textContent,/Hidden control/);
});

test('snapshots replace hidden original TeX in place with intrinsic-sized vector images',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><p>Before</p><pre class="latex-islands-original-hidden" style="display:none" id="tex"><code>Original TeX</code></pre><div class="latex-islands-container" style="transform:scale(.2);height:50px"><iframe></iframe></div><p>After</p></article></main>');
  let calls=0;
  h.w.LatexIslandsDiagramExport={snapshot:async (element,options)=>{calls++;assert.equal(element,h.get('main article'));assert.equal(options.signal,undefined);return [{sourceElement:h.get('#tex'),containerElement:h.get('.latex-islands-container'),svg:SVG,width:600,height:300}];}};
  const pdf=await h.prepare();t.after(pdf.dispose);assert.equal(calls,1);
  const image=pdf.root.querySelector('.li-pdf-island-image');assert.ok(image);
  assert.equal(image.width,600);assert.equal(image.height,300);assert.equal(image.style.width,'600px');assert.equal(image.style.maxWidth,'100%');assert.equal(image.style.maxHeight,'180mm');
  assert.equal(decodeURIComponent(image.src.split(',').slice(1).join(',')),SVG);
  assert.equal(pdf.root.querySelector('iframe, .latex-islands-container, pre'),null);
  const content=pdf.root.querySelector('[data-message-author-role]');assert.deepEqual([...content.children].map(x=>x.localName),['p','figure','p']);
  assert.doesNotMatch(pdf.root.textContent,/Original TeX/);
  assert.ok(h.get('#tex'),'Live conversation remains unchanged');
});

test('unavailable, unrendered, failed or invalid diagrams fail explicitly and clean up',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><pre id="tex">TeX</pre><div class="latex-islands-container"></div></article></main>');
  await assert.rejects(h.prepare(),/export is unavailable/);
  h.w.LatexIslandsDiagramExport={snapshot:async()=>[]};await assert.rejects(h.prepare(),/not ready/);
  h.w.LatexIslandsDiagramExport={snapshot:async()=>{throw Error('Rendering failed');}};await assert.rejects(h.prepare(),/Rendering failed/);
  h.w.LatexIslandsDiagramExport={snapshot:async()=>[{sourceElement:h.get('#tex'),containerElement:h.get('.latex-islands-container'),svg:SVG,width:0,height:300}]};await assert.rejects(h.prepare(),/no valid rendered size/);
  assert.equal(h.get('.li-pdf-document'),null);assert.equal(h.get('style[data-latex-islands-pdf]'),null);
});

test('raw diagrams preserve rich prose before and after the TeX rather than replacing the whole paragraph',async t=>{
  const h=harness(t,'<div role="main"><article data-message-author-role="assistant"><p id="raw"><strong>Before</strong> \\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture} <em>After</em></p><div class="latex-islands-container"></div></article></div>');
  h.w.LatexIslandsCore=require('../core.js');
  h.w.LatexIslandsDiagramExport={snapshot:async()=>[{sourceElement:h.get('#raw'),containerElement:h.get('.latex-islands-container'),svg:SVG,width:600,height:300}]};
  const pdf=await h.prepare();t.after(pdf.dispose);
  assert.equal(pdf.root.querySelector('strong').textContent,'Before');assert.equal(pdf.root.querySelector('em').textContent,'After');assert.ok(pdf.root.querySelector('.li-pdf-island-image'));
  assert.doesNotMatch(pdf.root.textContent,/tikzpicture|draw/);
});

test('a hidden outer code widget cannot hide a snapshot of its nested source',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><pre class="latex-islands-original-hidden" style="display:none"><pre id="tex">Source</pre></pre><div class="latex-islands-container"></div></article></main>');
  h.w.LatexIslandsDiagramExport={snapshot:async()=>[{sourceElement:h.get('#tex'),containerElement:h.get('.latex-islands-container'),svg:SVG,width:600,height:300}]};
  const pdf=await h.prepare();t.after(pdf.dispose);const image=pdf.root.querySelector('.li-pdf-island-image');assert.ok(image);assert.equal(h.w.getComputedStyle(image.closest('pre')).display,'block');assert.doesNotMatch(pdf.root.textContent,/Source/);
});

test('live hydration hiding markers cannot hide PDF clones or silently omit an uncaptured diagram',async t=>{
  const h=harness(t,'<style>[data-latex-islands-hidden="true"]{display:none!important}</style><main><article data-message-author-role="assistant"><div id="widget" data-latex-islands-hidden="true"><pre id="tex">Source</pre></div><div class="latex-islands-container"></div><code data-latex-islands-hidden="false">Visible fallback code</code></article></main>');
  h.w.LatexIslandsDiagramExport={snapshot:async()=>[{sourceElement:h.get('#tex'),containerElement:h.get('.latex-islands-container'),svg:SVG,width:600,height:300}]};
  const pdf=await h.prepare();t.after(pdf.dispose);
  const image=pdf.root.querySelector('.li-pdf-island-image');assert.ok(image);assert.equal(h.w.getComputedStyle(image.closest('div')).display,'block');
  assert.equal(pdf.root.querySelector('[data-latex-islands-hidden]'),null);assert.match(pdf.root.textContent,/Visible fallback code/);
  assert.equal(h.get('#widget').getAttribute('data-latex-islands-hidden'),'true');assert.equal(h.w.getComputedStyle(h.get('#widget')).display,'none');
  h.w.LatexIslandsDiagramExport.snapshot=async()=>[];await assert.rejects(h.prepare(),/not ready/);
});

test('streaming detection blocks only selected replies including the current stop-button reply',async t=>{
  const h=harness(t,'<main><article id="old" data-message-author-role="assistant">Complete</article><article id="new" data-message-author-role="assistant" data-is-streaming="true">Generating</article></main>');
  await assert.rejects(h.prepare(),/finish generating/);
  const old=await h.prepare({replyElement:h.get('#old')});old.dispose();
  h.get('#new').removeAttribute('data-is-streaming');const stop=h.doc.createElement('button');stop.dataset.testid='stop-button';h.doc.body.append(stop);
  await assert.rejects(h.prepare({replyElement:h.get('#new')}),/finish generating/);
  const oldAgain=await h.prepare({replyElement:h.get('#old')});oldAgain.dispose();
});

test('sanitization keeps safe links and selected loaded pictures without active content',async t=>{
  const h=harness(t,`<main><article data-message-author-role="assistant"><p onclick="evil()">Text<script>evil()</script></p><a href="javascript:evil()" onmouseover="evil()">Bad</a><a href="/safe" ping="https://evil.test">Good</a><iframe src="https://evil.test"></iframe><object data="https://evil.test"></object><style>body{color:red}</style><img src="/small.png" srcset="/big.png 2x" onerror="evil()" loading="lazy"><span style="background-image:url(https://evil.test/private);vertical-align:1em">Styled</span><svg><foreignObject><script>evil()</script></foreignObject><path id="path" d="M0 0L1 1"></path><use href="#path"></use></svg></article></main>`);
  Object.defineProperty(h.get('img'),'currentSrc',{value:'https://chatgpt.com/rendered.png'});
  const pdf=await h.prepare();t.after(pdf.dispose);
  assert.equal(pdf.root.querySelector('script,iframe,object,style'),null);
  assert.equal(pdf.root.querySelector('[onclick],[onmouseover],[onerror],[ping],[srcset]'),null);
  const anchors=pdf.root.querySelectorAll('a');assert.equal(anchors[0].hasAttribute('href'),false);assert.equal(anchors[1].href,'https://chatgpt.com/safe');
  assert.equal(pdf.root.querySelector('img').src,'https://chatgpt.com/rendered.png');assert.equal(pdf.root.querySelector('img').loading,'eager');
  assert.doesNotMatch(pdf.root.innerHTML,/evil\.test|javascript:/);
  const path=pdf.root.querySelector('path'),use=pdf.root.querySelector('use');assert.notEqual(path.id,'path');assert.equal(use.getAttribute('href'),'#'+path.id);
});

test('duplicate inline SVG ids get independent references and do not collide with the page',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><svg><defs><path id="glyph" d="M0 0"/></defs><use href="#glyph"/></svg><svg><defs><path id="glyph" d="M1 1"/></defs><use href="#glyph"/></svg></article></main>');
  const pdf=await h.prepare();t.after(pdf.dispose);
  const svgs=[...pdf.root.querySelectorAll('svg')];assert.notEqual(svgs[0].querySelector('path').id,svgs[1].querySelector('path').id);
  for(const svg of svgs)assert.equal(svg.querySelector('use').getAttribute('href'),'#'+svg.querySelector('path').id);
});

test('native Mermaid-style SVG labels and computed paint survive safe cloning and scoped ID changes',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><svg id="mermaid" viewBox="0 0 200 100"><style>#mermaid .node{fill:rgb(240, 230, 255);stroke:rgb(50, 10, 80)} #mermaid .nodeLabel{font-size:16px;color:rgb(50, 10, 80)}</style><rect class="node" width="180" height="80"/><foreignObject width="180" height="80"><div xmlns="http://www.w3.org/1999/xhtml" style="height:80px"><span class="nodeLabel" onclick="bad()"><b>Rendered label</b></span><script>bad()</script></div></foreignObject></svg></article></main>');
  // jsdom does not apply stylesheet nodes inside SVG; expose the actual browser
  // result for this narrowly scoped property so the clone path remains covered.
  const original=h.w.getComputedStyle;h.w.getComputedStyle=element=>{
    const computed=original(element);if(element.matches('.node'))return {display:computed.display,visibility:computed.visibility,getPropertyValue:property=>property==='fill'?'rgb(240, 230, 255)':property==='stroke'?'rgb(50, 10, 80)':computed.getPropertyValue(property)};
    return computed;
  };
  const pdf=await h.prepare();t.after(pdf.dispose);
  const label=pdf.root.querySelector('foreignObject .nodeLabel');assert.equal(label.textContent,'Rendered label');assert.ok(label.querySelector('b'));assert.equal(label.hasAttribute('onclick'),false);assert.equal(pdf.root.querySelector('script,style'),null);
  assert.equal(pdf.root.querySelector('rect').style.fill,'rgb(240, 230, 255)');assert.equal(pdf.root.querySelector('rect').style.stroke,'rgb(50, 10, 80)');assert.equal(pdf.root.querySelector('foreignObject div').style.height,'80px');
});

test('inline SVG image resources must decode successfully before printing',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><svg><image href="/chart.png" width="100" height="100"/></svg></article></main>');
  const decoded=[];h.w.HTMLImageElement.prototype.decode=async function(){decoded.push(this.src);};
  const pdf=await h.prepare();t.after(pdf.dispose);assert.deepEqual(decoded,['https://chatgpt.com/chart.png']);
  h.w.HTMLImageElement.prototype.decode=async()=>{throw Error('SVG image failed');};await assert.rejects(h.prepare(),/SVG image failed/);
});

test('clickable ChatGPT image cards preserve their pictures without viewer buttons or toolbars',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><button onclick="openViewer()"><img src="/generated.png" alt="Generated picture"><span>Open image</span></button><div role="button"><img src="/chart.png" alt="Chart"></div><div role="toolbar"><button><img src="/copy-icon.png" alt="Copy"></button></div><button><svg><path d="M0 0"/></svg>Copy code</button></article></main>');
  const pdf=await h.prepare();t.after(pdf.dispose);
  assert.deepEqual([...pdf.root.querySelectorAll('img')].map(image=>image.alt),['Generated picture','Chart']);assert.equal(pdf.root.querySelector('button,[role="button"],[onclick]'),null);assert.doesNotMatch(pdf.root.textContent,/Copy code|Open image/);
});

test('valid SVG data images without optional MIME parameters are supported',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><img></article></main>');
  const src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');h.get('img').src=src;
  const pdf=await h.prepare();t.after(pdf.dispose);assert.equal(pdf.root.querySelector('img').src,src);
});

test('code widgets retain actual code and CodeMirror newlines without their chrome',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><pre><div>python<button>Copy code</button></div><div class="cm-scroller"><pre class="cm-content"><div class="cm-line">one</div><div class="cm-line">two</div></pre></div></pre><pre><div>javascript</div><code><span class="token">const</span> x = 1;</code></pre></article></main>');
  const pdf=await h.prepare();t.after(pdf.dispose);
  const code=pdf.root.querySelectorAll('pre code');assert.equal(code.length,2);assert.equal(code[0].textContent,'one\ntwo');assert.equal(code[1].textContent,'const x = 1;');assert.ok(code[1].querySelector('.token'));
  assert.doesNotMatch(pdf.root.textContent,/Copy code|python|javascript/);
});

test('redesigned messages preserve roles, plain code widgets and math without duplicate speaker headings',async t=>{
  const code='<div data-markdown-copy="code-block"><header data-markdown-copy="exclude"><div>python</div><button>Copy code</button></header><div><code><span class="token">print</span>("first")\nprint("second")</code></div></div>';
  const math='<span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span><span class="katex-html" aria-hidden="true">Rendered math</span></span>';
  const h=harness(t,`<aside data-chatgpt-search-unit-key="outside:assistant">Sidebar secret</aside><main><div data-app-action-timeline-scroll><div data-chatgpt-conversation-selection-target>${redesignedTurn(0,{answer:'<p>Rich answer</p>'+code+math})}</div></div></main>`);
  const pdf=await h.prepare();t.after(pdf.dispose);
  assert.equal(pdf.count,2);assert.deepEqual([...pdf.root.querySelectorAll('.li-pdf-role')].map(node=>node.textContent),['You','ChatGPT']);
  const copiedCode=pdf.root.querySelector('pre code');assert.equal(copiedCode.textContent,'print("first")\nprint("second")');assert.ok(copiedCode.querySelector('.token'));
  assert.match(pdf.root.textContent,/Rendered math/);assert.doesNotMatch(pdf.root.textContent,/Sidebar secret|You said:|ChatGPT said:|Edit message|Copy reply|Copy code|python/);
  const answers=await h.prepare({includeUser:false});t.after(answers.dispose);assert.equal(answers.count,1);assert.doesNotMatch(answers.root.textContent,/Prompt 0/);
  const reply=await h.collect({replyElement:h.get('[data-markdown-text-style] p')});t.after(reply.dispose);assert.equal(reply.replyKey,'message:a0');assert.equal(reply.precedingPromptKey,'message:u0');
});

test('redesigned hidden code widgets are replaced by their rendered diagram without language chrome',async t=>{
  const code='<div id="tex" data-markdown-copy="code-block" class="latex-islands-original-hidden" style="display:none"><header data-markdown-copy="exclude"><div>tikz</div></header><div><code>Original TeX</code></div></div><div class="latex-islands-container"><iframe></iframe></div>';
  const h=harness(t,`<main>${redesignedTurn(0,{answer:'Before '+code+' After'})}</main>`);
  h.w.LatexIslandsDiagramExport={snapshot:async source=>source.contains(h.get('#tex'))?[{sourceElement:h.get('#tex'),containerElement:h.get('.latex-islands-container'),svg:SVG,width:600,height:300}]:[]};
  const pdf=await h.prepare();t.after(pdf.dispose);assert.ok(pdf.root.querySelector('.li-pdf-island-image'));assert.doesNotMatch(pdf.root.textContent,/Original TeX|tikz|ChatGPT said:/);assert.match(pdf.root.textContent,/Before.*After/);
});

test('redesigned image-only prompts remain selectable without a text bubble',async t=>{
  const h=harness(t,'<main><div data-content-search-turn-key="fallback-turn-0"><div data-chatgpt-search-unit-key="fallback-turn-0:user" data-chatgpt-search-message-ids="image-prompt"><h4 data-conversation-role="user" class="sr-only">You said:</h4><button><img src="/uploaded.png" alt="Uploaded image"></button><button>Edit message</button></div></div></main>');fastCollection(h);
  const capture=await h.collect();t.after(capture.dispose);assert.equal(capture.messages.length,1);assert.equal(capture.messages[0].key,'message:image-prompt');assert.equal(capture.messages[0].role,'user');
  const pdf=await h.prepare({capture,roleMode:'prompts'});t.after(pdf.dispose);assert.equal(pdf.count,1);assert.equal(pdf.root.querySelector('img').src,'https://chatgpt.com/uploaded.png');assert.doesNotMatch(pdf.root.textContent,/You said:|Edit message/);
});

test('dark redesigned prompt bubbles and copied theme scopes use readable paper colors without changing SVG paint',async t=>{
  const h=harness(t,`<style>:root,[data-theme="dark"]{--color-text-primary:#ededed;--color-text-secondary:#cdcdcd;--color-surface-elevated:#1b1b1b}[data-user-message-bubble]{background:#1b1b1b;color:#171717;border-radius:24px;padding:12px 20px}</style><main>${redesignedTurn(0,{answer:'<div data-theme="dark"><p>Answer in a theme scope</p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path style="fill:rgb(20, 80, 200);stroke:rgb(200, 30, 50)" d="M0 0L20 20"/></svg></div>'})}</main>`);
  h.doc.documentElement.dataset.theme='dark';
  const sourceBubble=h.get('[data-user-message-bubble]'),sourceScope=h.get('main [data-theme]'),sourceSVG=h.get('svg path');
  const sourcePaint={fill:h.w.getComputedStyle(sourceSVG).fill,stroke:h.w.getComputedStyle(sourceSVG).stroke};
  const pdf=await h.prepare();t.after(pdf.dispose);
  const bubble=pdf.root.querySelector('[data-user-message-bubble]'),css=h.w.getComputedStyle(bubble),scope=pdf.root.querySelector('[data-theme]');
  assert.equal(css.color,'rgb(23, 23, 23)');assert.equal(css.backgroundColor,'rgb(245, 245, 245)');assert.equal(css.borderRadius,'24px');assert.equal(css.padding,'12px 20px');
  assert.equal(scope.dataset.theme,'light');assert.equal(h.w.getComputedStyle(scope).getPropertyValue('--color-text-primary'),'#171717');assert.equal(h.w.getComputedStyle(pdf.root).getPropertyValue('--color-surface-elevated'),'#fff');
  assert.equal(h.w.getComputedStyle(pdf.root.querySelector('svg path')).fill,sourcePaint.fill);assert.equal(h.w.getComputedStyle(pdf.root.querySelector('svg path')).stroke,sourcePaint.stroke);
  assert.equal(sourceScope.dataset.theme,'dark');assert.equal(h.w.getComputedStyle(sourceBubble).backgroundColor,'rgb(27, 27, 27)','The live page theme is not changed');
});

test('dark assistant text and native math use paper ink while semantic colors and diagram paint remain intact',async t=>{
  const h=harness(t,`<style>.dark-message{color:rgb(236,236,236)!important;--color-text-primary:#ececec}.dark-message h3{color:rgb(245,245,245)!important}.neutral-fill{-webkit-text-fill-color:rgb(237,237,237)}</style><main>${redesignedTurn(0,{answer:`<div class="dark-message">
    <h3 class="paper-heading">Heading</h3><p class="paper-prose">Inherited assistant text <strong>and emphasis</strong>.</p>
    <p class="neutral-fill">Text fill</p><p class="inline-fill" style="-webkit-text-fill-color:rgb(236,236,236)!important">Inline text fill</p><p class="semantic-text" style="color:rgb(20,80,200)">Explicit blue text</p>
    <span class="katex"><span class="katex-html" aria-hidden="true"><span class="mord">x</span><span class="colored-math" style="color:rgb(180,30,50)">y</span><svg viewBox="0 0 20 20"><path class="math-line" style="fill:rgb(236,236,236);stroke:rgb(236,236,236)" d="M0 0L20 20"/><path class="colored-math-line" style="fill:rgb(180,30,50)" d="M0 0L10 10"/></svg></span></span>
    <math><mi>x</mi></math>
    <svg class="native-diagram" viewBox="0 0 20 20"><path style="fill:rgb(236,236,236);stroke:rgb(20,80,200)" d="M0 0L20 20"/><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" class="native-label" style="color:rgb(236,236,236)">Native label</div></foreignObject></svg>
    </div>`})}</main>`);
  h.doc.documentElement.dataset.theme='dark';const source=h.get('.dark-message'),before=source.outerHTML;
  assert.equal(h.w.getComputedStyle(h.get('.paper-prose')).color,'rgb(236, 236, 236)','Reproduces the dark inherited text before export');
  const pdf=await h.prepare();t.after(pdf.dispose);
  for(const selector of ['.paper-heading','.paper-prose','.paper-prose strong','.neutral-fill','.katex','.katex .mord'])assert.equal(h.w.getComputedStyle(pdf.root.querySelector(selector)).color,'rgb(23, 23, 23)',selector+' must be readable on white paper');
  for(const selector of ['.neutral-fill','.inline-fill']){
    const element=pdf.root.querySelector(selector);
    assert.equal(h.w.getComputedStyle(element).getPropertyValue('-webkit-text-fill-color'),'rgb(23, 23, 23)');
    assert.equal(element.style.getPropertyPriority('-webkit-text-fill-color'),'important');
  }
  assert.equal(h.w.getComputedStyle(pdf.root.querySelector('.math-line')).fill,'#171717');assert.equal(h.w.getComputedStyle(pdf.root.querySelector('.math-line')).stroke,'#171717');
  assert.equal(h.w.getComputedStyle(pdf.root.querySelector('.semantic-text')).color,'rgb(20, 80, 200)');
  assert.equal(h.w.getComputedStyle(pdf.root.querySelector('.colored-math')).color,'rgb(180, 30, 50)');assert.equal(h.w.getComputedStyle(pdf.root.querySelector('.colored-math-line')).fill,'rgb(180,30,50)');
  assert.equal(h.w.getComputedStyle(pdf.root.querySelector('.native-diagram path')).fill,'rgb(236,236,236)');assert.equal(h.w.getComputedStyle(pdf.root.querySelector('.native-diagram path')).stroke,'rgb(20,80,200)');
  assert.equal(h.w.getComputedStyle(pdf.root.querySelector('.native-label')).color,'rgb(236, 236, 236)');assert.equal(source.outerHTML,before,'The live message and its dark theme remain unchanged');
});

test('asset failures and unsafe image URLs prevent incomplete PDFs',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><img src="/image.png"></article></main>');
  h.w.HTMLImageElement.prototype.decode=async()=>{throw Error('Image decode failed');};
  await assert.rejects(h.prepare(),/Image decode failed/);assert.equal(h.get('.li-pdf-document'),null);
  h.get('img').src='javascript:bad()';await assert.rejects(h.prepare(),/cannot be included safely/);
  assert.equal(h.get('style[data-latex-islands-pdf]'),null);
});

test('cancellation during image readiness rejects immediately and removes the prepared DOM',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><img src="/image.png"></article></main>');
  h.w.HTMLImageElement.prototype.decode=()=>new Promise(()=>{});
  const controller=new h.w.AbortController(),pending=h.prepare({signal:controller.signal});
  await new Promise(resolve=>setImmediate(resolve));assert.ok(h.get('.li-pdf-document'));controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(h.get('.li-pdf-document'),null);assert.equal(h.get('style[data-latex-islands-pdf]'),null);
  await assert.rejects(h.prepare({signal:controller.signal}),{name:'AbortError'});
});

test('content changed during asset loading is rejected instead of mixing conversation versions',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><p>Original</p><img src="/image.png"></article></main>');
  let resolve;h.w.HTMLImageElement.prototype.decode=()=>new Promise(done=>{resolve=done;});
  const pending=h.prepare();await new Promise(done=>setImmediate(done));h.get('main p').textContent='Edited';resolve();
  await assert.rejects(pending,/conversation changed/);assert.equal(h.get('.li-pdf-document'),null);
});

test('print lifecycle isolates only the prepared document and waits for afterprint before disposal',async t=>{
  const h=harness(t),progress=[];const pdf=await h.prepare({onProgress:value=>progress.push(value)});
  assert.equal(progress.at(-1).phase,'ready');assert.equal(progress.at(-1).completed,2);
  pdf.print();assert.equal(h.prints.length,1);assert.match(h.prints[0],/li-pdf-printing/);assert.ok(pdf.root.isConnected);assert.equal(h.doc.title,'Sample conversation');
  assert.throws(()=>pdf.print(),/already open/);
  const css=h.get('style[data-latex-islands-pdf]').textContent;assert.match(css,/body\.li-pdf-printing > :not\(/);assert.match(css,/@page li-pdf-export/);assert.match(css,/::backdrop/);assert.match(css,/break-inside:avoid/);
  h.w.dispatchEvent(new h.w.Event('afterprint'));assert.equal(pdf.root.isConnected,false);assert.equal(h.doc.title,'Sample conversation - ChatGPT');assert.equal(h.doc.body.classList.contains('li-pdf-printing'),false);assert.equal(h.get('style[data-latex-islands-pdf]'),null);
  pdf.dispose();assert.throws(()=>pdf.print(),/expired/);
});

test('print errors, navigation and post-preparation cancellation restore the page',async t=>{
  const h=harness(t);let pdf=await h.prepare();h.w.print=()=>{throw Error('Print unavailable');};assert.throws(()=>pdf.print(),/Print unavailable/);assert.equal(pdf.root.isConnected,false);assert.equal(h.doc.body.classList.contains('li-pdf-printing'),false);
  pdf=await h.prepare();h.w.dispatchEvent(new h.w.Event('pagehide'));assert.equal(pdf.root.isConnected,false);
  const controller=new h.w.AbortController();pdf=await h.prepare({signal:controller.signal});controller.abort();assert.equal(pdf.root.isConnected,false);
});

test('separately prepared exports cannot hide or print each other',async t=>{
  const h=harness(t),first=await h.prepare(),second=await h.prepare();t.after(first.dispose);t.after(second.dispose);
  first.print();assert.equal(first.root.classList.contains('li-pdf-active'),true);assert.equal(second.root.classList.contains('li-pdf-active'),false);assert.throws(()=>second.print(),/already open/);
  h.w.dispatchEvent(new h.w.Event('afterprint'));assert.ok(second.root.isConnected);second.print();assert.equal(h.prints.length,2);h.w.dispatchEvent(new h.w.Event('afterprint'));
});

test('frozen captures support all, none, arbitrary ordered choices and role filters after DOM removal',async t=>{
  const h=harness(t,'<main><article data-message-id="u1" data-message-author-role="user">First prompt</article><article data-message-id="a1" data-message-author-role="assistant"><b>First answer</b></article><article data-message-id="u2" data-message-author-role="user">Second prompt</article><article data-message-id="a2" data-message-author-role="assistant">Second answer</article></main>');fastCollection(h);
  const capture=await h.collect();t.after(capture.dispose);
  assert.equal(Object.isFrozen(capture.messages),true);assert.equal(Object.isFrozen(capture.messages[0]),true);
  assert.deepEqual(Array.from(capture.messages,x=>x.key),['message:u1','message:a1','message:u2','message:a2']);
  h.get('main').replaceChildren();
  const selected=await h.prepare({capture,selectedKeys:['message:a2','message:u1','message:a2']});t.after(selected.dispose);
  assert.equal(selected.count,2);assert.ok(selected.root.textContent.indexOf('First prompt')<selected.root.textContent.indexOf('Second answer'));assert.doesNotMatch(selected.root.textContent,/First answer|Second prompt/);
  const answers=await h.prepare({capture,roleMode:'answers'});t.after(answers.dispose);assert.equal(answers.count,2);assert.ok(answers.root.querySelector('b'));assert.doesNotMatch(answers.root.textContent,/prompt/);
  const prompts=await h.prepare({capture,roleMode:'prompts'});t.after(prompts.dispose);assert.equal(prompts.count,2);assert.doesNotMatch(prompts.root.textContent,/answer/);
  await assert.rejects(h.prepare({capture,selectedKeys:[]}),/no rendered messages/);
  await assert.rejects(h.prepare({capture,selectedKeys:['missing']}),/no longer available/);
  await assert.rejects(h.prepare({capture,selectedKeys:['message:u1'],includeUser:false}),/no rendered messages/);
  capture.dispose();await assert.rejects(h.prepare({capture}),/expired/);
});

test('single reply capture includes only the preceding prompt and needs no history traversal',async t=>{
  const h=harness(t,'<main><article data-message-id="u0" data-message-author-role="user">Earlier prompt</article><article data-message-id="a0" data-message-author-role="assistant">Earlier answer</article><article data-message-id="u1" data-message-author-role="user">Context prompt</article><article id="reply" data-message-id="a1" data-message-author-role="assistant"><p>Chosen answer</p></article><article data-message-author-role="user">Following prompt</article></main>');
  h.doc.documentElement.scrollTo=()=>assert.fail('A single reply must not scroll the entire conversation');
  const capture=await h.collect({replyElement:h.get('#reply p')});t.after(capture.dispose);
  assert.equal(capture.scope,'reply');assert.equal(capture.replyKey,'message:a1');assert.equal(capture.precedingPromptKey,'message:u1');assert.equal(capture.messages.length,2);
  const reply=await h.prepare({capture,selectedKeys:[capture.replyKey]});t.after(reply.dispose);assert.equal(reply.count,1);assert.doesNotMatch(reply.root.textContent,/prompt/);
  const context=await h.prepare({capture});t.after(context.dispose);assert.equal(context.count,2);assert.doesNotMatch(context.root.textContent,/Earlier|Following/);
  const direct=await h.prepare({replyElement:h.get('#reply'),includePrecedingPrompt:true});t.after(direct.dispose);assert.equal(direct.count,2);
});

test('an earlier reply capture remains available while a later reply is generating',async t=>{
  const h=harness(t,'<main><article id="old" data-message-id="old" data-message-author-role="assistant">Finished answer</article><article data-message-id="current" data-message-author-role="assistant" data-is-streaming="true">Generating</article></main><button data-testid="stop-button">Stop</button>');
  const capture=await h.collect({replyElement:h.get('#old')});t.after(capture.dispose);assert.equal(capture.messages[0].error,'');
  const pdf=await h.prepare({capture});t.after(pdf.dispose);assert.match(pdf.root.textContent,/Finished answer/);
});

test('DOM fallback keys remain stable for the same node and capture expires on navigation',async t=>{
  const h=harness(t),reply=h.get('[data-message-author-role="assistant"]');
  const first=await h.collect({replyElement:reply}),second=await h.collect({replyElement:reply});t.after(first.dispose);t.after(second.dispose);
  assert.match(first.replyKey,/^dom:/);assert.equal(first.replyKey,second.replyKey);
  h.w.history.pushState({},'', '/c/another');await assert.rejects(h.prepare({capture:first}),/expired/);
});

test('full capture traverses overlapping virtualized windows and restores the scroll position',async t=>{
  const h=harness(t,'<div id="scroll" style="overflow-y:auto;scroll-behavior:smooth"><main></main></div>');fastCollection(h);
  const fixture=scrollFixture(h,{render:top=>{const first=Math.floor(top/150);h.get('main').innerHTML=Array.from({length:3},(_,offset)=>{const index=first+offset;return `<section data-testid="conversation-turn-${index}"><article data-message-id="m${index}" data-message-author-role="${index%2?'assistant':'user'}"><strong>Message ${index}</strong></article></section>`;}).join('');}});
  const progress=[],capture=await h.collect({onProgress:event=>progress.push(event)});t.after(capture.dispose);
  assert.deepEqual(Array.from(capture.messages,x=>x.key),Array.from({length:8},(_,index)=>'message:m'+index));
  assert.equal(fixture.top,500);assert.equal(fixture.scroller.style.scrollBehavior,'smooth');assert.ok(fixture.positions.includes(0));assert.ok(fixture.positions.includes(750));
  assert.equal(h.get('[data-message-id="m0"]'),null,'Older messages were unmounted by virtualization');
  const pdf=await h.prepare({capture,selectedKeys:['message:m7','message:m0']});t.after(pdf.dispose);assert.deepEqual([...pdf.root.querySelectorAll('strong')].map(x=>x.textContent),['Message 0','Message 7']);assert.equal(progress.at(-1).phase,'ready');
});

test('redesigned reverse timeline captures virtualized messages in chronological order and restores negative scrollTop',async t=>{
  const h=harness(t,'<aside id="sidebar" style="overflow-y:auto"></aside><main><div id="scroll" data-app-action-timeline-scroll style="display:flex;flex-direction:column-reverse;overflow-y:auto;scroll-behavior:smooth"><div data-chatgpt-conversation-selection-target></div></div></main>');fastCollection(h);
  h.get('#sidebar').scrollTo=()=>assert.fail('The conversation exporter must not scroll the sidebar');
  const fixture=scrollFixture(h,{reverse:true,start:-250,render:top=>{const first=Math.min(2,Math.floor((750+top)/300));h.get('[data-chatgpt-conversation-selection-target]').innerHTML=[first,first+1].map(index=>redesignedTurn(index)).join('');}});
  const capture=await h.collect();t.after(capture.dispose);
  assert.deepEqual(Array.from(capture.messages,message=>message.key),Array.from({length:4},(_,index)=>['message:u'+index,'message:a'+index]).flat());
  assert.equal(fixture.top,-250);assert.equal(fixture.scroller.style.scrollBehavior,'smooth');assert.ok(fixture.positions.includes(-750));assert.ok(fixture.positions.includes(0));assert.equal(h.get('[data-chatgpt-search-message-ids="u0"]'),null);
  const pdf=await h.prepare({capture,selectedKeys:['message:a3','message:u0']});t.after(pdf.dispose);assert.equal(pdf.count,2);assert.ok(pdf.root.textContent.indexOf('Prompt 0')<pdf.root.textContent.indexOf('Answer 3'));assert.doesNotMatch(pdf.root.textContent,/Prompt 1|Answer 0/);
});

test('reverse timeline recomputes its oldest negative offset when earlier history increases the height',async t=>{
  const h=harness(t,'<main><div id="scroll" data-app-action-timeline-scroll style="display:flex;flex-direction:column-reverse;overflow-y:auto"><div data-chatgpt-conversation-selection-target></div></div></main>');fastCollection(h);let loaded=false,attempts=0;
  const fixture=scrollFixture(h,{height:()=>loaded?1200:600,reverse:true,start:-50,render:top=>{if(top===-150&&++attempts>=4)loaded=true;const indices=loaded?[0,1,2]:[2];h.get('[data-chatgpt-conversation-selection-target]').innerHTML=indices.map(index=>redesignedTurn(index)).join('');}});
  const capture=await h.collect();t.after(capture.dispose);assert.ok(attempts>=4);assert.ok(fixture.positions.includes(-750));assert.equal(fixture.top,-50);assert.equal(capture.messages.length,6);assert.equal(capture.messages[0].key,'message:u0');
});

test('cancelling a redesigned reverse capture restores the signed scroll position',async t=>{
  const h=harness(t,`<main><div id="scroll" data-app-action-timeline-scroll style="display:flex;flex-direction:column-reverse;overflow-y:auto">${redesignedTurn(0)}</div></main>`);fastCollection(h);
  const fixture=scrollFixture(h,{reverse:true,start:-350}),controller=new h.w.AbortController();
  await assert.rejects(h.collect({signal:controller.signal,onProgress:()=>controller.abort()}),{name:'AbortError'});assert.equal(fixture.top,-350);assert.equal(fixture.scroller.style.scrollBehavior,'');
});

test('history loading keeps requesting the top until older numbered turns appear',async t=>{
  const h=harness(t,'<div id="scroll" style="overflow-y:auto"><main></main></div>');fastCollection(h);let attempts=0,loaded=false;
  const fixture=scrollFixture(h,{height:600,viewport:450,start:100,render:top=>{if(top===0&&++attempts>=5)loaded=true;const start=loaded?0:4;h.get('main').innerHTML=Array.from({length:2},(_,offset)=>`<section data-testid="conversation-turn-${start+offset}"><article data-message-id="m${start+offset}" data-message-author-role="${offset?'assistant':'user'}">Message ${start+offset}</article></section>`).join('');}});
  const capture=await h.collect();t.after(capture.dispose);assert.ok(attempts>=5);assert.deepEqual(Array.from(capture.messages,x=>x.key),['message:m0','message:m1']);assert.equal(fixture.top,100);
});

test('missing history overlap and a permanently incomplete beginning fail without a partial capture',async t=>{
  for(const incompleteTop of [false,true]){
    const h=harness(t,'<div id="scroll" style="overflow-y:auto"><main></main></div>');fastCollection(h);
    const fixture=scrollFixture(h,{render:top=>{const first=incompleteTop?4:top===0?0:10;h.get('main').innerHTML=`<section data-testid="conversation-turn-${first}"><article data-message-id="m${first}" data-message-author-role="assistant">Message ${first}</article></section>`;}});
    await assert.rejects(h.collect(),incompleteTop?/beginning/:/skipped/);assert.equal(fixture.top,500);assert.equal(h.get('.li-pdf-document'),null);
  }
});

test('numbered gaps fail even when every scroll window overlaps',async t=>{
  const h=harness(t,'<main><section data-testid="conversation-turn-0"><article data-message-id="m0" data-message-author-role="user">Prompt</article></section><section data-testid="conversation-turn-2"><article data-message-id="m2" data-message-author-role="assistant">Answer</article></section></main>');fastCollection(h);
  await assert.rejects(h.collect(),/turns are missing/);
});

test('a stuck history loader times out and cancellation restores the original position',async t=>{
  const h=harness(t,'<div id="scroll" style="overflow-y:auto"><div role="progressbar">Loading</div><main><article data-message-id="m0" data-message-author-role="assistant">Answer</article></main></div>');fastCollection(h,true);
  const fixture=scrollFixture(h);await assert.rejects(h.collect(),/did not finish loading/);assert.equal(fixture.top,500);
  h.get('[role="progressbar"]').remove();const controller=new h.w.AbortController();
  const pending=h.collect({signal:controller.signal,onProgress:()=>controller.abort()});await assert.rejects(pending,{name:'AbortError'});assert.equal(fixture.top,500);
});

test('long messages are scrolled fully and lazy media are recaptured after becoming visible',async t=>{
  const h=harness(t,'<div id="scroll" style="overflow-y:auto"><main><section data-testid="conversation-turn-0"><article data-message-id="a0" data-message-author-role="assistant"><p>A long response</p><img src="/placeholder.png"></article></section></main></div>');fastCollection(h);
  const fixture=scrollFixture(h,{height:1800,viewport:450,start:100,render:top=>{if(top>=900)h.get('img').src='/loaded-picture.png';}});
  const capture=await h.collect();t.after(capture.dispose);assert.ok(fixture.positions.includes(1350));assert.equal(capture.messages.length,1);
  const pdf=await h.prepare({capture});t.after(pdf.dispose);assert.equal(pdf.root.querySelector('img').src,'https://chatgpt.com/loaded-picture.png');assert.equal(fixture.top,100);
});

test('an image source changed during decoding is recaptured rather than frozen as its old thumbnail',async t=>{
  const h=harness(t,'<main><article data-message-id="a0" data-message-author-role="assistant"><img src="/thumbnail.png"></article></main>');fastCollection(h);
  let release,decodes=0;h.w.HTMLImageElement.prototype.decode=function(){if(++decodes===1)return new Promise(resolve=>{release=resolve;});return Promise.resolve();};
  const pending=h.collect({replyElement:h.get('article')});await new Promise(resolve=>setImmediate(resolve));
  h.get('img').src='/final-image.png';release();const capture=await pending;t.after(capture.dispose);
  assert.equal(capture.messages[0].error,'');assert.ok(decodes>=2);
  const pdf=await h.prepare({capture});t.after(pdf.dispose);assert.equal(pdf.root.querySelector('img').src,'https://chatgpt.com/final-image.png');
});

test('direct PDF preparation rejects a media-only change during decoding',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><img src="/thumbnail.png"></article></main>');
  let release;h.w.HTMLImageElement.prototype.decode=()=>new Promise(resolve=>{release=resolve;});
  const pending=h.prepare();await new Promise(resolve=>setImmediate(resolve));h.get('main img').src='/final.png';release();
  await assert.rejects(pending,/conversation changed/);assert.equal(h.get('.li-pdf-document'),null);
});

test('failed diagram capture blocks only the selected message and keeps controls out of fingerprints',async t=>{
  const h=harness(t,'<main><article data-message-id="a0" data-message-author-role="assistant">Good reply</article><article data-message-id="a1" data-message-author-role="assistant"><pre>Bad TeX</pre><div class="latex-islands-container"></div></article></main>');fastCollection(h);
  let calls=0;h.w.LatexIslandsDiagramExport={snapshot:async source=>{calls++;if(source.dataset.messageId==='a1')throw Error('Rendering failed: invalid TeX');const action=h.doc.createElement('button');action.className='li-export-reply';action.textContent='PDF';source.append(action);return [];}};
  const capture=await h.collect();t.after(capture.dispose);assert.match(capture.messages[1].error,/invalid TeX/);assert.equal(capture.messages[0].preview,'Good reply');
  const pdf=await h.prepare({capture,selectedKeys:['message:a0']});t.after(pdf.dispose);assert.equal(pdf.count,1);assert.doesNotMatch(pdf.root.textContent,/Bad TeX|PDF/);
  await assert.rejects(h.prepare({capture,selectedKeys:['message:a1']}),/invalid TeX/);assert.ok(calls>=2);
});

test('capture waits for a newly mounted diagram before freezing its rendered snapshot',async t=>{
  const h=harness(t,'<main><article data-message-id="a0" data-message-author-role="assistant"><pre id="tex">TeX</pre><div class="latex-islands-container"></div></article></main>');fastCollection(h);let calls=0;
  h.w.LatexIslandsDiagramExport={snapshot:async()=>{if(++calls===1)throw Error('A diagram is still loading. Wait for it to render.');return [{sourceElement:h.get('#tex'),containerElement:h.get('.latex-islands-container'),svg:SVG,width:600,height:300}];}};
  const capture=await h.collect({replyElement:h.get('article')});t.after(capture.dispose);assert.equal(calls,2);assert.equal(capture.messages[0].error,'');
  const pdf=await h.prepare({capture});t.after(pdf.dispose);assert.ok(pdf.root.querySelector('.li-pdf-island-image'));
});

test('removing the host boot loader during snapshot readiness does not change the message fingerprint',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant" data-message-id="a1"><p>Actual answer</p><pre id="tex" class="latex-islands-original-hidden">TikZ source</pre><div class="latex-islands-container"><iframe></iframe><div class="latex-islands-boot"><span role="status">Rendering diagram…</span><button>Show code</button></div></div></article></main>');
  fastCollection(h);let calls=0;
  h.w.LatexIslandsDiagramExport={snapshot:async()=>{
    if(++calls===1){h.get('.latex-islands-boot').remove();throw Error('The diagram is still rendering. Wait for it to finish, then export again.');}
    return [{sourceElement:h.get('#tex'),containerElement:h.get('.latex-islands-container'),svg:SVG,width:600,height:300}];
  }};
  const capture=await h.collect({replyElement:h.get('article')});t.after(capture.dispose);
  assert.equal(calls,2);assert.equal(capture.messages[0].error,'');
  assert.match(capture.messages[0].preview,/Actual answer/);assert.doesNotMatch(capture.messages[0].preview,/Rendering diagram|Show code/);
  const pdf=await h.prepare({capture});t.after(pdf.dispose);
  assert.ok(pdf.root.querySelector('.li-pdf-island-image'));assert.match(pdf.root.textContent,/Actual answer/);assert.doesNotMatch(pdf.root.textContent,/Rendering diagram|Show code|TikZ source/);
});

test('capture revisits a transiently unavailable diagram after its first readiness budget expires without DOM changes',async t=>{
  const h=harness(t,'<main><article data-message-id="a0" data-message-author-role="assistant"><pre id="tex">TeX</pre><div class="latex-islands-container"></div></article></main>');fastCollection(h);
  let now=1000,calls=0;h.w.Date.now=()=>now;
  const original=h.get('article').outerHTML;
  h.w.LatexIslandsDiagramExport={snapshot:async()=>{if(++calls===1){now+=15001;throw Error('A diagram is still loading or streaming. Wait for it to render, then export again.');}return [{sourceElement:h.get('#tex'),containerElement:h.get('.latex-islands-container'),svg:SVG,width:600,height:300}];}};
  const capture=await h.collect();t.after(capture.dispose);
  assert.equal(calls,2);assert.equal(h.get('article').outerHTML,original);assert.equal(capture.messages[0].error,'');
  const pdf=await h.prepare({capture});t.after(pdf.dispose);assert.ok(pdf.root.querySelector('.li-pdf-island-image'));assert.equal(pdf.count,1);
});

test('unchanged permanent diagram failures are not retried and transient rechecks are bounded',async t=>{
  for(const transient of [false,true]){
    const h=harness(t,'<div id="scroll" style="overflow-y:auto"><main><section data-testid="conversation-turn-0"><article data-message-id="a0" data-message-author-role="assistant"><pre>TeX</pre><div class="latex-islands-container"></div></article></section></main></div>');fastCollection(h);
    const fixture=scrollFixture(h,{height:2400,viewport:450,start:100});let now=1000,calls=0;h.w.Date.now=()=>now;
    h.w.LatexIslandsDiagramExport={snapshot:async()=>{calls++;if(transient&&calls===1)now+=15001;throw Error(transient?'A diagram is still loading. Wait for it to render.':'Rendering failed: invalid TeX');}};
    const capture=await h.collect();t.after(capture.dispose);assert.equal(fixture.top,100);assert.ok(fixture.positions.length>5);assert.equal(calls,transient?3:1);
    await assert.rejects(h.prepare({capture}),transient?/still loading/:/invalid TeX/);
  }
});

test('preview mounts inside the dialog and returns to body before printing',async t=>{
  const h=harness(t),host=h.doc.createElement('div');h.doc.body.append(host);const pdf=await h.prepare();
  pdf.mountPreview(host);assert.equal(pdf.root.parentElement,host);assert.equal(pdf.root.classList.contains('li-pdf-preview'),true);
  h.w.print=()=>{assert.equal(pdf.root.parentElement,h.doc.body);assert.equal(pdf.root.classList.contains('li-pdf-preview'),false);};pdf.print();h.w.dispatchEvent(new h.w.Event('afterprint'));assert.equal(pdf.root.isConnected,false);
});

test('wide native SVG keeps its intrinsic ratio and computed clipping/transforms after IDs change',async t=>{
  const h=harness(t,'<main><article data-message-author-role="assistant"><svg id="native" width="4000" height="1000"><defs><clipPath id="crop"><rect width="3900" height="950"/></clipPath></defs><g class="translated"><text>Chart label</text></g></svg></article></main>');
  const original=h.w.getComputedStyle;h.w.getComputedStyle=node=>{const css=original(node);return node.matches('.translated')?{display:css.display,visibility:css.visibility,getPropertyValue:key=>({'clip-path':'url("https://chatgpt.com/c/example#crop")',transform:'matrix(1, 0, 0, 1, 100, 50)','transform-origin':'0px 0px'}[key]||css.getPropertyValue(key))}:css;};
  const pdf=await h.prepare();t.after(pdf.dispose);const svg=pdf.root.querySelector('svg'),group=svg.querySelector('g');assert.equal(svg.getAttribute('viewBox'),'0 0 4000 1000');assert.equal(svg.style.aspectRatio,'4000 / 1000');assert.equal(svg.style.maxWidth,'100%');assert.equal(svg.style.height,'auto');assert.equal(svg.style.maxHeight,'180mm');
  assert.equal(group.style.clipPath,'url(#'+svg.querySelector('clipPath').id+')');assert.equal(group.style.transform,'matrix(1, 0, 0, 1, 100, 50)');assert.equal(group.style.transformOrigin,'0px 0px');
});
