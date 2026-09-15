const {Worker}=require('node:worker_threads');
const fs=require('node:fs/promises');
const path=require('node:path');
const dir=path.resolve(__dirname,'../vendor/tikzjax');
const worker=new Worker(path.join(__dirname,'engine-worker-shim.cjs'),{workerData:{engineDir:dir}});
let uid=0;const pending=new Map();
let readyResolve;const ready=new Promise(r=>readyResolve=r);
worker.on('message',m=>{
 if(m.type==='init')return readyResolve(m);
 if(m.type==='result'&&m.complete){pending.get(m.uid)?.resolve(m.payload);pending.delete(m.uid);}
 else if(m.type==='error'){pending.get(m.uid)?.reject(new Error(m.error?.message||JSON.stringify(m.error)));pending.delete(m.uid);}
 else if(typeof m==='string')console.log('TEX:',m);
 else if(m.type!=='running')console.log('OTHER:',m);
});
function rpc(method,...args){return new Promise((resolve,reject)=>{const id=++uid;pending.set(id,{resolve,reject});worker.postMessage({type:'run',uid:id,method,args});});}
const tests=[
 {name:'tikz',body:String.raw`\begin{tikzpicture}\draw[blue,thick] (0,0) circle (1);\node at (0,0) {$E=mc^2$};\end{tikzpicture}`,options:{}},
 {name:'circuitikz',body:String.raw`\begin{circuitikz}\draw (0,0) to[V,l=$U$] (0,3) to[R,l=$R$] (3,3) to[C,l=$C$] (3,0) -- (0,0);\end{circuitikz}`,options:{texPackages:{circuitikz:'american'}}},
 {name:'pgfplots',body:String.raw`\begin{tikzpicture}\begin{axis}[width=7cm,height=5cm,xlabel={$x$},ylabel={$f(x)$}]\addplot[blue,domain=-2:2,samples=21] {x^2};\end{axis}\end{tikzpicture}`,options:{texPackages:{pgfplots:''},addToPreamble:String.raw`\pgfplotsset{compat=1.18}`}},
 {name:'tikzcd',body:String.raw`\begin{tikzcd} A\arrow[r,"f"]\arrow[d] & B\arrow[d]\\C\arrow[r] & D\end{tikzcd}`,options:{tikzLibraries:'cd'}},
 {name:'latex',body:String.raw`\begin{tikzpicture}\node[inner sep=0pt,anchor=north west] {\begin{minipage}{13cm}Bonjour, voici une formule : $\int_0^1 x^2\,dx=\frac13$.\par Une deuxieme ligne.\[E=mc^2\]\begin{tabular}{cc}A&B\\1&2\end{tabular}\end{minipage}};\end{tikzpicture}`,options:{}},
 {name:'invalid',body:String.raw`\begin{tikzpicture}\notARealCommand\end{tikzpicture}`,options:{},expectError:true},
 {name:'tikz-after-error',body:String.raw`\begin{tikzpicture}\draw[red] (0,0)--(1,1);\end{tikzpicture}`,options:{}},
 {name:'blocked-input',body:String.raw`\input{https://example.com/remote.tex}`,options:{},expectError:true},
 {name:'tikz-after-blocked',body:String.raw`\begin{tikzpicture}\draw[green] (0,0)--(1,1);\end{tikzpicture}`,options:{}}
];
(async()=>{
 await ready;console.time('load');await rpc('load','https://extension.test/');console.timeEnd('load');
 const reports=[];
 for(const test of tests){
  console.time(test.name);
  const timeout=setTimeout(()=>{console.error('TIMEOUT',test.name);worker.terminate();process.exitCode=1},30000);
  try {
   const result=await rpc('texify',test.body,test.options);
   const svg=typeof result==='string'&&result.includes('<svg');
   const entry={name:test.name,length:result?.length,svg,expectedError:test.expectError||false,ok:svg&&!test.expectError};
   if(typeof result==='string')await fs.writeFile(path.join(__dirname,'engine-fixtures',test.name+'.svg'),result);
   reports.push(entry);console.log(entry);
  }catch(e){const entry={name:test.name,error:e.message.slice(0,1600),expectedError:test.expectError||false,ok:!!test.expectError};reports.push(entry);console.log({...entry,error:e.message.split('! ').pop()?.slice(0,160)});}
  finally{clearTimeout(timeout);console.timeEnd(test.name);}
 }
 await fs.writeFile(path.join(__dirname,'engine-fixtures','test-report.json'),JSON.stringify(reports,null,2));
 if(reports.some(r=>!r.ok))process.exitCode=1;
 worker.terminate();
})().catch(e=>{console.error(e);worker.terminate();process.exitCode=1});
