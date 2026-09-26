const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom');
const ROOT=path.resolve(__dirname,'..'),ID='01234567-89ab-4cde-8f01-23456789abcd',CHANNEL='latex-islands-conversation-export-v1';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const DEFAULT_PAGE='<header id="page-header"><div id="conversation-header-actions"><button id="native">Share</button></div></header><main><article data-message-author-role="assistant">A DOM message that must never be scraped.</article></main>';
function harness(respond,pathname='/c/'+ID,saved={},html=DEFAULT_PAGE){
  const dom=new JSDOM('<!doctype html>'+html,{url:'https://chatgpt.com'+pathname,runScripts:'outside-only'});
  const w=dom.window,sent=[],downloads=[],blobs=[],copied=[],stored=[];
  w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic-'+blobs.length;};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,url:this.href});};
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async value=>copied.push(value)}});
  w.chrome={storage:{local:{get:async defaults=>({...defaults,...saved}),set:async value=>stored.push(value)}}};
  function reply(request,data,overrides={}){w.dispatchEvent(new w.MessageEvent('message',{source:w,origin:w.location.origin,data:{channel:CHANNEL,type:'response',requestId:request.requestId,...data},...overrides}));}
  w.postMessage=(data,origin)=>{sent.push({data,origin});if(data.type==='request'&&respond)queueMicrotask(async()=>{const result=await respond(data,sent.filter(item=>item.data.type==='request').length);if(result)reply(data,result);});};
  for(const file of ['chatgpt-dom.js','export-core.js','export-preview-renderer.js','native-controls.js','conversation-export.js'])w.eval(fs.readFileSync(path.join(ROOT,file),'utf8'));
  const get=selector=>w.document.querySelector(selector);
  function format(value){get('#li-export-format').value=value;get('#li-export-format').dispatchEvent(new w.Event('change',{bubbles:true}));}
  function change(selector,value){const input=get(selector);if(input.type==='checkbox')input.checked=value;else input.value=value;input.dispatchEvent(new w.Event('change',{bubbles:true}));}
  async function settle(){for(let i=0;i<10;i++)await tick();}
  async function remount(){await new Promise(resolve=>setTimeout(resolve,280));await settle();}
  async function text(blob){return new Promise((resolve,reject)=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob);});}
  return {w,sent,downloads,blobs,copied,stored,get,format,change,reply,settle,remount,text,close:()=>w.close()};
}
function apiPage(messages=[],has_previous_page=false,extra={}){return {messages,page_info:{has_previous_page,has_next_page:false,start_cursor:'before-1'},...extra};}
const message=(id,role,text,extra={})=>({id,author:{role},content:{content_type:'text',parts:[text]},...extra});
const pdfMessages=[{key:'q1',role:'user',preview:'First prompt'},{key:'a1',role:'assistant',preview:'First rich answer'},{key:'q2',role:'user',preview:'Second prompt'},{key:'a2',role:'assistant',preview:'Second rich answer'}];
function installPDF(h){
  const collects=[],prepares=[],captures=[],documents=[],prints=[],mounts=[];
  h.w.LatexIslandsPDF={
    async collect(settings){
      collects.push(settings);
      const capture={messages:settings.replyElement?pdfMessages.slice(0,2):pdfMessages,disposed:false,dispose(){this.disposed=true;}};
      captures.push(capture);return capture;
    },
    async prepare(settings){
      prepares.push(settings);
      const entries=settings.capture.messages.filter(entry=>(settings.selectedKeys===null||settings.selectedKeys.includes(entry.key))&&(settings.roleMode==='conversation'||entry.role===(settings.roleMode==='prompts'?'user':'assistant')));
      const root=h.w.document.createElement('div');root.className='li-export li-pdf-root li-pdf-document';
      for(const entry of entries){const paragraph=h.w.document.createElement('p'),strong=h.w.document.createElement('strong');strong.textContent=entry.preview;paragraph.dataset.messageKey=entry.key;paragraph.append(strong);root.append(paragraph);}
      const prepared={root,disposed:false,mountPreview(container){mounts.push(entries.map(entry=>entry.key));container.append(root);},print(){prints.push(entries.map(entry=>entry.key));this.dispose();},dispose(){this.disposed=true;root.remove();}};
      documents.push(prepared);return prepared;
    }
  };
  return {collects,prepares,captures,documents,prints,mounts};
}
const choiceKeys=h=>[...h.w.document.querySelectorAll('.li-export-message-choice input')].map(input=>input.dataset.messageKey);
const choose=(h,key,checked=true)=>h.change('.li-export-message-choice input[data-message-key="'+key+'"]',checked);

test('header control is idempotent and option selection makes no request before an explicit action',async t=>{
  const h=harness();t.after(h.close);assert.ok(h.get('#conversation-header-actions > .li-export'));assert.equal(h.get('.li-export-panel').hidden,true);assert.equal(h.get('#native').textContent,'Share');
  h.get('.li-export-toggle').click();h.format('txt');h.change('#li-export-timestamps',true);assert.equal(h.sent.length,0);
  assert.equal(h.get('.li-export-toggle').getAttribute('aria-expanded'),'true');
  h.w.eval(fs.readFileSync(path.join(ROOT,'conversation-export.js'),'utf8'));assert.equal(h.w.document.querySelectorAll('.li-export').length,1);
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(h.get('.li-export-panel').hidden,true);
});

function modernTitlebar(id,hidden=false){return `<div data-app-shell-main-titlebar="true" aria-hidden="${hidden}" data-testid="app-shell-header-context-menu-surface"><div data-app-shell-header-obstacle="true"><div class="pointer-events-auto" style="pointer-events:auto"><div id="${id}" class="flex items-center gap-toolbar-action"><span><button aria-label="Share">Share</button></span><button aria-label="More">More</button></div></div></div></div>`;}
const MODERN_PAGE=`<header hidden><div id="conversation-header-actions"></div></header><main data-app-shell-main-surface="browser"><header data-app-shell-titlebar="true" style="pointer-events:none">${modernTitlebar('inactive-actions',true)}${modernTitlebar('active-actions')}<div data-app-shell-header-slot="end"></div></header><div data-content-search-turn-key="turn-user"><div id="modern-user" data-chatgpt-search-unit-key="turn-user:user"><div data-user-message-bubble>Current prompt</div></div></div><div data-content-search-turn-key="turn-answer"><div id="modern-reply" data-chatgpt-search-unit-key="turn-answer:assistant"><h4 data-conversation-role="assistant">ChatGPT</h4><div data-chatgpt-selection-message-id="modern-answer"><div data-markdown-text-style="assistant-message"><p id="modern-prose">Modern DOM answer</p></div></div></div><div id="native-reply-actions" class="turn-action-controls"><button aria-label="Copy">Copy</button><button aria-label="More">More</button></div></div></main>`;

test('September app shell mounts in the active header and adds one PDF action to the native reply toolbar',async t=>{
  const h=harness(null,'/c/'+ID,{},MODERN_PAGE);t.after(h.close);const pdf=installPDF(h);
  assert.equal(h.get('.li-export').parentElement.id,'active-actions');assert.equal(h.get('.li-export').closest('[aria-hidden="true"],[hidden]'),null);
  assert.equal(h.w.document.querySelectorAll('.li-export-reply').length,1);assert.equal(h.get('.li-export-reply').parentElement.id,'native-reply-actions');assert.equal(h.get('#modern-user .li-export-reply'),null);
  h.get('.li-export-reply').click();h.get('.li-export-inspect').click();await h.settle();assert.equal(pdf.collects[0].replyElement,h.get('#modern-reply'));assert.equal(h.sent.filter(item=>item.data.type==='request').length,0);
  await h.remount();assert.equal(h.w.document.querySelectorAll('.li-export-reply').length,1);
});

