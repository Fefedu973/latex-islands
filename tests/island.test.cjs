/* DOM integration tests. Run npm install before npm test, or set JSDOM_MODULE. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_MODULE || 'jsdom');
const ROOT=path.resolve(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({firefox=false,fontLoad=async()=>[{}],url='chrome-extension://test-id/island.html'}={}){
  const dom=new JSDOM(fs.readFileSync(path.join(ROOT,'island.html'),'utf8'),{url,runScripts:'outside-only'});
  const w=dom.window,calls=[],sent=[],requests=[],exports=[],canvasCalls=[];let bodyHeight=120;
  const css=w.document.createElement('style');css.textContent=fs.readFileSync(path.join(ROOT,'island.css'),'utf8');w.document.head.append(css);
  const channels=[];
  w.MessageChannel=class{constructor(){this.messages=[];this.port1={postMessage:data=>this.messages.push(data),close(){this.closed=true;}};this.port2={};channels.push(this);}};
  const parent={postMessage:(data,origin,ports)=>sent.push({data,origin,ports})};
  Object.defineProperty(w,'parent',{value:parent});
  w.ResizeObserver=class{constructor(callback){this.callback=callback;}observe(){}disconnect(){}};
  Object.defineProperty(w.document,'fonts',{value:{load:fontLoad}});
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
  return {w,dom,parent,channels,calls,sent,requests,exports,canvasCalls,el,send,setHeight:n=>bodyHeight=n,close:()=>w.close()};
}
const svg=text=>`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><text font-family="cmr10">${text}</text></svg>`;

test('editor icon tooltips replace browser titles, stay inside the viewport and dismiss without activating controls',t=>{
  const h=harness();t.after(h.close);const scheduled=[],timer=h.w.setTimeout.bind(h.w);
  h.w.setTimeout=(callback,ms,...args)=>{if(ms===300)scheduled.push(()=>callback(...args));return timer(callback,ms,...args);};
  const tooltip=h.el('control-tooltip');
  Object.defineProperties(tooltip,{offsetWidth:{get:()=>140},offsetHeight:{get:()=>30}});
  for(const id of ['close-editor','copy-header','png-header','zoom-in','zoom-out','menu-toggle']){
    assert.equal(h.el(id).hasAttribute('title'),false);assert.equal(h.el(id).hasAttribute('aria-describedby'),false);
    h.el(id).getBoundingClientRect=()=>({left:12,top:4,right:48,bottom:40,width:36,height:36});
  }
  h.send({autoRender:false,mode:'editor'});scheduled.at(-1)();
  assert.equal(h.el('close-editor').getAttribute('aria-describedby'),tooltip.id);
  assert.equal(tooltip.hidden,false);assert.equal(tooltip.textContent,'Close editor');assert.equal(tooltip.style.left,'8px');assert.equal(tooltip.style.top,'48px');
  h.el('copy-header').focus();scheduled.at(-1)();assert.equal(tooltip.textContent,'Copy code');
  h.el('copy-header').dispatchEvent(new h.w.Event('pointerleave'));assert.equal(tooltip.hidden,true);assert.equal(h.el('copy-header').hasAttribute('aria-describedby'),false);
  h.el('zoom-in').disabled=false;h.el('zoom-in').closest('.zoom-controls').hidden=false;
  h.el('zoom-in').getBoundingClientRect=()=>({left:990,top:726,right:1024,bottom:760,width:34,height:34});
  h.el('zoom-in').dispatchEvent(new h.w.Event('pointerenter'));scheduled.at(-1)();
  assert.equal(tooltip.style.left,'876px');assert.equal(tooltip.style.top,'688px');assert.equal(tooltip.textContent,'Zoom in');
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(tooltip.hidden,true);
  h.el('png-header').disabled=false;h.el('png-header').dispatchEvent(new h.w.Event('pointerenter'));h.el('png-header').disabled=true;scheduled.at(-1)();
  assert.equal(tooltip.hidden,true,'a control disabled during the hover delay must not show a tooltip');
  assert.equal(h.calls.length,0,'tooltips never compile or activate an editor action');
});

test('loaded island offers a document-bound port only to an allowed parent and accepts its matching diagram',async t=>{
  const h=harness({url:'chrome-extension://test-id/island.html?parentOrigin=https%3A%2F%2Fchatgpt.com#diagram-id'});t.after(h.close);
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].data.type,'ready');assert.equal(h.sent[0].data.id,'diagram-id');
  assert.equal(h.sent[0].origin,'https://chatgpt.com');assert.equal(h.sent[0].ports[0],h.channels[0].port2);
  const receive=data=>h.channels[0].port1.onmessage({data:{channel:'latex-islands',type:'render',id:'diagram-id',source:'port source',...data}});
  receive({id:'another-diagram'});assert.equal(h.calls.length,0);
  receive({});assert.equal(h.calls.length,1);assert.equal(h.calls[0].message.source,'port source');
  h.calls[0].resolve({ok:true,svg:svg('port diagram')});await tick();assert.equal(h.el('output').textContent,'port diagram');
  h.w.dispatchEvent(new h.w.Event('pagehide'));assert.equal(h.channels[0].port1.closed,true);
  h.w.dispatchEvent(new h.w.PageTransitionEvent('pageshow',{persisted:true}));
  assert.equal(h.channels.length,2);assert.equal(h.sent.at(-1).data.type,'ready');
  h.channels[1].port1.onmessage({data:{channel:'latex-islands',type:'view',id:'diagram-id',mode:'editor'}});
  assert.equal(h.w.document.querySelector('.island').dataset.mode,'editor');
  assert.equal(h.el('output').textContent,'port diagram','completed SVG remains visible after restoration');
  assert.equal(h.calls.length,1,'back/forward cache restores the channel without recompiling');
});

test('document liveness replies only on the current private port and never start a compilation',t=>{
  const h=harness({url:'chrome-extension://test-id/island.html?parentOrigin=https%3A%2F%2Fchatgpt.com#test'});t.after(h.close);
  h.send({type:'document-ping',requestId:'ping-1'});assert.equal(h.channels[0].messages.length,0);
  const ping=requestId=>h.channels[0].port1.onmessage({data:{channel:'latex-islands',id:'test',type:'document-ping',requestId}});
  ping('bad');assert.equal(h.channels[0].messages.length,0);ping('ping-1');
  assert.equal(h.channels[0].messages.length,1);assert.equal(h.channels[0].messages[0].type,'document-pong');assert.equal(h.channels[0].messages[0].requestId,'ping-1');
  h.w.dispatchEvent(new h.w.Event('pagehide'));ping('ping-2');assert.equal(h.channels[0].messages.length,2,'only the pagehide notification is added after closing the port');
  assert.equal(h.calls.length,0);
});

test('island never offers a ready port to an arbitrary parent origin',t=>{
  for(const origin of ['https://attacker.example','*','null']){
    const h=harness({url:'chrome-extension://test-id/island.html?parentOrigin='+encodeURIComponent(origin)+'#diagram-id'});t.after(h.close);
    assert.equal(h.sent.length,0);assert.equal(h.channels.length,0);
  }
});

test('back-forward restoration retries an orphaned runtime request without letting its old completion replace the successor',async t=>{
  const h=harness({url:'chrome-extension://test-id/island.html?parentOrigin=https%3A%2F%2Fchatgpt.com#diagram-id'});t.after(h.close);
  h.channels[0].port1.onmessage({data:{channel:'latex-islands',type:'render',id:'diagram-id',source:'restored diagram'}});
  assert.equal(h.calls.length,1);assert.equal(h.el('compile').disabled,true);
  h.w.dispatchEvent(new h.w.PageTransitionEvent('pagehide',{persisted:true}));
  h.w.dispatchEvent(new h.w.PageTransitionEvent('pageshow',{persisted:true}));
  assert.equal(h.channels.length,2);assert.equal(h.calls.length,2);
  await tick();assert.equal(h.el('compile').disabled,true,'the old request finally must not unlock its successor');
  h.calls[1].resolve({ok:true,svg:svg('restored result')});await tick();
  assert.equal(h.el('output').textContent,'restored result');assert.equal(h.el('compile').disabled,false);
  h.calls[0].resolve({ok:true,svg:svg('obsolete result')});await tick();
  assert.equal(h.el('output').textContent,'restored result');assert.equal(h.calls.length,2);
  assert.equal(h.sent.filter(event=>event.data.type==='result'&&event.data.ok).length,1);
});

test('an unanswered runtime request ends in a retryable error and ignores its late response',async t=>{
  const h=harness();t.after(h.close);const timeouts=[],timer=h.w.setTimeout.bind(h.w);
  h.w.setTimeout=(callback,ms,...args)=>{if(ms===120000)timeouts.push(()=>callback(...args));return timer(callback,ms,...args);};
  h.send();assert.equal(timeouts.length,1);timeouts[0]();await tick();
  assert.equal(h.el('spinner').hidden,true);assert.match(h.el('error').textContent,/renderer did not respond in time/i);assert.equal(h.el('retry').disabled,false);
  h.el('retry').click();assert.equal(h.calls.length,2);
  h.calls[1].resolve({ok:true,svg:svg('retry result')});await tick();
  h.calls[0].resolve({ok:true,svg:svg('late result')});await tick();
  assert.equal(h.el('output').textContent,'retry result');assert.equal(h.el('error').hidden,true);
});

test('stalled font loading reaches an error and retry without displaying the late font result',async t=>{
  const loads=[],h=harness({fontLoad:()=>new Promise(resolve=>loads.push(resolve))});t.after(h.close);
  const timeouts=[],timer=h.w.setTimeout.bind(h.w);
  h.w.setTimeout=(callback,ms,...args)=>{if(ms===15000)timeouts.push(()=>callback(...args));return timer(callback,ms,...args);};
  h.send();h.calls[0].resolve({ok:true,svg:svg('first')});await tick();assert.equal(timeouts.length,1);
  timeouts[0]();await tick();assert.match(h.el('error').textContent,/Could not load diagram font/);assert.equal(h.el('spinner').hidden,true);assert.equal(h.el('retry').disabled,false);
  h.el('retry').click();h.calls[1].resolve({ok:true,svg:svg('second')});await tick();loads[1]([{}]);await tick();
  loads[0]([{}]);await tick();assert.equal(h.el('output').textContent,'second');assert.equal(h.el('error').hidden,true);
});

test('cached SVG stays behind the loader until all used TeX fonts finish loading',async t=>{
  const fonts=[];
  const h=harness({fontLoad:(font,text)=>new Promise(resolve=>fonts.push({font,text,resolve}))});t.after(h.close);
  h.send({theme:'dark'});
  h.calls[0].resolve({ok:true,cached:true,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><g font-family="cmr10"><text>\uF031\uF032</text></g><text style="font-family:&quot;cmmi10&quot;">\uF052</text><text font-family="cmr10">\uF03D</text></svg>'});await tick();
  assert.deepEqual(fonts.map(f=>f.font),['16px "cmr10"','16px "cmmi10"']);
  assert.ok(fonts.every(f=>f.text.includes('\uF052')),'load requests cover the actual private-use glyphs');
  assert.equal(h.el('output').children.length,0);assert.equal(h.el('placeholder').hidden,false);
  assert.equal(h.el('spinner').hidden,false);assert.equal(h.el('viewport').getAttribute('aria-busy'),'true');
  assert.equal(h.el('download').disabled,true);assert.equal(h.el('zoom-in').disabled,true);
  assert.equal(h.sent.some(s=>s.data.type==='result'),false);
  fonts[0].resolve([{}]);await tick();assert.equal(h.el('output').children.length,0);
  fonts[1].resolve([{}]);await tick();
  assert.equal(h.el('output').children.length,1);assert.equal(h.el('placeholder').hidden,true);
  assert.equal(h.el('download').disabled,false);assert.equal(h.el('viewport').getAttribute('aria-busy'),'false');
  assert.ok(h.sent.some(s=>s.data.type==='result'&&s.data.ok));
});

test('source replaced while fonts load never displays or reports the stale diagram',async t=>{
  let finishFont;
  const h=harness({fontLoad:()=>new Promise(resolve=>{finishFont=resolve;})});t.after(h.close);
  h.send({source:'old'});h.calls[0].resolve({ok:true,svg:svg('old')});await tick();
  h.send({source:'new'});finishFont([{}]);await tick();
  assert.equal(h.el('output').children.length,0);assert.equal(h.sent.some(s=>s.data.type==='result'),false);
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].message.source,'new');
  h.calls[1].resolve({ok:true,svg:svg('new')});await tick();finishFont([{}]);await tick();
  assert.equal(h.el('output').textContent,'new');
  assert.deepEqual(h.sent.filter(s=>s.data.type==='result').map(s=>s.data.source),['new']);
});

test('missing or failed fonts produce an actionable error instead of an incomplete diagram',async t=>{
  for(const fontLoad of [async()=>[],async()=>{throw new Error('network error');}]){
    const h=harness({fontLoad});t.after(h.close);h.send();h.calls[0].resolve({ok:true,svg:svg('label')});await tick();
    assert.equal(h.el('output').children.length,0);assert.equal(h.el('download').disabled,true);
    assert.equal(h.el('error').hidden,false);assert.match(h.el('error').textContent,/Could not load diagram font "cmr10".*Reload/);
    assert.equal(h.el('spinner').hidden,true);assert.equal(h.el('compile').disabled,false);
    assert.ok(h.sent.some(s=>s.data.type==='result'&&s.data.ok===false));
  }
});

test('diagrams without font references do not request any fonts',async t=>{
  const h=harness({fontLoad:()=>{throw new Error('Unexpected font request');}});t.after(h.close);
  h.send();h.calls[0].resolve({ok:true,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M0 0L20 20"/></svg>'});await tick();
  assert.ok(h.el('output').querySelector('path'));assert.equal(h.el('placeholder').hidden,true);
});

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
  assert.match(h.el('error').textContent,/SVG.*invalid/);assert.equal(h.el('output').children.length,0);
  h.el('compile').click();h.calls[2].resolve({ok:true,svg:svg('recovered'),cached:true});await tick();
  assert.equal(h.el('error').hidden,true);assert.equal(h.el('output').textContent,'recovered');assert.equal(h.el('status').textContent,'');
});

test('error panel keeps message and recovery together in every view and restores controls after retry',async t=>{
  for(const mode of ['inline','editor','preview','fullscreen']){
    const h=harness();t.after(h.close);h.send({mode});h.calls[0].resolve({ok:true,svg:'<svg><broken></svg>'});await tick();
    assert.equal(h.el('error-panel').parentElement,h.el('viewport'));
    assert.equal(h.el('error-panel').hidden,false);assert.equal(h.el('placeholder').hidden,true);
    assert.equal(h.el('error-details').hidden,true);assert.equal(h.el('error-actions').closest('#error-panel'),h.el('error-panel'));
    assert.equal(h.w.document.querySelector('.floating-tools').hidden,true);assert.equal(h.w.document.querySelector('.zoom-controls').hidden,true);
    assert.equal(h.el('source-details').hidden,mode!=='editor');assert.equal(h.el('source').value,'diagram');
    h.el('retry').click();assert.equal(h.el('error-panel').hidden,true);assert.equal(h.el('placeholder').hidden,false);assert.equal(h.el('spinner').hidden,false);
    assert.equal(h.calls[1].message.source,'diagram');h.calls[1].resolve({ok:true,svg:svg('recovered')});await tick();
    assert.equal(h.el('error-panel').hidden,true);assert.equal(h.el('output').textContent,'recovered');
    assert.equal(h.w.document.querySelector('.floating-tools').hidden,false);assert.equal(h.w.document.querySelector('.zoom-controls').hidden,false);
    assert.equal(h.el('download').disabled,false);
  }
});

test('long error details retain exact escaped logs and reset when retrying or replacing source',async t=>{
  const h=harness();t.after(h.close);h.send({mode:'editor'});
  const log='Undefined control sequence.\n'+Array(50).fill('line 17: <img src=x> \\unknowncommand').join('\n');
  h.calls[0].resolve({ok:false,error:log});await tick();
  assert.equal(h.el('error').textContent,'Undefined control sequence.');assert.equal(h.el('error-details').hidden,false);assert.equal(h.el('error-details').open,false);
  assert.equal(h.el('error-log').textContent,log);assert.equal(h.el('error-log').querySelector('img'),null);
  h.el('error-details').open=true;h.el('retry').click();assert.equal(h.el('error-details').open,false);assert.equal(h.el('error-log').textContent,'');
  h.calls[1].resolve({ok:false,error:'Still invalid.'});await tick();assert.equal(h.el('error-details').hidden,true);assert.equal(h.el('error').textContent,'Still invalid.');
  h.send({mode:'editor',type:'prepare',source:'new diagram'});assert.equal(h.el('error-panel').hidden,true);assert.equal(h.el('source').value,'new diagram');
});

test('compilation repair sends the exact failed code and error privately, without submitting a chat',async t=>{
  const h=harness({url:'chrome-extension://test-id/island.html?parentOrigin=https%3A%2F%2Fchatgpt.com#test'});t.after(h.close);
  const source='\\begin{tikzpicture}\n\\badcommand\n\\end{tikzpicture}',error='Undefined control sequence.\n<unsafe text> \\badcommand';
  h.send({source,mode:'editor'});h.calls[0].resolve({ok:false,error});await tick();
  assert.equal(h.el('ask-fix').hidden,false);h.el('source').value='unapplied changes';
  h.el('ask-fix').click();h.el('ask-fix').click();
  const channel=h.channels[0],requests=channel.messages.filter(message=>message.type==='fix-error');
  assert.equal(requests.length,1);assert.equal(requests[0].source,source);assert.equal(requests[0].error,error);
  assert.equal(h.sent.some(event=>event.data.type==='fix-error'),false,'repair payload never uses the public window channel');
  assert.equal(h.el('ask-fix').disabled,true);
  h.send({type:'fix-error-result',requestId:requests[0].requestId,ok:true});
  assert.equal(h.el('ask-fix').disabled,true,'public window acknowledgements are ignored');
  channel.port1.onmessage({data:{channel:'latex-islands',type:'fix-error-result',id:'test',requestId:requests[0].requestId,ok:true}});
  assert.equal(h.el('ask-fix').disabled,false);assert.equal(h.el('fix-status').hidden,true);
  assert.equal(h.calls.length,1,'preparing a repair prompt does not compile or send a chat');
});

test('repair is hidden without a ChatGPT composer and for font or transport failures',async t=>{
  for(const origin of ['chrome-extension://test-id','https://chatgpt.com']){
    const h=harness({url:'chrome-extension://test-id/island.html?parentOrigin='+encodeURIComponent(origin)+'#test'});t.after(h.close);
    h.send({},origin);
    if(origin.startsWith('chrome-extension:'))h.calls[0].resolve({ok:false,error:'TeX failed'});
    else h.calls[0].reject(new Error('Extension runtime disconnected.'));
    await tick();assert.equal(h.el('ask-fix').hidden,true);h.el('ask-fix').click();
    assert.equal(h.channels[0].messages.some(message=>message.type==='fix-error'),false);
  }
});

test('repair failure preserves the original compilation error and can be retried',async t=>{
  const h=harness({url:'chrome-extension://test-id/island.html?parentOrigin=https%3A%2F%2Fchatgpt.com#test'});t.after(h.close);
  const timeouts=[],timer=h.w.setTimeout.bind(h.w);
  h.w.setTimeout=(callback,ms,...args)=>{if(ms===5000)timeouts.push(()=>callback(...args));return timer(callback,ms,...args);};
  h.send();h.calls[0].resolve({ok:false,error:'TeX failed'});await tick();h.el('ask-fix').click();timeouts[0]();
  assert.equal(h.el('ask-fix').disabled,false);assert.equal(h.el('error').textContent,'TeX failed');assert.equal(h.el('fix-status').hidden,false);
  h.el('ask-fix').click();const requests=h.channels[0].messages.filter(message=>message.type==='fix-error');assert.equal(requests.length,2);
  h.channels[0].port1.onmessage({data:{channel:'latex-islands',type:'fix-error-result',id:'test',requestId:requests[0].requestId,ok:true}});
  assert.equal(h.el('ask-fix').disabled,true,'late acknowledgement cannot unlock a newer attempt');
  h.send({source:'replacement'});assert.equal(h.el('ask-fix').hidden,true);assert.equal(h.el('fix-status').hidden,true);
});

test('SVG download embeds the used local font and preserves diagram labels',async t=>{
  const h=harness();t.after(h.close);h.send();h.calls[0].resolve({ok:true,svg:svg('R = 10 kΩ')});await tick();
  h.el('download').click();await tick();assert.equal(h.exports.length,1);assert.equal(h.exports[0].filename,'tikz-diagram.svg');
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
  assert.equal(output.children.length,0);assert.equal(h.el('error').hidden,false);assert.match(h.el('error').textContent,/SVG.*invalid/);
});

test('streaming prepares one warmup and compiles immediately when the completed block arrives',async t=>{
  const h=harness();t.after(h.close);
  h.send({type:'prepare',source:'\\begin{tikzpicture}',streaming:true});
  h.send({type:'prepare',source:'\\begin{tikzpicture}\\node {Hello};',streaming:true});
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].message.action,'warmup');
  assert.equal(h.el('spinner').hidden,false);assert.equal(h.el('compile').disabled,true);
  assert.match(h.el('status').textContent,/Writing/);
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
  assert.equal(h.el('output').textContent,'');assert.equal(h.calls.length,2);assert.match(h.el('status').textContent,/Writing/);
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

test('standalone preview and full screen fill the host without source controls or duplicate compilation',async t=>{
  const h=harness();t.after(h.close);h.send({mode:'preview'});
  h.calls[0].resolve({ok:true,svg:svg('full-height diagram')});await tick();
  const node=h.el('output').firstElementChild,island=h.w.document.querySelector('.island');
  assert.equal(island.dataset.mode,'preview');assert.equal(island.classList.contains('editor'),false);
  assert.equal(h.el('viewport').style.height,'');assert.equal(h.el('source-details').hidden,true);
  assert.equal(h.el('open-editor').textContent,'Open full screen');assert.equal(h.sent.some(item=>item.data.type==='resize'),false);
  h.el('viewport').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowRight'}));h.el('zoom-in').click();
  const transform=h.el('output').style.transform;
  h.send({type:'view',mode:'fullscreen'});
  assert.equal(island.dataset.mode,'fullscreen');assert.equal(island.classList.contains('editor'),true);
  assert.equal(h.el('source-toggle').hidden,true);assert.equal(h.el('source-details').hidden,true);
  assert.equal(h.el('close-editor').getAttribute('aria-label'),'Close full screen');
  h.el('source-toggle').click();assert.equal(h.el('source-details').hidden,true);
  assert.equal(h.el('output').firstElementChild,node);assert.equal(h.el('output').style.transform,transform);
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(h.sent.at(-1).data.type,'close-editor');
  h.send({type:'view',mode:'preview'});assert.equal(island.classList.contains('editor'),false);assert.equal(h.el('output').style.transform,transform);
  h.send({type:'view',mode:'editor'});assert.equal(h.el('source-toggle').hidden,false);assert.equal(h.el('source-details').hidden,false,'ChatGPT editor still opens code');
  assert.equal(h.calls.length,1);
});

test('standalone error source action returns to the host editor instead of revealing code in the preview',async t=>{
  const h=harness();t.after(h.close);h.send({mode:'preview'});h.calls[0].reject(new Error('Invalid diagram'));await tick();
  assert.equal(h.el('error').hidden,false);assert.equal(h.el('error-actions').hidden,false);
  h.el('error-source').click();assert.equal(h.sent.at(-1).data.type,'show-source');assert.equal(h.el('source-details').hidden,true);
  h.send({type:'view',mode:'fullscreen'});h.el('error-source').click();
  assert.equal(h.sent.at(-1).data.type,'show-source');assert.equal(h.el('source-details').hidden,true);
});

test('plain wheel zooms standalone and modal diagrams while inline ChatGPT keeps conversation scrolling',async t=>{
  const h=harness();t.after(h.close);h.send();h.calls[0].resolve({ok:true,svg:svg('wheel')});await tick();
  const wheel=(options={})=>{const event=new h.w.WheelEvent('wheel',{deltaY:-100,cancelable:true,...options});h.el('viewport').dispatchEvent(event);return event;};
  let before=h.el('output').style.transform;
  assert.equal(wheel().defaultPrevented,false);assert.equal(h.el('output').style.transform,before);
  assert.equal(wheel({ctrlKey:true}).defaultPrevented,true);assert.notEqual(h.el('output').style.transform,before);
  assert.equal(wheel({metaKey:true}).defaultPrevented,true);
  for(const mode of ['preview','fullscreen','editor']){
    h.send({type:'view',mode});before=h.el('output').style.transform;
    assert.equal(wheel().defaultPrevented,true,mode+' handles wheel');assert.notEqual(h.el('output').style.transform,before);
    before=h.el('output').style.transform;assert.equal(wheel({deltaY:0,deltaX:30}).defaultPrevented,false);assert.equal(h.el('output').style.transform,before);
  }
  h.send({type:'view',mode:'inline'});before=h.el('output').style.transform;
  assert.equal(wheel().defaultPrevented,false);assert.equal(h.el('output').style.transform,before);assert.equal(h.calls.length,1);
});

test('inline ordinary wheel requires click or keyboard focus and releases on Escape, leave and focus transfer',async t=>{
  const h=harness();t.after(h.close);h.send();const viewport=h.el('viewport');
  const wheel=()=>{const event=new h.w.WheelEvent('wheel',{deltaY:-100,cancelable:true,clientX:150,clientY:100});viewport.dispatchEvent(event);return event;};
  viewport.focus();assert.equal(wheel().defaultPrevented,false,'loading diagrams never intercept wheel scrolling');viewport.blur();
  h.calls[0].resolve({ok:true,svg:svg('wheel activation')});await tick();
  viewport.dispatchEvent(new h.w.Event('pointerenter'));assert.equal(wheel().defaultPrevented,false,'hover alone leaves page scrolling active');
  const down=new h.w.MouseEvent('pointerdown',{button:0,clientX:150,clientY:100});Object.defineProperty(down,'pointerId',{value:1});viewport.dispatchEvent(down);
  const up=new h.w.MouseEvent('pointerup');Object.defineProperty(up,'pointerId',{value:1});viewport.dispatchEvent(up);
  assert.equal(h.w.document.activeElement,viewport);assert.equal(h.w.getComputedStyle(viewport).outline,'none','activation must not add the old white frame');
  const before=h.el('output').style.transform;assert.equal(wheel().defaultPrevented,true);assert.notEqual(h.el('output').style.transform,before);
  viewport.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.notEqual(h.w.document.activeElement,viewport);assert.equal(wheel().defaultPrevented,false);
  viewport.focus();assert.equal(wheel().defaultPrevented,true,'keyboard focus activates ordinary wheel zoom');
  viewport.dispatchEvent(new h.w.Event('pointerleave'));assert.notEqual(h.w.document.activeElement,viewport);assert.equal(wheel().defaultPrevented,false);
  viewport.dispatchEvent(new h.w.Event('pointerenter'));assert.equal(wheel().defaultPrevented,false,'returning the pointer does not reactivate the diagram');
  viewport.focus();h.el('menu-toggle').focus();assert.equal(wheel().defaultPrevented,false,'another control releases the viewport activation');assert.equal(h.calls.length,1);
});

test('inline wheel activation survives a captured drag until release outside, and Escape cancels that drag',async t=>{
  const h=harness();t.after(h.close);h.send();h.calls[0].resolve({ok:true,svg:svg('drag activation')});await tick();const viewport=h.el('viewport');
  const pointer=(type,x=100,y=100)=>{const event=new h.w.MouseEvent(type,{button:0,clientX:x,clientY:y});Object.defineProperty(event,'pointerId',{value:2});viewport.dispatchEvent(event);};
  const wheel=()=>{const event=new h.w.WheelEvent('wheel',{deltaY:-100,cancelable:true});viewport.dispatchEvent(event);return event.defaultPrevented;};
  pointer('pointerdown');pointer('pointerleave');assert.equal(h.w.document.activeElement,viewport);assert.equal(wheel(),true,'leaving during pointer capture must not interrupt a drag');
  pointer('pointermove',130,150);assert.equal(viewport.classList.contains('dragging'),true);
  pointer('pointerup',130,150);assert.equal(viewport.classList.contains('dragging'),false);assert.notEqual(h.w.document.activeElement,viewport);assert.equal(wheel(),false);
  pointer('pointerenter');pointer('pointerdown');const before=h.el('output').style.transform;
  viewport.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));pointer('pointermove',200,200);
  assert.equal(h.el('output').style.transform,before);assert.equal(viewport.classList.contains('dragging'),false);assert.equal(wheel(),false);
  pointer('pointerdown');const beforeBlur=h.el('output').style.transform;h.w.dispatchEvent(new h.w.Event('blur'));pointer('pointermove',250,250);
  assert.equal(h.el('output').style.transform,beforeBlur,'switching windows during a drag must not leave it active');assert.equal(viewport.classList.contains('dragging'),false);assert.equal(wheel(),false);
});

test('wheel keeps the diagram point under the pointer fixed after pan and at both zoom limits',async t=>{
  const h=harness();t.after(h.close);h.send();h.calls[0].resolve({ok:true,svg:svg('anchor')});await tick();
  const viewport=h.el('viewport'),bounds={left:31,top:47,width:800,height:600};
  viewport.getBoundingClientRect=()=>bounds;
  const state=()=>{
    const [,x,y,scale]=h.el('output').style.transform.match(/translate\(([-\d.e+]+)px, ([-\d.e+]+)px\) scale\(([-\d.e+]+)\)/);
    return {x:Number(x),y:Number(y),scale:Number(scale)};
  };
  const point={x:-200,y:-120};
  const anchor=()=>{const s=state();return {x:(point.x-s.x)/s.scale,y:(point.y-s.y)/s.scale};};
  for(const mode of ['inline','preview','fullscreen','editor']){
    h.send({type:'view',mode});viewport.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'0'}));
    if(mode==='inline')viewport.focus();
    viewport.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowRight'}));viewport.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowDown'}));
    const initial=anchor();
    for(const deltaY of [...Array(50).fill(-100),...Array(80).fill(100)]){
      const event=new h.w.WheelEvent('wheel',{deltaY,cancelable:true,clientX:bounds.left+bounds.width/2+point.x,clientY:bounds.top+bounds.height/2+point.y});
      viewport.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
      const current=anchor();assert.ok(Math.abs(current.x-initial.x)<1e-9&&Math.abs(current.y-initial.y)<1e-9,mode+' retains pointer anchor');
    }
    const atMinimum=state();
    viewport.dispatchEvent(new h.w.WheelEvent('wheel',{deltaY:100,cancelable:true,clientX:700,clientY:500}));
    assert.deepEqual(state(),atMinimum,'clamped zoom does not move the diagram');
  }
  assert.equal(h.calls.length,1);
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
  assert.equal(h.exports.at(-1).filename,'tikz-diagram.png');assert.equal(h.exports.at(-1).blob.type,'image/png');
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
  assert.equal(root.dataset.renderColors,'chatgpt');assert.equal(h.w.getComputedStyle(node).filter,'invert(1) hue-rotate(180deg)');
  h.send({type:'view',mode:'editor'});h.el('source').value='unsaved local source';h.el('zoom-in').click();
  const transform=h.el('output').style.transform;
  h.send({type:'view',mode:'editor',renderColors:'native'});
  assert.equal(root.dataset.theme,'dark');assert.equal(root.dataset.renderColors,'native');
  assert.equal(root.style.getPropertyValue('--surface'),'#292929');assert.equal(root.style.getPropertyValue('--text'),'#ececec');
  assert.equal(h.w.getComputedStyle(h.el('viewport')).backgroundColor,'rgb(255, 255, 255)');assert.equal(h.w.getComputedStyle(node).filter,'none');
  assert.equal(h.el('output').firstElementChild,node);assert.equal(node.querySelector('path').getAttribute('fill'),'#e60000');
  assert.equal(h.el('output').style.transform,transform);assert.equal(h.el('source').value,'unsaved local source');assert.equal(h.calls.length,1);
  h.send({type:'view',mode:'editor',renderColors:'chatgpt'});
  assert.equal(h.w.getComputedStyle(node).filter,'invert(1) hue-rotate(180deg)');assert.equal(h.calls.length,1);
});

test('native PNG uses white background without inversion and SVG export retains original colors',async t=>{
  const h=harness();t.after(h.close);h.send({theme:'dark',renderColors:'native',colors:{background:'#121212'}});
  h.calls[0].resolve({ok:true,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><path fill="#e60000" stroke="#0044cc" d="M0 0h10v10z"/></svg>'});await tick();
  h.el('download-png').click();await tick();await tick();
  assert.equal(h.exports.at(-1).filename,'tikz-diagram.png');
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

function snapshotHarness(){
  const h=harness({url:'chrome-extension://test-id/island.html?parentOrigin=https%3A%2F%2Fchatgpt.com#test'});
  h.portSend=data=>h.channels[0].port1.onmessage({data:{channel:'latex-islands',id:'test',source:'diagram',...data}});
  h.snapshot=(extra={})=>h.portSend({type:'snapshot',requestId:'snapshot-1',...extra});
  h.responses=()=>h.channels[0].messages.filter(message=>message.type==='snapshot-result');
  return h;
}

test('PDF snapshot keeps native vector colors and dimensions, embedded fonts, and no viewport pan or zoom',async t=>{
  const h=snapshotHarness();t.after(h.close);h.portSend({type:'render',theme:'dark',scale:2});
  h.calls[0].resolve({ok:true,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="160pt" height="80pt" viewBox="-72 -72 160 80"><text font-family="cmr10" fill="#ef0000">label</text></svg>'});await tick();
  h.el('zoom-in').click();h.el('viewport').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowRight'}));
  h.snapshot();await tick();const result=h.responses()[0];
  assert.equal(result.ok,true);assert.equal(result.source,'diagram');assert.ok(Math.abs(result.width-160*4/3)<1e-9);assert.ok(Math.abs(result.height-80*4/3)<1e-9);
  assert.match(result.svg,/width="160pt"/);assert.match(result.svg,/viewBox="-72 -72 160 80"/);assert.match(result.svg,/data:font\/woff2;base64,QUJD/);
  assert.match(result.svg,/fill="#ef0000"/);assert.doesNotMatch(result.svg,/invert\(|translate\(-50%|scale\(/);
  assert.equal(h.sent.some(message=>message.data.type==='snapshot-result'||message.data.svg),false,'SVG is never exposed through window.postMessage');
});

test('window messages cannot request PDF snapshots or cancel an authenticated request',async t=>{
  const h=snapshotHarness();t.after(h.close);h.portSend({type:'render'});h.calls[0].resolve({ok:true,svg:svg('private')});await tick();
  h.send({type:'snapshot',requestId:'snapshot-1'});await tick();assert.equal(h.responses().length,0);assert.equal(h.requests.length,0);
  let finish;h.w.fetch=()=>new Promise(resolve=>{finish=resolve;});h.snapshot();
  h.send({type:'snapshot-cancel',requestId:'snapshot-1'});
  finish({ok:true,arrayBuffer:async()=>new Uint8Array([65]).buffer});await tick();assert.equal(h.responses()[0].ok,true);
});

test('PDF snapshots report streaming, rendering, missing output, mismatched source and unapplied edits',async t=>{
  for(const state of ['streaming','rendering','missing','source','edits']){
    const h=snapshotHarness();t.after(h.close);
    if(state==='streaming')h.portSend({type:'prepare'});
    else h.portSend({type:'render',autoRender:state!=='missing'});
    if(state==='source'||state==='edits'){h.calls[0].resolve({ok:true,svg:svg('ready')});await tick();}
    if(state==='edits')h.el('source').value='unapplied source';
    h.snapshot(state==='source'?{source:'wrong source'}:{});await tick();
    assert.equal(h.responses().length,1);assert.equal(h.responses()[0].ok,false);
    assert.match(h.responses()[0].error,/streaming|rendering|has not rendered|Update the diagram/);
  }
});

test('PDF snapshots fail font embedding explicitly and retry failed font fetches',async t=>{
  const h=snapshotHarness();t.after(h.close);h.portSend({type:'render'});h.calls[0].resolve({ok:true,svg:svg('font')});await tick();
  h.w.fetch=async()=>({ok:false});h.snapshot();await tick();
  assert.equal(h.responses()[0].ok,false);assert.match(h.responses()[0].error,/embed diagram font "cmr10"/);
  h.w.fetch=async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([65]).buffer});
  h.snapshot({requestId:'snapshot-2'});await tick();assert.equal(h.responses()[1].ok,true);
});

test('PDF snapshots discard cancellation and page navigation, and reject source changes during font embedding',async t=>{
  for(const change of ['cancel','navigation','source']){
    const h=snapshotHarness();t.after(h.close);h.portSend({type:'render'});h.calls[0].resolve({ok:true,svg:svg('old')});await tick();
    let finish;h.w.fetch=()=>new Promise(resolve=>{finish=resolve;});h.snapshot();
    if(change==='cancel')h.portSend({type:'snapshot-cancel',requestId:'snapshot-1'});
    if(change==='navigation')h.w.dispatchEvent(new h.w.Event('pagehide'));
    if(change==='source')h.portSend({type:'render',source:'new'});
    finish({ok:true,arrayBuffer:async()=>new Uint8Array([65]).buffer});await tick();
    assert.equal(h.responses().some(message=>message.ok),false);
    if(change==='source')assert.match(h.responses()[0].error,/changed during export/);
    else assert.equal(h.responses().length,0);
  }
});

test('PDF snapshots refuse oversized serialized vector data',async t=>{
  const h=snapshotHarness();t.after(h.close);h.portSend({type:'render'});
  h.calls[0].resolve({ok:true,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><desc>'+'x'.repeat(10*1024*1024)+'</desc></svg>'});await tick();
  h.snapshot();await tick();assert.equal(h.responses()[0].ok,false);assert.match(h.responses()[0].error,/10 MB/);
});
