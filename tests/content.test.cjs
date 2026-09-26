/* Integration tests run the real core + content scripts against ChatGPT-shaped
 * DOM fixtures. They do not modify or require the user's ChatGPT page. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_MODULE || 'jsdom');
const ROOT=path.resolve(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const EXT='chrome-extension://test-id';
const SOURCE=String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}`;
const SNAPSHOT_SVG='<svg xmlns="http://www.w3.org/2000/svg" width="160pt" height="80pt"><path d="M0 0L10 10"/></svg>';
const snapshotReply=request=>({...request,type:'snapshot-result',ok:true,svg:SNAPSHOT_SVG,width:160*4/3,height:80*4/3});
function harness({streaming=false,saved={},source=SOURCE,modern=false}={}){
  const dom=new JSDOM(`<!doctype html><html><body><main>
  <section data-message-author-role="user"><pre id="user"><code></code></pre></section>
  <section id="assistant" data-message-author-role="assistant"><div class="markdown">
  <p id="native"><span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html">x²</span></span></p>
  <pre id="diagram"><code class="language-tikz"></code></pre><pre id="ordinary"><code class="language-python">print('ordinary code')</code></pre>
  </div></section></main><div id="composer" contenteditable="true"><pre></pre></div></body></html>`,{url:'https://chatgpt.com/c/test',runScripts:'outside-only'});
  const css=dom.window.document.createElement('style');css.textContent=fs.readFileSync(path.join(ROOT,'content.css'),'utf8');dom.window.document.head.append(css);
  const w=dom.window,timers=new Map(),changes=[],storageWrites=[],resizeObservers=[];let now=100000,nextTimer=0;
  const get=id=>w.document.getElementById(id);
  get('diagram').querySelector('code').textContent=source;get('user').querySelector('code').textContent=SOURCE;get('composer').querySelector('pre').textContent=SOURCE;
  if(modern) {
    // September 2026: message identity moved to semantic wrappers, and fenced
    // code is a div widget with no <pre> or language-* class anywhere inside.
    const assistant=get('assistant'),content=assistant.querySelector('.markdown'),selection=w.document.createElement('div');
    assistant.removeAttribute('data-message-author-role');assistant.setAttribute('data-chatgpt-search-unit-key','turn-1:assistant');
    const heading=w.document.createElement('h4');heading.setAttribute('data-conversation-role','assistant');heading.textContent='ChatGPT said:';
    selection.setAttribute('data-chatgpt-selection-message-id','answer-1');content.className='';content.setAttribute('data-markdown-text-style','assistant-message');selection.append(content);assistant.prepend(heading,selection);
    const user=get('user').parentElement;user.removeAttribute('data-message-author-role');user.setAttribute('data-chatgpt-search-unit-key','turn-0:user');
    const bubble=w.document.createElement('div');bubble.setAttribute('data-user-message-bubble','');get('user').before(bubble);bubble.append(get('user'));
    for(const [id,language] of [['diagram','tikz'],['ordinary','python'],['user','tikz']]) {
      const previous=get(id),widget=w.document.createElement('div');widget.id=id;widget.setAttribute('data-markdown-copy','code-block');
      const header=w.document.createElement('div');header.setAttribute('data-markdown-copy','exclude');
      const label=w.document.createElement('div');label.textContent=language;header.append(label);
      const copy=w.document.createElement('button');copy.className='font-medium';copy.textContent='Copy code';header.append(copy);
      const scroller=w.document.createElement('div'),code=w.document.createElement('code'),span=w.document.createElement('span');
      scroller.style.overflow='auto';code.style.whiteSpace='pre';span.textContent=previous.querySelector('code').textContent;code.append(span);scroller.append(code);widget.append(header,scroller);previous.replaceWith(widget);
    }
  }
  if(streaming)get('assistant').setAttribute('data-is-streaming','true');
  w.Date.now=()=>now;w.setTimeout=(fn,delay=0)=>{const id=++nextTimer;timers.set(id,{fn,due:now+delay});return id;};w.clearTimeout=id=>timers.delete(id);
  w.requestAnimationFrame=callback=>w.setTimeout(()=>callback(now),16);w.cancelAnimationFrame=w.clearTimeout;
  w.ResizeObserver=class {constructor(callback){this.callback=callback;this.targets=new Set();resizeObservers.push(this);}observe(element){this.targets.add(element);}disconnect(){this.targets.clear();}};
  w.chrome={runtime:{getURL:file=>EXT+'/'+file},storage:{local:{get:(defaults,callback)=>callback({...defaults,...saved}),set:(value,callback)=>{storageWrites.push(value);callback?.();}},onChanged:{addListener:fn=>changes.push(fn)}}};
  const before={native:get('native').outerHTML,user:get('user').outerHTML,composer:get('composer').outerHTML,ordinary:get('ordinary').outerHTML};
  for(const script of ['core.js','chatgpt-dom.js','content.js'])w.eval(fs.readFileSync(path.join(ROOT,script),'utf8'));
  async function advance(ms){const end=now+ms;await tick();let runs=0;
    while(true){const entries=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due);if(!entries.length)break;
      if(++runs>100)throw new Error('Unbounded scan loop');const [id,t]=entries[0];timers.delete(id);now=t.due;t.fn();await tick();}
    now=end;await tick();
  }
  function settings(next,area='local'){const event={};for(const [key,value]of Object.entries(next))event[key]={newValue:value};for(const cb of changes)cb(event,area);}
  function connect(frame){const sent=[];const port={postMessage:data=>sent.push({data,origin:EXT}),close(){this.closed=true;}};sent.port=port;sent.reply=data=>port.onmessage?.({data:{channel:'latex-islands',id:decodeURIComponent(new URL(frame.src).hash.slice(1)),...data}});message(frame,{type:'ready'},EXT,frame.contentWindow,[port]);return sent;}
  function message(frame,data={},origin=EXT,source=frame.contentWindow,ports=[]){w.dispatchEvent(new w.MessageEvent('message',{origin,source,ports,data:{channel:'latex-islands',id:decodeURIComponent(new URL(frame.src).hash.slice(1)),...data}}));}
  const resize=element=>{for(const observer of resizeObservers)if(observer.targets.has(element))observer.callback([{target:element}]);};
  return {w,get,storageWrites,resizeObservers,resize,hidden:id=>w.getComputedStyle(get(id)).display==='none',before,advance,settings,connect,message,frames:()=>[...w.document.querySelectorAll('.latex-islands-container iframe')],close:()=>w.close()};
}

test('one assistant TikZ island is added while native math, user, composer and ordinary code stay intact',async t=>{
  const h=harness();t.after(h.close);await h.advance(2100);assert.equal(h.frames().length,1);
  const frame=h.frames()[0];assert.match(frame.src,/^chrome-extension:\/\/test-id\/island\.html\?/);
  assert.equal(new URL(frame.src).searchParams.get('parentOrigin'),'https://chatgpt.com');
  const sent=h.connect(frame);assert.equal(sent.length,1);assert.equal(sent[0].origin,EXT);assert.equal(sent[0].data.source,SOURCE);
  for(const key of ['native','user','composer','ordinary'])assert.equal(h.get(key).outerHTML,h.before[key]);
  await h.advance(3000);assert.equal(h.frames().length,1);assert.equal(sent.length,1);
  // Accidental reinjection of the script must also remain idempotent.
  h.w.eval(fs.readFileSync(path.join(ROOT,'content.js'),'utf8'));await h.advance(2000);assert.equal(h.frames().length,1);
});

test('intermediate iframe load never sends to its WindowProxy; only a verified document port starts rendering',async t=>{
  const h=harness();t.after(h.close);await h.advance(60);
  const frame=h.frames()[0],sent=[];
  frame.contentWindow.postMessage=()=>assert.fail('Never post to an iframe window that may inherit the ChatGPT origin');
  const port={postMessage:data=>sent.push(data),close(){}};
  frame.dispatchEvent(new h.w.Event('load'));h.settings({scale:1.5});await h.advance(60);
  h.message(frame,{type:'ready'},'https://chatgpt.com',frame.contentWindow,[port]);
  h.message(frame,{type:'ready'},EXT,h.w,[port]);
  h.message(frame,{type:'ready'},EXT,frame.contentWindow);
  assert.equal(sent.length,0);
  h.message(frame,{type:'ready'},EXT,frame.contentWindow,[port]);
  assert.equal(sent.length,1);assert.equal(sent[0].type,'render');assert.equal(sent[0].scale,1.5);
});

test('a reloaded extension document replaces its port and receives unchanged source again',async t=>{
  const h=harness();t.after(h.close);await h.advance(60);
  const frame=h.frames()[0],first=h.connect(frame);
  frame.dispatchEvent(new h.w.Event('load'));
  const second=h.connect(frame);
  assert.equal(first.port.closed,true);assert.equal(second.length,1);assert.equal(second[0].data.source,SOURCE);
  h.settings({renderColors:'native'});
  assert.equal(first.length,1);assert.equal(second.at(-1).data.renderColors,'native');
});

test('removing a source or iframe stops messages before the next cleanup scan',async t=>{
  for(const remove of ['source','frame']){
    const h=harness();t.after(h.close);await h.advance(60);
    const frame=h.frames()[0],sent=h.connect(frame);
    h.message(frame,{type:'open-editor'});
    const count=sent.length;
    (remove==='source'?h.get('diagram'):frame).remove();
    h.settings({scale:1.5,renderColors:'native'});
    h.message(frame,{type:'ready'},EXT,frame.contentWindow,[{postMessage:()=>assert.fail('Detached frame accepted'),close(){}}]);
    assert.equal(sent.length,count);
    h.settings({enabled:false});assert.equal(sent.port.closed,true);assert.equal(sent.length,count);
  }
});

test('color preference updates existing island views without resending source or losing editor drafts',async t=>{
  const h=harness();t.after(h.close);await h.advance(60);
  const frame=h.frames()[0],sent=h.connect(frame);
  assert.equal(sent[0].data.renderColors,'chatgpt');
  h.message(frame,{type:'open-editor'});h.message(frame,{type:'source-change',source:'local draft'});
  const renders=sent.filter(item=>item.data.type==='render').length;
  h.settings({renderColors:'native'});await h.advance(100);
  assert.equal(h.frames()[0],frame);
  assert.equal(sent.at(-1).data.type,'view');assert.equal(sent.at(-1).data.mode,'editor');assert.equal(sent.at(-1).data.renderColors,'native');
  assert.equal(sent.filter(item=>item.data.type==='render').length,renders);
  h.message(frame,{type:'close-editor'});assert.equal(sent.at(-1).data.renderColors,'native');
  h.settings({renderColors:'unsupported'});assert.equal(sent.at(-1).data.renderColors,'chatgpt');
  assert.equal(sent.filter(item=>item.data.type==='render').length,renders);
  assert.equal(h.get('diagram').querySelector('code').textContent,SOURCE);
});

test('saved native colors also reach a streaming prepare message',async t=>{
  const h=harness({streaming:true,source:'',saved:{renderColors:'native'}});t.after(h.close);h.get('ordinary').remove();await h.advance(60);
  const sent=h.connect(h.frames()[0]);assert.equal(sent[0].data.type,'prepare');assert.equal(sent[0].data.renderColors,'native');
});

test('page theme is remembered once and only palette changes write again, including while disabled',async t=>{
  const h=harness();t.after(h.close);await h.advance(60);
  assert.equal(h.storageWrites.length,1);assert.equal(h.storageWrites[0].chatgptTheme.theme,'light');
  assert.deepEqual(Object.keys(h.storageWrites[0].chatgptTheme.colors).sort(),['background','border','surface','text']);
  const frame=h.frames()[0],sent=h.connect(frame);
  h.w.document.documentElement.classList.add('dark');await h.advance(60);
  assert.equal(h.storageWrites.length,2);assert.equal(h.storageWrites[1].chatgptTheme.theme,'dark');
  assert.equal(sent.at(-1).data.type,'view');assert.equal(sent.at(-1).data.theme,'dark');
  h.w.document.documentElement.classList.add('unrelated-layout');h.get('assistant').append(h.w.document.createTextNode('streamed token'));
  h.message(frame,{type:'open-editor'});h.message(frame,{type:'close-editor'});await h.advance(60);
  assert.equal(h.storageWrites.length,2,'streaming and fullscreen classes never cause redundant writes');
  h.w.document.body.style.backgroundColor='rgb(18, 20, 22)';await h.advance(60);
  assert.equal(h.storageWrites.length,3);assert.equal(h.storageWrites[2].chatgptTheme.colors.background,'rgb(18, 20, 22)');
  h.settings({enabled:false});h.w.document.documentElement.classList.remove('dark');await h.advance(60);
  assert.equal(h.frames().length,0);assert.equal(h.storageWrites.length,4);assert.equal(h.storageWrites[3].chatgptTheme.theme,'light');
});

test('loading an unchanged remembered page palette does not write storage again',async t=>{
  const first=harness();await first.advance(60);const palette=JSON.parse(JSON.stringify(first.storageWrites[0].chatgptTheme));first.close();
  const reordered={colors:{border:palette.colors.border,surface:palette.colors.surface,text:palette.colors.text,background:palette.colors.background},theme:palette.theme};
  const h=harness({saved:{chatgptTheme:reordered}});t.after(h.close);await h.advance(60);h.connect(h.frames()[0]);
  assert.equal(h.storageWrites.length,0);
});

test('an empty streaming TikZ fence creates a loader before its first source token',async t=>{
  const h=harness({streaming:true,source:''});t.after(h.close);h.get('ordinary').remove();
  await h.advance(60);assert.equal(h.frames().length,1);const sent=h.connect(h.frames()[0]);
  assert.equal(sent[0].data.type,'prepare');assert.equal(sent[0].data.source,'');
  assert.equal(h.hidden('diagram'),true);await h.advance(5000);
  assert.ok(sent.every(message=>message.data.type==='prepare'));
});

test('a paused incomplete block stays in preparation instead of compiling unfinished TeX',async t=>{
  const source=String.raw`\begin{tikzpicture}\draw (0,0)`;
  const h=harness({streaming:true,source});t.after(h.close);h.get('ordinary').remove();
  await h.advance(60);const frame=h.frames()[0],sent=h.connect(frame);
  await h.advance(5000);assert.ok(sent.every(message=>message.data.type==='prepare'));
  h.get('diagram').querySelector('code').textContent=source+String.raw`--(1,1);\node {still typing`;
  await h.advance(5000);assert.equal(h.frames()[0],frame);
  assert.ok(sent.every(message=>message.data.type==='prepare'));
});

test('a balanced block compiles after 180 ms while the answer is still streaming',async t=>{
  const h=harness({streaming:true,source:String.raw`\begin{tikzpicture}`});t.after(h.close);h.get('ordinary').remove();
  await h.advance(60);const frame=h.frames()[0],sent=h.connect(frame);
  h.get('diagram').querySelector('code').textContent=SOURCE;await h.advance(60);
  assert.equal(sent.at(-1).data.type,'prepare');await h.advance(179);
  assert.equal(sent.at(-1).data.type,'prepare');await h.advance(1);
  assert.equal(sent.at(-1).data.type,'render');assert.equal(sent.at(-1).data.source,SOURCE);
  assert.equal(h.get('assistant').getAttribute('data-is-streaming'),'true');
  assert.equal(h.frames()[0],frame);await h.advance(1000);
  assert.equal(sent.filter(message=>message.data.type==='render').length,1);
});

test('a following Markdown block finishes the fence even when its TeX is malformed',async t=>{
  const source=String.raw`\begin{tikzpicture}\node {missing brace`;
  const h=harness({streaming:true,source});t.after(h.close);h.get('ordinary').remove();
  await h.advance(60);const frame=h.frames()[0],sent=h.connect(frame);
  const paragraph=h.w.document.createElement('p');paragraph.textContent='La réponse continue ici.';
  h.get('diagram').after(paragraph);await h.advance(60);
  assert.equal(sent.at(-1).data.type,'render');assert.equal(sent.at(-1).data.source,source);
  assert.equal(h.get('assistant').getAttribute('data-is-streaming'),'true');
  h.message(frame,{type:'result',ok:false,error:'Unbalanced braces',source});
  assert.equal(h.hidden('diagram'),false);
});

test('an ordinary code fence following the diagram is valid evidence of a closed Markdown block',async t=>{
  const source=String.raw`\begin{tikzpicture}\draw`;
  const h=harness({streaming:true,source});t.after(h.close);await h.advance(60);
  const sent=h.connect(h.frames()[0]);assert.equal(sent[0].data.type,'render');
  assert.equal(h.get('ordinary').outerHTML,h.before.ordinary);
});

test('nested code widgets produce one island and their copy controls never close a streaming fence',async t=>{
  const source=String.raw`\begin{tikzpicture}\draw (0,0)`;
  const h=harness({streaming:true,source});t.after(h.close);h.get('ordinary').remove();
  const outer=h.get('diagram'),header=h.w.document.createElement('div'),label=h.w.document.createElement('span');
  label.className='font-medium';label.textContent='tikz';header.append(label);
  const scroller=h.w.document.createElement('div'),inner=h.w.document.createElement('pre'),code=h.w.document.createElement('code');
  inner.className='cm-content';code.textContent=source;inner.append(code);scroller.append(inner);outer.replaceChildren(header,scroller);
  const widget=h.w.document.createElement('div');outer.before(widget);widget.append(outer);
  const toolbar=h.w.document.createElement('div'),copy=h.w.document.createElement('button');
  copy.textContent='Copier';toolbar.append(copy);widget.append(toolbar);
  await h.advance(60);assert.equal(h.frames().length,1);const frame=h.frames()[0],sent=h.connect(frame);
  await h.advance(2000);assert.ok(sent.every(message=>message.data.type==='prepare'));
  assert.equal(sent.at(-1).data.source,source);
  code.textContent=SOURCE;await h.advance(300);assert.equal(h.frames().length,1);
  assert.equal(sent.at(-1).data.type,'render');assert.equal(sent.at(-1).data.source,SOURCE);
});

test('CodeMirror content without a code element excludes the language header and copy label',async t=>{
  const h=harness();t.after(h.close);const outer=h.get('diagram');
  const header=h.w.document.createElement('div'),label=h.w.document.createElement('span'),copy=h.w.document.createElement('button');
  label.className='font-medium';label.textContent='tikz';copy.textContent='Copier le code';header.append(label,copy);
  const content=h.w.document.createElement('pre');content.className='cm-content';content.textContent=SOURCE;
  outer.replaceChildren(header,content);await h.advance(60);assert.equal(h.frames().length,1);
  const sent=h.connect(h.frames()[0]);assert.equal(sent[0].data.source,SOURCE);
});

test('CodeMirror line elements preserve newlines and TeX comments during source extraction',async t=>{
  const h=harness();t.after(h.close);const outer=h.get('diagram');outer.setAttribute('data-language','tikz');
  const source=String.raw`\begin{tikzpicture}
% This comment must end before the drawing command.

\draw (0,0)--(1,1);
\end{tikzpicture}`;
  const content=h.w.document.createElement('div');content.className='cm-content';
  for(const text of source.split('\n')){const line=h.w.document.createElement('div');line.className='cm-line';line.textContent=text;content.append(line);}
  outer.replaceChildren(content);await h.advance(60);assert.equal(h.frames().length,1);
  const sent=h.connect(h.frames()[0]);assert.equal(sent[0].data.source,source);
  assert.match(sent[0].data.source,/%[^\n]*\n\n\\draw/);
});

test('attribute-only generation end submits malformed source so the compiler can report an error',async t=>{
  const source=String.raw`\begin{tikzpicture}\draw (0,0)`;
  const h=harness({streaming:true,source});t.after(h.close);h.get('ordinary').remove();
  await h.advance(500);const frame=h.frames()[0],sent=h.connect(frame);assert.equal(sent[0].data.type,'prepare');
  h.get('assistant').removeAttribute('data-is-streaming');await h.advance(60);
  assert.equal(sent.at(-1).data.type,'render');assert.equal(sent.at(-1).data.source,source);
  h.message(frame,{type:'result',ok:false,error:'Unexpected end',source});assert.equal(h.hidden('diagram'),false);
});

test('removing an ancestor streaming class finishes pending islands without another text mutation',async t=>{
  const h=harness({source:String.raw`\begin{tikzpicture}`});t.after(h.close);h.get('ordinary').remove();
  const wrapper=h.w.document.createElement('div');wrapper.className='result-streaming';
  h.get('assistant').before(wrapper);wrapper.append(h.get('assistant'));
  await h.advance(500);const sent=h.connect(h.frames()[0]);assert.equal(sent[0].data.type,'prepare');
  wrapper.className='';await h.advance(60);assert.equal(sent.at(-1).data.type,'render');
});

test('continuous unrelated token mutations cannot postpone a completed block indefinitely',async t=>{
  const h=harness({streaming:true});t.after(h.close);h.get('ordinary').remove();
  await h.advance(0);const sent=h.connect(h.frames()[0]);assert.equal(sent[0].data.type,'prepare');
  const prose=h.w.document.createElement('p');h.get('diagram').before(prose);
  for(let i=0;i<10;i++){prose.textContent+='token ';await h.advance(30);}
  assert.equal(sent.filter(message=>message.data.type==='render').length,1);
  assert.equal(h.get('assistant').getAttribute('data-is-streaming'),'true');
});

test('navigation/removal cleans stale islands and new assistant responses can render',async t=>{
  const h=harness();t.after(h.close);await h.advance(2100);const oldFrame=h.frames()[0];h.connect(oldFrame);
  h.get('diagram').remove();await h.advance(1100);assert.equal(h.frames().length,0);assert.equal(oldFrame.isConnected,false);
  const pre=h.w.document.createElement('pre');pre.textContent=SOURCE;h.get('assistant').append(pre);
  await h.advance(2100);assert.equal(h.frames().length,1);assert.notEqual(h.frames()[0],oldFrame);
  h.get('assistant').remove();await h.advance(1100);assert.equal(h.frames().length,0);
});

test('resize and result messages require the correct extension origin, source window and island id',async t=>{
  const h=harness({saved:{autoRender:false}});t.after(h.close);await h.advance(2100);const frame=h.frames()[0];h.connect(frame);
  const initial=frame.style.height;
  h.message(frame,{type:'resize',height:501},'https://attacker.example');assert.equal(frame.style.height,initial);
  h.message(frame,{type:'resize',height:502},EXT,h.w);assert.equal(frame.style.height,initial);
  h.message(frame,{type:'resize',height:503,id:'wrong'});assert.equal(frame.style.height,initial);
  h.message(frame,{type:'resize',height:NaN});assert.equal(frame.style.height,initial);
  h.message(frame,{type:'resize',height:123.2});assert.equal(frame.style.height,'124px');
  h.message(frame,{type:'resize',height:1});assert.equal(frame.style.height,'80px');
  h.message(frame,{type:'result',ok:true},'https://attacker.example');assert.equal(h.hidden('diagram'),false);
  h.message(frame,{type:'result',ok:true},EXT,h.w);assert.equal(h.hidden('diagram'),false);
  h.message(frame,{type:'result',ok:true});assert.equal(h.hidden('diagram'),true);
  h.message(frame,{type:'result',ok:false});assert.equal(h.hidden('diagram'),false);
});

test('disabling removes islands, restores hidden source, and enabling recreates a single island',async t=>{
  const h=harness();t.after(h.close);await h.advance(2100);const frame=h.frames()[0];h.connect(frame);
  h.message(frame,{type:'result',ok:true});assert.equal(h.hidden('diagram'),true);
  h.settings({enabled:false});assert.equal(h.frames().length,0);assert.equal(h.hidden('diagram'),false);
  await h.advance(3100);assert.equal(h.frames().length,0);
  h.settings({enabled:true});await h.advance(2100);assert.equal(h.frames().length,1);
  h.settings({enabled:false},'sync');assert.equal(h.frames().length,1);
});

test('initial disabled state leaves the conversation untouched',async t=>{
  const h=harness({saved:{enabled:false}});t.after(h.close);await h.advance(5000);
  assert.equal(h.frames().length,0);for(const key of ['native','user','composer','ordinary'])assert.equal(h.get(key).outerHTML,h.before[key]);
});

test('stale render results cannot hide manually rendered source before or after its new compilation is sent',async t=>{
  const h=harness({saved:{autoRender:false}});t.after(h.close);await h.advance(2100);const frame=h.frames()[0],sent=h.connect(frame);
  h.message(frame,{type:'result',ok:true,source:SOURCE});assert.equal(h.hidden('diagram'),true);
  const changed=SOURCE.replace('(1,1)','(3,3)');h.get('diagram').querySelector('code').textContent=changed;
  await h.advance(1100);assert.equal(h.hidden('diagram'),false);
  h.message(frame,{type:'result',ok:true,source:SOURCE});assert.equal(h.hidden('diagram'),false);
  await h.advance(1100);assert.equal(sent.at(-1).data.source,changed);
  h.message(frame,{type:'result',ok:true,source:SOURCE});assert.equal(h.hidden('diagram'),false);
  h.message(frame,{type:'result',ok:true,source:changed});assert.equal(h.hidden('diagram'),true);
});

test('error source comes from actual TeX, and raw diagrams preserve surrounding prose',async t=>{
  const h=harness();t.after(h.close);h.get('diagram').remove();
  const error=h.w.document.createElement('span');error.className='katex-error';error.title='ParseError: No such environment: tikzpicture';error.textContent=SOURCE;
  const p=h.w.document.createElement('p');p.textContent='Avant '+SOURCE+' après';h.get('assistant').append(error,p);
  await h.advance(2100);assert.equal(h.frames().length,2);
  const errorFrame=error.nextElementSibling.querySelector('iframe'),rawFrame=p.nextElementSibling.querySelector('iframe');
  const sent=h.connect(errorFrame);assert.equal(sent[0].data.source,SOURCE);h.connect(rawFrame);
  h.message(errorFrame,{type:'result',ok:true,source:SOURCE});assert.equal(h.w.getComputedStyle(error).display,'none');
  h.message(rawFrame,{type:'result',ok:true,source:SOURCE});assert.notEqual(h.w.getComputedStyle(p).display,'none');assert.equal(p.textContent,'Avant '+SOURCE+' après');
});

test('over-limit source, code containing a TikZ string and assistant edit boxes are not rendered',async t=>{
  const h=harness();t.after(h.close);h.get('diagram').querySelector('code').textContent=SOURCE+'x'.repeat(60001);
  h.get('ordinary').querySelector('code').textContent='text = '+JSON.stringify(SOURCE);
  const editor=h.w.document.createElement('div');editor.contentEditable='true';editor.setAttribute('contenteditable','true');const pre=h.w.document.createElement('pre');pre.textContent=SOURCE;editor.append(pre);h.get('assistant').append(editor);
  await h.advance(3100);assert.equal(h.frames().length,0);
});

test('editor promotes the existing iframe without reload and restores it on close or disable',async t=>{
  const h=harness();t.after(h.close);await h.advance(100);const frame=h.frames()[0],sent=h.connect(frame),parent=frame.parentElement,window=frame.contentWindow;
  let opened=0,closed=0;parent.showPopover=()=>opened++;parent.hidePopover=()=>closed++;
  h.message(frame,{type:'open-editor'});assert.equal(opened,1);assert.equal(frame.parentElement,parent);assert.equal(frame.contentWindow,window);
  assert.equal(parent.getAttribute('popover'),'manual');assert.equal(parent.getAttribute('role'),'dialog');assert.equal(sent.at(-1).data.type,'view');assert.equal(sent.at(-1).data.mode,'editor');
  h.message(frame,{type:'close-editor'});assert.equal(closed,1);assert.equal(frame.parentElement,parent);assert.equal(parent.hasAttribute('popover'),false);assert.equal(sent.at(-1).data.mode,'inline');
  assert.equal(sent.filter(s=>s.data.type==='render').length,1);
  h.message(frame,{type:'open-editor'});h.settings({enabled:false});assert.equal(h.w.document.querySelector('.latex-islands-editor'),null);assert.equal(h.w.document.documentElement.classList.contains('latex-islands-editor-open'),false);
});

function rectangle(left,top,width,height){return {left,top,width,height,right:left+width,bottom:top+height};}
function editorBounds(element){return ['left','top','width','height'].map(key=>element.style.getPropertyValue('--li-editor-'+key));}
function setViewport(h,width,height){Object.defineProperty(h.w,'innerWidth',{value:width,configurable:true});Object.defineProperty(h.w,'innerHeight',{value:height,configurable:true});}

test('editor uses the stationary conversation viewport and leaves expanded sidebar and right panel uncovered',async t=>{
  const h=harness();t.after(h.close);setViewport(h,1718,1296);
  const main=h.w.document.querySelector('main'),scrollRoot=h.w.document.createElement('div');scrollRoot.setAttribute('data-scroll-root','true');
  main.before(scrollRoot);scrollRoot.append(main);
  scrollRoot.getBoundingClientRect=()=>rectangle(260,0,1138,1296);
  main.getBoundingClientRect=()=>rectangle(275,-12255,1108,1244);
  await h.advance(100);const frame=h.frames()[0],sent=h.connect(frame),parent=frame.parentElement,window=frame.contentWindow;
  h.message(frame,{type:'open-editor'});
  assert.deepEqual(editorBounds(parent),['260px','0px','1138px','1296px']);
  assert.deepEqual(editorBounds(h.w.document.querySelector('.latex-islands-editor')),editorBounds(parent));
  assert.equal(frame.contentWindow,window);assert.equal(sent.at(-1).data.mode,'editor');
  const css=fs.readFileSync(path.join(ROOT,'content.css'),'utf8');
  assert.match(css,/\.latex-islands-is-editing::backdrop\s*\{[^}]*background:transparent[^}]*pointer-events:none/,'top-layer backdrop must not hide or intercept the sidebar');
  h.message(frame,{type:'close-editor'});assert.deepEqual(editorBounds(parent),['','','','']);
});

test('editor follows sidebar collapse, expansion and browser resizing without replacing its iframe or source',async t=>{
  const h=harness();t.after(h.close);setViewport(h,1440,900);
  const main=h.w.document.querySelector('main'),scrollRoot=h.w.document.createElement('div');scrollRoot.className='group/scroll-root';
  main.before(scrollRoot);scrollRoot.append(main);let bounds=rectangle(260,0,1180,900);scrollRoot.getBoundingClientRect=()=>bounds;
  await h.advance(100);const frame=h.frames()[0],sent=h.connect(frame),parent=frame.parentElement,window=frame.contentWindow;
  h.message(frame,{type:'open-editor'});h.message(frame,{type:'source-change',source:'editor draft'});
  bounds=rectangle(0,0,1440,900);h.resize(scrollRoot);await h.advance(16);
  assert.deepEqual(editorBounds(parent),['0px','0px','1440px','900px']);
  bounds=rectangle(260,0,1180,900);scrollRoot.classList.add('sidebar-expanded');await h.advance(16);
  assert.deepEqual(editorBounds(parent),['260px','0px','1180px','900px']);
  setViewport(h,1200,740);bounds=rectangle(260,0,940,740);h.w.dispatchEvent(new h.w.Event('resize'));await h.advance(16);
  assert.deepEqual(editorBounds(parent),['260px','0px','940px','740px']);
  assert.equal(frame.contentWindow,window);assert.equal(h.frames()[0],frame);assert.equal(sent.filter(item=>item.data.type==='render').length,1);
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape'}));
  assert.equal(h.w.document.querySelector('.latex-islands-editor'),null);assert.equal(sent.at(-1).data.mode,'inline');
  assert.ok(h.resizeObservers.every(observer=>observer.targets.size===0));
  bounds=rectangle(0,0,1200,740);h.w.dispatchEvent(new h.w.Event('resize'));await h.advance(16);
  assert.deepEqual(editorBounds(parent),['','','','']);assert.equal(h.w.document.documentElement.classList.contains('latex-islands-editor-open'),false);
});

test('editor supports the unannotated scroll viewport and mobile layout fallback',async t=>{
  const h=harness();t.after(h.close);setViewport(h,390,844);
  const main=h.w.document.querySelector('main'),scroller=h.w.document.createElement('div');scroller.style.overflowY='auto';
  main.before(scroller);scroller.append(main);scroller.getBoundingClientRect=()=>rectangle(0,0,390,844);
  main.getBoundingClientRect=()=>rectangle(15,-800,360,2000);
  await h.advance(100);const frame=h.frames()[0];h.connect(frame);h.message(frame,{type:'open-editor'});
  assert.deepEqual(editorBounds(frame.parentElement),['0px','0px','390px','844px']);
  h.message(frame,{type:'close-editor'});scroller.style.overflowY='visible';main.getBoundingClientRect=()=>rectangle(0,0,0,0);
  h.message(frame,{type:'open-editor'});assert.deepEqual(editorBounds(frame.parentElement),['0px','0px','390px','844px']);
  h.message(frame,{type:'close-editor'});
});

test('editor closes and releases its layout observers immediately when navigation removes the conversation',async t=>{
  const h=harness();t.after(h.close);await h.advance(100);
  const frame=h.frames()[0];h.connect(frame);h.message(frame,{type:'open-editor'});
  h.get('assistant').remove();await h.advance(16);
  assert.equal(h.w.document.querySelector('.latex-islands-editor'),null);
  assert.equal(h.w.document.documentElement.classList.contains('latex-islands-editor-open'),false);
  assert.ok(h.resizeObservers.every(observer=>observer.targets.size===0));
});

test('editor drafts survive settings changes without altering the conversation source, then reset on new streamed source',async t=>{
  const h=harness({saved:{autoRender:false}});t.after(h.close);await h.advance(100);const frame=h.frames()[0],sent=h.connect(frame),draft=SOURCE.replace('(1,1)','(5,5)');
  h.message(frame,{type:'source-change',source:draft});h.message(frame,{type:'result',ok:true,source:draft});assert.equal(h.hidden('diagram'),true);
  assert.equal(h.get('diagram').querySelector('code').textContent,SOURCE);
  h.settings({scale:1.5});assert.equal(sent.at(-1).data.source,draft);
  const changed=SOURCE.replace('(1,1)','(6,6)');h.get('diagram').querySelector('code').textContent=changed;await h.advance(100);
  assert.equal(sent.at(-1).data.source,changed);h.message(frame,{type:'result',ok:true,source:draft});assert.equal(h.hidden('diagram'),false);
});

test('a modern non-TeX language header prevents rendering embedded TikZ examples',async t=>{
  const h=harness();t.after(h.close);const pre=h.get('diagram');pre.querySelector('code').className='';
  const header=h.w.document.createElement('div');header.className='font-medium';header.textContent='bash';pre.prepend(header);
  const copy=h.w.document.createElement('button');copy.className='font-medium';copy.textContent='Copier';pre.append(copy);
  await h.advance(200);assert.equal(h.frames().length,0);
});

test('PDF snapshots select only diagrams in scope, preserve edited source, and trust only the verified port',async t=>{
  const h=harness();t.after(h.close);await h.advance(60);
  const frame=h.frames()[0],sent=h.connect(frame),api=h.w.LatexIslandsDiagramExport;
  assert.equal((await api.snapshot(h.get('native'))).length,0);
  const edited=SOURCE.replace('(1,1)','(2,2)');h.message(frame,{type:'source-change',source:edited});
  const promise=api.snapshot(h.get('diagram')),request=sent.at(-1).data;
  assert.equal(request.type,'snapshot');assert.equal(request.source,edited);
  let settled=false;promise.then(()=>settled=true);
  h.message(frame,snapshotReply(request));await tick();assert.equal(settled,false,'public window responses are ignored');
  sent.reply({...snapshotReply(request),id:'wrong'});sent.reply({...snapshotReply(request),requestId:'snapshot-unknown'});
  await tick();assert.equal(settled,false);
  sent.reply(snapshotReply(request));const results=await promise;
  assert.equal(results.length,1);assert.equal(results[0].sourceElement,h.get('diagram'));
  assert.equal(results[0].containerElement,frame.parentElement);assert.equal(results[0].svg,SNAPSHOT_SVG);
  assert.equal(results[0].width,160*4/3);assert.equal(results[0].height,80*4/3);
});

test('PDF snapshots report disconnected, unrendered, streaming, and failed diagrams instead of omitting them',async t=>{
  const h=harness();t.after(h.close);await h.advance(60);
  const api=h.w.LatexIslandsDiagramExport;
  await assert.rejects(api.snapshot(h.get('assistant')),/diagram connection is still loading/);
  const sent=h.connect(h.frames()[0]),promise=api.snapshot(h.get('assistant'));
  sent.reply({...sent.at(-1).data,type:'snapshot-result',ok:false,error:'Use Render diagram or Retry, then export again.'});
  await assert.rejects(promise,/Render diagram or Retry/);
  h.get('assistant').setAttribute('data-is-streaming','true');h.get('ordinary').remove();h.get('diagram').querySelector('code').textContent='\\begin{tikzpicture}';
  await assert.rejects(api.snapshot(h.get('assistant')),/diagram code is still streaming/);
  const removed=h.get('assistant');removed.remove();await assert.rejects(api.snapshot(removed),/no longer available/);
});

test('PDF snapshots reject stale source, a new document port, frame reload, removal, and navigation',async t=>{
  for(const change of ['source','reply-source','port','reload','remove','frame-source','navigation','pagehide']){
    const h=harness();t.after(h.close);await h.advance(60);
    const frame=h.frames()[0],sent=h.connect(frame),promise=h.w.LatexIslandsDiagramExport.snapshot(h.get('assistant'));
    const rejected=assert.rejects(promise,/changed|reloaded|removed|closed/),request=sent.at(-1).data;
    if(change==='source')h.get('diagram').querySelector('code').textContent=SOURCE.replace('(1,1)','(2,2)');
    if(change==='reply-source')request.source='stale source';
    if(change==='port')h.connect(frame);
    if(change==='reload')frame.dispatchEvent(new h.w.Event('load'));
    if(change==='remove')frame.remove();
    if(change==='frame-source')frame.src='about:blank';
    if(change==='navigation')h.w.history.pushState({},'', '/c/another-chat');
    if(change==='pagehide')h.w.dispatchEvent(new h.w.Event('pagehide'));
    sent.reply(snapshotReply(request));await rejected;
  }
});

test('PDF snapshots clean up cancellation, timeout, and invalid payloads',async t=>{
  for(const failure of ['abort','timeout','size','width','height']){
    const h=harness();t.after(h.close);await h.advance(60);
    const sent=h.connect(h.frames()[0]),controller=new h.w.AbortController();
    const promise=h.w.LatexIslandsDiagramExport.snapshot(h.get('assistant'),{signal:controller.signal});
    const rejected=assert.rejects(promise,/cancelled|timed out|dimensions|10 MB/),request=sent.at(-1).data;
    if(failure==='abort')controller.abort();
    else if(failure==='timeout')await h.advance(10001);
    else sent.reply({...snapshotReply(request),...(failure==='size'?{svg:'x'.repeat(10*1024*1024+1)}:failure==='width'?{width:Infinity}:{height:0})});
    await rejected;assert.equal(sent.at(-1).data.type,'snapshot-cancel');
    sent.reply(snapshotReply(request));
  }
  const h=harness();t.after(h.close);const controller=new h.w.AbortController();controller.abort();
  await assert.rejects(h.w.LatexIslandsDiagramExport.snapshot(h.get('native'),{signal:controller.signal}),{name:'AbortError'});
});

test('PDF snapshots recheck earlier diagrams after collecting multiple document-bound responses',async t=>{
  const h=harness();t.after(h.close);await h.advance(60);
  const second=h.w.document.createElement('pre');second.innerHTML='<code class="language-tikz"></code>';second.firstElementChild.textContent=SOURCE;
  h.get('assistant').querySelector('.markdown').append(second);await h.advance(60);
  const frames=h.frames(),first=h.connect(frames[0]),last=h.connect(frames[1]);
  const promise=h.w.LatexIslandsDiagramExport.snapshot(h.get('assistant')),rejected=assert.rejects(promise,/changed/);
  first.reply(snapshotReply(first.at(-1).data));
  frames[0].dispatchEvent(new h.w.Event('load'));
  last.reply(snapshotReply(last.at(-1).data));
  await rejected;
});

test('content detection ignores PDF clones and per-response export controls',async t=>{
  const h=harness();t.after(h.close);await h.advance(60);
  for(const className of ['li-pdf-root','li-export-reply']){
    const wrapper=h.w.document.createElement('div');wrapper.className=className;
    const clone=h.get('assistant').cloneNode(true);clone.querySelectorAll('.latex-islands-container').forEach(element=>element.remove());wrapper.append(clone);h.w.document.body.append(wrapper);
  }
  h.settings({scale:1.5});await h.advance(60);
  assert.equal(h.frames().length,1);
});

test('September message and code widgets render without legacy role attributes or pre elements',async t=>{
  const source=String.raw`\begin{tikzpicture}
% Keep this newline before the drawing.
\node {réseau};
\end{tikzpicture}`;
  const h=harness({modern:true,source});t.after(h.close);await h.advance(60);
  assert.equal(h.get('assistant').querySelector('pre'),null);
  assert.equal(h.w.document.querySelector('[data-message-author-role]'),null);
  assert.equal(h.frames().length,1);
  const frame=h.frames()[0],sent=h.connect(frame);assert.equal(sent[0].data.source,source);
  assert.equal(sent[0].data.type,'render');assert.equal(frame.parentElement.previousElementSibling,h.get('diagram'));
  h.message(frame,{type:'result',ok:true,source});assert.equal(h.hidden('diagram'),true,'the complete widget and its header are hidden');
  for(const key of ['native','user','composer','ordinary'])assert.equal(h.get(key).outerHTML,h.before[key]);
});

test('September empty streaming widgets prepare early and submit only their completed source',async t=>{
  const h=harness({modern:true,streaming:true,source:''});t.after(h.close);h.get('ordinary').remove();await h.advance(60);
  assert.equal(h.frames().length,1);const sent=h.connect(h.frames()[0]);assert.equal(sent[0].data.type,'prepare');assert.equal(sent[0].data.source,'');
  h.get('diagram').querySelector('code span').textContent='\\begin{tikzpicture}';await h.advance(500);
  assert.ok(sent.every(item=>item.data.type==='prepare'));
  h.get('diagram').querySelector('code span').textContent=SOURCE;await h.advance(60);assert.equal(sent.at(-1).data.type,'prepare');
  await h.advance(180);assert.equal(sent.at(-1).data.type,'render');assert.equal(sent.at(-1).data.source,SOURCE);
  assert.equal(h.get('assistant').getAttribute('data-is-streaming'),'true');
});

function addSeptemberStopControl(h) {
  const composer=h.w.document.createElement('div');composer.setAttribute('data-chatgpt-composer','');
  composer.innerHTML='<div data-composer-footer-responsive><button aria-label="Arrêter">■</button></div>';
  h.w.document.body.append(composer);return composer.querySelector('button');
}

test('live September composer signal prepares partial code then renders while the answer keeps streaming',async t=>{
  const partial='\\begin{tikzpicture}\\draw (';
  const h=harness({modern:true,source:partial});t.after(h.close);h.get('ordinary').remove();const stop=addSeptemberStopControl(h);
  h.get('diagram').querySelector('code span').setAttribute('aria-busy','false');
  assert.equal(h.w.document.querySelector('[data-is-streaming], [aria-busy="true"], .result-streaming, [data-testid="stop-button"], [data-test-id="stop-button"]'),null);
  await h.advance(60);assert.equal(h.frames().length,1);const sent=h.connect(h.frames()[0]);
  assert.equal(sent[0].data.type,'prepare');assert.equal(sent[0].data.source,partial);assert.equal(h.hidden('diagram'),true);
  await h.advance(1500);assert.ok(sent.every(item=>item.data.type==='prepare'),'a pause cannot compile an incomplete block');
  h.get('diagram').querySelector('code span').textContent=SOURCE;
  const continuation=h.w.document.createElement('p');continuation.textContent='The response continues';h.get('assistant').querySelector('[data-markdown-text-style]').append(continuation);
  await h.advance(60);assert.equal(sent.at(-1).data.type,'render');assert.equal(sent.at(-1).data.source,SOURCE);assert.equal(stop.isConnected,true);
  for(let i=0;i<5;i++){continuation.textContent+=' with another token';await h.advance(30);}
  assert.equal(sent.filter(item=>item.data.type==='render').length,1);assert.equal(stop.isConnected,true);
});

test('ending generation through the September composer submits unfinished TeX for diagnostics',async t=>{
  for(const finish of ['remove','relabel']) {
    const source='\\begin{tikzpicture}\\draw (';
    const h=harness({modern:true,source});t.after(h.close);h.get('ordinary').remove();const stop=addSeptemberStopControl(h);
    await h.advance(500);const sent=h.connect(h.frames()[0]);assert.equal(sent[0].data.type,'prepare');
    if(finish==='remove')stop.remove();else stop.setAttribute('aria-label','Envoyer');
    await h.advance(60);assert.equal(sent.at(-1).data.type,'render');assert.equal(sent.at(-1).data.source,source);
    assert.equal(h.get('diagram').querySelector('code span').textContent,source,'the end signal works without another source mutation');
    h.message(h.frames()[0],{type:'result',ok:false,source,error:'Incomplete TeX'});assert.equal(h.hidden('diagram'),false);
  }
});

test('existing-chat code is replaced by a host loader before the iframe handshake and stays hidden through rendering',async t=>{
  for(const modern of [false,true]) {
    const h=harness({modern});t.after(h.close);await h.advance(0);
    const frame=h.frames()[0],container=frame.parentElement;assert.equal(h.hidden('diagram'),true);
    assert.equal(container.querySelector('.latex-islands-boot [role="status"]').textContent,'Rendering diagram…');
    assert.equal(h.w.getComputedStyle(frame).visibility,'hidden');assert.equal(frame.style.height,'222px');
    const sent=h.connect(frame);assert.equal(sent[0].data.type,'render');assert.equal(h.hidden('diagram'),true);assert.ok(container.querySelector('.latex-islands-boot'));
    h.message(frame,{type:'resize',height:222});assert.equal(container.querySelector('.latex-islands-boot'),null);assert.equal(container.classList.contains('latex-islands-booting'),false);
    assert.equal(h.w.getComputedStyle(frame).visibility,'visible');assert.equal(h.hidden('diagram'),true);
    h.message(frame,{type:'result',ok:true,source:SOURCE,cached:true});assert.equal(h.hidden('diagram'),true);
    assert.equal(sent.filter(item=>item.data.type==='render').length,1);
  }
});

test('an empty streaming fence also has a visible host loader before the iframe connects',async t=>{
  const h=harness({modern:true,streaming:true,source:''});t.after(h.close);h.get('ordinary').remove();await h.advance(0);
  const container=h.frames()[0].parentElement;assert.equal(h.hidden('diagram'),true);assert.equal(container.querySelector('[role="status"]').textContent,'Writing diagram…');
  assert.equal(h.connect(h.frames()[0])[0].data.type,'prepare');
});

test('slow iframe startup keeps an explicit source fallback and render errors keep the source visible',async t=>{
  const h=harness({modern:true});t.after(h.close);await h.advance(0);const frame=h.frames()[0];
  const fallback=frame.parentElement.querySelector('.latex-islands-boot button');fallback.click();assert.equal(h.hidden('diagram'),false);assert.equal(fallback.disabled,true);
  await h.advance(2000);assert.equal(h.hidden('diagram'),false);h.connect(frame);assert.equal(h.hidden('diagram'),false);
  h.message(frame,{type:'result',ok:false,source:SOURCE,error:'Invalid drawing'});assert.equal(h.hidden('diagram'),false);assert.equal(frame.parentElement.querySelector('.latex-islands-boot'),null);
  h.get('assistant').append(h.w.document.createTextNode('Another token'));await h.advance(60);assert.equal(h.hidden('diagram'),false,'rescanning must not hide a compiler error again');
});

test('manual rendering keeps existing code visible while the preview connects',async t=>{
  const h=harness({modern:true,saved:{autoRender:false}});t.after(h.close);await h.advance(0);const frame=h.frames()[0];
  assert.equal(h.hidden('diagram'),false);assert.equal(frame.parentElement.querySelector('[role="status"]').textContent,'Loading preview…');
  const sent=h.connect(frame);assert.equal(sent[0].data.autoRender,false);h.message(frame,{type:'resize',height:222});assert.equal(h.hidden('diagram'),false);
  h.message(frame,{type:'result',ok:true,source:SOURCE});assert.equal(h.hidden('diagram'),true);
  h.settings({enabled:false});assert.equal(h.hidden('diagram'),false);assert.equal(h.frames().length,0);
});

test('new compilation and iframe replacement retain the last height until the next result',async t=>{
  const h=harness({modern:true});t.after(h.close);await h.advance(0);const original=h.frames()[0];h.connect(original);
  h.message(original,{type:'result',ok:true,source:SOURCE});h.message(original,{type:'resize',height:640});assert.equal(original.style.height,'640px');
  const next=SOURCE.replace('(1,1)','(9,9)');h.get('diagram').querySelector('code span').textContent=next;await h.advance(60);
  h.message(original,{type:'resize',height:222});assert.equal(original.style.height,'640px');assert.equal(h.hidden('diagram'),true);
  h.message(original,{type:'result',ok:true,source:next});h.message(original,{type:'resize',height:480});assert.equal(original.style.height,'480px');
  original.parentElement.remove();await h.advance(60);const replacement=h.frames()[0];assert.notEqual(replacement,original);assert.equal(replacement.style.height,'480px');
  h.connect(replacement);h.message(replacement,{type:'resize',height:222});assert.equal(replacement.style.height,'480px');
  h.message(replacement,{type:'result',ok:true,source:next});h.message(replacement,{type:'resize',height:480});assert.equal(replacement.style.height,'480px');
  h.settings({scale:1.5});h.message(replacement,{type:'resize',height:360});assert.equal(replacement.style.height,'360px','resizing an already rendered source must not wait for another compiler result');
});

test('snapshot rejects a srcdoc override without removing it or replacing the iframe',async t=>{
  const h=harness({modern:true});t.after(h.close);await h.advance(60);const frame=h.frames()[0],sent=h.connect(frame);
  frame.setAttribute('srcdoc','');await assert.rejects(h.w.LatexIslandsDiagramExport.snapshot(h.get('diagram')),/diagram is unavailable/);
  assert.equal(sent.filter(item=>item.data.type==='snapshot').length,0);await h.advance(60);
  assert.equal(h.frames()[0],frame);assert.equal(frame.hasAttribute('srcdoc'),true);assert.equal(frame.getAttribute('srcdoc'),'');
});

test('September copy controls do not end a fence but a following code widget does',async t=>{
  const h=harness({modern:true,streaming:true,source:'\\begin{tikzpicture}\\draw ('});t.after(h.close);
  const ordinary=h.get('ordinary');ordinary.remove();await h.advance(500);const sent=h.connect(h.frames()[0]);assert.equal(sent[0].data.type,'prepare');
  const footer=h.w.document.createElement('div');footer.setAttribute('data-markdown-copy','exclude');footer.innerHTML='<p>Copy code</p>';h.get('diagram').append(footer);
  await h.advance(500);assert.ok(sent.every(item=>item.data.type==='prepare'));
  h.get('assistant').querySelector('[data-markdown-text-style]').append(ordinary);await h.advance(60);
  assert.equal(sent.at(-1).data.type,'render','a following fenced block proves that malformed TeX is ready for diagnostics');
});

test('September descendant aria-busy changes finish a streaming widget without another source token',async t=>{
  const h=harness({modern:true,source:'\\begin{tikzpicture}\\draw ('});t.after(h.close);h.get('ordinary').remove();
  const code=h.get('diagram').querySelector('code span');code.setAttribute('aria-busy','true');await h.advance(500);
  const sent=h.connect(h.frames()[0]);assert.equal(sent[0].data.type,'prepare');
  code.setAttribute('aria-busy','false');await h.advance(60);assert.equal(sent.at(-1).data.type,'render');
});

test('September data-theme palette reaches existing islands without requiring a dark class',async t=>{
  const h=harness({modern:true});t.after(h.close);await h.advance(60);const sent=h.connect(h.frames()[0]);
  h.w.document.documentElement.className='chatgpt-theme';h.w.document.documentElement.dataset.theme='dark';await h.advance(60);
  assert.equal(h.w.document.documentElement.classList.contains('dark'),false);
  assert.equal(sent.at(-1).data.type,'view');assert.equal(sent.at(-1).data.theme,'dark');
  assert.equal(sent.filter(item=>item.data.type==='render').length,1);
});

test('adding a message role after hydration discovers existing code without a text mutation',async t=>{
  const h=harness();t.after(h.close);h.get('assistant').removeAttribute('data-message-author-role');await h.advance(60);assert.equal(h.frames().length,0);
  h.get('assistant').setAttribute('data-message-author-role','assistant');await h.advance(60);assert.equal(h.frames().length,1);
});

test('adding the September code-widget marker after hydration discovers its source',async t=>{
  const h=harness({modern:true});t.after(h.close);h.get('diagram').removeAttribute('data-markdown-copy');await h.advance(60);assert.equal(h.frames().length,0);
  h.get('diagram').setAttribute('data-markdown-copy','code-block');await h.advance(60);assert.equal(h.frames().length,1);
  assert.equal(h.connect(h.frames()[0])[0].data.source,SOURCE);
});

test('host removal of only the island container or iframe remounts once and preserves edited source',async t=>{
  for(const removed of ['container','iframe']) {
    const h=harness({modern:true,saved:{autoRender:false}});t.after(h.close);await h.advance(60);
    const oldFrame=h.frames()[0],oldPort=h.connect(oldFrame),draft=SOURCE.replace('(1,1)','(4,4)');
    h.message(oldFrame,{type:'source-change',source:draft});h.message(oldFrame,{type:'result',ok:true,source:draft});assert.equal(h.hidden('diagram'),true);
    (removed==='container'?oldFrame.parentElement:oldFrame).remove();await h.advance(60);
    assert.equal(h.frames().length,1);const replacement=h.frames()[0];assert.notEqual(replacement,oldFrame);assert.equal(oldPort.port.closed,true);
    assert.equal(h.hidden('diagram'),false,'the original is restored until the replacement renders');
    const sent=h.connect(replacement);assert.equal(sent[0].data.source,draft);
    h.message(oldFrame,{type:'result',ok:true,source:draft});assert.equal(h.hidden('diagram'),false,'the detached document is no longer trusted');
    h.message(replacement,{type:'result',ok:true,source:draft});assert.equal(h.hidden('diagram'),true);
    await h.advance(1000);assert.equal(h.frames()[0],replacement);assert.equal(sent.filter(item=>item.data.type==='render').length,1);
  }
});

test('a role change restores source and removes the old island on an otherwise unchanged message',async t=>{
  const h=harness();t.after(h.close);await h.advance(60);const frame=h.frames()[0];h.connect(frame);h.message(frame,{type:'result',ok:true,source:SOURCE});
  h.get('assistant').setAttribute('data-message-author-role','user');await h.advance(60);
  assert.equal(h.frames().length,0);assert.equal(h.hidden('diagram'),false);
});

test('September editor uses the inner reverse-column timeline viewport',async t=>{
  const h=harness({modern:true});t.after(h.close);setViewport(h,1440,900);
  const main=h.w.document.querySelector('main'),timeline=h.w.document.createElement('div');timeline.setAttribute('data-app-action-timeline-scroll','');timeline.style.cssText='overflow-y:auto;display:flex;flex-direction:column-reverse';
  main.append(timeline);timeline.append(h.get('assistant'));timeline.getBoundingClientRect=()=>rectangle(260,48,880,790);main.getBoundingClientRect=()=>rectangle(260,0,1180,900);
  await h.advance(60);const frame=h.frames()[0];h.connect(frame);h.message(frame,{type:'open-editor'});
  assert.deepEqual(editorBounds(frame.parentElement),['260px','48px','880px','790px']);
  assert.equal(h.frames().length,1);h.message(frame,{type:'close-editor'});
});

test('September snapshots associate the complete code widget and ignore cloned message shells',async t=>{
  const h=harness({modern:true});t.after(h.close);await h.advance(60);
  const wrapper=h.w.document.createElement('div');wrapper.className='li-pdf-root';const clone=h.get('assistant').cloneNode(true);clone.querySelectorAll('.latex-islands-container').forEach(element=>element.remove());wrapper.append(clone);h.w.document.body.append(wrapper);
  await h.advance(60);assert.equal(h.frames().length,1);
  const sent=h.connect(h.frames()[0]),promise=h.w.LatexIslandsDiagramExport.snapshot(h.get('assistant'));sent.reply(snapshotReply(sent.at(-1).data));
  const results=await promise;assert.equal(results.length,1);assert.equal(results[0].sourceElement,h.get('diagram'));assert.equal(results[0].svg,SNAPSHOT_SVG);
});

test('PDF print hiding preserves the ready iframe, edited source and theme then resumes discovery',async t=>{
  const h=harness({modern:true,saved:{autoRender:false}});t.after(h.close);await h.advance(60);
  const frame=h.frames()[0],sent=h.connect(frame),draft=SOURCE.replace('(1,1)','(7,7)'),themeWrites=h.storageWrites.length;
  h.message(frame,{type:'source-change',source:draft});h.message(frame,{type:'result',ok:true,source:draft});
  const main=h.w.document.querySelector('main');h.w.document.body.classList.add('li-pdf-printing');main.style.display='none';await h.advance(500);
  assert.equal(h.frames()[0],frame);assert.equal(sent.port.closed,undefined);assert.equal(h.storageWrites.length,themeWrites);
  const added=h.w.document.createElement('pre');added.textContent=SOURCE;h.get('assistant').append(added);await h.advance(60);assert.equal(h.frames().length,1);
  main.style.removeProperty('display');h.w.document.body.classList.remove('li-pdf-printing');await h.advance(60);
  assert.equal(h.frames()[0],frame);assert.equal(h.frames().length,2);assert.equal(h.hidden('diagram'),true);assert.equal(sent.port.closed,undefined);
  assert.equal(sent.filter(item=>item.data.type==='render').length,1,'printing never reinitializes the manual render');
  const promise=h.w.LatexIslandsDiagramExport.snapshot(h.get('diagram')),request=sent.at(-1).data;assert.equal(request.source,draft);sent.reply(snapshotReply(request));await promise;
  main.style.display='none';await h.advance(60);assert.equal(h.frames().length,0,'a real hidden branch outside print still removes its islands');
});

test('PDF print suppression still rejects pending snapshots when the actual TeX changes',async t=>{
  const h=harness({modern:true});t.after(h.close);await h.advance(60);const frame=h.frames()[0],sent=h.connect(frame);
  const promise=h.w.LatexIslandsDiagramExport.snapshot(h.get('diagram')),rejected=assert.rejects(promise,/changed/);
  h.w.document.body.classList.add('li-pdf-printing');h.w.document.querySelector('main').style.display='none';
  h.get('diagram').querySelector('code span').textContent=SOURCE.replace('(1,1)','(8,8)');await h.advance(60);await rejected;
  assert.equal(h.frames()[0],frame);assert.equal(sent.at(-1).data.type,'snapshot-cancel');
  h.w.document.querySelector('main').style.removeProperty('display');h.w.document.body.classList.remove('li-pdf-printing');await h.advance(60);
  assert.equal(h.frames()[0],frame);assert.equal(sent.at(-1).data.source,SOURCE.replace('(1,1)','(8,8)'));
});