test('header visibility switches and replacement preserve the export dialog and its chosen options',async t=>{
  const h=harness(null,'/c/'+ID,{},MODERN_PAGE);t.after(h.close);
  const original=h.get('.li-export');h.get('.li-export-toggle').click();h.change('#li-export-preset','answers');
  h.get('#active-actions').closest('[data-app-shell-main-titlebar]').setAttribute('aria-hidden','true');h.get('#inactive-actions').closest('[data-app-shell-main-titlebar]').setAttribute('aria-hidden','false');await h.remount();
  assert.equal(original.parentElement.id,'inactive-actions');assert.equal(h.get('.li-export-panel').hidden,false);assert.equal(h.get('#li-export-preset').value,'answers');
  h.get('main header').innerHTML=modernTitlebar('replacement-actions');await h.remount();
  assert.equal(h.get('.li-export'),original);assert.equal(original.parentElement.id,'replacement-actions');assert.equal(h.get('.li-export-panel').hidden,false);
  assert.equal(h.w.document.querySelectorAll('.li-export-toggle').length,1);assert.equal(h.sent.filter(item=>item.data.type==='request').length,1,'the opened transcript preview starts once');
});

test('opening the dialog previews a transcript automatically and reuses it across formats',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('a','assistant','An automatic preview')])}));t.after(h.close);
  assert.equal(h.sent.length,0);h.get('.li-export-toggle').click();await h.remount();
  assert.match(h.get('.li-export-dialogue').textContent,/An automatic preview/);assert.equal(h.get('.li-export-preview').hidden,false);assert.equal(h.get('.li-export-options').open,false);assert.equal(h.get('.li-export-preview-heading > span').textContent,'1 message');
  assert.equal(h.sent.filter(item=>item.data.type==='request').length,1);assert.equal(h.downloads.length,0);assert.equal(h.copied.length,0);
  h.format('txt');await h.remount();assert.equal(h.sent.filter(item=>item.data.type==='request').length,1);assert.equal(h.get('.li-export-preview').hidden,false);
});

test('closing before automatic preview cancels it and a failed automatic preview never retries itself',async t=>{
  const h=harness(async()=>({ok:false,error:'Synthetic fetch failure'}));t.after(h.close);
  h.get('.li-export-toggle').click();h.get('.li-export-close').click();await h.remount();assert.equal(h.sent.length,0);
  h.get('.li-export-toggle').click();await h.remount();assert.match(h.get('.li-export-status').textContent,/Synthetic fetch failure/);
  await h.remount();assert.equal(h.sent.filter(item=>item.data.type==='request').length,1);assert.equal(h.get('.li-export-save').disabled,false);
});

test('full PDF history waits for an explicit action while a single reply previews without printing',async t=>{
  const h=harness();t.after(h.close);const pdf=installPDF(h);
  h.get('.li-export-toggle').click();h.format('pdf');await h.remount();assert.equal(pdf.collects.length,0);assert.equal(h.sent.length,0);
  h.get('.li-export-close').click();h.get('.li-export-reply').click();await h.remount();
  assert.equal(pdf.collects.length,1);assert.equal(pdf.collects[0].replyElement,h.get('main article'));assert.deepEqual(pdf.mounts.at(-1),['a1']);assert.equal(pdf.prints.length,0);
});

test('saved PDF preferences arriving after dialog opening never start full-history collection',async t=>{
  const h=harness(null,'/c/'+ID,{exportPreferences:{format:'pdf'}});t.after(h.close);const pdf=installPDF(h);
  assert.equal(h.get('#li-export-format').value,'md');h.get('.li-export-toggle').click();await h.remount();
  assert.equal(h.get('#li-export-format').value,'pdf');assert.equal(pdf.collects.length,0);assert.equal(h.sent.length,0);assert.equal(h.get('.li-export-inspect').disabled,false);
});

test('automatic transcript loading keeps configuration editable and never follows a format change into PDF capture',async t=>{
  const h=harness();t.after(h.close);const pdf=installPDF(h);
  h.get('.li-export-toggle').click();await h.remount();const request=h.sent.find(item=>item.data.type==='request').data;
  assert.equal(h.get('#li-export-format-trigger').disabled,false);assert.equal(h.get('#li-export-preset-trigger').disabled,false);assert.equal(h.get('.li-export-save').disabled,true);
  h.change('#li-export-preset','answers');h.format('pdf');h.change('#li-export-pdf-role','prompts');
  h.reply(request,{ok:true,payload:apiPage([message('q','user','Question'),message('a','assistant','Answer')])});await h.remount();
  assert.equal(h.get('#li-export-format').value,'pdf');assert.equal(h.get('#li-export-pdf-role').value,'prompts');assert.equal(pdf.collects.length,0);assert.equal(pdf.prints.length,0);
  h.format('md');await h.remount();assert.equal(h.sent.filter(item=>item.data.type==='request').length,1);assert.match(h.get('.li-export-dialogue').textContent,/Answer/);assert.doesNotMatch(h.get('.li-export-dialogue').textContent,/Question/);
});

test('navigation during an automatic preview discards the response and makes no file',async t=>{
  const h=harness();t.after(h.close);h.get('.li-export-toggle').click();await h.remount();const request=h.sent.find(item=>item.data.type==='request').data;
  h.w.history.pushState({},'','/');h.w.dispatchEvent(new h.w.PopStateEvent('popstate'));
  h.reply(request,{ok:true,payload:apiPage([message('a','assistant','Late result')])});await h.settle();
  assert.equal(h.get('.li-export'),null);assert.equal(h.downloads.length,0);assert.equal(h.copied.length,0);assert.ok(h.sent.some(item=>item.data.type==='cancel'));
});

test('reply PDF action stays hidden during composer or message streaming and returns on the same node',async t=>{
  const page=MODERN_PAGE+'<div data-chatgpt-composer><button id="stop" aria-label="Stop generating">Stop</button></div>';
  const h=harness(null,'/c/'+ID,{},page);t.after(h.close);const action=h.get('.li-export-reply');
  assert.equal(action.hidden,true);assert.equal(action.textContent,'');assert.equal(action.querySelector('svg').getAttribute('width'),'20');
  action.click();assert.equal(h.get('.li-export-panel').hidden,true);
  h.get('#stop').remove();await h.remount();assert.equal(h.get('.li-export-reply'),action);assert.equal(action.hidden,false);
  h.get('#modern-reply').setAttribute('data-is-streaming','true');await h.remount();assert.equal(action.hidden,true);
  h.get('#modern-reply').removeAttribute('data-is-streaming');await h.remount();assert.equal(action.hidden,false);assert.equal(h.w.document.querySelectorAll('.li-export-reply').length,1);
});

test('role-only hydration mounts PDF actions and removing the assistant role removes them',async t=>{
  const page='<header id="conversation-header-actions"></header><main><article id="late">A late message</article><div id="new-late">Another late message</div></main>';
  const h=harness(null,'/c/'+ID,{},page);t.after(h.close);assert.equal(h.get('.li-export-reply'),null);
  h.get('#late').setAttribute('data-message-author-role','assistant');h.get('#new-late').setAttribute('data-chatgpt-search-unit-key','hydrated:assistant');await h.remount();
  assert.equal(h.w.document.querySelectorAll('.li-export-reply').length,2);
  h.get('#late').setAttribute('data-message-author-role','user');h.get('#new-late').setAttribute('data-chatgpt-search-unit-key','hydrated:user');await h.remount();assert.equal(h.get('.li-export-reply'),null);
});

