const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom');
const ROOT=path.resolve(__dirname,'..'),ID='01234567-89ab-4cde-8f01-23456789abcd',CHANNEL='latex-islands-conversation-export-v1';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(respond,pathname='/c/'+ID,saved={}){
  const dom=new JSDOM('<!doctype html><header id="page-header"><div id="conversation-header-actions"><button id="native">Share</button></div></header><main><article data-message-author-role="assistant">A DOM message that must never be scraped.</article></main>',{url:'https://chatgpt.com'+pathname,runScripts:'outside-only'});
  const w=dom.window,sent=[],downloads=[],blobs=[],copied=[],stored=[];
  w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic-'+blobs.length;};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,url:this.href});};
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async value=>copied.push(value)}});
  w.chrome={storage:{local:{get:async defaults=>({...defaults,...saved}),set:async value=>stored.push(value)}}};
  function reply(request,data,overrides={}){w.dispatchEvent(new w.MessageEvent('message',{source:w,origin:w.location.origin,data:{channel:CHANNEL,type:'response',requestId:request.requestId,...data},...overrides}));}
  w.postMessage=(data,origin)=>{sent.push({data,origin});if(data.type==='request'&&respond)queueMicrotask(async()=>{const result=await respond(data,sent.filter(item=>item.data.type==='request').length);if(result)reply(data,result);});};
  for(const file of ['export-core.js','export-preview-renderer.js','conversation-export.js'])w.eval(fs.readFileSync(path.join(ROOT,file),'utf8'));
  const get=selector=>w.document.querySelector(selector);
  function format(value){get('#li-export-format').value=value;get('#li-export-format').dispatchEvent(new w.Event('change',{bubbles:true}));}
  function change(selector,value){const input=get(selector);if(input.type==='checkbox')input.checked=value;else input.value=value;input.dispatchEvent(new w.Event('change',{bubbles:true}));}
  async function settle(){for(let i=0;i<10;i++)await tick();}
  async function text(blob){return new Promise((resolve,reject)=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob);});}
  return {w,sent,downloads,blobs,copied,stored,get,format,change,reply,settle,text,close:()=>w.close()};
}
function apiPage(messages=[],has_previous_page=false,extra={}){return {messages,page_info:{has_previous_page,has_next_page:false,start_cursor:'before-1'},...extra};}
const message=(id,role,text,extra={})=>({id,author:{role},content:{content_type:'text',parts:[text]},...extra});

test('header control is idempotent and option selection makes no request before an explicit action',async t=>{
  const h=harness();t.after(h.close);assert.ok(h.get('#conversation-header-actions > .li-export'));assert.equal(h.get('.li-export-panel').hidden,true);assert.equal(h.get('#native').textContent,'Share');
  h.get('.li-export-toggle').click();h.format('txt');h.change('#li-export-timestamps',true);assert.equal(h.sent.length,0);
  assert.equal(h.get('.li-export-toggle').getAttribute('aria-expanded'),'true');
  h.w.eval(fs.readFileSync(path.join(ROOT,'conversation-export.js'),'utf8'));assert.equal(h.w.document.querySelectorAll('.li-export').length,1);
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(h.get('.li-export-panel').hidden,true);
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

test('answers-only text export and saved preferences honor the chosen options without saving the conversation',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('q','user','Question unique'),message('a','assistant','Réponse finale',{channel:'final'})],false,{title:'Sans question'})}));t.after(h.close);
  h.format('txt');h.change('#li-export-preset','answers');h.change('#li-export-timestamps',true);h.get('.li-export-save').click();await h.settle();
  assert.equal(h.downloads[0].name,'Sans question.txt');const output=await h.text(h.blobs[0]);assert.match(output,/Réponse finale/);assert.ok(!output.includes('Question unique'));
  assert.equal(h.stored.at(-1).exportPreferences.format,'txt');assert.equal(h.stored.at(-1).exportPreferences.includeUser,false);assert.ok(!JSON.stringify(h.stored).includes('Réponse finale'));
});

test('changing options updates the preview without another request and changed messages cause a fresh fetch',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('q','user','Question visible'),message('a','assistant','Réponse visible',{channel:'final'})])}));t.after(h.close);
  h.get('.li-export-inspect').click();await h.settle();h.change('#li-export-preset','answers');assert.ok(!h.get('.li-export-preview pre').textContent.includes('Question visible'));assert.equal(h.sent.filter(x=>x.data.type==='request').length,1);
  h.get('main article').firstChild.data+=' New response token';await h.settle();assert.match(h.get('.li-export-status').textContent,/conversation a changé/);h.get('.li-export-save').click();await h.settle();assert.equal(h.sent.filter(x=>x.data.type==='request').length,2);
});

test('a failed later page gives an error without a partial archive',async t=>{
  const h=harness(async(request,count)=>count===1?{ok:true,payload:apiPage([],true)}:{ok:false,error:'HTTP 429 synthetic refusal',status:429});t.after(h.close);
  h.get('.li-export-save').click();await h.settle();assert.equal(h.downloads.length,0);assert.equal(h.get('.li-export-status').dataset.state,'error');assert.match(h.get('.li-export-status').textContent,/429/);assert.equal(h.get('.li-export-save').disabled,false);
});

