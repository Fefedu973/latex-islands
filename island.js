/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
const extensionAPI=globalThis.browser||globalThis.chrome;
const $=id=>document.getElementById(id);
const island=document.querySelector('.island'),viewport=$('viewport');
let current=null,parentOrigin=null,version=0,svgNode=null,previewCompiler=null,busy=false,warmed=false;
let editor=false,zoomValue=1,fitScale=1,panX=0,panY=0,naturalWidth=500,naturalHeight=260,drag=null;
const ownOrigin=location.protocol+'//'+location.host;
const allowedOrigins=new Set(['https://chatgpt.com','https://chat.openai.com',ownOrigin]);
function send(type,more={}) {if(current&&parentOrigin) parent.postMessage({channel:'latex-islands',type,id:current.id,...more},parentOrigin);}
function resize() {
  if(editor)return;
  const menuBottom=$('diagram-menu').hidden?0:$('diagram-menu').getBoundingClientRect().bottom+8;
  send('resize',{height:Math.min(2400,Math.ceil(Math.max(document.body.getBoundingClientRect().height,menuBottom))+2)});
}
new ResizeObserver(resize).observe(document.body);

function cleanSVG(markup) {
  let xml=new DOMParser().parseFromString(markup,'image/svg+xml');
  if(xml.querySelector('parsererror')) {
    const wrapped=new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">'+markup+'</svg>','image/svg+xml');
    const children=[...wrapped.documentElement.children];
    if(!wrapped.querySelector('parsererror')&&children.length>1&&children.every(el=>el.localName==='svg')&&[...wrapped.documentElement.childNodes].every(n=>n.nodeType===1||!n.textContent.trim())){
      const toPx=value=>{const m=String(value||'').match(/^([\d.]+)(pt|px|cm|mm|in)?$/);return m?Number(m[1])*({pt:4/3,px:1,cm:96/2.54,mm:96/25.4,in:96}[m[2]]||1):0;};
      let y=0,width=0;
      for(const child of children){const w=toPx(child.getAttribute('width')),h=toPx(child.getAttribute('height'));if(!w||!h)throw new Error('Dimensions de schéma invalides.');child.setAttribute('x','0');child.setAttribute('y',String(y));y+=h+16;width=Math.max(width,w);}
      wrapped.documentElement.setAttribute('width',String(width));wrapped.documentElement.setAttribute('height',String(y-16));wrapped.documentElement.setAttribute('viewBox',`0 0 ${width} ${y-16}`);xml=wrapped;
    }
  }
  if(xml.querySelector('parsererror') || xml.documentElement.localName!=='svg') throw new Error('Le SVG produit est invalide.');
  const allowed=new Set(['svg','g','path','defs','use','text','tspan','rect','circle','ellipse','line','polyline','polygon','clippath','mask','lineargradient','radialgradient','stop','pattern','marker','title','desc']);
  for(const el of [...xml.querySelectorAll('*')]) {
    if(!allowed.has(el.localName.toLowerCase())) {el.remove();continue;}
    for(const attr of [...el.attributes]) {
      const name=attr.name.toLowerCase(),value=attr.value;
      const urls=[...value.matchAll(/url\s*\(([^)]*)\)/gi)];
      const unsafeURL=urls.some(m=>!/^#[A-Za-z0-9_.:-]+$/.test(m[1].trim().replace(/^(['"])(.*)\1$/,'$2')));
      if(name.startsWith('on') || name==='xml:base' || ((name==='href'||name.endsWith(':href'))&&!/^#[A-Za-z0-9_.:-]+$/.test(value)) || unsafeURL || /(?:javascript\s*:|@import|expression\s*\()/i.test(value)) el.removeAttributeNode(attr);
    }
  }
  return document.importNode(xml.documentElement,true);
}

function setTheme(message) {
  if(message.theme==='dark'||message.theme==='light') document.documentElement.dataset.theme=message.theme;
  if(message.renderColors==='native'||message.renderColors==='chatgpt')document.documentElement.dataset.renderColors=message.renderColors;
  else if(!document.documentElement.dataset.renderColors)document.documentElement.dataset.renderColors='chatgpt';
  for(const key of ['text','background','surface','border']){
    const value=message.colors?.[key];
    if(typeof value==='string'&&/^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s/]+\)|hsla?\([\d.,%\s/]+\))$/i.test(value))document.documentElement.style.setProperty('--'+key,value);
  }
}
function setSourceVisible(visible){
  $('source-details').hidden=!visible;$('source-toggle').setAttribute('aria-expanded',String(visible));
  $('source-toggle').querySelector('span').textContent=visible?'Masquer le code':'Afficher le code';
  fit();resize();
}
function setView(mode){
  if(mode!=='inline'&&mode!=='editor')return;
  if(editor===(mode==='editor'))return;
  editor=mode==='editor';island.classList.toggle('editor',editor);setSourceVisible(editor);closeMenu(false);
  panX=panY=0;fit();resize();if(editor)$('close-editor').focus();
}
function setState(state,text){
  island.dataset.state=state;$('status').textContent=text;$('placeholder').hidden=state==='ready';
  $('spinner').hidden=!['streaming','loading'].includes(state);
  $('render-manual').hidden=state!=='idle';
  $('compile').disabled=busy||current?.streaming===true;
  $('retry').disabled=busy||current?.streaming===true;
  viewport.setAttribute('aria-busy',String(state==='loading'||state==='streaming'));
}
function setAvailable(available){
  for(const id of ['download','download-png','png-header','zoom-in','zoom-out','reset-zoom'])$(id).disabled=!available;
  viewport.classList.toggle('has-diagram',available);
}
function clearOutput(){
  svgNode=null;$('output').replaceChildren();setAvailable(false);$('error').hidden=true;$('error-actions').hidden=true;$('warning').hidden=true;
}
const lengthPx=value=>{
  const m=String(value||'').match(/^([\d.]+)(pt|px|cm|mm|in)?$/);
  return m?Number(m[1])*({pt:4/3,px:1,cm:96/2.54,mm:96/25.4,in:96}[m[2]]||1):0;
};
function dimensions(node){
  const view=(node.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number);
  const width=lengthPx(node.getAttribute('width'))||(view.length===4&&view[2]>0?view[2]:500);
  const height=lengthPx(node.getAttribute('height'))||(view.length===4&&view[3]>0?view[3]:260);
  return {width:Math.max(1,Math.min(width,100000)),height:Math.max(1,Math.min(height,100000))};
}
function applyTransform(){
  if(!svgNode)return;
  $('output').style.transform='translate(-50%, -50%) translate('+panX+'px, '+panY+'px) scale('+(fitScale*zoomValue)+')';
  $('zoom-out').disabled=zoomValue<=.25;$('zoom-in').disabled=zoomValue>=5;
}
function fit(){
  if(!svgNode)return;
  const width=viewport.getBoundingClientRect().width||window.innerWidth||720;
  if(!editor)viewport.style.height=Math.max(180,Math.min(640,naturalHeight*Math.min(2,(width-32)/naturalWidth)+64))+'px';
  const height=viewport.getBoundingClientRect().height||parseFloat(viewport.style.height)||500;
  fitScale=Math.min(editor?3:2,Math.max(1,width-32)/naturalWidth,Math.max(1,height-64)/naturalHeight);
  applyTransform();
}
function zoom(multiplier){
  if(!svgNode)return;zoomValue=Math.max(.25,Math.min(5,zoomValue*multiplier));applyTransform();
  $('announcement').textContent='Zoom '+Math.round(zoomValue*100)+' %';
}
function resetZoom(){zoomValue=1;panX=panY=0;fit();}
new ResizeObserver(fit).observe(viewport);
window.addEventListener('resize',fit);
async function warmup(){
  if(warmed)return;warmed=true;
  try{
    if(extensionAPI?.runtime?.id)await extensionAPI.runtime.sendMessage({channel:'latex-islands',target:'background',action:'warmup'});
    else {previewCompiler ||=new TikZCompiler();await previewCompiler.load();}
  }catch{warmed=false;} // The eventual render exposes actionable compilation errors.
}
async function render(){
  if(!current||busy||current.streaming)return;
  const mine=version,source=current.source;busy=true;$('error').hidden=true;$('error-actions').hidden=true;$('warning').hidden=true;
  setState('loading','Rendu du schéma…');
  try{
    let result;
    if(extensionAPI?.runtime?.id)result=await extensionAPI.runtime.sendMessage({channel:'latex-islands',target:'background',source});
    else {previewCompiler ||=new TikZCompiler();result=await previewCompiler.compile(source);}
    if(mine!==version)return;
    if(!result?.ok)throw new Error(result?.error||'Le compilateur est indisponible. Recharge la page après l’installation.');
    svgNode=cleanSVG(result.svg);$('output').replaceChildren(svgNode);
    const size=dimensions(svgNode);naturalWidth=size.width;naturalHeight=size.height;
    $('output').style.width=naturalWidth+'px';$('output').style.height=naturalHeight+'px';
    panX=panY=0;fit();setAvailable(true);setState('ready',result.cached?'Rendu prêt · en cache':'Rendu prêt');
    if(result.warnings?.length){$('warning').textContent=result.warnings.join('\n');$('warning').hidden=false;}
    send('result',{ok:true,source});
  }catch(e){
    if(mine===version){$('error').textContent=e.message;$('error').hidden=false;$('error-actions').hidden=false;setState('error','Le schéma n’a pas pu être affiché');send('result',{ok:false,error:e.message,source});}
  }finally{
    busy=false;$('compile').disabled=current?.streaming===true;$('retry').disabled=current?.streaming===true;resize();
    if(mine!==version&&current.autoRender!==false&&!current.streaming)render();
  }
}
window.addEventListener('message',e=>{
  const m=e.data;
  if(e.source!==parent||!allowedOrigins.has(e.origin)||m?.channel!=='latex-islands'||typeof m.id!=='string')return;
  if(m.type==='view'){
    if(!current||m.id!==current.id)return;
    parentOrigin=e.origin;setTheme(m);setView(m.mode);fit();resize();return;
  }
  if(!['render','prepare'].includes(m.type)||typeof m.source!=='string'||m.source.length>60000)return;
  parentOrigin=e.origin;setTheme(m);
  const streaming=m.type==='prepare'||m.streaming===true;
  const same=current?.source===m.source&&current.id===m.id;
  const previous=current;
  if(!same){version++;clearOutput();$('source').value=m.source;panX=panY=0;}
  else if(streaming&&!previous?.streaming){version++;clearOutput();}
  current={...m,streaming};
  if(!same||m.scale!==previous?.scale)zoomValue=[.75,1,1.25,1.5,2].includes(Number(m.scale))?Number(m.scale):1;
  if(m.mode)setView(m.mode);
  if(streaming){setState('streaming','Écriture du schéma…');warmup();}
  else if(!svgNode&&!busy){setState('idle','Schéma prêt à afficher');if(m.autoRender!==false)render();}
  else if(svgNode)fit();
  resize();
});
function compileEdits(){
  if(!current||busy||current.streaming)return;
  const source=$('source').value;
  if(source!==current.source){version++;current={...current,source,streaming:false,autoRender:true};clearOutput();send('source-change',{source});}
  render();
}
$('compile').addEventListener('click',compileEdits);
$('render-manual').addEventListener('click',render);
$('retry').addEventListener('click',render);
$('source').addEventListener('keydown',event=>{
  if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();compileEdits();}
  if(event.key==='Tab'){event.preventDefault();const input=event.currentTarget;input.setRangeText('  ',input.selectionStart,input.selectionEnd,'end');}
});
$('source-toggle').addEventListener('click',()=>setSourceVisible($('source-details').hidden));
$('error-source').addEventListener('click',()=>{setSourceVisible(true);$('source').focus();});
$('zoom-in').addEventListener('click',()=>zoom(1.25));
$('zoom-out').addEventListener('click',()=>zoom(.8));
$('reset-zoom').addEventListener('click',resetZoom);
viewport.addEventListener('dblclick',resetZoom);
viewport.addEventListener('wheel',event=>{if(svgNode&&(event.ctrlKey||event.metaKey)){event.preventDefault();zoom(event.deltaY<0?1.1:1/1.1);}},{passive:false});
viewport.addEventListener('keydown',event=>{
  if(!svgNode)return;
  if(['+','=','-','0','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))event.preventDefault();
  if(event.key==='+'||event.key==='=')zoom(1.25);
  else if(event.key==='-')zoom(.8);
  else if(event.key==='0')resetZoom();
  else if(event.key.startsWith('Arrow')){panX+=event.key==='ArrowRight'?24:event.key==='ArrowLeft'?-24:0;panY+=event.key==='ArrowDown'?24:event.key==='ArrowUp'?-24:0;applyTransform();}
});
viewport.addEventListener('pointerdown',event=>{
  if(!svgNode||event.button!==0)return;
  drag={id:event.pointerId,x:event.clientX,y:event.clientY,panX,panY};viewport.setPointerCapture?.(event.pointerId);viewport.classList.add('dragging');viewport.focus();
});
viewport.addEventListener('pointermove',event=>{
  if(!drag||drag.id!==event.pointerId)return;
  panX=drag.panX+event.clientX-drag.x;panY=drag.panY+event.clientY-drag.y;applyTransform();
});
function stopDrag(event){if(drag?.id===event.pointerId){drag=null;viewport.classList.remove('dragging');}}
viewport.addEventListener('pointerup',stopDrag);viewport.addEventListener('pointercancel',stopDrag);viewport.addEventListener('lostpointercapture',stopDrag);
function closeMenu(focus=true){const wasOpen=!$('diagram-menu').hidden;$('diagram-menu').hidden=true;$('menu-toggle').setAttribute('aria-expanded','false');if(focus)$('menu-toggle').focus();if(wasOpen)resize();}
$('menu-toggle').addEventListener('click',()=>{
  const open=$('diagram-menu').hidden;$('diagram-menu').hidden=!open;$('menu-toggle').setAttribute('aria-expanded',String(open));
  if(open)$('diagram-menu').querySelector('button:not(:disabled)').focus();resize();
});
$('diagram-menu').addEventListener('click',event=>{if(event.target.closest('button'))closeMenu();});
$('diagram-menu').addEventListener('keydown',event=>{
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const buttons=[...$('diagram-menu').querySelectorAll('button:not(:disabled)')],i=buttons.indexOf(document.activeElement);
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
  buttons[next]?.focus();
});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.floating-tools'))closeMenu(false);});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    if(!$('diagram-menu').hidden){event.preventDefault();closeMenu();}
    else if(editor){event.preventDefault();send('close-editor');}
  }
  if(event.key==='Tab'&&editor){
    const candidates=[...document.querySelectorAll('button:not(:disabled),textarea,[tabindex="0"]')].filter(el=>!el.closest('[hidden]')&&el.getClientRects().length);
    const first=candidates[0],last=candidates.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
});
$('open-editor').addEventListener('click',()=>send('open-editor',{source:current?.source||''}));
$('close-editor').addEventListener('click',()=>send('close-editor'));
async function copySource(){
  try{await navigator.clipboard.writeText($('source').value);$('announcement').textContent='Code copié';}
  catch{setSourceVisible(true);$('source').focus();$('source').select();$('announcement').textContent='Sélectionne le code puis copie-le avec Ctrl ou ⌘ + C.';}
}
$('copy-source').addEventListener('click',copySource);$('copy-header').addEventListener('click',copySource);
const fontCache=new Map();
async function fontData(family){
  if(!fontCache.has(family))fontCache.set(family,(async()=>{
    const response=await fetch('vendor/tikzjax/fonts/'+family+'.woff2');if(!response.ok)return '';
    const bytes=new Uint8Array(await response.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
    return "@font-face{font-family:'"+family+"';src:url(data:font/woff2;base64,"+btoa(binary)+") format('woff2');}";
  })().catch(()=>{fontCache.delete(family);return '';}));
  return fontCache.get(family);
}
async function exportSVG(){
  if(!svgNode)return null;
  const clone=svgNode.cloneNode(true),size=dimensions(svgNode);
  // Pan/zoom belongs to the HTML wrapper; retain the SVG's own visual styles.
  clone.removeAttribute('data-width');
  if(!clone.hasAttribute('viewBox'))clone.setAttribute('viewBox','0 0 '+size.width+' '+size.height);
  const families=new Set();
  for(const el of [clone,...clone.querySelectorAll('[font-family],[style]')]){
    const family=el.getAttribute('font-family')||el.style.fontFamily;
    for(const name of (family||'').split(',')){const clean=name.trim().replace(/["']/g,'');if(/^[A-Za-z0-9-]+$/.test(clean))families.add(clean);}
  }
  const css=(await Promise.all([...families].map(fontData))).join('');
  if(css){const style=document.createElementNS('http://www.w3.org/2000/svg','style');style.textContent=css;clone.prepend(style);}
  return {blob:new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml;charset=utf-8'}),...size};
}
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function download(kind){
  if(!svgNode)return;
  const nativeColors=document.documentElement.dataset.renderColors==='native';
  const adaptDark=!nativeColors&&document.documentElement.dataset.theme==='dark';
  const background=nativeColors?'#ffffff':getComputedStyle(document.documentElement).getPropertyValue('--background').trim()||(adaptDark?'#212121':'#ffffff');
  try{
    const exported=await exportSVG();if(!exported)return;
    if(kind==='svg'){downloadBlob(exported.blob,'schema-tikz.svg');return;}
    const url=URL.createObjectURL(exported.blob);
    try{
      const img=new Image();
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Impossible de préparer le PNG.'));img.src=url;});
      const scale=Math.min(2,8192/exported.width,8192/exported.height,Math.sqrt(16777216/(exported.width*exported.height)));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(exported.width*scale));canvas.height=Math.max(1,Math.ceil(exported.height*scale));
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Le navigateur ne permet pas l’export PNG.');
      ctx.fillStyle=background;
      ctx.fillRect(0,0,canvas.width,canvas.height);
      if(adaptDark)ctx.filter='invert(1) hue-rotate(180deg)';
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Impossible de créer le PNG.');
      downloadBlob(blob,'schema-tikz.png');
    }finally{URL.revokeObjectURL(url);}
  }catch(e){$('announcement').textContent=e.message;$('warning').textContent=e.message;$('warning').hidden=false;resize();}
}
$('download').addEventListener('click',()=>download('svg'));
$('download-png').addEventListener('click',()=>download('png'));
$('png-header').addEventListener('click',()=>download('png'));
