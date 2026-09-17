/* SPDX-License-Identifier: GPL-3.0-or-later
 * First-paint regression in an isolated real Chromium browser (Node.js 22+).
 * Run: node tests/font-render.browser.cjs
 * Negative control: node tests/font-render.browser.cjs --island-ref=v1.4.1
 * Set CHROME_BINARY to override browser discovery. No user profile is opened.
 * Production island files are served unchanged, except a test-only runtime
 * script inserted into the HTML response. Fonts are held until the pending
 * assertions finish, then delayed at least 250 ms from each request.
 */
'use strict';
const fs=require('node:fs/promises');
const fsSync=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const modes=[{name:'dark',theme:'dark',renderColors:'chatgpt'},{name:'light',theme:'light',renderColors:'chatgpt'},{name:'native',theme:'dark',renderColors:'native'}];
const fallbackSVG='<svg xmlns="http://www.w3.org/2000/svg" width="280" height="130" viewBox="0 0 280 130"><path d="M20 100H260M20 100V20" fill="none" stroke="black"/><text x="40" y="45" font-family="cmr10" font-size="24">&#xf046;&#xf06f;&#xf06e;&#xf074;</text><text x="40" y="80" font-family="cmmi10" font-size="24">&#xf045;&#xf06d;&#xf063;</text><text x="150" y="80" font-family="cmsy10" font-size="24">&#xf0a1;</text></svg>';

function browserBinary(){
  if(process.env.CHROME_BINARY)return process.env.CHROME_BINARY;
  const candidates=process.platform==='win32'?
    [path.join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe')]:
    process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']:['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/microsoft-edge'];
  const found=candidates.find(candidate=>fsSync.existsSync(candidate));
  if(!found)throw Error('Chromium browser not found. Set CHROME_BINARY to a Chrome or Edge executable.');
  return found;
}
async function until(read,label,timeout=15000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const result=await read();if(result)return result;await sleep(25);}
  throw Error(label+' timed out');
}
class CDP{
  constructor(socket){
    this.socket=socket;this.next=0;this.pending=new Map();this.errors=[];
    socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.method==='Runtime.exceptionThrown')this.errors.push(message.params.exceptionDetails.text+': '+(message.params.exceptionDetails.exception?.description||''));
      if(!message.id)return;
      const pending=this.pending.get(message.id);if(!pending)return;
      this.pending.delete(message.id);clearTimeout(pending.timeout);
      if(message.error)pending.reject(Error(message.error.message));else pending.resolve(message.result);
    });
    socket.addEventListener('close',()=>{for(const pending of this.pending.values()){clearTimeout(pending.timeout);pending.reject(Error('Browser connection closed'));}this.pending.clear();});
  }
  static async connect(url){
    const socket=new WebSocket(url);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Could not connect to browser')), {once:true});});
    return new CDP(socket);
  }
  call(method,params={}){
    const id=++this.next;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP timeout: '+method));},15000);
      this.pending.set(id,{resolve,reject,timeout});this.socket.send(JSON.stringify({id,method,params}));
    });
  }
  async evaluate(expression){
    const result=await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result.value;
  }
}