test('responses from another origin or window cannot satisfy an export request',async t=>{
  const h=harness();t.after(h.close);h.format('json');h.get('.li-export-save').click();const request=h.sent.find(item=>item.data.type==='request').data;
  h.reply(request,{ok:true,payload:apiPage()},{origin:'https://attacker.example'});h.reply(request,{ok:true,payload:apiPage()},{source:null});await h.settle();assert.equal(h.downloads.length,0);
  h.reply(request,{ok:true,payload:apiPage()});await h.settle();assert.equal(h.downloads.length,1);
});

test('cancel and navigation discard in-flight exports without downloading',async t=>{
  for(const mode of ['cancel','navigate']){const h=harness();t.after(h.close);h.get('.li-export-save').click();const request=h.sent.find(item=>item.data.type==='request').data;
    if(mode==='cancel')h.get('.li-export-cancel').click();else{h.w.history.pushState({},'','/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');h.reply(request,{ok:true,payload:apiPage()});}
    await h.settle();assert.equal(h.downloads.length,0);assert.equal(h.get('.li-export-status').dataset.state,'error');assert.match(h.get('.li-export-status').textContent,/annulé/);
  }
});

test('export absent on new chats/shared links; options restored without fetching data',async t=>{
  for(const pathname of ['/','/share/'+ID]){const h=harness(null,pathname);t.after(h.close);assert.equal(h.get('.li-export'),null);assert.equal(h.sent.length,0);}
  const h=harness(null,'/c/'+ID,{exportPreferences:{format:'txt',timestamps:true,includeUser:false}});t.after(h.close);await h.settle();assert.equal(h.get('#li-export-format').value,'txt');assert.equal(h.get('#li-export-timestamps').checked,true);assert.equal(h.get('#li-export-preset').value,'answers');assert.equal(h.sent.length,0);
});

test('clipboard failure exposes an actionable preview without an automatic download',async t=>{
  const h=harness(async()=>({ok:true,payload:apiPage([message('a','assistant','Copie manuelle')])}));t.after(h.close);h.w.navigator.clipboard.writeText=async()=>{throw new Error('denied');};
  h.get('.li-export-copy').click();await h.settle();assert.equal(h.get('.li-export-preview').hidden,false);assert.equal(h.get('.li-export-status').dataset.state,'error');assert.match(h.get('.li-export-status').textContent,/Copie indisponible/);assert.equal(h.downloads.length,0);
});

test('dialogue preview is paged, inert and configurable independently of the file view',async t=>{
  const content='Une formule \\(x^2\\).\n\n```html\n<img src="https://tracking.invalid/x" onerror="fake()">\n```\n\nSuite';
  const messages=Array.from({length:25},(_,i)=>message('m'+i,i%2?'assistant':'user',content));
  const h=harness(async()=>({ok:true,payload:apiPage(messages)}));t.after(h.close);
  h.get('.li-export-toggle').click();h.get('.li-export-inspect').click();await h.settle();
  assert.equal(h.get('.li-export-dialogue').hidden,false);assert.equal(h.w.document.querySelectorAll('.li-export-message').length,20);assert.equal(h.get('.li-export-more').hidden,false);
  assert.equal(h.get('.li-export-dialogue img'),null);assert.match(h.get('.li-preview-code pre').textContent,/<img/);assert.match(h.get('.li-export-dialogue').textContent,/Suite/);
  h.get('.li-export-more').click();assert.equal(h.w.document.querySelectorAll('.li-export-message').length,25);assert.equal(h.get('.li-export-more').hidden,true);
  h.change('#li-export-includeUser',false);assert.equal(h.get('#li-export-preset').value,'answers');assert.equal(h.w.document.querySelectorAll('.li-export-message').length,12);
  h.change('#li-export-includeTools',true);assert.equal(h.get('#li-export-preset').value,'custom');
  h.get('.li-export-file-mode').click();assert.equal(h.get('.li-export-preview > pre').hidden,false);assert.equal(h.get('.li-export-dialogue').hidden,true);
  h.format('json');assert.equal(h.get('.li-export-dialogue-mode').disabled,true);assert.match(h.get('.li-export-preview > pre').textContent,/"messages"/);assert.equal(h.sent.filter(x=>x.data.type==='request').length,1);
});

test('closing the modal cancels an in-flight operation and restores focus',async t=>{
  const h=harness();t.after(h.close);h.get('.li-export-toggle').focus();h.get('.li-export-toggle').click();
  h.get('.li-export-save').click();const request=h.sent.find(x=>x.data.type==='request').data;
  h.get('.li-export-close').click();h.reply(request,{ok:true,payload:apiPage()});await h.settle();
  assert.equal(h.downloads.length,0);assert.equal(h.get('.li-export-panel').hidden,true);assert.equal(h.w.document.activeElement,h.get('.li-export-toggle'));assert.ok(h.sent.some(x=>x.data.type==='cancel'));
});
