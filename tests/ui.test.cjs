/* Native extension pages: settings, theme propagation, source persistence and editor lifecycle. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_MODULE || 'jsdom');
const ROOT=path.resolve(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const EXT='chrome-extension://test-id';
const CUSTOM=String.raw`\begin{tikzpicture}
  \node {Saved source};
\end{tikzpicture}`;
function harness(page, saved={}, dark=false, firefox=false) {
  const dom=new JSDOM(fs.readFileSync(path.join(ROOT,page+'.html'),'utf8'),{url:EXT+'/'+page+'.html',runScripts:'outside-only'});
  const w=dom.window,writes=[],opened=[],copied=[],changes=[],themeChanges=[],timers=new Map();let timerId=0;
  const media={matches:dark,addEventListener:(_,fn)=>themeChanges.push(fn)};
  w.matchMedia=()=>media;
  w.setTimeout=(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;};w.clearTimeout=id=>timers.delete(id);
  w.chrome={runtime:{getURL:file=>EXT+'/'+file},tabs:{create:options=>opened.push(options)},storage:{local:{get:async defaults=>({...defaults,...saved}),set:async value=>{writes.push(JSON.parse(JSON.stringify(value)));}},onChanged:{addListener:fn=>changes.push(fn)}}};
  if(firefox){w.browser=w.chrome;w.chrome={storage:{local:{get(){throw Error('Use Firefox Promise API');},set(){throw Error('Use Firefox Promise API');}}}};}
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>copied.push(text)}});
  w.eval(fs.readFileSync(path.join(ROOT,'native-controls.js'),'utf8'));
  if(page==='demo')w.eval(fs.readFileSync(path.join(ROOT,'examples.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT,page+'.js'),'utf8'));
  const el=id=>w.document.getElementById(id);
  function change(id,value){const input=el(id);if(input.type==='checkbox')input.checked=value;else input.value=value;input.dispatchEvent(new w.Event('change',{bubbles:true}));}
  function storage(next,area='local'){for(const fn of changes)fn(Object.fromEntries(Object.entries(next).map(([key,newValue])=>[key,{newValue}])),area);}
  async function flush(){for(const [id,{fn}]of [...timers]){timers.delete(id);fn();}await tick();}
  function systemDark(value){media.matches=value;for(const fn of themeChanges)fn({matches:value});}
  function connect(){const frame=el('preview').querySelector('iframe'),sent=[];frame.contentWindow.postMessage=(data,origin)=>sent.push({data,origin});frame.dispatchEvent(new w.Event('load'));return {frame,sent};}
  function message(frame,data,origin=EXT,source=frame.contentWindow){w.dispatchEvent(new w.MessageEvent('message',{origin,source,data:{channel:'latex-islands',id:'demo-1',...data}}));}
  return {w,el,writes,opened,copied,change,storage,flush,systemDark,connect,message,close:()=>w.close()};
}

test('popup restores existing settings and opens the local editor',async t=>{
  const h=harness('popup',{enabled:false,autoRender:true,scale:1.5,uiTheme:'dark'});t.after(h.close);await tick();
  assert.equal(h.el('enabled').checked,false);assert.equal(h.el('autoRender').checked,true);assert.equal(h.el('scale').value,'1.5');
  assert.equal(h.w.document.documentElement.dataset.theme,'dark');
  h.el('open-demo').click();assert.equal(h.opened[0].url,EXT+'/demo.html');
  h.change('enabled',true);h.change('autoRender',false);h.change('scale','1.25');await tick();
  assert.deepEqual(h.writes,[{enabled:true},{autoRender:false},{scale:1.25}]);
});

test('Firefox Promise namespace restores and saves popup and full editor preferences',async t=>{
  const popup=harness('popup',{scale:1.5,uiTheme:'dark'},false,true);t.after(popup.close);await tick();
  assert.equal(popup.el('scale').value,'1.5');assert.equal(popup.w.document.documentElement.dataset.theme,'dark');
  popup.change('enabled',false);await tick();assert.deepEqual(popup.writes.at(-1),{enabled:false});
  popup.el('open-demo').click();assert.equal(popup.opened[0].url,EXT+'/demo.html');
  const demo=harness('demo',{demoSource:CUSTOM,demoExample:'custom'},false,true);t.after(demo.close);await tick();
  assert.equal(demo.el('source').value,CUSTOM);assert.ok(demo.connect().frame);
  demo.change('renderColors','native');await tick();assert.deepEqual(demo.writes.at(-1),{renderColors:'native'});
});

test('popup explicit theme wins over system, then system follows OS and cross-page changes',async t=>{
  const h=harness('popup',{uiTheme:'light'},true);t.after(h.close);await tick();
  assert.equal(h.w.document.documentElement.dataset.theme,'light');
  h.change('uiTheme','system');await tick();assert.deepEqual(h.writes.at(-1),{uiTheme:'system'});
  assert.equal(h.w.document.documentElement.dataset.theme,'dark');h.systemDark(false);assert.equal(h.w.document.documentElement.dataset.theme,'light');
  h.storage({uiTheme:'dark'});assert.equal(h.el('uiTheme').value,'dark');assert.equal(h.w.document.documentElement.dataset.theme,'dark');
  h.storage({uiTheme:'light'},'sync');assert.equal(h.w.document.documentElement.dataset.theme,'dark');
});

test('popup reports failed saves without claiming success',async t=>{
  const h=harness('popup');t.after(h.close);await tick();h.w.chrome.storage.local.set=async()=>{throw Error('disk unavailable');};
  h.change('autoRender',false);await tick();assert.match(h.el('save-status').textContent,/Could not save/);
});

test('editor restores custom source and saved scale before first render',async t=>{
  const h=harness('demo',{demoSource:CUSTOM,demoExample:'custom',scale:1.25,uiTheme:'dark'});t.after(h.close);await tick();
  const {frame,sent}=h.connect();assert.equal(frame.title,'TikZ diagram preview');assert.equal(sent[0].origin,EXT);
  assert.equal(sent[0].data.mode,'preview');
  assert.equal(sent[0].data.source,CUSTOM);assert.equal(sent[0].data.scale,1.25);assert.equal(sent[0].data.theme,'dark');
  assert.equal(h.el('example').value,'custom');assert.equal(h.el('source-count').textContent,'3 lines');assert.equal(h.el('render').disabled,true);
  h.message(frame,{type:'result',ok:true});assert.equal(h.el('render').disabled,false);assert.equal(h.el('render-status').textContent,'');
});

test('editor theme changes update the island view without recompiling or losing source',async t=>{
  const h=harness('demo',{demoSource:CUSTOM,uiTheme:'system'});t.after(h.close);await tick();const {sent}=h.connect();
  h.change('uiTheme','dark');await tick();assert.equal(sent.at(-1).data.type,'view');assert.equal(sent.at(-1).data.theme,'dark');
  assert.equal(sent.filter(({data})=>data.type==='render').length,1);assert.deepEqual(h.writes.at(-1),{uiTheme:'dark'});
  h.storage({uiTheme:'light'});assert.equal(sent.at(-1).data.theme,'light');assert.equal(h.el('source').value,CUSTOM);
});

test('source toggle and copy preserve the exact editor text',async t=>{
  const h=harness('demo',{demoSource:CUSTOM});t.after(h.close);await tick();
  h.el('toggle-source').click();assert.equal(h.el('source-panel').hidden,true);assert.equal(h.el('toggle-source').getAttribute('aria-expanded'),'false');
  assert.equal(h.el('workspace').classList.contains('source-hidden'),true);h.el('toggle-source').click();assert.equal(h.el('source-panel').hidden,false);
  h.el('copy-source').click();await tick();assert.deepEqual(h.copied,[CUSTOM]);assert.equal(h.el('source').value,CUSTOM);
  assert.equal(h.el('copy-source').getAttribute('aria-label'),'Copied');
  assert.equal(h.el('source-status').textContent,'');
  assert.equal(h.el('copy-source').querySelector('svg path').getAttribute('d'),'m5 12 4 4L19 6');
  await h.flush();assert.equal(h.el('copy-source').getAttribute('aria-label'),'Copy code');
  assert.ok(h.el('copy-source').querySelector('svg rect'));
  h.w.navigator.clipboard.writeText=async()=>{throw Error('Clipboard denied');};
  h.el('copy-source').click();await tick();assert.equal(h.el('source-status').textContent,'Could not copy');
  assert.equal(h.el('copy-source').getAttribute('aria-label'),'Copy code');
  h.w.navigator.clipboard.writeText=async()=>{};
  h.el('copy-source').click();await tick();assert.equal(h.el('source-status').textContent,'');
  assert.equal(h.el('copy-source').getAttribute('aria-label'),'Copied');
});

test('source edits debounce and flush on pagehide before the delay expires',async t=>{
  const h=harness('demo');t.after(h.close);await tick();h.el('source').value=CUSTOM;
  h.el('source').dispatchEvent(new h.w.Event('input'));assert.equal(h.writes.length,0);
  h.w.dispatchEvent(new h.w.Event('pagehide'));await tick();assert.deepEqual(h.writes,[{demoSource:CUSTOM,demoExample:'custom'}]);
  assert.equal(h.el('source-status').textContent,'');await h.flush();assert.equal(h.writes.length,1);
});

test('edits during compilation leave a dirty preview indication, then Ctrl+Enter renders current source',async t=>{
  const h=harness('demo');t.after(h.close);await tick();const {frame,sent}=h.connect();
  h.el('source').value=CUSTOM;h.el('source').dispatchEvent(new h.w.Event('input'));
  h.message(frame,{type:'result',ok:true});assert.equal(h.el('render-status').textContent,'Uncompiled changes');
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,cancelable:true}));
  assert.equal(sent.at(-1).data.source,CUSTOM);assert.equal(sent.at(-1).data.id,'demo-2');
  h.message(frame,{type:'result',ok:false});assert.equal(h.el('render').disabled,true,'stale result must not finish a newer render');
  h.message(frame,{id:'demo-2',type:'result',ok:true});assert.equal(h.el('render-status').textContent,'');
});

test('fullscreen dialog restores focus and synchronizes iframe edits; foreign messages are ignored',async t=>{
  const h=harness('demo');t.after(h.close);await tick();const {frame,sent}=h.connect();
  h.message(frame,{type:'open-editor'},'https://attacker.example');assert.equal(h.el('preview').hasAttribute('role'),false);
  h.el('expand-preview').focus();h.el('expand-preview').click();assert.equal(h.el('preview').getAttribute('role'),'dialog');
  assert.equal(sent.at(-1).data.mode,'fullscreen');assert.equal(h.el('preview').classList.contains('editor-expanded'),true);
  h.message(frame,{type:'source-change',source:CUSTOM});await h.flush();assert.equal(h.el('source').value,CUSTOM);assert.equal(h.writes.at(-1).demoSource,CUSTOM);
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',cancelable:true}));
  assert.equal(h.el('preview').hasAttribute('role'),false);assert.equal(h.el('preview').classList.contains('editor-expanded'),false);
  assert.equal(sent.at(-1).data.mode,'preview');assert.equal(h.w.document.activeElement,h.el('expand-preview'));
});

test('ChatGPT is the default popup appearance and uses the observed palette',async t=>{
  const observed={theme:'dark',colors:{text:'rgb(238, 238, 238)',background:'#000000',surface:'#202020',border:'#414141'}};
  const h=harness('popup',{chatgptTheme:observed});t.after(h.close);await tick();
  assert.equal(h.el('uiTheme').value,'chatgpt');assert.equal(h.w.document.documentElement.dataset.theme,'dark');
  assert.equal(h.w.document.documentElement.style.getPropertyValue('--surface'),'#000000');
  assert.equal(h.w.document.documentElement.style.getPropertyValue('--page'),'#202020');
  assert.match(h.el('theme-help').textContent,/ChatGPT theme: dark/);
  h.systemDark(false);assert.equal(h.w.document.documentElement.dataset.theme,'dark');
  h.change('uiTheme','light');await tick();assert.equal(h.w.document.documentElement.dataset.theme,'light');
  assert.equal(h.w.document.documentElement.style.getPropertyValue('--surface'),'');
  h.storage({chatgptTheme:observed});assert.equal(h.w.document.documentElement.dataset.theme,'light');
});

test('standalone preview keeps host-owned height and full screen keeps the same frame without a code editor',async t=>{
  const h=harness('demo',{demoSource:CUSTOM});t.after(h.close);await tick();const {frame,sent}=h.connect(),window=frame.contentWindow;
  assert.equal(sent[0].data.mode,'preview');
  h.message(frame,{type:'resize',height:180});assert.equal(frame.style.height,'','inline natural height cannot shrink the standalone preview');
  h.el('toggle-source').click();assert.equal(h.el('source-panel').hidden,true);
  h.el('expand-preview').click();assert.equal(sent.at(-1).data.mode,'fullscreen');
  assert.equal(h.el('preview').getAttribute('aria-label'),'Full-screen TikZ diagram');
  h.storage({uiTheme:'dark'});assert.equal(sent.at(-1).data.mode,'fullscreen');
  h.message(frame,{type:'close-editor'});assert.equal(sent.at(-1).data.mode,'preview');
  assert.equal(h.el('source-panel').hidden,true,'full screen preserves the host source visibility');
  assert.equal(frame.contentWindow,window);assert.equal(sent.filter(item=>item.data.type==='render').length,1);
  h.message(frame,{type:'resize',height:240});assert.equal(frame.style.height,'');
  h.el('expand-preview').click();h.message(frame,{type:'show-source'});
  assert.equal(h.el('preview').classList.contains('editor-expanded'),false);assert.equal(h.el('source-panel').hidden,false);
  assert.equal(h.w.document.activeElement,h.el('source'));assert.equal(sent.at(-1).data.mode,'preview');
});

test('ChatGPT appearance falls back to system until a palette is observed and follows cache changes',async t=>{
  const h=harness('popup',{},true);t.after(h.close);await tick();
  assert.equal(h.el('uiTheme').value,'chatgpt');assert.equal(h.w.document.documentElement.dataset.theme,'dark');
  assert.match(h.el('theme-help').textContent,/until ChatGPT is opened/);
  h.systemDark(false);assert.equal(h.w.document.documentElement.dataset.theme,'light');
  h.storage({chatgptTheme:{theme:'dark',colors:{background:'#111111'}}});
  assert.equal(h.w.document.documentElement.dataset.theme,'dark');assert.equal(h.w.document.documentElement.style.getPropertyValue('--surface'),'#111111');
  h.storage({chatgptTheme:null});assert.equal(h.w.document.documentElement.dataset.theme,'light');
  assert.equal(h.w.document.documentElement.style.getPropertyValue('--surface'),'');
});

test('popup restores, saves and synchronizes the diagram color preference separately from UI appearance',async t=>{
  const h=harness('popup',{renderColors:'native',uiTheme:'dark'});t.after(h.close);await tick();
  assert.equal(h.el('renderColors').value,'native');h.change('renderColors','chatgpt');await tick();
  assert.deepEqual(h.writes.at(-1),{renderColors:'chatgpt'});assert.equal(h.w.document.documentElement.dataset.theme,'dark');
  h.storage({renderColors:'native'});assert.equal(h.el('renderColors').value,'native');
  h.storage({renderColors:'unknown'});assert.equal(h.el('renderColors').value,'chatgpt');
});

test('editor sends the observed ChatGPT palette on first render and updates it without recompilation',async t=>{
  const observed={theme:'dark',colors:{text:'#eeeeee',background:'#000000',surface:'#202020',border:'#414141'}};
  const h=harness('demo',{chatgptTheme:observed});t.after(h.close);await tick();const {sent}=h.connect();
  assert.equal(h.el('uiTheme').value,'chatgpt');assert.equal(sent[0].data.theme,'dark');assert.equal(sent[0].data.renderColors,'chatgpt');
  assert.equal(sent[0].data.colors.background,'#000000');assert.equal(sent[0].data.colors.surface,'#202020');assert.equal(sent[0].data.colors.text,'#eeeeee');
  h.storage({chatgptTheme:{theme:'light',colors:{text:'#111111',background:'#ffffff',surface:'#f4f4f4',border:'#dedede'}}});
  assert.equal(sent.at(-1).data.type,'view');assert.equal(sent.at(-1).data.theme,'light');assert.equal(sent.at(-1).data.colors.background,'#ffffff');
  assert.equal(sent.filter(({data})=>data.type==='render').length,1);
});

test('native color mode keeps dark UI, persists and updates an open fullscreen view without compiling',async t=>{
  const h=harness('demo',{uiTheme:'dark',renderColors:'native'});t.after(h.close);await tick();const {sent}=h.connect();
  assert.equal(sent[0].data.renderColors,'native');assert.equal(sent[0].data.theme,'dark');
  assert.equal(h.w.document.documentElement.dataset.renderColors,'native');assert.equal(h.w.document.documentElement.dataset.theme,'dark');
  h.el('expand-preview').click();h.change('renderColors','chatgpt');await tick();
  assert.equal(sent.at(-1).data.type,'view');assert.equal(sent.at(-1).data.mode,'fullscreen');assert.equal(sent.at(-1).data.renderColors,'chatgpt');
  assert.deepEqual(h.writes.at(-1),{renderColors:'chatgpt'});
  h.storage({renderColors:'native'});assert.equal(h.el('renderColors').value,'native');assert.equal(sent.at(-1).data.renderColors,'native');
  assert.equal(sent.at(-1).data.theme,'dark');assert.equal(sent.filter(({data})=>data.type==='render').length,1);
});

test('popup custom selects retain native values, accessible labels and one save per selection',async t=>{
  const h=harness('popup',{uiTheme:'dark',scale:1.5});t.after(h.close);await tick();
  const trigger=h.el('uiTheme-trigger'),menu=h.el('uiTheme-menu');
  assert.equal(h.el('uiTheme').hidden,true);assert.equal(h.el('uiTheme').getAttribute('aria-hidden'),'true');
  assert.equal(trigger.getAttribute('role'),'combobox');assert.equal(trigger.getAttribute('aria-labelledby'),'uiTheme-label');
  assert.equal(trigger.getAttribute('aria-describedby'),'theme-help');assert.equal(trigger.textContent,'Dark');
  assert.equal(h.el('scale-trigger').textContent,'150%');
  trigger.click();assert.equal(menu.hidden,false);assert.equal(trigger.getAttribute('aria-expanded'),'true');
  assert.equal(menu.querySelector('[aria-selected="true"]').dataset.value,'dark');
  menu.querySelector('[data-value="light"]').click();await tick();
  assert.deepEqual(h.writes,[{uiTheme:'light'}]);assert.equal(h.el('uiTheme').value,'light');assert.equal(trigger.textContent,'Light');
  assert.equal(menu.hidden,true);assert.equal(h.w.document.activeElement,trigger);
});

test('select keyboard navigation commits with Enter and Escape cancels before outer handlers',async t=>{
  const h=harness('popup',{uiTheme:'light'});t.after(h.close);await tick();
  const trigger=h.el('uiTheme-trigger'),menu=h.el('uiTheme-menu');let outerEscapes=0;
  h.w.document.addEventListener('keydown',event=>{if(event.key==='Escape')outerEscapes++;});
  const key=value=>trigger.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
  key('ArrowDown');key('ArrowDown');assert.equal(trigger.getAttribute('aria-activedescendant'),'uiTheme-option-3');
  key('Escape');assert.equal(menu.hidden,true);assert.equal(h.el('uiTheme').value,'light');assert.equal(outerEscapes,0);assert.equal(h.writes.length,0);
  key('d');assert.equal(trigger.getAttribute('aria-activedescendant'),'uiTheme-option-3');key('Enter');await tick();
  assert.deepEqual(h.writes,[{uiTheme:'dark'}]);assert.equal(trigger.textContent,'Dark');assert.equal(menu.hidden,true);
});

test('only one settings listbox opens and outside clicks, Tab and disabling close it',async t=>{
  const h=harness('popup');t.after(h.close);await tick();
  h.el('scale-trigger').click();h.el('uiTheme-trigger').click();
  assert.equal(h.el('scale-menu').hidden,true);assert.equal(h.el('uiTheme-menu').hidden,false);
  h.el('open-demo').dispatchEvent(new h.w.Event('pointerdown',{bubbles:true}));assert.equal(h.el('uiTheme-menu').hidden,true);
  h.el('scale-trigger').click();h.el('scale-trigger').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
  assert.equal(h.el('scale-menu').hidden,true);
  h.el('scale-trigger').click();h.el('scale').disabled=true;await tick();
  assert.equal(h.el('scale-menu').hidden,true);assert.equal(h.el('scale-trigger').disabled,true);assert.equal(h.writes.length,0);
});

test('storage updates synchronize visible select values and switch states without saving again',async t=>{
  const h=harness('popup');t.after(h.close);await tick();
  h.storage({uiTheme:'dark',renderColors:'native',scale:2,enabled:false,autoRender:false});
  assert.equal(h.el('uiTheme-trigger').textContent,'Dark');assert.equal(h.el('scale-trigger').textContent,'200%');
  assert.equal(h.el('renderColors-trigger').textContent,'LaTeX colors · white background');
  assert.equal(h.el('enabled').checked,false);assert.equal(h.el('autoRender').checked,false);assert.equal(h.writes.length,0);
  h.el('enabled').click();await tick();assert.equal(h.el('enabled').getAttribute('role'),'switch');assert.deepEqual(h.writes,[{enabled:true}]);
});

test('editor example control reflects restored code, user typing and keyboard selection',async t=>{
  const h=harness('demo',{demoSource:CUSTOM,demoExample:'custom'});t.after(h.close);await tick();
  const {frame,sent}=h.connect();h.message(frame,{type:'result',ok:true});
  const trigger=h.el('example-trigger');assert.equal(trigger.textContent,'My diagram');
  assert.ok(trigger.getAttribute('aria-labelledby'));assert.equal(h.w.document.querySelector('label[for="example-trigger"]').textContent,'Choose a diagram example');
  trigger.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));
  trigger.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  assert.equal(h.el('example').value,h.w.LatexIslandsExamples[0].id);assert.equal(trigger.textContent,h.w.LatexIslandsExamples[0].title);
  assert.equal(sent.at(-1).data.source,h.w.LatexIslandsExamples[0].source);
  h.el('source').value=CUSTOM;h.el('source').dispatchEvent(new h.w.Event('input'));
  assert.equal(trigger.textContent,'My diagram');await h.flush();assert.equal(h.writes.at(-1).demoExample,'custom');
});

test('enhanced selects update changed options and skip disabled choices',async t=>{
  const h=harness('popup',{uiTheme:'chatgpt'});t.after(h.close);await tick();
  h.el('uiTheme').options[1].disabled=true;await tick();
  const trigger=h.el('uiTheme-trigger');trigger.click();
  trigger.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  assert.equal(trigger.getAttribute('aria-activedescendant'),'uiTheme-option-2');
  trigger.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await tick();
  assert.deepEqual(h.writes,[{uiTheme:'light'}]);assert.equal(h.el('uiTheme-option-1').getAttribute('aria-disabled'),'true');
});
