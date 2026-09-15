/* DOM integration tests. Run npm install before npm test, or set JSDOM_MODULE. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_MODULE || 'jsdom');
const ROOT=path.resolve(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({firefox=false}={}){
  const dom=new JSDOM(fs.readFileSync(path.join(ROOT,'island.html'),'utf8'),{url:'chrome-extension://test-id/island.html',runScripts:'outside-only'});
  const w=dom.window,calls=[],sent=[],requests=[],exports=[],canvasCalls=[];let bodyHeight=120;
  const css=w.document.createElement('style');css.textContent=fs.readFileSync(path.join(ROOT,'island.css'),'utf8');w.document.head.append(css);
  const parent={postMessage:(data,origin)=>sent.push({data,origin})};
  Object.defineProperty(w,'parent',{value:parent});
  w.ResizeObserver=class{constructor(callback){this.callback=callback;}observe(){}disconnect(){}};
  w.chrome={runtime:{id:'test-id',sendMessage:message=>new Promise((resolve,reject)=>calls.push({message,resolve,reject}))}};
  if(firefox){w.browser=w.chrome;w.chrome={runtime:{sendMessage(){throw Error('Use Firefox Promise API');}}};}
  w.document.body.getBoundingClientRect=()=>({height:bodyHeight});
  w.fetch=async url=>{requests.push(url);return {ok:true,arrayBuffer:async()=>new Uint8Array([65,66,67]).buffer};};
  w.Blob=Blob;w.URL.createObjectURL=blob=>{exports.push({blob});return 'blob:mock-export';};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){exports.at(-1).filename=this.download;};
  w.Image=class{set src(value){this.url=value;queueMicrotask(()=>this.onload());}};
  w.HTMLCanvasElement.prototype.getContext=function(){return {fillRect:(...args)=>canvasCalls.push(['fill',...args]),drawImage:(...args)=>canvasCalls.push(['draw',...args]),set filter(value){canvasCalls.push(['filter',value]);},set fillStyle(value){canvasCalls.push(['fillStyle',value]);}};};
  w.HTMLCanvasElement.prototype.toBlob=function(callback,type){canvasCalls.push(['size',this.width,this.height]);callback(new Blob(['png-bytes'],{type}));};
  w.eval(fs.readFileSync(path.join(ROOT,'island.js'),'utf8'));
  const el=id=>w.document.getElementById(id);
  function send(data={},origin='https://chatgpt.com',source=parent){
    w.dispatchEvent(new w.MessageEvent('message',{data:{channel:'latex-islands',type:'render',id:'test',source:'diagram',...data},origin,source}));
  }
  return {w,dom,parent,calls,sent,requests,exports,canvasCalls,el,send,setHeight:n=>bodyHeight=n,close:()=>w.close()};
}
const svg=text=>`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><text font-family="cmr10">${text}</text></svg>`;

test('island ignores foreign/non-parent/malformed requests without compiling',t=>{
  const h=harness();t.after(h.close);
  h.send({},'https://attacker.example');h.send({},'https://chatgpt.com',h.w);
  h.send({channel:'different'});h.send({type:'resize'});h.send({id:123});h.send({source:{bad:true}});
  assert.equal(h.calls.length,0);assert.equal(h.sent.length,0);assert.equal(h.el('source').value,'');
});

test('Firefox island awaits Promise warmup and compilation instead of callback-only chrome APIs',async t=>{
  const h=harness({firefox:true});t.after(h.close);h.send({type:'prepare',source:'partial'});
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].message.action,'warmup');h.calls[0].resolve({ok:true});await tick();
  h.send({source:'complete'});assert.equal(h.calls.length,2);h.calls[1].resolve({ok:true,svg:svg('Firefox')});await tick();
  assert.equal(h.el('output').textContent,'Firefox');assert.equal(h.el('error').hidden,true);
});

test('actual page renders sanitized SVG, preserves local quoted references and text labels',async t=>{
  const h=harness();t.after(h.close);h.send();assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].message.target,'background');assert.equal(h.el('compile').disabled,true);
  h.calls[0].resolve({ok:true,svg:`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="bad()">
    <script>bad()</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">bad</div></foreignObject>
    <defs><clipPath id="clip"><rect width="10" height="10" /></clipPath></defs>
    <g clip-path="url( '#clip' )"><text font-family="cmr10">U = RI</text></g>
    <use id="local" xlink:href="#clip"/><use id="external" href="https://attacker.example/x.svg#x"/>
    <path id="unsafe" style="fill:url(https://attacker.example/x)" onclick="bad()"/>
    </svg>`,warnings:['Package ajusté <script>']});await tick();
  const out=h.el('output');assert.ok(out.querySelector('svg'));assert.equal(out.querySelector('script,foreignObject'),null);
  assert.equal(out.querySelector('svg').hasAttribute('onload'),false);
  assert.equal(out.querySelector('g').getAttribute('clip-path'),"url( '#clip' )");
  assert.equal(out.querySelector('text').textContent,'U = RI');assert.equal(out.querySelector('#local').getAttribute('xlink:href'),'#clip');
  assert.equal(out.querySelector('#external').hasAttribute('href'),false);assert.equal(out.querySelector('#unsafe').hasAttribute('style'),false);
  assert.equal(out.querySelector('#unsafe').hasAttribute('onclick'),false);assert.equal(h.el('download').disabled,false);
  assert.equal(h.el('warning').textContent,'Package ajusté <script>');assert.equal(h.el('warning').querySelector('script'),null);
  assert.ok(h.sent.some(s=>s.data.type==='result'&&s.data.ok&&s.origin==='https://chatgpt.com'));
});

test('manual mode compiles only on click, toggles source and applies zoom',async t=>{
  const h=harness();t.after(h.close);h.send({autoRender:false,source:'<b>literal TeX</b>',scale:1.5});
  assert.equal(h.calls.length,0);assert.equal(h.el('source').value,'<b>literal TeX</b>');assert.equal(h.el('source').querySelector('b'),null);
  h.el('source-toggle').click();assert.equal(h.el('source-details').hidden,false);assert.equal(h.el('source-toggle').getAttribute('aria-expanded'),'true');
  h.el('source-toggle').click();assert.equal(h.el('source-details').hidden,true);
  h.el('compile').click();assert.equal(h.calls.length,1);h.calls[0].resolve({ok:true,svg:svg('manual')});await tick();
  assert.equal(h.el('output').style.width,'160px');assert.match(h.el('output').style.transform,/scale\(3\)/);
  h.el('zoom-out').click();assert.match(h.el('output').style.transform,/scale\(2.4000000000000004\)/);
  h.el('reset-zoom').click();assert.match(h.el('output').style.transform,/scale\(2\)/);
});

test('duplicate payload does not compile twice and height can shrink after growing',async t=>{
  const h=harness();t.after(h.close);h.send();h.send();assert.equal(h.calls.length,1);
  h.calls[0].resolve({ok:true,svg:svg('same')});await tick();h.setHeight(600);h.send();
  assert.equal(h.sent.at(-1).data.height,602);h.setHeight(100);h.send();assert.equal(h.sent.at(-1).data.height,102);
  assert.equal(h.calls.length,1);h.setHeight(5000);h.send();assert.equal(h.sent.at(-1).data.height,2400);
});

test('latest source wins when the previous render finishes after a replacement',async t=>{
  const h=harness();t.after(h.close);h.send({source:'old'});h.send({source:'new'});
  assert.equal(h.calls.length,1);h.calls[0].resolve({ok:true,svg:svg('old result')});await tick();
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].message.source,'new');assert.equal(h.el('output').textContent,'');
  h.calls[1].resolve({ok:true,svg:svg('latest result')});await tick();
  assert.equal(h.el('output').textContent,'latest result');assert.equal(h.el('source').value,'new');
  assert.equal(h.el('compile').disabled,false);
});

test('changing to manual mode while busy avoids unintended follow-up compilation',async t=>{
  const h=harness();t.after(h.close);h.send({source:'old'});h.send({source:'manual replacement',autoRender:false});
  h.calls[0].resolve({ok:true,svg:svg('stale')});await tick();assert.equal(h.calls.length,1);
  assert.equal(h.el('output').textContent,'');assert.equal(h.el('download').disabled,true);
  h.el('compile').click();assert.equal(h.calls.length,2);h.calls[1].resolve({ok:true,svg:svg('manual replacement')});await tick();
  assert.equal(h.el('output').textContent,'manual replacement');
});

test('RPC errors and malformed SVG remain visible errors and allow retry',async t=>{
  const h=harness();t.after(h.close);h.send();h.calls[0].reject(new Error('failed <img src=x>'));await tick();
  assert.equal(h.el('error').hidden,false);assert.equal(h.el('error').textContent,'failed <img src=x>');assert.equal(h.el('error').querySelector('img'),null);
  assert.equal(h.el('compile').disabled,false);assert.equal(h.el('download').disabled,true);
  h.el('compile').click();h.calls[1].resolve({ok:true,svg:'<svg><broken></svg>'});await tick();
  assert.match(h.el('error').textContent,/SVG.*invalide/);assert.equal(h.el('output').children.length,0);
  h.el('compile').click();h.calls[2].resolve({ok:true,svg:svg('recovered'),cached:true});await tick();
  assert.equal(h.el('error').hidden,true);assert.equal(h.el('output').textContent,'recovered');assert.match(h.el('status').textContent,/cache/);
});

test('SVG download embeds the used local font and preserves diagram labels',async t=>{
  const h=harness();t.after(h.close);h.send();h.calls[0].resolve({ok:true,svg:svg('R = 10 kΩ')});await tick();
  h.el('download').click();await tick();assert.equal(h.exports.length,1);assert.equal(h.exports[0].filename,'schema-tikz.svg');
  assert.deepEqual(h.requests,['vendor/tikzjax/fonts/cmr10.woff2']);
  const xml=await h.exports[0].blob.text();assert.match(xml,/data:font\/woff2;base64,QUJD/);assert.match(xml,/R = 10 kΩ/);
  assert.doesNotMatch(xml,/data-width=/);assert.match(xml,/@font-face/);
});

test('sibling SVG diagrams are stacked into one SVG while extra HTML roots remain invalid',async t=>{
  const h=harness();t.after(h.close);h.send();
  h.calls[0].resolve({ok:true,svg:svg('first diagram')+'\n'+svg('second diagram')});await tick();
  const output=h.el('output');assert.equal(output.children.length,1);const root=output.firstElementChild;
  assert.equal(root.localName,'svg');assert.equal(root.children.length,2);
  assert.equal(root.getAttribute('width'),'160');assert.equal(root.getAttribute('height'),'176');
  assert.equal(root.children[0].getAttribute('y'),'0');assert.equal(root.children[1].getAttribute('y'),'96');
  assert.equal(root.children[0].textContent,'first diagram');assert.equal(root.children[1].textContent,'second diagram');
  h.send({source:'invalid roots'});h.calls[1].resolve({ok:true,svg:svg('first diagram')+svg('second diagram')+'<div>unexpected HTML</div>'});await tick();
  assert.equal(output.children.length,0);assert.equal(h.el('error').hidden,false);assert.match(h.el('error').textContent,/SVG.*invalide/);
});

test('streaming prepares one warmup and compiles immediately when the completed block arrives',async t=>{
  const h=harness();t.after(h.close);
  h.send({type:'prepare',source:'\\begin{tikzpicture}',streaming:true});
  h.send({type:'prepare',source:'\\begin{tikzpicture}\\node {Hello};',streaming:true});
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].message.action,'warmup');
  assert.equal(h.el('spinner').hidden,false);assert.equal(h.el('compile').disabled,true);
  assert.match(h.el('status').textContent,/Écriture/);
  h.calls[0].resolve({ok:true,ready:true});await tick();
  h.send({source:'\\begin{tikzpicture}\\node {Hello};\\end{tikzpicture}'});
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].message.source,'\\begin{tikzpicture}\\node {Hello};\\end{tikzpicture}');
  h.calls[1].resolve({ok:true,svg:svg('Hello')});await tick();
  assert.equal(h.el('placeholder').hidden,true);assert.equal(h.el('output').textContent,'Hello');
});

test('streaming replacement suppresses stale render without compiling incomplete source',async t=>{
  const h=harness();t.after(h.close);h.send({source:'complete old'});
  h.send({type:'prepare',source:'new partial'});
  h.calls[0].resolve({ok:true,svg:svg('old')});h.calls[1].resolve({ok:true});await tick();
  assert.equal(h.el('output').textContent,'');assert.equal(h.calls.length,2);assert.match(h.el('status').textContent,/Écriture/);
  h.send({source:'new partial'});assert.equal(h.calls.length,3);
  h.calls[2].resolve({ok:true,svg:svg('new')});await tick();assert.equal(h.el('output').textContent,'new');
});

test('editor uses the same SVG, preserves unsaved edits across view messages and applies explicit edits',async t=>{
  const h=harness();t.after(h.close);h.send({source:'original',theme:'dark',colors:{background:'#000',surface:'#262626'}});
  h.calls[0].resolve({ok:true,svg:svg('original')});await tick();
  const original=h.el('output').firstElementChild;
  h.el('open-editor').click();assert.equal(h.sent.at(-1).data.type,'open-editor');
  h.send({type:'view',mode:'editor'});
  assert.equal(h.w.document.querySelector('.island').classList.contains('editor'),true);
  assert.equal(h.el('source-details').hidden,false);assert.equal(h.el('output').firstElementChild,original);assert.equal(h.calls.length,1);
  assert.equal(h.w.document.documentElement.dataset.theme,'dark');assert.equal(h.w.document.documentElement.style.getPropertyValue('--background'),'#000');
  h.el('source').value='edited';h.send({type:'view',mode:'editor'});assert.equal(h.el('source').value,'edited');
  h.el('source-toggle').click();assert.equal(h.el('source-details').hidden,true);
  h.el('source-toggle').click();h.el('source').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));
  assert.ok(h.sent.some(s=>s.data.type==='source-change'&&s.data.source==='edited'));assert.equal(h.calls[1].message.source,'edited');
  h.calls[1].resolve({ok:true,svg:svg('edited')});await tick();
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(h.sent.at(-1).data.type,'close-editor');
  h.send({type:'view',mode:'inline'});assert.equal(h.el('source-details').hidden,true);assert.equal(h.el('output').textContent,'edited');assert.equal(h.calls.length,2);
});

test('zoom, keyboard movement and pointer drag operate on a stable viewport',async t=>{
  const h=harness();t.after(h.close);h.send();h.calls[0].resolve({ok:true,svg:svg('diagram')});await tick();
  const viewport=h.el('viewport'),height=viewport.style.height;
  h.el('zoom-in').click();assert.match(h.el('output').style.transform,/scale\(2.5\)/);
  viewport.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowRight'}));assert.match(h.el('output').style.transform,/translate\(24px, 0px\)/);
  const pointer=(type,x,y)=>{const event=new h.w.MouseEvent(type,{clientX:x,clientY:y,button:0});Object.defineProperty(event,'pointerId',{value:1});viewport.dispatchEvent(event);};
  pointer('pointerdown',10,20);pointer('pointermove',50,70);pointer('pointerup',50,70);
  assert.match(h.el('output').style.transform,/translate\(64px, 50px\)/);assert.equal(viewport.classList.contains('dragging'),false);
  assert.equal(viewport.style.height,height);assert.equal(h.calls.length,1);
  viewport.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'0'}));assert.match(h.el('output').style.transform,/translate\(0px, 0px\) scale\(2\)/);
});

test('PNG export embeds fonts, matches dark mode and produces a bounded raster download',async t=>{
  const h=harness();t.after(h.close);h.send({theme:'dark'});h.calls[0].resolve({ok:true,svg:svg('Ω')});await tick();
  h.el('download-png').click();await tick();await tick();
  assert.equal(h.exports.at(-1).filename,'schema-tikz.png');assert.equal(h.exports.at(-1).blob.type,'image/png');
  assert.deepEqual(h.requests,['vendor/tikzjax/fonts/cmr10.woff2']);
  assert.match(await h.exports[0].blob.text(),/@font-face/);
  assert.ok(h.canvasCalls.some(call=>call[0]==='filter'&&call[1]==='invert(1) hue-rotate(180deg)'));
  assert.ok(h.canvasCalls.some(call=>call[0]==='size'&&call[1]===320&&call[2]===160));
  h.el('download').click();await tick();assert.equal(h.requests.length,1,'font bytes are reused between exports');
});

test('native diagram colors switch live without changing dark toolbar theme, SVG, zoom or edits',async t=>{
  const h=harness();t.after(h.close);h.send({theme:'dark',colors:{background:'#161616',text:'#ececec',surface:'#292929'}});
  h.calls[0].resolve({ok:true,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><path fill="#e60000" d="M0 0h10v10z"/></svg>'});await tick();
  const root=h.w.document.documentElement,node=h.el('output').firstElementChild;
  assert.equal(root.dataset.renderColors,'chatgpt');assert.equal(h.w.getComputedStyle(h.el('output')).filter,'invert(1) hue-rotate(180deg)');
  h.send({type:'view',mode:'editor'});h.el('source').value='unsaved local source';h.el('zoom-in').click();
  const transform=h.el('output').style.transform;
  h.send({type:'view',mode:'editor',renderColors:'native'});
  assert.equal(root.dataset.theme,'dark');assert.equal(root.dataset.renderColors,'native');
  assert.equal(root.style.getPropertyValue('--surface'),'#292929');assert.equal(root.style.getPropertyValue('--text'),'#ececec');
  assert.equal(h.w.getComputedStyle(h.el('viewport')).backgroundColor,'rgb(255, 255, 255)');assert.equal(h.w.getComputedStyle(h.el('output')).filter,'none');
  assert.equal(h.el('output').firstElementChild,node);assert.equal(node.querySelector('path').getAttribute('fill'),'#e60000');
  assert.equal(h.el('output').style.transform,transform);assert.equal(h.el('source').value,'unsaved local source');assert.equal(h.calls.length,1);
  h.send({type:'view',mode:'editor',renderColors:'chatgpt'});
  assert.equal(h.w.getComputedStyle(h.el('output')).filter,'invert(1) hue-rotate(180deg)');assert.equal(h.calls.length,1);
});

test('native PNG uses white background without inversion and SVG export retains original colors',async t=>{
  const h=harness();t.after(h.close);h.send({theme:'dark',renderColors:'native',colors:{background:'#121212'}});
  h.calls[0].resolve({ok:true,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><path fill="#e60000" stroke="#0044cc" d="M0 0h10v10z"/></svg>'});await tick();
  h.el('download-png').click();await tick();await tick();
  assert.equal(h.exports.at(-1).filename,'schema-tikz.png');
  assert.ok(h.canvasCalls.some(call=>call[0]==='fillStyle'&&call[1]==='#ffffff'));
  assert.equal(h.canvasCalls.some(call=>call[0]==='filter'),false);
  h.el('download').click();await tick();
  const xml=await h.exports.at(-1).blob.text();assert.match(xml,/fill="#e60000"/);assert.match(xml,/stroke="#0044cc"/);assert.doesNotMatch(xml,/invert\(|#ffffff/);
  h.send({type:'view',renderColors:'chatgpt'});h.el('download-png').click();await tick();await tick();
  assert.ok(h.canvasCalls.some(call=>call[0]==='fillStyle'&&call[1]==='#121212'));
  assert.ok(h.canvasCalls.some(call=>call[0]==='filter'&&call[1]==='invert(1) hue-rotate(180deg)'));assert.equal(h.calls.length,1);
});

test('options menu supports keyboard navigation and Escape without closing editor',t=>{
  const h=harness();t.after(h.close);h.send({autoRender:false});h.send({type:'view',mode:'editor'});
  h.el('menu-toggle').click();assert.equal(h.el('diagram-menu').hidden,false);assert.equal(h.w.document.activeElement,h.el('open-editor'));
  h.el('diagram-menu').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowDown'}));assert.equal(h.w.document.activeElement,h.el('copy-source'));
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape'}));
  assert.equal(h.el('diagram-menu').hidden,true);assert.equal(h.el('menu-toggle').getAttribute('aria-expanded'),'false');
  assert.equal(h.sent.some(s=>s.data.type==='close-editor'),false);
});

test('short diagram menus request enough iframe height and restore it after closing',t=>{
  const h=harness();t.after(h.close);h.send({autoRender:false});h.setHeight(180);
  h.el('diagram-menu').getBoundingClientRect=()=>({bottom:330});
  h.el('menu-toggle').click();assert.equal(h.sent.at(-1).data.height,340);
  h.el('menu-toggle').click();assert.equal(h.sent.at(-1).data.height,182);
});

test('font-embedded SVG retains native pt dimensions and translated viewBox',async t=>{
  const h=harness();t.after(h.close);h.send();
  h.calls[0].resolve({ok:true,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="160pt" height="80pt" viewBox="-72 -72 160 80"><text font-family="cmr10">native units</text></svg>'});await tick();
  h.el('download').click();await tick();
  const xml=await h.exports.at(-1).blob.text();
  assert.match(xml,/width="160pt"/);assert.match(xml,/height="80pt"/);assert.match(xml,/viewBox="-72 -72 160 80"/);
  assert.ok(Math.abs(parseFloat(h.el('output').style.width)-160*4/3)<.001);
});
