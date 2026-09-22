/* SPDX-License-Identifier: GPL-3.0-or-later
 * Exercise the unchanged cancel package through the packaged PGF adapter.
 * Real bundled TeX/WASM and SVG conversion, with no network access.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const {Worker}=require('node:worker_threads');
const {JSDOM}=require('jsdom');
const engineDir=path.resolve(__dirname,'../vendor/tikzjax');
const worker=new Worker(path.join(__dirname,'engine-worker-shim.cjs'),{workerData:{engineDir}});
let sequence=0,resolveReady;
const ready=new Promise(resolve=>{resolveReady=resolve;});
const pending=new Map();
worker.on('message',message=>{
  if(message.type==='init')return resolveReady();
  const task=pending.get(message.uid);
  if(!task)return;
  if(message.type==='result'&&message.complete){pending.delete(message.uid);task.resolve(message.payload);}
  else if(message.type==='error'){pending.delete(message.uid);task.reject(Error(message.error?.message||JSON.stringify(message.error)));}
});
worker.on('error',error=>{for(const task of pending.values())task.reject(error);pending.clear();});
function rpc(method,...args){return new Promise((resolve,reject)=>{const uid=++sequence;pending.set(uid,{resolve,reject});worker.postMessage({type:'run',uid,method,args});});}
function inheritedAttribute(node,name){
  for(let element=node;element;element=element.parentElement)if(element.hasAttribute(name))return element.getAttribute(name);
  return null;
}
async function render(expression,{options='',preamble='',text=false}={}){
  const body='\\begin{tikzpicture}\\node {'+(text?expression:'$'+expression+'$')+'};\\end{tikzpicture}';
  const svg=await rpc('texify',body,{texPackages:{cancel:options,'latex-islands-cancel':''},addToPreamble:preamble});
  assert.match(svg,/^<svg[\s>]/);
  assert.doesNotMatch(svg,/line10|linew10/);
  const doc=new JSDOM(svg,{contentType:'image/svg+xml'}).window.document;
  const paths=[...doc.querySelectorAll('path')];
  assert.ok(paths.length,'Cancellation marks must remain visible vector paths.');
  for(const item of paths){
    assert.notEqual(inheritedAttribute(item,'stroke'),'none','A PGF mark must not inherit the surrounding SVG text stroke=none.');
    assert.doesNotMatch(item.getAttribute('d'),/NaN|Infinity/);
  }
  return {svg,doc,paths,width:parseFloat(doc.documentElement.getAttribute('width'))};
}
(async()=>{
  const watchdog=setTimeout(()=>{console.error('Cancellation engine test timed out.');worker.terminate();process.exitCode=1;},30000);
  try{
    // The source archive carries the readable preferred form of the packaged adapter.
    assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(engineDir,'tex_files/latex-islands-cancel.sty.gz'))).toString(),fs.readFileSync(path.join(engineDir,'source/latex-islands-cancel.sty'),'utf8'));
    await ready;await rpc('load','https://extension.test/');
    for(const [command,count] of [[String.raw`\cancel{x}`,1],[String.raw`\bcancel{x}`,1],[String.raw`\xcancel{x}`,2],[String.raw`\cancelto{0}{x}`,2]]){
      const result=await render(command);
      assert.equal(result.paths.length,count,command);
      console.log('PASS vector cancellation',command);
    }
    await render(String.raw`\cancel{wide words}`,{text:true});
    await render(String.raw`\cancel{\frac{a+b}{c+d}}+\cancel{\bcancel{x}}`);
    const script=await render(String.raw`x_{\cancelto{0}{\alpha}}`,{options:'makeroom'});
    assert.match(script.svg,/font-family="cmmi7"/);
    assert.match(script.svg,/font-family="cmr5"/);
    const normal=await render(String.raw`\cancel{x}`);
    const thick=await render(String.raw`\cancel{x}`,{options:'thicklines'});
    assert.ok(Number(inheritedAttribute(thick.paths[0],'stroke-width'))>Number(inheritedAttribute(normal.paths[0],'stroke-width')));
    const color=await render(String.raw`\cancel{x}`,{preamble:String.raw`\renewcommand{\CancelColor}{\color{red}}`});
    assert.equal(inheritedAttribute(color.paths[0],'stroke'),'#f00');
    const overlap=await render(String.raw`\cancelto{12345}{x}`,{options:'overlap'});
    const room=await render(String.raw`\cancelto{12345}{x}`,{options:'makeroom'});
    assert.ok(room.width>overlap.width,'makeroom reserves the cancellation target width.');
    const same=await render(String.raw`\cancelto{0}{x}`,{options:'samesize'});
    const small=await render(String.raw`\cancelto{0}{x}`,{options:'smaller'});
    const smaller=await render(String.raw`\displaystyle\cancelto{0}{x}`,{options:'Smaller'});
    assert.match(same.svg,/font-family="cmr10"/);
    assert.match(small.svg,/font-family="cmr7"/);
    assert.match(smaller.svg,/font-family="cmr7"/);
    console.log('PASS cancellation text, nested expressions, script styles, color and all package options');
  }finally{clearTimeout(watchdog);await worker.terminate();}
})().catch(error=>{console.error(error);process.exitCode=1;});