// Decode screenshots rather than comparing PNG compression/metadata bytes.
function pngPixels(buffer){
  if(!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid screenshot PNG');
  let width,height,channels;const compressed=[];
  for(let offset=8;offset<buffer.length;){
    const length=buffer.readUInt32BE(offset),type=buffer.toString('ascii',offset+4,offset+8),data=buffer.subarray(offset+8,offset+8+length);offset+=12+length;
    if(type==='IHDR'){
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      if(data[8]!==8||![2,6].includes(data[9])||data[12]!==0)throw Error('Unsupported screenshot PNG encoding');
      channels=data[9]===6?4:3;
    }else if(type==='IDAT')compressed.push(data);
  }
  const raw=zlib.inflateSync(Buffer.concat(compressed)),stride=width*channels,pixels=Buffer.alloc(width*height*channels);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let row=0;row<height;row++){
    const filter=raw[row*(stride+1)];if(filter>4)throw Error('Invalid PNG row filter');
    for(let column=0;column<stride;column++){
      const index=row*stride+column,left=column>=channels?pixels[index-channels]:0,up=row?pixels[index-stride]:0,upperLeft=row&&column>=channels?pixels[index-stride-channels]:0;
      const predicted=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,upperLeft);
      pixels[index]=(raw[row*(stride+1)+1+column]+predicted)&255;
    }
  }
  return {width,height,channels,pixels};
}
function pixelDifference(before,after){
  const a=pngPixels(before),b=pngPixels(after);
  if(a.width!==b.width||a.height!==b.height||a.channels!==b.channels)throw Error('Screenshot dimensions changed after hover');
  let changed=0;
  for(let index=0;index<a.pixels.length;index+=a.channels){for(let channel=0;channel<a.channels;channel++){if(a.pixels[index+channel]!==b.pixels[index+channel]){changed++;break;}}}
  return changed;
}
const stateExpression=`(() => {
  const frame=document.querySelector('iframe'),doc=frame?.contentDocument,win=frame?.contentWindow;
  if(!doc?.querySelector('.island'))return null;
  const output=doc.getElementById('output'),svg=output.querySelector('svg');
  let visible=!!svg;const filters=[];
  for(let node=svg;node;node=node.parentElement){const style=win.getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)visible=false;if(style.filter!=='none')filters.push(style.filter);}
  const families=[...new Set([...(svg?.querySelectorAll('[font-family]')||[])].map(node=>node.getAttribute('font-family')))];
  return {state:doc.querySelector('.island').dataset.state,visible,svg:!!svg,placeholderHidden:doc.getElementById('placeholder').hidden,downloadEnabled:!doc.getElementById('download').disabled,
    readyMessages:(window.testMessages||[]).filter(message=>message.type==='result'&&message.ok).length,
    fontStatus:doc.fonts.status,fonts:[...doc.fonts].filter(face=>families.includes(face.family.replace(/['"]/g,''))).map(face=>({family:face.family,status:face.status})),
    filter:win.getComputedStyle(output).filter,filters,background:win.getComputedStyle(doc.getElementById('viewport')).backgroundColor,
    error:doc.getElementById('error').hidden?'':doc.getElementById('error').textContent};
})()`;

