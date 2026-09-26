/* SPDX-License-Identifier: GPL-3.0-or-later
 * Actual MV3 extension navigation smoke, using an isolated Chrome profile.
 * Only a temporary runtime copy permits the synthetic localhost parent.
 * Run: node tests/chromium-extension-navigation.mjs [--ask-fix-only]
 * Requires current Chrome (138+) with the Extensions.loadUnpacked CDP API.
 * Set CHROME_BINARY to override Windows, Linux or macOS Chrome discovery.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {Script} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {collectRuntime} from '../scripts/build.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'latex-islands-chromium-navigation-'));
const extension=path.join(temporary,'extension'),profile=path.join(temporary,'profile');
async function writeScript(name,source){new Script(source,{filename:name});await fs.writeFile(path.join(extension,name),source);}
function browserBinary(){
  if(process.env.CHROME_BINARY)return process.env.CHROME_BINARY;
  const candidates=process.platform==='win32'?[
    path.join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe')
  ]:process.platform==='darwin'?[
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ]:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/microsoft-edge'];
  const found=candidates.find(candidate=>fsSync.existsSync(candidate));
  if(!found)throw Error('Current Chrome not found. Set CHROME_BINARY to a Chrome 138+ executable.');
  return found;
}
const events=[];let child,pipe,deadline,resolveResult,rejectResult,stderr='';
const result=new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;});result.catch(()=>{});
const code=String.raw`\begin{tikzpicture}\draw[blue] (0,0) rectangle (3,1);\node at (1.5,.5) {MV3 navigation};\end{tikzpicture}`;
const brokenCode=String.raw`\begin{tikzpicture}
  \node {\FixtureUndefinedCommand};
\end{tikzpicture}`;
const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const markup=`<div data-chatgpt-conversation-selection-target><div data-content-search-turn-key="fallback-turn-0"><div data-chatgpt-search-unit-key="fallback-turn-0:2:assistant" data-chatgpt-search-message-ids="answer"><h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4><div data-chatgpt-selection-message-id="answer"><div data-markdown-text-style="assistant-message"><p>Here is a diagram.</p><div data-markdown-copy="code-block" id="diagram"><div data-markdown-copy="exclude"><div>tikz</div><button>Copy</button></div><div><code style="white-space:pre">${escape(code)}</code></div></div><p>Completed answer.</p></div></div></div><div class="turn-action-controls"><button>Copy reply</button></div></div></div>`;
const server=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.end();return;}
  if((req.url==='/event'||req.url==='/report')&&req.method==='POST'){
    let body='';for await(const part of req){body+=part;if(body.length>1000000){res.writeHead(413);res.end();return;}}
    try{const value=JSON.parse(body);if(req.url==='/event')events.push(value);else if(value.ok)resolveResult(value);else rejectResult(Error(JSON.stringify(value)));res.end('ok');}catch(error){rejectResult(error);res.writeHead(400);res.end();}return;
  }
  if(req.url?.startsWith('/c/')){
    res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><title>Isolated extension navigation</title><style>html,body{margin:0;height:100%;background:#000;color:#eee;font:16px/1.5 system-ui}main{height:100vh;margin-left:150px}[data-app-action-timeline-scroll]{height:100%;overflow-y:auto;display:flex;flex-direction:column-reverse}[data-chatgpt-conversation-selection-target]{width:700px;max-width:100%;margin:auto;padding:24px;box-sizing:border-box;flex-shrink:0}.sr-only{position:absolute;width:1px;height:1px;clip:rect(0,0,0,0)}code{display:block;overflow:auto}</style></head><body><main data-app-shell-main-surface="browser"><header><div data-app-shell-main-titlebar><div data-app-shell-header-obstacle><button>Share</button></div></div></header><div data-app-action-timeline-scroll>${markup}</div></main></body></html>`);return;
  }
  res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;

class PipeCDP {
  constructor(process){
    this.sequence=0;this.pending=new Map();let buffer='';this.input=process.stdio[3];
    process.stdio[4].on('data',chunk=>{buffer+=chunk.toString();let end;while((end=buffer.indexOf('\0'))!==-1){const raw=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!raw)continue;const message=JSON.parse(raw),pending=this.pending.get(message.id);if(!pending)continue;this.pending.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(Error(JSON.stringify(message.error))):pending.resolve(message.result);}});
  }
  call(method,params={}){return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(Error(method+' timed out'));},15000);this.pending.set(id,{resolve,reject,timer});this.input.write(JSON.stringify({id,method,params})+'\0');});}
}

try{
  const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
  const fixtureMatch='http://127.0.0.1/*';
  manifest.host_permissions=[...(manifest.host_permissions||[]),fixtureMatch];
  manifest.content_security_policy.extension_pages=manifest.content_security_policy.extension_pages.replace("connect-src 'self'","connect-src 'self' "+origin);
  for(const script of manifest.content_scripts)script.matches.push(fixtureMatch);
  const isolated=manifest.content_scripts.find(script=>script.js.includes('content.js'));
  for(const resource of manifest.web_accessible_resources)resource.matches.push(fixtureMatch);
  const runtime=await collectRuntime(root,manifest,'chrome');
  for(const entry of runtime){const target=path.join(extension,entry.name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,entry.data);}
  isolated.js.unshift('navigation-observer.js');isolated.js.push('navigation-probe.js');
  await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest,null,2));
  await fs.mkdir(profile);
  const islandFile=path.join(extension,'island.js');let island=await fs.readFile(islandFile,'utf8');
  island=island.replace("'https://chat.openai.com',ownOrigin]","'https://chat.openai.com',ownOrigin,"+JSON.stringify(origin)+"]");
  if(!island.includes(JSON.stringify(origin)))throw Error('Could not add the synthetic parent origin to the temporary island copy');
  const askParents="['https://chatgpt.com','https://chat.openai.com'].includes(parentOrigin)";
  if(!island.includes(askParents))throw Error('Could not locate the Ask ChatGPT parent gate in the temporary copy');
  island=island.replace(askParents,"['https://chatgpt.com','https://chat.openai.com',"+JSON.stringify(origin)+"].includes(parentOrigin)");
  island+=`\nfor(const eventType of ['pageshow','pagehide','load'])window.addEventListener(eventType,event=>{fetch(${JSON.stringify(origin+'/event')},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({where:'island',event:eventType,id:location.hash,persisted:event.persisted,href:location.href,now:Date.now()})});});\n`;
  island+=`
    // Test-only driver in the real extension document: click the production UI
    // once an actual TeX failure exposes it, then observe its acknowledgement.
    let navigationAsked=false,navigationAcknowledged=false;
    const navigationAskObserver=new MutationObserver(()=>{
      const button=document.getElementById('ask-fix');
      if(!navigationAsked&&document.querySelector('.island').dataset.state==='error'&&!button.hidden&&failedDiagram){
        navigationAsked=true;parent.postMessage({channel:'navigation-ask-fix-probe',phase:'click',source:failedDiagram.source,error:failedDiagram.error},${JSON.stringify(origin)});button.click();
      }
      if(navigationAsked&&!navigationAcknowledged&&!button.disabled&&!button.hasAttribute('aria-busy')){
        navigationAcknowledged=true;const status=document.getElementById('fix-status');parent.postMessage({channel:'navigation-ask-fix-probe',phase:'ack',ok:status.hidden,message:status.textContent},${JSON.stringify(origin)});
      }
    });navigationAskObserver.observe(document.body,{subtree:true,attributes:true,childList:true,characterData:true});
  `;
  await fs.writeFile(islandFile,island);
  let content=await fs.readFile(path.join(extension,'content.js'),'utf8');
  for(const [needle,trace] of [
    ["function restartIsland(state,automatic=false,reason='manual-retry') {",`globalThis.NAV_TRACE?.('restart',{automatic,reason,ready:state.ready,id:state.id,recoveries:state.navigationRecoveries,failed:state.navigationFailed,src:state.frame?.src,srcdoc:state.frame?.getAttribute('srcdoc')});`],
    ['function probeDocument(state) {',`globalThis.NAV_TRACE?.('probe',{ready:state.ready,id:state.id,port:!!state.port,live:liveFrame(state),attached:attachedFrame(state),detached:state.documentDetached,srcMatches:state.frame?.src===state.frameURL,srcdoc:state.frame?.getAttribute('srcdoc')});`],
    ['function receiveSnapshot(state,port,data) {',`if(data?.type!=='snapshot-result')globalThis.NAV_TRACE?.('port',{messageType:data?.type,requestId:data?.requestId,id:state.id,samePort:state.port===port});`]
  ]){if(!content.includes(needle))throw Error('Missing trace point '+needle);content=content.replace(needle,needle+trace);}
  await fs.writeFile(path.join(extension,'content.js'),content);
  await writeScript('navigation-observer.js',`
    globalThis.NAV_EVENTS=[];globalThis.NAV_TRACE=(type,data={})=>{const event={where:'content',type,...data,now:Date.now(),url:location.href};NAV_EVENTS.push(event);fetch(${JSON.stringify(origin+'/event')},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event)}).catch(()=>{});};
    window.addEventListener('message',event=>{if(event.data?.channel==='latex-islands')NAV_TRACE('window',{event:event.data.type,ok:event.data.ok,id:event.data.id,origin:event.origin,sourceNull:event.source===null,sourceMatch:[...document.querySelectorAll('.latex-islands-container iframe')].some(frame=>frame.contentWindow===event.source)});});
    const observer=new MutationObserver(records=>{for(const record of records)if(record.type==='attributes'&&record.target.matches('iframe'))NAV_TRACE('iframe-attribute',{attribute:record.attributeName,value:record.target.getAttribute(record.attributeName)});});observer.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['src','srcdoc']});
  `);
  await writeScript('navigation-probe.js',`
    if(location.origin===${JSON.stringify(origin)}){
      const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const wait=async(check,label,timeout=45000)=>{const end=Date.now()+timeout;while(Date.now()<end){const alert=document.querySelector('.latex-islands-boot [role="alert"]');if(alert)throw Error(label+': '+alert.textContent);const value=await check();if(value)return value;await sleep(50);}throw Error(label+' timed out');};
      const snapshot=async label=>{await wait(async()=>{try{const source=document.getElementById('diagram'),items=await LatexIslandsDiagramExport.snapshot(source);if(items.length!==1||!items[0].svg.includes('<svg')||document.querySelectorAll('.latex-islands-container iframe').length!==1)throw Error('Expected one SVG and one iframe');return true;}catch{return false;}},label);return {label,frames:document.querySelectorAll('.latex-islands-container iframe').length,srcdoc:document.querySelector('.latex-islands-container iframe').hasAttribute('srcdoc')};};
      const stages=[];
      (async()=>{try{
        await wait(()=>NAV_EVENTS.some(event=>event.type==='window'&&event.event==='result'&&event.ok),'Initial actual MV3 render');stages.push(await snapshot('initial'));
        if(!${JSON.stringify(process.argv.includes('--ask-fix-only'))}){
        // A deliberate load notification on the still-live extension frame
        // exercises the real cross-origin private-port heartbeat independently
        // of the browser's initial ready/load ordering.
        document.querySelector('.latex-islands-container iframe').dispatchEvent(new Event('load'));
        await wait(()=>NAV_EVENTS.some(event=>event.type==='port'&&event.messageType==='document-pong'&&event.requestId?.startsWith('ping-')),'Real extension private-port pong',10000);
        await sleep(6000);stages.push(await snapshot('initial after document-ping window'));
        for(const mode of ['cloned-cache','hidden-connected-cache','same-node-detach']){
          const current=document.querySelector('[data-chatgpt-conversation-selection-target]'),saved=mode==='cloned-cache'?current.cloneNode(true):current;
          history.pushState({},'', '/c/87654321-4321-4321-8321-cba987654321');
          const other=document.createElement('div');other.setAttribute('data-chatgpt-conversation-selection-target','');other.textContent='Conversation B';
          if(mode==='hidden-connected-cache'){current.hidden=true;current.inert=true;current.after(other);}else current.replaceWith(other);
          await wait(()=>document.querySelectorAll('.latex-islands-container iframe').length===0,'Inactive frame cleanup '+mode);
          await sleep(100);history.pushState({},'', '/c/12345678-1234-4123-8123-123456789abc');
          if(mode==='hidden-connected-cache'){other.remove();saved.hidden=false;saved.inert=false;}else other.replaceWith(saved);
          stages.push(await snapshot(mode+' restored'));
          await sleep(6000);stages.push(await snapshot(mode+' stable after ping'));
        }
        if(NAV_EVENTS.some(event=>event.type==='restart'))throw Error('Normal navigation caused an unexpected automatic iframe recovery');
        }
        const form=document.createElement('form');form.setAttribute('data-chatgpt-composer','');
        form.innerHTML='<div id="prompt-textarea" role="textbox" contenteditable="true"><p>Avant : garder ce <strong>brouillon important</strong>.</p><p>Seconde ligne à conserver.</p></div><button type="submit">Send</button>';
        document.body.append(form);const composer=form.querySelector('[contenteditable]'),strong=composer.querySelector('strong'),draft=composer.innerText;
        const nativeExecCommand=document.execCommand.bind(document);document.execCommand=(...args)=>{const ok=nativeExecCommand(...args);NAV_TRACE('exec-command',{command:args[0],ok,focused:document.hasFocus(),active:document.activeElement?.id,draft,html:composer.innerHTML,text:composer.innerText});return ok;};
        let submits=0,sendClicks=0,inputs=0,childClick,childAck;
        form.addEventListener('submit',event=>{submits++;event.preventDefault();});form.querySelector('button').addEventListener('click',()=>sendClicks++);composer.addEventListener('input',()=>inputs++);
        const childReport=event=>{if(event.origin!==chrome.runtime.getURL('').slice(0,-1)||event.source!==document.querySelector('.latex-islands-container iframe')?.contentWindow||event.data?.channel!=='navigation-ask-fix-probe')return;if(event.data.phase==='click')childClick=event.data;else if(event.data.phase==='ack')childAck=event.data;};window.addEventListener('message',childReport);
        document.getElementById('diagram').querySelector('code').textContent=${JSON.stringify(brokenCode)};
        await wait(()=>childAck,'Ask ChatGPT real contenteditable insertion');
        if(!childAck.ok)throw Error('Ask ChatGPT acknowledgement failed: '+childAck.message);
        await sleep(200);const text=composer.innerText,sourceText=[...composer.children].map(node=>node.textContent).join('\\n').replace(/\u00a0/g,' ');
        if(!childClick||childClick.source!==${JSON.stringify(brokenCode)}||!childClick.error.includes('Undefined control sequence'))throw Error('Expected the actual failed source and compiler error');
        if(!text.startsWith(draft)||composer.querySelector('strong')!==strong||strong.textContent!=='brouillon important')throw Error('Rich draft text or its original strong node was replaced');
        if(!sourceText.includes(childClick.source)||!sourceText.includes(childClick.error.replace(/\u00a0/g,' '))||!text.includes('Please fix this TikZ/LaTeX diagram'))throw Error('Repair request lost its source or full compiler error');
        if(submits!==0||sendClicks!==0||inputs<1)throw Error('Expected editing input without any submission');
        const askFix={realCompilerError:true,privatePortAcknowledged:true,draftPreserved:true,originalStrongNodePreserved:true,fullFailedSource:true,fullCompilerError:true,inputs,submits,sendClicks,characters:text.length};
        window.removeEventListener('message',childReport);
        await fetch(${JSON.stringify(origin+'/report')},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ok:true,stages,askFix,events:NAV_EVENTS,extension:chrome.runtime.id,userAgent:navigator.userAgent})});
      }catch(error){await fetch(${JSON.stringify(origin+'/report')},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ok:false,error:String(error),stack:error.stack,stages,events:NAV_EVENTS,frames:[...document.querySelectorAll('.latex-islands-container iframe')].map(frame=>({src:frame.src,srcdoc:frame.getAttribute('srcdoc'),height:frame.style.height}))})});}})();
    }
  `);
  child=spawn(browserBinary(),['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--disable-component-update','--remote-debugging-pipe','--enable-unsafe-extension-debugging','--user-data-dir='+profile,'--window-size=1100,900','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe','pipe','pipe']});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-5000);});child.on('error',rejectResult);
  pipe=new PipeCDP(child);
  const version=await pipe.call('Browser.getVersion');
  if(Number(version.product.match(/\/(\d+)/)?.[1])<138)throw Error('This MV3 browser test requires Chrome 138+; found '+version.product);
  const installed=await pipe.call('Extensions.loadUnpacked',{path:extension});
  console.log(JSON.stringify({phase:'extension-loaded',browser:version.product,extension:installed.id}));
  deadline=setTimeout(()=>rejectResult(Error('Actual Chromium extension navigation timed out')),150000);
  await pipe.call('Target.createTarget',{url:origin+'/c/12345678-1234-4123-8123-123456789abc'});
  const report=await result;
  const target=path.join(root,'tests/engine-fixtures/chromium-extension-navigation.json');
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify({browser:version.product,...report,serverEvents:events},null,2));
  console.log(JSON.stringify({ok:true,browser:version.product,extension:installed.id,stages:report.stages,askFix:report.askFix,portEvents:report.events.filter(event=>['probe','port','restart'].includes(event.type)),report:target},null,2));
}catch(error){
  const target=path.join(root,'tests/engine-fixtures/chromium-extension-navigation-failure.json');await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify({error:String(error),events,stderr},null,2));
  console.error(JSON.stringify({error:String(error),events:events.slice(-25),stderr,report:target},null,2));process.exitCode=1;
}finally{
  clearTimeout(deadline);if(pipe)try{await pipe.call('Browser.close');}catch{}
  if(child&&child.exitCode===null){await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);if(child.exitCode===null)child.kill();}
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  const target=path.resolve(temporary);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('latex-islands-chromium-navigation-'))throw Error('Unsafe temporary profile path');
  await fs.rm(target,{recursive:true,force:true,maxRetries:20,retryDelay:200});
}
