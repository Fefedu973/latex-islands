/* SPDX-License-Identifier: GPL-3.0-or-later
 * Real offline TeX/WASM + SVG regression for the bundled Euler font tables.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Worker}=require('node:worker_threads');
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
async function render(name,expression){
  const svg=await rpc('texify','\\begin{tikzpicture}\\node {$'+expression+'$};\\end{tikzpicture}',{texPackages:{amsmath:'',amsfonts:''}});
  assert.match(svg,/^<svg[\s>]/);
  assert.doesNotMatch(svg,/NaN|undefined/);
  fs.mkdirSync(path.join(__dirname,'engine-fixtures'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'engine-fixtures',name+'.svg'),svg);
  return svg;
}
(async()=>{
  const watchdog=setTimeout(()=>{console.error('Euler engine test timed out.');worker.terminate();process.exitCode=1;},30000);
  try{
    await ready;await rpc('load','https://extension.test/');
    const regular=await render('euler-regular',String.raw`\mathfrak{ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789}`);
    assert.match(regular,/font-family="eufm10"/);
    for(const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')assert.ok(regular.includes('&#x'+(0xF000+char.charCodeAt(0)).toString(16)+';'),char+' must use its verified BaKoMa glyph.');
    const bold=await render('euler-bold',String.raw`\boldsymbol{\mathfrak{ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789}}`);
    assert.match(bold,/font-family="eufb10"/);
    const styles=await render('euler-styles',String.raw`\mathfrak{g}_{\mathfrak{h}_{\mathfrak{k}}}+\boldsymbol{\mathfrak{g}_{\mathfrak{h}_{\mathfrak{k}}}}`);
    for(const font of ['eufm10','eufm7','eufm5','eufb10','eufb7','eufb5'])assert.ok(styles.includes('font-family="'+font+'"'),font);
    // TFM ec is inclusive: the last valid Euler character is alternate digit 1.
    const last=await render('euler-last-slot',String.raw`\mathfrak{\mathchar"707F}+\boldsymbol{\mathfrak{\mathchar"707F}}`);
    assert.match(last,/font-family="eufm10"/);
    assert.match(last,/font-family="eufb10"/);
    assert.equal((last.match(/&#xf0c4;/g)||[]).length,2);
    const alternates=await render('euler-alternates',String.raw`\mathfrak{\mathchar"7000\mathchar"7001\mathchar"7002\mathchar"7003\mathchar"7004\mathchar"7005\mathchar"7006\mathchar"7007}`);
    assert.match(alternates,/font-family="eufm10"/);
    for(let code=0xF0A1;code<=0xF0A8;code++)assert.ok(alternates.includes('&#x'+code.toString(16)+';'));
    console.log('PASS Euler regular/bold alphabets and digits, all six optical sizes, alternate glyph mappings and final TFM slot');
  }finally{clearTimeout(watchdog);await worker.terminate();}
})().catch(error=>{console.error(error);process.exitCode=1;});