test('a detached native reply toolbar is replaced without losing or duplicating its PDF action',async t=>{
  const h=harness(null,'/c/'+ID,{},MODERN_PAGE);t.after(h.close);const original=h.get('.li-export-reply');
  const toolbar=h.get('#native-reply-actions'),next=h.w.document.createElement('div');next.id='next-reply-actions';next.className='turn-action-controls';next.innerHTML='<button aria-label="Copy">Copy</button>';toolbar.replaceWith(next);await h.remount();
  assert.equal(h.get('.li-export-reply'),original);assert.equal(original.parentElement,next);assert.equal(h.w.document.querySelectorAll('.li-export-reply').length,1);
});

test('removing only injected controls restores their original nodes without duplicates',async t=>{
  const h=harness(null,'/c/'+ID,{},MODERN_PAGE);t.after(h.close);
  const root=h.get('.li-export'),action=h.get('.li-export-reply');
  root.remove();action.remove();await h.remount();
  assert.equal(h.get('#active-actions > .li-export'),root);assert.equal(h.get('#native-reply-actions > .li-export-reply'),action);
  await h.remount();assert.equal(h.w.document.querySelectorAll('.li-export').length,1);assert.equal(h.w.document.querySelectorAll('.li-export-reply').length,1);
  h.w.history.pushState({},'','/');h.w.dispatchEvent(new h.w.PopStateEvent('popstate'));await h.remount();
  assert.equal(h.get('.li-export'),null);assert.equal(h.get('.li-export-reply'),null);
});

test('returning to a cloned conversation replaces inert export controls and tracks reply streaming',async t=>{
  const h=harness(null,'/c/'+ID,{},MODERN_PAGE);t.after(h.close);const pdf=installPDF(h);
  const originalRoot=h.get('.li-export'),oldAction=h.get('.li-export-reply'),cached=h.get('main').cloneNode(true);
  const other=h.w.document.createElement('main');other.textContent='Another conversation';h.get('main').replaceWith(other);
  h.w.history.pushState({},'','/c/11234567-89ab-4cde-8f01-23456789abcd');h.w.dispatchEvent(new h.w.PopStateEvent('popstate'));
  other.replaceWith(cached);h.w.history.pushState({},'','/c/'+ID);h.w.dispatchEvent(new h.w.PopStateEvent('popstate'));await h.remount();
  assert.equal(h.w.document.querySelectorAll('.li-export').length,1);assert.equal(h.get('.li-export'),originalRoot);
  assert.equal(h.w.document.querySelectorAll('.li-export-reply').length,1);assert.notEqual(h.get('.li-export-reply'),oldAction);
  const reply=h.get('#modern-reply'),action=h.get('.li-export-reply');reply.setAttribute('data-is-streaming','true');await h.remount();assert.equal(action.hidden,true);
  reply.removeAttribute('data-is-streaming');await h.remount();assert.equal(action.hidden,false);
  action.click();h.get('.li-export-inspect').click();await h.settle();assert.equal(pdf.collects.length,1);assert.equal(pdf.collects[0].replyElement,reply);assert.equal(h.get('.li-export-panel').hidden,false);
});

test('copies of injected controls are removed without replacing the open dialog or its selection',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('q','user','Question'),message('a','assistant','Answer')])}),'/c/'+ID,{},MODERN_PAGE);t.after(h.close);
  h.get('.li-export-toggle').click();h.get('.li-export-choose-messages').click();await h.settle();h.get('.li-export-select-none').click();choose(h,'a');
  const root=h.get('.li-export'),panel=h.get('.li-export-panel'),action=h.get('.li-export-reply');
  root.after(root.cloneNode(true));action.after(action.cloneNode(true));await h.remount();
  assert.equal(h.w.document.querySelectorAll('.li-export').length,1);assert.equal(h.w.document.querySelectorAll('.li-export-reply').length,1);
  assert.equal(h.get('.li-export'),root);assert.equal(h.get('.li-export-panel'),panel);assert.equal(h.get('.li-export-reply'),action);assert.equal(panel.hidden,false);
  assert.equal(h.get('.li-export-message-choice input[data-message-key="a"]').checked,true);assert.equal(h.get('.li-export-selection-count').textContent,'1 / 2');
  h.get('.li-export-save').click();await h.settle();assert.equal(h.sent.filter(item=>item.data.type==='request').length,1);assert.match(await h.text(h.blobs[0]),/Answer/);assert.doesNotMatch(await h.text(h.blobs[0]),/Question/);
  await h.remount();assert.equal(h.w.document.querySelectorAll('.li-export').length,1);assert.equal(h.w.document.querySelectorAll('.li-export-reply').length,1);
});

test('new message content and identity mutations invalidate the API snapshot without scraping its displayed text',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('a','assistant','Server answer')])}),'/c/'+ID,{},MODERN_PAGE);t.after(h.close);
  h.get('.li-export-inspect').click();await h.settle();assert.equal(h.sent.filter(item=>item.data.type==='request').length,1);
  h.get('#modern-prose').firstChild.data+=' changed';await h.settle();assert.match(h.get('.li-export-status').textContent,/conversation has changed/);
  h.get('.li-export-save').click();await h.settle();assert.equal(h.sent.filter(item=>item.data.type==='request').length,2);assert.doesNotMatch(await h.text(h.blobs.at(-1)),/Modern DOM answer/);
  h.get('[data-chatgpt-selection-message-id]').setAttribute('data-chatgpt-selection-message-id','regenerated-answer');await h.settle();assert.match(h.get('.li-export-status').textContent,/conversation has changed/);
});

test('visual class and style changes keep the API snapshot and explicit message selection',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('q','user','Server prompt'),message('a','assistant','Server answer')])}),'/c/'+ID,{},MODERN_PAGE);t.after(h.close);
  h.get('.li-export-toggle').click();h.get('.li-export-choose-messages').click();await h.settle();h.get('.li-export-select-none').click();choose(h,'a');
  h.get('#modern-prose').style.opacity='.95';h.get('#modern-prose').classList.add('hovered');h.get('#modern-reply').style.color='red';await h.remount();
  assert.equal(h.get('.li-export-status').dataset.state,'success');assert.equal(h.get('.li-export-status').textContent,'');assert.equal(h.get('.li-export-selection-count').textContent,'1 / 2');assert.equal(h.get('.li-export-preview-heading > span').textContent,'1 message selected');
  h.get('.li-export-save').click();await h.settle();assert.equal(h.sent.filter(item=>item.data.type==='request').length,1);
  const file=await h.text(h.blobs[0]);assert.match(file,/Server answer/);assert.doesNotMatch(file,/Server prompt/);
});

test('styles that hide a message still invalidate the API snapshot',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('a','assistant','Server answer')])}),'/c/'+ID,{},MODERN_PAGE);t.after(h.close);
  h.get('.li-export-inspect').click();await h.settle();h.get('#modern-reply').style.display='none';await h.settle();
  assert.equal(h.get('.li-export-status').dataset.state,'stale');h.get('.li-export-save').click();await h.settle();assert.equal(h.sent.filter(item=>item.data.type==='request').length,2);
});

test('a legacy streaming class transition still invalidates the API snapshot',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('a','assistant','Server answer')])}));t.after(h.close);
  h.get('main article').classList.add('result-streaming');await h.remount();h.get('.li-export-inspect').click();await h.settle();
  h.get('main article').classList.remove('result-streaming');await h.settle();assert.equal(h.get('.li-export-status').dataset.state,'stale');
});

test('the fallback stays accessible when its former header becomes hidden',async t=>{
  const h=harness();t.after(h.close);h.get('#page-header').hidden=true;await h.remount();
  assert.equal(h.get('.li-export').parentElement,h.w.document.body);assert.equal(h.get('.li-export').classList.contains('li-export-fallback'),true);
});

