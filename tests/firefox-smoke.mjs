/* SPDX-License-Identifier: GPL-3.0-or-later
 * Real Firefox smoke on synthetic fixtures and a new temporary profile.
 * Run npm run build, then node tests/firefox-smoke.mjs [dist/firefox].
 * Test-only instrumentation is applied to a temporary COPY of the release:
 * localhost fixture matches/CSP, observer/bootstrap scripts, and localhost as
 * an allowed island parent. No user profile, ChatGPT session, or store is used.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import webExt from 'web-ext';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(process.argv[2]||path.join(root,'dist/firefox'));
const firefox=process.env.FIREFOX_BINARY||(process.platform==='win32'?'C:/Program Files/Mozilla Firefox/firefox.exe':'firefox');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'latex-islands-firefox-smoke-'));
const extension=path.join(temporary,'extension'),profile=path.join(temporary,'profile');
const id='01234567-89ab-4cde-8f01-23456789abcd';
const tikz=String.raw`\begin{tikzpicture}\draw[red] (0,0)--(1,1);\node at (0,1) {Firefox smoke};\end{tikzpicture}`;
const reports=new Map(),events=[];let runtime,timeout,requests=0,resolveResults,rejectResults;
const results=new Promise((resolve,reject)=>{resolveResults=resolve;rejectResults=reject;});
const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const server=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.end();return;}
  if(req.url==='/event'&&req.method==='POST'){let data='';for await(const chunk of req)data+=chunk;try{events.push(JSON.parse(data));}catch{}res.end();return;}
  if(req.url==='/report'&&req.method==='POST'){
    let data='';for await(const chunk of req){data+=chunk;if(data.length>100000){res.statusCode=413;res.end();return;}}
    try{const report=JSON.parse(data);reports.set(report.context,report);res.end('ok');if(reports.size===2)resolveResults([...reports.values()]);}
    catch(error){rejectResults(error);res.statusCode=400;res.end();}return;
  }
  if(req.url?.startsWith('/backend-api/')){
    requests++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({title:'Firefox synthetic export',conversation_id:id,messages:[{id:'u',author:{role:'user'},content:{content_type:'text',parts:['API question']}},{id:'a',author:{role:'assistant'},channel:'final',content:{content_type:'text',parts:['API answer **formatted**']}}],page_info:{has_previous_page:false,has_next_page:false,start_cursor:null}}));return;
  }
  if(req.url?.startsWith('/c/')){
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html class="dark"><head><style>body{background:#212121;color:#eee;font:16px sans-serif}</style></head><body><header id="page-header"><div id="conversation-header-actions"><button>Share</button></div></header><main><section data-message-author-role="assistant"><div class="markdown"><pre id="diagram"><code class="language-tikz">'+escape(tikz)+'</code></pre></div></section></main><script src="/fixture-driver.js"></script></body></html>');return;
  }
  if(req.url==='/fixture-driver.js'){
    res.setHeader('Content-Type','text/javascript');res.end(`
      const events=[];window.addEventListener('message',event=>{if(event.data?.channel==='latex-islands')events.push({type:event.data.type,ok:event.data.ok,origin:event.origin,sourceNull:event.source===null,error:event.data.error});});
      const wait=async(check,label)=>{for(let n=0;n<600;n++){const value=check();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error(label+' timed out '+JSON.stringify(events));};
      (async()=>{try{
        await wait(()=>document.querySelector('#diagram.latex-islands-original-hidden'),'content render');
        const toggle=await wait(()=>document.querySelector('.li-export-toggle'),'export controls');toggle.click();document.querySelector('.li-export-inspect').click();
        await wait(()=>document.querySelector('.li-export-dialogue')?.textContent.includes('API answer'),'MAIN-world API export '+document.querySelector('.li-export-status')?.textContent);
        const palette=JSON.parse(JSON.stringify(events));
        await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:'content',ok:true,events:palette,exportedAPIText:true})});
      }catch(error){await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:'content',ok:false,error:String(error),events,frames:document.querySelectorAll('.latex-islands-container iframe').length,exportControls:!!document.querySelector('.li-export-toggle')})});}})();
    `);return;
  }
  res.statusCode=404;res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
try{
  await fs.cp(source,extension,{recursive:true});await fs.mkdir(profile);
  const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));
  const fixtureMatch='http://127.0.0.1/*';
  manifest.host_permissions=[...(manifest.host_permissions||[]),fixtureMatch];
  manifest.content_security_policy.extension_pages=manifest.content_security_policy.extension_pages.replace("connect-src 'self'","connect-src 'self' "+origin);
  for(const script of manifest.content_scripts)script.matches.push(fixtureMatch);
  for(const resource of manifest.web_accessible_resources)resource.matches.push(fixtureMatch);
  manifest.background.scripts.unshift('smoke-observer.js');manifest.background.scripts.push('smoke-bootstrap.js');
  await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest,null,2));
  const islandFile=path.join(extension,'island.js');let island=await fs.readFile(islandFile,'utf8');
  island=island.replace("const allowedOrigins=new Set(","const smokeLocalOrigin="+JSON.stringify(origin)+";\nconst allowedOrigins=new Set(").replace("'https://chat.openai.com',ownOrigin]","'https://chat.openai.com',ownOrigin,smokeLocalOrigin]");
  island+=`\nwindow.addEventListener('message',event=>{fetch(${JSON.stringify(origin+'/event')},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({where:'island',type:event.data?.type,origin:event.origin,sourceNull:event.source===null,parent:event.source===parent,id:event.data?.id})});});\n`;
  await fs.writeFile(islandFile,island);
  await fs.writeFile(path.join(extension,'smoke-observer.js'),`
    globalThis.smokeWorkerCount=0;const RealWorker=globalThis.Worker;globalThis.Worker=class extends RealWorker{constructor(...args){super(...args);globalThis.smokeWorkerCount++;}};
    browser.runtime.onMessage.addListener(message=>{if(message?.channel==='smoke-status')return Promise.resolve({workers:globalThis.smokeWorkerCount});});
  `);
  await fs.writeFile(path.join(extension,'smoke-bootstrap.js'),`browser.storage.local.set({demoSource:${JSON.stringify(tikz)},demoExample:'custom',uiTheme:'dark',renderColors:'native'}).then(()=>Promise.all([browser.tabs.create({url:browser.runtime.getURL('smoke.html')}),browser.tabs.create({url:${JSON.stringify(origin+'/c/'+id)}})]));`);
  await fs.writeFile(path.join(extension,'smoke.html'),'<!doctype html><html><head><meta charset="utf-8"></head><body><script src="smoke.js"></script></body></html>');
  await fs.writeFile(path.join(extension,'smoke.js'),`
    const wait=async(check,label)=>{for(let n=0;n<600;n++){const value=check();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw Error(label+' timed out');};
    const report=data=>fetch(${JSON.stringify(origin+'/report')},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:'extension',...data})});
    (async()=>{try{
      const demo=document.createElement('iframe');demo.src=browser.runtime.getURL('demo.html');document.body.append(demo);
      const diagram=await wait(()=>demo.contentDocument?.querySelector('#preview iframe'),'demo iframe');
      const svg=await wait(()=>diagram.contentDocument?.querySelector('#output svg'),'real compiler SVG');
      const doc=diagram.contentDocument,win=diagram.contentWindow;
      if(doc.documentElement.dataset.renderColors!=='native'||win.getComputedStyle(doc.getElementById('output')).filter!=='none')throw Error('Native colors not applied');
      if(win.getComputedStyle(doc.getElementById('viewport')).backgroundColor!=='rgb(255, 255, 255)')throw Error('Native canvas not white');
      const before=await browser.runtime.sendMessage({channel:'smoke-status'});
      await browser.storage.local.set({renderColors:'chatgpt'});await wait(()=>doc.documentElement.dataset.renderColors==='chatgpt','live colors');
      if(doc.querySelector('#output svg')!==svg)throw Error('Color change replaced SVG');
      const popup=document.createElement('iframe');popup.src=browser.runtime.getURL('popup.html');document.body.append(popup);
      await wait(()=>popup.contentDocument?.querySelector('#renderColors')?.value==='chatgpt','popup preferences');
      const after=await browser.runtime.sendMessage({channel:'smoke-status'});
      if(before.workers!==1||after.workers!==1)throw Error('Expected shared single worker: '+JSON.stringify({before,after}));
      await report({ok:true,firefox:navigator.userAgent,svg:true,sharedWorkers:after.workers,liveColors:true,popup:true});
    }catch(error){await report({ok:false,error:String(error),stack:error.stack});}})();
  `);
  timeout=setTimeout(()=>rejectResults(new Error('Firefox smoke timed out; reports='+JSON.stringify([...reports.values()]))),90000);
  runtime=await webExt.cmd.run({sourceDir:extension,firefox,firefoxProfile:profile,keepProfileChanges:true,noInput:true,noReload:true,args:['-headless'],startUrl:['about:blank'],artifactsDir:path.join(temporary,'artifacts')},{shouldExitProgram:false});
  const data=await results;
  if(data.some(report=>!report.ok))throw Error(JSON.stringify({reports:data,events},null,2));
  if(requests!==1)throw Error('Expected one synthetic conversation request, got '+requests);
  console.log(JSON.stringify({ok:true,fixtureRequests:requests,reports:data},null,2));
}finally{
  clearTimeout(timeout);if(runtime)await runtime.exit();await new Promise(resolve=>server.close(resolve));
  // Only remove the directory created by mkdtemp above, never a user profile.
  const target=path.resolve(temporary);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('latex-islands-firefox-smoke-'))throw Error('Unsafe temporary path');
  await fs.rm(target,{recursive:true,force:true,maxRetries:20,retryDelay:200});
}