async function main(){
  const refArgument=process.argv.slice(2).find(argument=>argument.startsWith('--island-ref='));
  const sourceRef=refArgument?.slice('--island-ref='.length);
  if(sourceRef&&!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(sourceRef))throw Error('Invalid --island-ref');
  const sourceFiles=new Map();
  for(const filename of ['island.html','island.css','island.js','core.js','compiler.js'])sourceFiles.set(filename,sourceRef&&filename.startsWith('island.')?execFileSync('git',['show',sourceRef+':'+filename],{cwd:root,encoding:'utf8'}):await fs.readFile(path.join(root,filename),'utf8'));
  let fixture='tests/engine-fixtures/circuitikz.svg',svg;
  try{svg=await fs.readFile(path.join(root,fixture),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;fixture='built-in synthetic PUA SVG';svg=fallbackSVG;}
  if(!/&#x[fF][0-8][\da-fA-F]{2};|[\uE000-\uF8FF]/.test(svg))throw Error('Expected TeX private-use glyphs in SVG fixture');
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'latex-islands-font-render-'));
  const profile=path.join(temporary,'profile');await fs.mkdir(profile);
  const browser=browserBinary(),cases=new Map(modes.map(mode=>[mode.name,{...mode,requests:[],released:false}]));
  const responses=new Set(),reports=[];let child,cdp,stderr='';
  const server=http.createServer(async(request,response)=>{
    try{
      const url=new URL(request.url,'http://localhost');
      const [,name,...parts]=url.pathname.split('/'),testCase=cases.get(name),filename=parts.join('/');
      if(!testCase){response.writeHead(404);response.end();return;}
      response.setHeader('Cache-Control','no-store');
      if(filename==='fixture.html'){
        const background=testCase.theme==='dark'?'#212121':'#fff';
        response.setHeader('Content-Type','text/html;charset=utf-8');response.end(`<!doctype html><html><head><style>body{margin:0;background:${background}}iframe{position:absolute;left:40px;top:20px;width:900px;height:750px;border:0}</style></head><body><iframe src="/${name}/island.html"></iframe><script>
          window.testMessages=[];window.addEventListener('message',event=>{if(event.source===document.querySelector('iframe').contentWindow&&event.data?.channel==='latex-islands')window.testMessages.push(event.data);});
          document.querySelector('iframe').addEventListener('load',()=>document.querySelector('iframe').contentWindow.postMessage({channel:'latex-islands',type:'render',id:'font-test',source:'synthetic cached circuit',autoRender:true,theme:${JSON.stringify(testCase.theme)},renderColors:${JSON.stringify(testCase.renderColors)}},location.origin));
        </script></body></html>`);return;
      }
      if(filename==='test-runtime.js'){
        response.setHeader('Content-Type','text/javascript');response.end(`globalThis.browser={runtime:{id:'font-render-test',sendMessage:async message=>message.action==='warmup'?{ok:true}:{ok:true,cached:true,svg:${JSON.stringify(svg)}}}};`);return;
      }
      if(sourceFiles.has(filename)){
        response.setHeader('Content-Type',filename.endsWith('.html')?'text/html;charset=utf-8':filename.endsWith('.css')?'text/css':'text/javascript');
        const source=sourceFiles.get(filename);response.end(filename==='island.html'?source.replace('<head>','<head><script src="test-runtime.js"></script>'):source);return;
      }
      if(filename==='vendor/tikzjax/fonts.css'||/^vendor\/tikzjax\/fonts\/[A-Za-z0-9-]+\.woff2$/.test(filename)){
        const data=await fs.readFile(path.join(root,filename));
        response.setHeader('Content-Type',filename.endsWith('.css')?'text/css':'font/woff2');
        if(filename.endsWith('.woff2')){
          const fontRequest={font:path.basename(filename),requested:Date.now(),finished:null};testCase.requests.push(fontRequest);
          const release=()=>{
            if(!testCase.released)return;
            responses.delete(release);
            const finish=()=>{
              const remaining=250-(Date.now()-fontRequest.requested);
              if(remaining>0){setTimeout(finish,remaining).unref();return;}
              fontRequest.finished=Date.now();response.end(data);
            };
            finish();
          };
          responses.add(release);release();return;
        }
        response.end(data);return;
      }
      response.writeHead(404);response.end();
    }catch(error){response.statusCode=500;response.end(String(error));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    child=spawn(browser,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--disable-extensions','--disable-component-update','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=1000,820','--force-device-scale-factor=1','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    let spawnError;child.on('error',error=>{spawnError=error;});child.stderr.on('data',data=>{stderr=(stderr+data).slice(-6000);});
    const debugPort=await until(async()=>{if(spawnError)throw spawnError;if(child.exitCode!==null)throw Error('Browser exited: '+stderr);try{return (await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0];}catch{return false;}},'Browser startup');
    const target=await (await fetch('http://127.0.0.1:'+debugPort+'/json/new?about:blank',{method:'PUT'})).json();
    cdp=await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');await cdp.call('Network.setCacheDisabled',{cacheDisabled:true});
    await cdp.call('Emulation.setDeviceMetricsOverride',{width:1000,height:820,deviceScaleFactor:1,mobile:false});
    const browserVersion=await cdp.call('Browser.getVersion');
    const screenshot=async(filename,diagramOnly=false)=>{
      // Hover intentionally reveals the toolbar; compare the diagram itself.
      const clip=await cdp.evaluate(`(() => {const frame=document.querySelector('iframe'),outer=frame.getBoundingClientRect(),inner=frame.contentDocument.getElementById('${diagramOnly?'output':'viewport'}').getBoundingClientRect();return {x:Math.floor(outer.left+inner.left),y:Math.floor(outer.top+inner.top),width:Math.ceil(inner.width),height:Math.ceil(inner.height),scale:1};})()`);
      const {data}=await cdp.call('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:false});
      const bytes=Buffer.from(data,'base64');await fs.writeFile(path.join(temporary,filename),bytes);return bytes;
    };
    for(const mode of modes){
      const testCase=cases.get(mode.name),failures=[];
      await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:980,y:800});
      await cdp.call('Page.navigate',{url:origin+'/'+mode.name+'/fixture.html'});
      await until(()=>testCase.requests.length>0,'Font request in '+mode.name);
      await cdp.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const pending=await cdp.evaluate(stateExpression);
      if(pending.visible)failures.push('Diagram visible before its fonts loaded');
      if(pending.readyMessages||pending.state==='ready')failures.push('Ready reported before fonts loaded');
      if(pending.downloadEnabled)failures.push('Download enabled before fonts loaded');
      if(pending.placeholderHidden)failures.push('Loading indicator hidden before fonts loaded');
      await screenshot(mode.name+'-pending.png');
      testCase.released=true;for(const release of [...responses])release();
      const ready=await until(async()=>{const state=await cdp.evaluate(stateExpression);if(state?.error)throw Error(mode.name+': '+state.error);return state?.visible&&state.readyMessages&&state.fontStatus==='loaded'&&state.fonts.length>=3&&state.fonts.every(font=>font.status==='loaded')?state:false;},'Loaded diagram in '+mode.name);
      await cdp.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const before=await screenshot(mode.name+'-before-hover.png',true);
      const center=await cdp.evaluate(`(() => {const frame=document.querySelector('iframe'),outer=frame.getBoundingClientRect(),inner=frame.contentDocument.getElementById('viewport').getBoundingClientRect();return {x:outer.left+inner.left+inner.width/2,y:outer.top+inner.top+inner.height/2};})()`);
      await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...center});
      await cdp.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const after=await screenshot(mode.name+'-after-hover.png',true),changedPixels=pixelDifference(before,after);
      if(changedPixels)failures.push(changedPixels+' diagram pixels changed on hover');
      if(mode.name==='dark'&&!ready.filters.some(filter=>filter.includes('invert')))failures.push('Dark adaptation not exercised');
      if(mode.name==='native'&&(ready.filters.length||ready.background!=='rgb(255, 255, 255)'))failures.push('Native white preview not exercised');
      if(testCase.requests.some(request=>!request.finished||request.finished-request.requested<250))failures.push('Font response did not observe the intended delay');
      reports.push({mode:mode.name,ok:failures.length===0,failures,pending,ready,changedPixels,screenshotSHA256:crypto.createHash('sha256').update(before).digest('hex'),fontRequests:testCase.requests.map(request=>({font:request.font,delayMs:request.finished-request.requested}))});
    }
    const report={ok:reports.every(result=>result.ok)&&cdp.errors.length===0,browser:browserVersion.product,sourceRef:sourceRef||'working tree',fixture,artifacts:temporary,results:reports,browserErrors:cdp.errors};
    await fs.writeFile(path.join(temporary,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    if(!report.ok)process.exitCode=1;
  }finally{
    if(cdp){try{await cdp.call('Browser.close');}catch{}cdp.socket.close();}
    if(child&&child.exitCode===null){await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(3000)]);if(child.exitCode===null)child.kill();}
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    // Delete only the fresh profile created above; retain synthetic screenshots.
    const target=path.resolve(profile);
    if(path.dirname(target)!==path.resolve(temporary)||!path.basename(temporary).startsWith('latex-islands-font-render-'))throw Error('Unsafe temporary profile path');
    await fs.rm(target,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