test('PDF print visibility keeps the export controls, dialog and message selection in place',async t=>{
  const h=harness(null,'/c/'+ID,{},MODERN_PAGE);t.after(h.close);const pdf=installPDF(h);
  h.get('.li-export-toggle').click();h.format('pdf');h.get('.li-export-choose-messages').click();await h.settle();
  h.get('.li-export-select-none').click();choose(h,'a2');await h.settle();
  const root=h.get('.li-export'),parent=root.parentElement,action=h.get('.li-export-reply'),panel=h.get('.li-export-panel');
  const style=h.w.document.createElement('style');style.textContent='body.li-pdf-printing > :not(.li-pdf-active) { display:none !important; }';h.w.document.head.append(style);
  h.w.document.body.classList.add('li-pdf-printing');await h.remount();
  assert.equal(h.w.LatexIslandsChatGPT.getMessages().length,0);
  assert.equal(root.parentElement,parent);assert.equal(h.get('.li-export-reply'),action);assert.equal(action.isConnected,true);
  assert.equal(panel.hidden,false);assert.equal(h.get('.li-export-message-choice input[data-message-key="a2"]').checked,true);assert.equal(pdf.captures[0].disposed,false);
  h.w.document.body.classList.remove('li-pdf-printing');await h.remount();
  assert.equal(root.parentElement,parent);assert.equal(h.get('.li-export-reply'),action);assert.equal(panel.hidden,false);assert.equal(pdf.collects.length,1);
  assert.equal(h.get('.li-export-selection-count').textContent,'1 / 4');
});

test('navigation during PDF printing is cleaned up when print visibility ends',async t=>{
  const h=harness();t.after(h.close);const pdf=installPDF(h);
  h.get('.li-export-toggle').click();h.format('pdf');h.get('.li-export-inspect').click();await h.settle();
  const root=h.get('.li-export'),panel=h.get('.li-export-panel');
  h.w.document.body.classList.add('li-pdf-printing');h.w.history.pushState({},'','/');h.w.dispatchEvent(new h.w.PopStateEvent('popstate'));await h.remount();
  assert.equal(root.isConnected,true);assert.equal(panel.hidden,false);assert.equal(pdf.captures[0].disposed,false);
  h.w.document.body.classList.remove('li-pdf-printing');await h.remount();
  assert.equal(root.isConnected,false);assert.equal(panel.hidden,true);assert.equal(pdf.captures[0].disposed,true);assert.equal(h.get('.li-export-reply'),null);
});

test('JSON ignores transcript filters and downloads the complete API archive after all pages finish',async t=>{
  const h=harness(async(request,count)=>({ok:true,payload:count===1?apiPage([message('answer','assistant','API answer',{unknown:'kept'})],true,{title:'API title',conversation_id:ID}):apiPage([message('question','user','API question')])}));t.after(h.close);
  h.change('#li-export-preset','answers');h.format('json');assert.equal(h.get('.li-export-transcript').hidden,true);h.get('.li-export-save').click();assert.equal(h.downloads.length,0);await h.settle();
  assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].name,'API title.json');const data=JSON.parse(await h.text(h.blobs[0]));
  assert.equal(data.raw_pages.length,2);assert.deepEqual(data.messages.map(m=>m.id),['question','answer']);assert.equal(data.messages[1].unknown,'kept');assert.ok(!JSON.stringify(data).includes('DOM message'));assert.equal(h.sent.at(-1).data.type,'release');
});

test('Markdown defaults to a transcript, previews safely, and reuses its snapshot for copy and download',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('q','user','Une question'),message('a','assistant','Une réponse **en gras** avec <script>fake()</script>',{channel:'final',metadata:{private_field:'metadata-only'}})],false,{title:'Transcript'})}));t.after(h.close);
  h.get('.li-export-toggle').click();h.get('.li-export-inspect').click();await h.settle();
  assert.equal(h.downloads.length,0);assert.equal(h.get('.li-export-preview').hidden,false);const preview=h.get('.li-export-preview pre');assert.match(preview.textContent,/Une réponse/);assert.equal(preview.querySelector('script'),null);assert.ok(!preview.textContent.includes('metadata-only'));
  h.get('.li-export-copy').click();await h.settle();assert.equal(h.copied.length,1);assert.match(h.copied[0],/Une question/);assert.ok(!h.copied[0].includes('"author"'));
  h.get('.li-export-save').click();await h.settle();assert.equal(h.downloads[0].name,'Transcript.md');assert.equal(await h.text(h.blobs[0]),h.copied[0]);assert.equal(h.sent.filter(x=>x.data.type==='request').length,1);
});

test('export actions show only their own spinner through pagination and finish without status text',async t=>{
  for(const [selector,label] of [['.li-export-inspect','Preview'],['.li-export-copy','Copy'],['.li-export-save','Download']]){
    const h=harness();t.after(h.close);h.get('.li-export-toggle').click();
    const active=h.get(selector),status=h.get('.li-export-status');status.textContent='Previous error';
    active.click();
    assert.equal(status.textContent,'');assert.equal(active.getAttribute('aria-label'),label);
    assert.equal(active.getAttribute('aria-busy'),'true');assert.equal(active.querySelector('.li-export-button-spinner').hidden,false);
    assert.equal(h.w.document.querySelectorAll('.li-export-actions button[aria-busy="true"]').length,1);
    assert.equal(h.get('.li-export-cancel').hidden,false);
    const first=h.sent.find(x=>x.data.type==='request').data;
    h.reply(first,{ok:true,payload:apiPage([message('a','assistant','Answer')],true)});await h.settle();
    assert.equal(active.getAttribute('aria-busy'),'true');assert.equal(status.textContent,'');
    const second=h.sent.filter(x=>x.data.type==='request').at(-1).data;
    h.reply(second,{ok:true,payload:apiPage([message('q','user','Question')])});await h.settle();
    assert.equal(status.textContent,'');assert.equal(status.dataset.state,'success');
    assert.equal(active.getAttribute('aria-busy'),'false');assert.equal(active.querySelector('.li-export-button-spinner').hidden,true);
    assert.equal(active.disabled,false);assert.equal(h.get('.li-export-cancel').hidden,true);
  }
});

test('answers-only text export and saved preferences honor the chosen options without saving the conversation',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('q','user','Question unique'),message('a','assistant','Réponse finale',{channel:'final'})],false,{title:'Sans question'})}));t.after(h.close);
  h.format('txt');h.change('#li-export-preset','answers');h.change('#li-export-timestamps',true);h.get('.li-export-save').click();await h.settle();
  assert.equal(h.downloads[0].name,'Sans question.txt');const output=await h.text(h.blobs[0]);assert.match(output,/Réponse finale/);assert.ok(!output.includes('Question unique'));
  assert.equal(h.stored.at(-1).exportPreferences.format,'txt');assert.equal(h.stored.at(-1).exportPreferences.includeUser,false);assert.ok(!JSON.stringify(h.stored).includes('Réponse finale'));
});

test('changing options updates the preview without another request and changed messages cause a fresh fetch',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('q','user','Question visible'),message('a','assistant','Réponse visible',{channel:'final'})])}));t.after(h.close);
  h.get('.li-export-inspect').click();await h.settle();h.change('#li-export-preset','answers');assert.ok(!h.get('.li-export-preview pre').textContent.includes('Question visible'));assert.equal(h.sent.filter(x=>x.data.type==='request').length,1);
  h.get('main article').firstChild.data+=' New response token';await h.settle();assert.match(h.get('.li-export-status').textContent,/conversation has changed/);h.get('.li-export-save').click();await h.settle();assert.equal(h.sent.filter(x=>x.data.type==='request').length,2);
});

