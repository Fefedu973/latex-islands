/* Real end-to-end compiler + normalization + WebAssembly test, offline. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {Worker:NodeWorker}=require('node:worker_threads');
const engineDir=path.resolve(__dirname,'../vendor/tikzjax');
class BrowserWorker {
 constructor(url){
  assert.equal(new URL(url).origin,'https://extension.test');
  this.worker=new NodeWorker(path.join(__dirname,'engine-worker-shim.cjs'),{workerData:{engineDir,assetPrefix:'/vendor/tikzjax/'}});
  this.queue=[];this.ready=false;
  this.worker.on('message',data=>{
   if(data.type==='init'){this.ready=true;for(const message of this.queue)this.worker.postMessage(message);this.queue=[];}
   this.onmessage?.({data});
  });
  this.worker.on('error',error=>this.onerror?.({message:error.message}));
 }
 postMessage(message){if(this.ready)this.worker.postMessage(message);else this.queue.push(message);}
 terminate(){this.worker.terminate();}
}
globalThis.Worker=BrowserWorker;
globalThis.location={href:'https://extension.test/offscreen.html'};
globalThis.LatexIslandsCore=require('../core.js');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../compiler.js'),'utf8'),{filename:'compiler.js'});
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../examples.js'),'utf8'),{filename:'examples.js'});
const compiler=new TikZCompiler();
const snippets=[
 ['full-document',String.raw`\documentclass{standalone}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning}
\begin{document}\begin{tikzpicture}\node[draw] (a) {Source};\node[draw,right=of a] (b) {Signal};\draw[-{Stealth}] (a)--(b);\end{tikzpicture}\end{document}`],
 ['auto-circuitikz',String.raw`\begin{circuitikz}\draw (0,0) to[R,l=$R$] (2,0) to[C,l=$C$] (2,-2)--(0,-2)--(0,0);\end{circuitikz}`],
 ['auto-tikzcd',String.raw`\begin{tikzcd} A\arrow[r,"f"]\arrow[d] & B\arrow[d]\\C\arrow[r] & D\end{tikzcd}`],
 ['auto-axis',String.raw`\begin{axis}[width=5cm,height=4cm]\addplot[blue,domain=0:2,samples=11] {x^2};\end{axis}`]
];
snippets.push(
 ['complex-circuit',String.raw`\begin{circuitikz}[american]
\draw (0,0) to[V,l=$E=10\,\mathrm{V}$] (0,4)
  to[R,l=$R_1=1\,\mathrm{k}\Omega$] (3,4)
  to[C,l=$C=100\,\mathrm{nF}$] (3,0) -- (0,0);
\draw (3,4) to[R,l=$R_2=2.2\,\mathrm{k}\Omega$] (6,4)
  to[L,l=$L=10\,\mathrm{mH}$] (6,0) -- (3,0);
\end{circuitikz}`],
 ['surface-3d',String.raw`\begin{tikzpicture}
\begin{axis}[view={55}{30},domain=-3:3,y domain=-3:3,samples=20,samples y=20,width=9cm,height=7cm]
\addplot3[surf,shader=interp]{sin(deg(sqrt(x^2+y^2)))/(sqrt(x^2+y^2)+0.2)};
\end{axis}\end{tikzpicture}`],
 ['graph-3d',String.raw`\begin{tikzpicture}[x={(1cm,0cm)},y={(0.45cm,0.35cm)},z={(0cm,1cm)},vertex/.style={circle,draw,minimum size=7mm}]
\coordinate (A) at (0,0,0);\coordinate (B) at (2,0,0);\coordinate (C) at (2,2,0);\coordinate (D) at (0,2,0);
\coordinate (E) at (0,0,2);\coordinate (F) at (2,0,2);\coordinate (G) at (2,2,2);\coordinate (H) at (0,2,2);
\foreach \p/\name in {A/A,B/B,C/C,D/D,E/E,F/F,G/G,H/H}{\node[vertex] (\name) at (\p) {$\name$};}
\draw (A)--(B)--(C)--(D)--cycle (E)--(F)--(G)--(H)--cycle (A)--(E) (B)--(F) (C)--(G) (D)--(H);\end{tikzpicture}`],
 ['flowchart-auto-libs',String.raw`\begin{tikzpicture}[node distance=10mm and 18mm,
 startstop/.style={rectangle,rounded corners,draw,minimum width=25mm,minimum height=8mm,align=center},
 decision/.style={diamond,aspect=2,draw,align=center},io/.style={trapezium,trapezium left angle=70,trapezium right angle=110,draw,align=center},
 arrow/.style={->,thick,>={Stealth}}]
\node[startstop] (start) {Début};\node[io,below=of start] (input) {Lire $n$};\node[decision,below=of input] (test) {$n>1$ ?};
\node[startstop,below left=of test] (again) {Continuer};\node[startstop,below right=of test] (stop) {Fin};
\draw[arrow] (start)--(input);\draw[arrow] (input)--(test);\draw[arrow] (test)--(again);\draw[arrow] (test)--(stop);\end{tikzpicture}`],
 ['chemfig-molecule',String.raw`\chemfig{HO-*6(-=-(-OH)-(-CH_2CH_2NH_2)=-)}`],
 ['tikz-3dplot',String.raw`\tdplotsetmaincoords{70}{110}\begin{tikzpicture}[tdplot_main_coords]
\draw[->] (0,0,0)--(2,0,0) node[anchor=north east]{$x$};\draw[->] (0,0,0)--(0,2,0) node[anchor=north west]{$y$};\draw[->] (0,0,0)--(0,0,2) node[anchor=south]{$z$};\end{tikzpicture}`]
);
snippets.push(...LatexIslandsExamples.map(example=>['example-'+example.id,example.source]));
(async()=>{
 // Compare the same real diagram with a cold worker and a prewarmed worker.
 // Timing is reported, never asserted against a machine-dependent threshold.
 const benchmarkSource=String.raw`\begin{tikzpicture}\draw[blue,thick] (0,0) circle (1);\node at (0,0) {$E=mc^2$};\end{tikzpicture}`;
 const benchmark=new TikZCompiler();
 try {
  const cold=await benchmark.compile(benchmarkSource);assert.equal(cold.ok,true,cold.error);
  benchmark.stop();benchmark.cache.clear();benchmark.cacheBytes=0;
  const prepared=await benchmark.warmup();assert.equal(prepared.ready,true);
  const warm=await benchmark.compile(benchmarkSource);assert.equal(warm.ok,true,warm.error);
  const cacheStart=performance.now(),cached=await benchmark.compile(benchmarkSource);
  const cacheMs=performance.now()-cacheStart;assert.equal(cached.cached,true);assert.equal(warm.svg,cold.svg);
  console.log('PERFORMANCE',JSON.stringify({coldMs:cold.duration,coldLoadMs:cold.timings.load,prewarmMs:prepared.duration,afterPrewarmMs:warm.duration,cachedMs:Number(cacheMs.toFixed(3))}));
 } finally {benchmark.stop();}
 const outputs=await Promise.all(snippets.map(async([name,source])=>{
  const result=await compiler.compile(source);
  assert.equal(result.ok,true,`${name}: ${result.error}`);
  assert.match(result.svg,/^<svg[\s>]/);
  fs.writeFileSync(path.join(__dirname,'engine-fixtures',name+'.svg'),result.svg);
  console.log('PASS',name,result.svg.length+' bytes',result.duration+'ms');
  return result;
 }));
 const cached=await compiler.compile(snippets[0][1]);assert.equal(cached.cached,true);assert.equal(cached.svg,outputs[0].svg);console.log('PASS cache');
 const retainedWorker=compiler.worker;
 const invalid=await compiler.compile(String.raw`\begin{tikzpicture}\nonexistentcommand\end{tikzpicture}`);assert.equal(invalid.ok,false);assert.match(invalid.error,/Undefined control sequence/);assert.equal(compiler.worker,retainedWorker);console.log('PASS invalid TeX retains loaded engine');
 const fresh=await compiler.compile(String.raw`\begin{tikzpicture}\draw[orange] (0,0) circle(.5);\end{tikzpicture}`);assert.equal(fresh.ok,true,fresh.error);assert.equal(compiler.worker,retainedWorker);console.log('PASS same worker after error',fresh.duration+'ms');
 const originalRpc=compiler.rpc.bind(compiler);
 compiler.rpc=function(method,args,timeout){return originalRpc(method,args,method==='texify'?1500:timeout);};
 const infinite=await compiler.compile(String.raw`\begin{tikzpicture}\loop\iftrue\repeat\end{tikzpicture}`);assert.equal(infinite.ok,false);assert.match(infinite.error,/secondes/);console.log('PASS actual infinite-TeX worker termination');
 compiler.rpc=originalRpc;
 const afterTimeout=await compiler.compile(String.raw`\begin{tikzpicture}\draw[violet] (0,0)--(1,1);\end{tikzpicture}`);assert.equal(afterTimeout.ok,true,afterTimeout.error);console.log('PASS fresh worker after timeout');
 compiler.stop();
})().catch(async error=>{await compiler.tail;compiler.stop();console.error(error);process.exitCode=1;});
