const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs/promises');
const path=require('node:path');
const vm=require('node:vm');
const listeners=new Map();
globalThis.self=globalThis;
globalThis.postMessage=(data)=>parentPort.postMessage(data);
globalThis.addEventListener=(type,listener)=>{ if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(listener);};
globalThis.removeEventListener=(type,listener)=>listeners.get(type)?.delete(listener);
parentPort.on('message',(data)=>{for(const fn of listeners.get('message')||[])fn({data});});
globalThis.fetch=async function(url){
 const parsed=new URL(url);
 if(parsed.origin!=='https://extension.test')throw new Error('Network request blocked in test: '+url);
 const prefix=workerData.assetPrefix || '/';
 if(!parsed.pathname.startsWith(prefix))throw new Error('Unexpected asset root');
 const basename=decodeURIComponent(parsed.pathname.slice(prefix.length));
 const target=path.resolve(workerData.engineDir,basename);
 if(!target.startsWith(workerData.engineDir+path.sep))throw new Error('Path traversal blocked');
 try {return new Response(await fs.readFile(target),{status:200});}
 catch {return new Response('missing',{status:404});}
};
(async()=>{vm.runInThisContext(await fs.readFile(path.join(workerData.engineDir,'run-tex.js'),'utf8'),{filename:'run-tex.js'});})().catch(e=>parentPort.postMessage({type:'shimerror',error:e.stack}));