test('a failed later page gives an error without a partial archive',async t=>{
  const h=harness(async(request,count)=>count===1?{ok:true,payload:apiPage([],true)}:{ok:false,error:'HTTP 429 synthetic refusal',status:429});t.after(h.close);
  h.get('.li-export-save').click();await h.settle();assert.equal(h.downloads.length,0);assert.equal(h.get('.li-export-status').dataset.state,'error');assert.match(h.get('.li-export-status').textContent,/429/);assert.equal(h.get('.li-export-save').disabled,false);
  assert.equal(h.get('.li-export-save').getAttribute('aria-busy'),'false');assert.equal(h.get('.li-export-save .li-export-button-spinner').hidden,true);
});

test('responses from another origin or window cannot satisfy an export request',async t=>{
  const h=harness();t.after(h.close);h.format('json');h.get('.li-export-save').click();const request=h.sent.find(item=>item.data.type==='request').data;
  h.reply(request,{ok:true,payload:apiPage()},{origin:'https://attacker.example'});h.reply(request,{ok:true,payload:apiPage()},{source:null});await h.settle();assert.equal(h.downloads.length,0);
  h.reply(request,{ok:true,payload:apiPage()});await h.settle();assert.equal(h.downloads.length,1);
});

test('cancel and navigation discard in-flight exports without downloading',async t=>{
  for(const mode of ['cancel','navigate']){const h=harness();t.after(h.close);h.get('.li-export-save').click();const request=h.sent.find(item=>item.data.type==='request').data;
    if(mode==='cancel')h.get('.li-export-cancel').click();else{h.w.history.pushState({},'','/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');h.reply(request,{ok:true,payload:apiPage()});}
    await h.settle();assert.equal(h.downloads.length,0);assert.equal(h.get('.li-export-status').dataset.state,'error');assert.match(h.get('.li-export-status').textContent,/cancelled/);
    assert.equal(h.get('.li-export-save').getAttribute('aria-busy'),'false');assert.equal(h.get('.li-export-save .li-export-button-spinner').hidden,true);
  }
});

test('export absent on new chats/shared links; options restored without fetching data',async t=>{
  for(const pathname of ['/','/share/'+ID]){const h=harness(null,pathname);t.after(h.close);assert.equal(h.get('.li-export'),null);assert.equal(h.sent.length,0);}
  const h=harness(null,'/c/'+ID,{exportPreferences:{format:'txt',timestamps:true,includeUser:false}});t.after(h.close);await h.settle();assert.equal(h.get('#li-export-format').value,'txt');assert.equal(h.get('#li-export-timestamps').checked,true);assert.equal(h.get('#li-export-preset').value,'answers');assert.equal(h.sent.length,0);
});

test('clipboard failure exposes an actionable preview without an automatic download',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('a','assistant','Copie manuelle')])}));t.after(h.close);h.w.navigator.clipboard.writeText=async()=>{throw new Error('denied');};
  h.get('.li-export-copy').click();await h.settle();assert.equal(h.get('.li-export-preview').hidden,false);assert.equal(h.get('.li-export-status').dataset.state,'error');assert.match(h.get('.li-export-status').textContent,/Copy unavailable/);assert.equal(h.downloads.length,0);
});

test('dialogue preview is paged, inert and configurable independently of the file view',async t=>{
  const content='Une formule \\(x^2\\).\n\n```html\n<img src="https://tracking.invalid/x" onerror="fake()">\n```\n\nSuite';
  const messages=Array.from({length:25},(_,i)=>message('m'+i,i%2?'assistant':'user',content));
  const h=harness(async()=>({ok:true,payload:apiPage(messages)}));t.after(h.close);
  h.get('.li-export-toggle').click();h.get('.li-export-inspect').click();await h.settle();
  assert.equal(h.get('.li-export-dialogue').hidden,false);assert.equal(h.w.document.querySelectorAll('.li-export-message').length,20);assert.equal(h.get('.li-export-more').hidden,false);
  assert.equal(h.get('.li-export-dialogue img'),null);assert.match(h.get('.li-preview-code pre').textContent,/<img/);assert.match(h.get('.li-export-dialogue').textContent,/Suite/);
  h.get('.li-export-more').click();assert.equal(h.w.document.querySelectorAll('.li-export-message').length,25);assert.equal(h.get('.li-export-more').hidden,true);
  h.change('#li-export-preset','answers');assert.equal(h.get('#li-export-preset').value,'answers');assert.equal(h.w.document.querySelectorAll('.li-export-message').length,12);
  h.change('#li-export-includeTools',true);assert.equal(h.get('#li-export-preset').value,'answers');
  h.get('.li-export-file-mode').click();assert.equal(h.get('.li-export-preview > pre').hidden,false);assert.equal(h.get('.li-export-dialogue').hidden,true);
  h.format('json');assert.equal(h.get('.li-export-dialogue-mode').disabled,true);assert.match(h.get('.li-export-preview > pre').textContent,/"messages"/);assert.equal(h.sent.filter(x=>x.data.type==='request').length,1);
});

test('closing the modal cancels an in-flight operation and restores focus',async t=>{
  const h=harness();t.after(h.close);h.get('.li-export-toggle').focus();h.get('.li-export-toggle').click();
  h.get('.li-export-save').click();const request=h.sent.find(x=>x.data.type==='request').data;
  const close=h.get('.li-export-close');assert.equal(close.getAttribute('aria-label'),'Close export options');assert.equal(close.textContent,'');
  const icon=close.querySelector('svg');assert.equal(icon.getAttribute('viewBox'),'0 0 24 24');assert.equal(icon.getAttribute('aria-hidden'),'true');
  icon.querySelector('path').dispatchEvent(new h.w.MouseEvent('click',{bubbles:true}));h.reply(request,{ok:true,payload:apiPage()});await h.settle();
  assert.equal(h.downloads.length,0);assert.equal(h.get('.li-export-panel').hidden,true);assert.equal(h.w.document.activeElement,h.get('.li-export-toggle'));assert.ok(h.sent.some(x=>x.data.type==='cancel'));
});

test('custom format listbox supports arrows, typeahead, selection and Escape without dismissing the dialog',async t=>{
  const h=harness();t.after(h.close);h.get('.li-export-toggle').click();
  const trigger=h.get('#li-export-format-trigger'),menu=h.get('#li-export-format-menu');
  const key=value=>trigger.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
  assert.equal(trigger.getAttribute('role'),'combobox');assert.equal(trigger.getAttribute('aria-haspopup'),'listbox');
  assert.equal(h.get('#li-export-format').hidden,true);assert.equal(h.w.document.activeElement,trigger);
  key('ArrowDown');assert.equal(menu.hidden,false);assert.equal(trigger.getAttribute('aria-expanded'),'true');
  assert.equal(h.get('#li-export-format-option-0').getAttribute('aria-selected'),'true');
  key('End');assert.equal(trigger.getAttribute('aria-activedescendant'),'li-export-format-option-3');
  key('Escape');assert.equal(menu.hidden,true);assert.equal(h.get('.li-export-panel').hidden,false);assert.equal(h.get('#li-export-format').value,'md');
  key('p');assert.equal(trigger.getAttribute('aria-activedescendant'),'li-export-format-option-1');key('Enter');
  assert.equal(h.get('#li-export-format').value,'txt');assert.equal(trigger.querySelector('.li-export-select-value').textContent,'Plain text (.txt)');
  assert.equal(h.stored.at(-1).exportPreferences.format,'txt');assert.equal(menu.hidden,true);assert.equal(h.w.document.activeElement,trigger);
  key('Home');key('ArrowDown');key('ArrowDown');key(' ');
  assert.equal(h.get('#li-export-format').value,'json');assert.equal(h.get('.li-export-transcript').hidden,true);assert.equal(h.sent.length,0);
});

test('custom selects restore preferences, keep only one listbox open and disable during fetch',async t=>{
  const h=harness(null,'/c/'+ID,{exportPreferences:{format:'txt',includeUser:false}});t.after(h.close);await h.settle();h.get('.li-export-toggle').click();
  const format=h.get('#li-export-format-trigger'),preset=h.get('#li-export-preset-trigger');
  assert.equal(format.querySelector('.li-export-select-value').textContent,'Plain text (.txt)');assert.equal(preset.querySelector('.li-export-select-value').textContent,'Answers only');
  format.click();preset.click();assert.equal(h.get('#li-export-format-menu').hidden,true);assert.equal(h.get('#li-export-preset-menu').hidden,false);
  h.get('#li-export-preset-option-0').click();assert.equal(h.get('#li-export-preset').value,'conversation');assert.equal(h.get('#li-export-includeUser'),null);assert.equal(h.get('#li-export-includeTools').checked,false);
  format.click();h.get('.li-export-save').dispatchEvent(new h.w.MouseEvent('pointerdown',{bubbles:true}));assert.equal(h.get('#li-export-format-menu').hidden,true);
  h.get('.li-export-save').click();assert.equal(format.disabled,true);assert.equal(preset.disabled,true);
  h.get('.li-export-cancel').click();await h.settle();assert.equal(format.disabled,false);assert.equal(preset.disabled,false);
});

test('advanced switches keep checkbox semantics and persist independently of the role filter',async t=>{
  const h=harness();t.after(h.close);h.get('.li-export-toggle').click();
  const input=h.get('#li-export-includeAttachments');assert.equal(input.type,'checkbox');assert.equal(input.getAttribute('role'),'switch');assert.match(input.labels[0].textContent,/Include attachment references/);
  input.click();assert.equal(input.checked,false);assert.equal(h.get('#li-export-preset').value,'conversation');
  assert.equal(h.get('#li-export-preset-trigger .li-export-select-value').textContent,'Conversation');assert.equal(h.stored.at(-1).exportPreferences.includeAttachments,false);
  h.get('#li-export-includeTools').click();assert.equal(h.get('#li-export-preset-trigger .li-export-select-value').textContent,'Conversation');
  assert.equal(h.sent.length,0);
});

test('role filters preserve all advanced switches and migrate legacy Detailed and Custom settings',async t=>{
  for(const [saved,role]of [[{includeUser:true,includeProgress:true,includeTools:true},'conversation'],[{includeUser:false,roleMode:'conversation',includeProgress:true,includeTools:true},'answers'],[{includeUser:true,roleMode:'prompts',timestamps:true},'prompts']]){
    const h=harness(null,'/c/'+ID,{exportPreferences:saved});t.after(h.close);await h.settle();
    assert.deepEqual([...h.get('#li-export-preset').options].map(option=>option.value),['conversation','answers','prompts']);assert.equal(h.get('#li-export-preset').value,role);assert.equal(h.get('#li-export-pdf-role').value,role);assert.equal(h.get('#li-export-includeUser'),null);
    const before=[...h.w.document.querySelectorAll('.li-export-options input')].map(input=>[input.id,input.checked]);
    h.change('#li-export-preset',role==='answers'?'conversation':'answers');
    assert.deepEqual([...h.w.document.querySelectorAll('.li-export-options input')].map(input=>[input.id,input.checked]),before);
    assert.equal(h.get('#li-export-includeProgress').checked,!!saved.includeProgress);assert.equal(h.get('#li-export-includeTools').checked,!!saved.includeTools);assert.equal(h.stored.at(-1).exportPreferences.includeUser,role==='answers');
  }
});

test('header tooltip replaces native title and closes when the export dialog opens',async t=>{
  const h=harness();t.after(h.close);const toggle=h.get('.li-export-toggle'),tooltip=h.get('.li-export-tooltip');
  assert.equal(toggle.hasAttribute('title'),false);assert.equal(toggle.getAttribute('aria-label'),'Export conversation');assert.equal(toggle.getAttribute('aria-describedby'),tooltip.id);assert.equal(tooltip.getAttribute('role'),'tooltip');
  toggle.dispatchEvent(new h.w.Event('pointerenter'));await new Promise(resolve=>setTimeout(resolve,330));assert.equal(tooltip.hidden,false);
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(tooltip.hidden,true);
  toggle.dispatchEvent(new h.w.Event('pointerleave'));assert.equal(tooltip.hidden,true);
  toggle.focus();toggle.click();await new Promise(resolve=>setTimeout(resolve,330));assert.equal(tooltip.hidden,true);assert.equal(h.get('.li-export-panel').hidden,false);
});

test('a focused tooltip survives scroll after focus and hides if its reply starts streaming',async t=>{
  const h=harness(null,'/c/'+ID,{},MODERN_PAGE);t.after(h.close);const toggle=h.get('.li-export-toggle'),tooltip=h.get('.li-export-tooltip');
  toggle.focus();h.w.document.dispatchEvent(new h.w.Event('scroll'));await new Promise(resolve=>setTimeout(resolve,330));assert.equal(tooltip.hidden,false);assert.equal(tooltip.textContent,'Export conversation');
  toggle.blur();h.get('.li-export-reply').focus();h.w.dispatchEvent(new h.w.Event('resize'));await new Promise(resolve=>setTimeout(resolve,330));assert.equal(tooltip.hidden,false);assert.equal(tooltip.textContent,'Export reply as PDF');
  h.get('#modern-reply').setAttribute('data-is-streaming','true');await h.remount();assert.equal(tooltip.hidden,true);assert.equal(h.get('.li-export-reply').hidden,true);
});

test('PDF Preview mounts rich content and only Save PDF invokes printing without API access',async t=>{
  const h=harness();t.after(h.close);const pdf=installPDF(h);
  h.get('.li-export-toggle').click();h.format('pdf');
  assert.equal(h.get('.li-export-copy').hidden,true);
  assert.equal(h.get('.li-export-transcript').hidden,true);
  assert.equal(h.get('.li-export-save').getAttribute('aria-label'),'Save PDF');
  assert.equal(h.get('.li-export-inspect').getAttribute('aria-label'),'Preview');
  assert.match(h.get('.li-export-pdf-note').textContent,/scrolls.*full conversation/);
  assert.equal(h.get('#li-export-pdf-include-user').parentElement.hidden,true);
  assert.equal(h.get('#li-export-pdf-role').closest('.li-export-field').hidden,false);
  h.get('.li-export-inspect').click();await h.settle();
  assert.equal(pdf.collects.length,1);assert.equal(pdf.collects[0].replyElement,null);assert.equal(pdf.collects[0].includePrecedingPrompt,true);
  assert.equal(pdf.prepares[0].capture,pdf.captures[0]);assert.equal(pdf.prepares[0].selectedKeys,null);
  assert.equal(pdf.prints.length,0);assert.match(h.get('.li-export-pdf-preview strong').textContent,/First prompt/);
  assert.equal(h.get('.li-export-pdf-preview').hidden,false);
  h.change('#li-export-pdf-role','answers');await h.settle();assert.equal(pdf.prepares.at(-1).roleMode,'answers');
  assert.deepEqual(pdf.mounts.at(-1),['a1','a2']);
  h.get('.li-export-save').click();await h.settle();assert.deepEqual(pdf.prints,[['a1','a2']]);assert.equal(pdf.collects.length,1);
  assert.equal(h.sent.length,0);assert.equal(h.downloads.length,0);assert.equal(h.copied.length,0);
  assert.equal(h.get('.li-export-status').dataset.state,'success');
  h.get('.li-export-close').click();assert.equal(pdf.captures[0].disposed,true);
  h.get('.li-export-toggle').click();h.format('md');assert.equal(h.get('.li-export-copy').hidden,false);assert.equal(h.get('.li-export-save').getAttribute('aria-label'),'Download');
});

test('PDF preview documents sharing the export styling class survive delayed control cleanup',async t=>{
  const h=harness();t.after(h.close);const pdf=installPDF(h);
  h.get('.li-export-toggle').click();h.format('pdf');h.get('.li-export-inspect').click();await h.settle();
  const prepared=pdf.documents.at(-1),preview=prepared.root;assert.equal(preview.classList.contains('li-export'),true);
  await h.remount();await h.remount();
  assert.equal(preview.isConnected,true);assert.equal(preview.parentElement,h.get('.li-export-pdf-preview'));assert.equal(prepared.disposed,false);
  assert.equal(preview.querySelectorAll('p').length,4);assert.equal(h.get('.li-export-panel').hidden,false);assert.equal(pdf.prepares.length,1);
});

test('each reply has one PDF action which exports that reply and restores conversation scope on header open',async t=>{
  const h=harness();t.after(h.close);const pdf=installPDF(h);
  const reply=h.get('main article'),action=h.get('.li-export-reply');assert.ok(action);assert.equal(action.getAttribute('aria-label'),'Export this reply as PDF');
  action.click();assert.equal(h.get('#li-export-format').value,'pdf');assert.equal(h.get('#li-export-format').disabled,true);assert.equal(h.get('#li-export-title').textContent,'Export reply');
  assert.equal(h.get('#li-export-pdf-include-user').parentElement.hidden,false);assert.equal(h.get('#li-export-pdf-include-user').checked,false);
  assert.match(h.get('#li-export-pdf-include-user').parentElement.textContent,/Include prompt/);
  assert.equal(h.get('#li-export-pdf-role').closest('.li-export-field').hidden,true);
  h.get('.li-export-inspect').click();await h.settle();assert.equal(pdf.collects[0].replyElement,reply);assert.equal(pdf.collects[0].includePrecedingPrompt,true);assert.equal(h.sent.length,0);
  assert.deepEqual(Array.from(pdf.prepares[0].selectedKeys),['a1']);assert.deepEqual(pdf.mounts[0],['a1']);assert.equal(pdf.prints.length,0);
  h.change('#li-export-pdf-include-user',true);await h.settle();assert.deepEqual(pdf.mounts.at(-1),['q1','a1']);assert.equal(pdf.collects.length,1);
  h.get('.li-export-close').click();h.get('.li-export-toggle').click();assert.equal(h.get('#li-export-title').textContent,'Export conversation');assert.equal(h.get('#li-export-format').disabled,false);
  h.get('.li-export-save').click();await h.settle();assert.equal(pdf.collects[1].replyElement,null);assert.equal(pdf.captures[0].disposed,true);
  assert.equal(h.w.document.querySelectorAll('.li-export-reply').length,1);
});

test('PDF cancellation, navigation and missing assets never start printing',async t=>{
  for(const mode of ['cancel','navigate','assets']){
    const h=harness();t.after(h.close);const pdf=installPDF(h);let resolve;
    h.w.LatexIslandsPDF.collect=({signal})=>new Promise((done,reject)=>{resolve=()=>done({messages:pdfMessages,dispose(){}});signal.addEventListener('abort',()=>reject(new Error('Export cancelled.')),{once:true});if(mode==='assets')reject(new Error('Render the diagram before exporting.'));});
    h.format('pdf');h.get('.li-export-save').click();
    if(mode==='cancel')h.get('.li-export-cancel').click();
    if(mode==='navigate'){h.w.history.pushState({},'','/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');resolve();}
    await h.settle();assert.equal(pdf.prints.length,0);assert.equal(pdf.prepares.length,0);assert.equal(h.get('.li-export-status').dataset.state,'error');assert.equal(h.get('.li-export-save').disabled,false);assert.equal(h.sent.length,0);
  }
});

test('saved PDF preferences restore without network activity',async t=>{
  const h=harness(null,'/c/'+ID,{exportPreferences:{format:'pdf',includeUser:false}});t.after(h.close);await h.settle();
  assert.equal(h.get('#li-export-format').value,'pdf');assert.equal(h.get('#li-export-pdf-role').value,'answers');assert.equal(h.get('#li-export-pdf-include-user').checked,false);assert.equal(h.get('.li-export-copy').hidden,true);assert.equal(h.sent.length,0);
});

test('Markdown message picker supports none, one, arbitrary order, search and all without another request',async t=>{
  const messages=pdfMessages.map(entry=>message(entry.key,entry.role,entry.preview));
  const h=harness(async()=>({ok:true,payload:apiPage(messages)}));t.after(h.close);
  h.get('.li-export-toggle').click();h.get('.li-export-choose-messages').click();await h.settle();
  assert.deepEqual(choiceKeys(h),['q1','a1','q2','a2']);assert.equal(h.get('.li-export-selection').hidden,false);
  assert.equal(h.get('.li-export-selection-count').textContent,'4 / 4');
  h.get('.li-export-select-none').click();h.get('.li-export-save').click();await h.settle();
  assert.equal(h.downloads.length,0);assert.match(h.get('.li-export-status').textContent,/Select at least one/);
  choose(h,'a2');h.get('.li-export-save').click();await h.settle();
  const one=await h.text(h.blobs[0]);assert.match(one,/Second rich answer/);assert.doesNotMatch(one,/First prompt|First rich answer|Second prompt/);
  choose(h,'q1');h.get('.li-export-inspect').click();await h.settle();
  assert.deepEqual([...h.w.document.querySelectorAll('.li-export-message-body')].map(node=>node.textContent),['First prompt','Second rich answer']);
  h.get('.li-export-copy').click();await h.settle();assert.ok(h.copied[0].indexOf('First prompt')<h.copied[0].indexOf('Second rich answer'));
  h.get('.li-export-selection-mode').click();const search=h.get('.li-export-message-search');search.value='SECOND';search.dispatchEvent(new h.w.Event('input',{bubbles:true}));
  assert.deepEqual(choiceKeys(h),['q2','a2']);assert.equal(h.get('.li-export-selection-count').textContent,'2 / 4');
  h.get('.li-export-select-all').click();assert.equal(h.get('.li-export-selection-count').textContent,'4 / 4');
  h.get('.li-export-copy').click();await h.settle();for(const entry of pdfMessages)assert.ok(h.copied.at(-1).includes(entry.preview));
  assert.equal(h.sent.filter(item=>item.data.type==='request').length,1);
  assert.ok(!h.stored.some(value=>Object.hasOwn(value.exportPreferences,'selectedMessageIds')),'Message selections are session-only.');
});

test('prompts-only Markdown filters the picker, preview and downloaded text while JSON remains complete',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage(pdfMessages.map(entry=>message(entry.key,entry.role,entry.preview)))}));t.after(h.close);
  h.get('.li-export-toggle').click();h.change('#li-export-preset','prompts');h.get('.li-export-choose-messages').click();await h.settle();
  assert.deepEqual(choiceKeys(h),['q1','q2']);assert.equal(h.stored.at(-1).exportPreferences.includeUser,true);
  h.get('.li-export-select-none').click();choose(h,'q2');h.get('.li-export-inspect').click();await h.settle();
  assert.equal(h.w.document.querySelectorAll('.li-export-message').length,1);assert.match(h.get('.li-export-dialogue').textContent,/Second prompt/);assert.doesNotMatch(h.get('.li-export-dialogue').textContent,/rich answer|First prompt/);
  h.get('.li-export-save').click();await h.settle();assert.match(await h.text(h.blobs[0]),/Second prompt/);assert.doesNotMatch(await h.text(h.blobs[0]),/rich answer|First prompt/);
  h.format('json');assert.equal(h.get('.li-export-choose-messages').hidden,true);h.get('.li-export-save').click();await h.settle();
  assert.deepEqual(JSON.parse(await h.text(h.blobs[1])).messages.map(item=>item.id),['q1','a1','q2','a2']);
  assert.equal(h.sent.filter(item=>item.data.type==='request').length,1);
});

test('PDF picker preserves chronological arbitrary selection and role filters in rich preview and print',async t=>{
  const h=harness();t.after(h.close);const pdf=installPDF(h);
  h.get('.li-export-toggle').click();h.format('pdf');h.get('.li-export-choose-messages').click();await h.settle();
  assert.deepEqual(choiceKeys(h),['q1','a1','q2','a2']);assert.equal(pdf.prepares.length,0);assert.equal(pdf.prints.length,0);
  h.get('.li-export-select-none').click();h.get('.li-export-save').click();await h.settle();
  assert.equal(pdf.prints.length,0);assert.match(h.get('.li-export-status').textContent,/Select at least one/);
  h.get('.li-export-selection-mode').click();choose(h,'a2');h.get('.li-export-inspect').click();await h.settle();assert.deepEqual(pdf.mounts.at(-1),['a2']);
  h.get('.li-export-selection-mode').click();choose(h,'q1');h.get('.li-export-inspect').click();await h.settle();assert.deepEqual(pdf.mounts.at(-1),['q1','a2']);assert.equal(pdf.prints.length,0);
  h.change('#li-export-pdf-role','prompts');await h.settle();assert.deepEqual(pdf.mounts.at(-1),['q1']);assert.equal(pdf.prepares.at(-1).roleMode,'prompts');
  h.get('.li-export-save').click();await h.settle();assert.deepEqual(pdf.prints,[['q1']]);
  h.get('.li-export-selection-mode').click();assert.deepEqual(choiceKeys(h),['q1','q2']);h.get('.li-export-select-all').click();
  h.get('.li-export-inspect').click();await h.settle();assert.deepEqual(pdf.mounts.at(-1),['q1','q2']);assert.equal(pdf.prepares.at(-1).selectedKeys,null);
  assert.equal(pdf.collects.length,1);assert.equal(h.sent.length,0);assert.equal(h.downloads.length,0);
});

test('reload preserves explicit Markdown IDs without selecting new messages and refreshes the PDF capture',async t=>{
  const h=harness(async(_,count)=>({ok:true,payload:apiPage(count===2?[message('q2','user','New prompt'),message('a1','assistant','Updated answer'),message('a2','assistant','New answer')]:[message('q'+count,'user','Prompt '+count),message('a'+count,'assistant','Answer '+count)])}));t.after(h.close);
  h.get('.li-export-toggle').click();h.get('.li-export-choose-messages').click();await h.settle();h.get('.li-export-select-none').click();choose(h,'a1');
  h.get('.li-export-refresh').click();await h.settle();assert.deepEqual(choiceKeys(h),['q2','a1','a2']);assert.equal(h.get('.li-export-selection-count').textContent,'1 / 3');
  assert.equal(h.get('[data-message-key="a1"]').checked,true);assert.equal(h.get('[data-message-key="a2"]').checked,false);assert.equal(h.get('[data-message-key="q2"]').checked,false);
  h.get('.li-export-refresh').click();await h.settle();assert.deepEqual(choiceKeys(h),['q3','a3']);assert.equal(h.get('.li-export-selection-count').textContent,'0 / 2');
  h.get('.li-export-save').click();await h.settle();assert.equal(h.downloads.length,0);assert.match(h.get('.li-export-status').textContent,/Select at least one/);
  const pdf=installPDF(h);h.format('pdf');h.get('.li-export-choose-messages').click();await h.settle();h.get('.li-export-select-none').click();choose(h,'a2');
  h.get('.li-export-refresh').click();await h.settle();assert.equal(pdf.collects.length,2);assert.equal(pdf.captures[0].disposed,true);assert.equal(h.get('.li-export-selection-count').textContent,'4 / 4');
  assert.equal(pdf.prints.length,0);assert.equal(h.sent.filter(item=>item.data.type==='request').length,3);
  h.get('.li-export-close').click();assert.equal(pdf.captures[1].disposed,true);
});

test('cancelling PDF collection or preview preparation restores controls without mounting or printing late results',async t=>{
  for(const phase of ['collect','prepare']){
    const h=harness();t.after(h.close);const pdf=installPDF(h);let started=false;
    const original=h.w.LatexIslandsPDF[phase];
    h.w.LatexIslandsPDF[phase]=settings=>new Promise((resolve,reject)=>{started=true;settings.signal.addEventListener('abort',()=>reject(new h.w.DOMException('PDF export cancelled.','AbortError')),{once:true});});
    h.get('.li-export-toggle').click();h.format('pdf');h.get(phase==='collect'?'.li-export-choose-messages':'.li-export-inspect').click();await h.settle();assert.equal(started,true);
    assert.equal(h.get('.li-export-choose-messages').disabled,true);assert.equal(h.get('.li-export-cancel').hidden,false);
    h.get('.li-export-cancel').click();await h.settle();assert.equal(pdf.prints.length,0);assert.equal(pdf.mounts.length,0);assert.equal(h.get('.li-export-choose-messages').disabled,false);assert.match(h.get('.li-export-status').textContent,/cancelled/);
    h.w.LatexIslandsPDF[phase]=original;h.get('.li-export-inspect').click();await h.settle();assert.equal(pdf.prints.length,0);assert.equal(pdf.mounts.length,1);assert.equal(h.sent.length,0);
  }
});

test('a late PDF preparation cannot replace a newer role-filtered preview or a closed dialog',async t=>{
  for(const action of ['filter','close']){
    const h=harness();t.after(h.close);const pdf=installPDF(h);
    h.get('.li-export-toggle').click();h.format('pdf');h.get('.li-export-inspect').click();await h.settle();
    const original=h.w.LatexIslandsPDF.prepare;let finish;
    h.w.LatexIslandsPDF.prepare=settings=>{h.w.LatexIslandsPDF.prepare=original;return new Promise(resolve=>{finish=async()=>resolve(await original(settings));});};
    h.change('#li-export-pdf-role','answers');
    if(action==='filter'){h.change('#li-export-pdf-role','prompts');await h.settle();assert.deepEqual(pdf.mounts.at(-1),['q1','q2']);}
    else h.get('.li-export-close').click();
    const mountedBefore=pdf.mounts.length;await finish();await h.settle();
    assert.equal(pdf.mounts.length,mountedBefore);assert.equal(pdf.documents.at(-1).disposed,true);assert.equal(pdf.prints.length,0);
    if(action==='filter')assert.deepEqual([...h.w.document.querySelectorAll('.li-export-pdf-preview p')].map(node=>node.dataset.messageKey),['q1','q2']);
    else assert.equal(h.get('.li-export-panel').hidden,true);
  }
});

test('changing advanced options preserves the role filter and its exported message selection',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('q','user','Visible prompt'),message('a','assistant','Visible answer')])}));t.after(h.close);
  h.get('.li-export-toggle').click();h.change('#li-export-preset','prompts');h.get('.li-export-inspect').click();await h.settle();
  assert.doesNotMatch(h.get('.li-export-dialogue').textContent,/Visible answer/);
  h.change('#li-export-includeTools',true);await h.settle();
  assert.equal(h.get('#li-export-preset').value,'prompts');assert.equal(h.stored.at(-1).exportPreferences.roleMode,'prompts');
  assert.match(h.get('.li-export-dialogue').textContent,/Visible prompt/);assert.doesNotMatch(h.get('.li-export-dialogue').textContent,/Visible answer/);
  h.get('.li-export-save').click();await h.settle();assert.doesNotMatch(await h.text(h.blobs[0]),/Visible answer/);
});
