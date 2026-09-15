/* Runtime tests use a mocked Worker: they verify transport, lifecycle and concurrency,
 * independently of the real TeX smoke tests. Run: node --test tests/runtime.test.cjs */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function compilerHarness({auto=true, normalize}={}) {
  const workers=[],timers=new Map();let timerId=0,normalizations=0;
  class Worker {
    constructor(url){this.url=url;this.messages=[];this.terminated=false;workers.push(this);}
    postMessage(message){this.messages.push(message);if(auto)queueMicrotask(()=>this.result(message.uid,message.method==='load'?undefined:'<svg><path /></svg>'));}
    result(uid,payload){this.onmessage?.({data:{type:'result',uid,complete:true,payload}});}
    fail(uid,message){this.onmessage?.({data:{type:'error',uid,error:{message}}});}
    terminate(){this.terminated=true;}
  }
  const context=vm.createContext({Worker,URL,location:{href:'chrome-extension://test-id/offscreen.html'},performance,
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
    LatexIslandsCore:{normalizeTeX(source){normalizations++;if(normalize)return normalize(source);return {body:source,texPackages:{},tikzLibraries:'',addToPreamble:'',warnings:[]};}}});
  vm.runInContext(fs.readFileSync(path.join(ROOT,'compiler.js'),'utf8'),context);
  const compiler=new context.TikZCompiler();
  return {compiler,workers,timers,get normalizations(){return normalizations;}};
}

test('one shared worker serializes all compilations and suppresses duplicate work',async()=>{
  const h=compilerHarness({auto:false});
  const first=h.compiler.compile('A'),duplicate=h.compiler.compile('A'),second=h.compiler.compile('B');
  await tick();assert.equal(h.workers.length,1);const w=h.workers[0];
  assert.match(w.url,/^chrome-extension:\/\/test-id\/vendor\/tikzjax\/run-tex.js$/);
  assert.equal(w.messages.length,1);assert.equal(w.messages[0].method,'load');
  w.result(w.messages[0].uid);await tick();assert.equal(w.messages.length,2);assert.equal(w.messages[1].method,'texify');
  w.result(w.messages[1].uid,'<svg><text>A</text></svg>');await tick();
  assert.equal((await first).ok,true);assert.equal((await duplicate).cached,true);
  assert.equal(w.messages.length,3);assert.equal(w.messages[2].args[0],'B');
  w.result(w.messages[2].uid,'<svg><text>B</text></svg>');assert.equal((await second).ok,true);
  assert.equal(h.normalizations,2);assert.equal(h.compiler.count,0);
  assert.equal((await h.compiler.compile('A')).cached,true);assert.equal(w.messages.length,3);
  h.compiler.stop();assert.equal(h.timers.size,0);
});

test('TeX errors release the damaged worker and let later diagrams render',async()=>{
  const h=compilerHarness({auto:false});const broken=h.compiler.compile('broken'),next=h.compiler.compile('good');
  await tick();const old=h.workers[0];old.result(old.messages[0].uid);await tick();
  old.fail(old.messages[1].uid,'Unknown control sequence');await tick();
  assert.equal((await broken).ok,false);assert.match((await broken).error,/Unknown control sequence/);
  assert.equal(old.terminated,true);assert.equal(h.workers.length,2);
  const fresh=h.workers[1];fresh.result(fresh.messages[0].uid);await tick();
  // A late response from the terminated worker must not satisfy the new request.
  old.result(old.messages[1].uid,'<svg>wrong</svg>');assert.equal(h.compiler.pending.size,1);
  fresh.result(fresh.messages[1].uid,'<svg>right</svg>');assert.equal((await next).svg,'<svg>right</svg>');
  assert.equal(h.compiler.count,0);h.compiler.stop();
});

test('timeout terminates the active worker, clears pending RPCs and recovers',async()=>{
  const h=compilerHarness({auto:false});const result=h.compiler.compile('slow');await tick();
  const timer=[...h.timers.values()].find(t=>t.delay===30000);assert.ok(timer);timer.fn();
  assert.equal((await result).ok,false);assert.match((await result).error,/30-second/);
  assert.equal(h.workers[0].terminated,true);assert.equal(h.compiler.pending.size,0);
  const retry=h.compiler.compile('slow');await tick();assert.equal(h.workers.length,2);
  const w=h.workers[1];w.result(w.messages[0].uid);await tick();w.result(w.messages[1].uid,'<svg />');
  assert.equal((await retry).ok,true);h.compiler.stop();
});

test('invalid input does not launch a worker or consume queue slots',async()=>{
  const h=compilerHarness();for(const value of ['', '  ',null,{},'a'.repeat(60001)]){
    assert.equal((await h.compiler.compile(value)).ok,false);
  }
  assert.equal(h.workers.length,0);assert.equal(h.compiler.count,0);assert.equal(h.timers.size,0);
});

test('queue limit rejects excess work and all accepted requests complete',async()=>{
  const h=compilerHarness();const pending=Array.from({length:24},(_,i)=>h.compiler.compile(`figure ${i}`));
  const rejected=await h.compiler.compile('25th');assert.equal(rejected.ok,false);assert.match(rejected.error,/in the queue/);
  const results=await Promise.all(pending);assert.ok(results.every(r=>r.ok));assert.equal(h.compiler.count,0);
  assert.equal(h.workers.length,1);assert.equal(h.workers[0].messages.filter(m=>m.method==='texify').length,24);
  h.compiler.stop();
});

test('cache stays bounded and idle expiry releases memory while retaining successful renders',async()=>{
  const h=compilerHarness();for(let i=0;i<25;i++)assert.equal((await h.compiler.compile(`figure ${i}`)).ok,true);
  assert.equal(h.compiler.cache.size,24);assert.equal(h.compiler.cache.has('figure 0'),false);
  const idle=[...h.timers.values()].find(t=>t.delay===90000);assert.ok(idle);idle.fn();
  assert.equal(h.workers[0].terminated,true);assert.equal(h.compiler.worker,null);
  assert.equal((await h.compiler.compile('figure 24')).cached,true);assert.equal(h.workers.length,1);
  assert.equal((await h.compiler.compile('figure 0')).ok,true);assert.equal(h.workers.length,2);h.compiler.stop();
});

test('invalid SVG never reaches the success cache and later work recovers',async()=>{
  const h=compilerHarness({auto:false});const bad=h.compiler.compile('invalid');await tick();const w=h.workers[0];
  w.result(w.messages[0].uid);await tick();w.result(w.messages[1].uid,'an error, not an SVG');
  assert.equal((await bad).ok,false);assert.equal(h.compiler.cache.size,0);assert.equal(w.terminated,true);h.compiler.stop();
});

function backgroundHarness(){
  const listeners=[],creates=[],calls=[];let existing=false;
  const chrome={runtime:{id:'test-id',getURL:file=>`chrome-extension://test-id/${file}`,
    getContexts:async()=>existing?[{}]:[],sendMessage:async m=>{calls.push(m);return {ok:true,svg:'<svg />'};},
    onMessage:{addListener:fn=>listeners.push(fn)}},offscreen:{createDocument:options=>new Promise((resolve,reject)=>creates.push({options,resolve:()=>{existing=true;resolve();},reject}))}};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'background.js'),'utf8'),{chrome});
  function send(message={},sender={id:'test-id',url:'chrome-extension://test-id/island.html?id=123'}){
    let held;const response=new Promise(resolve=>{held=listeners[0]({channel:'latex-islands',target:'background',source:'diagram',...message},sender,resolve);});
    return {held,response};
  }
  return {send,creates,calls};
}

test('background initializes one offscreen document for simultaneous island requests',async()=>{
  const h=backgroundHarness();const a=h.send(),b=h.send({source:'diagram 2'});assert.equal(a.held,true);assert.equal(b.held,true);
  await tick();assert.equal(h.creates.length,1);assert.equal(h.creates[0].options.url,'offscreen.html');
  h.creates[0].resolve();assert.equal((await a.response).ok,true);assert.equal((await b.response).ok,true);
  assert.equal(h.calls.length,2);assert.ok(h.calls.every(m=>m.target==='compiler'));
  const c=h.send();assert.equal((await c.response).ok,true);assert.equal(h.creates.length,1);
});

test('background handles offscreen initialization failure and retries on the next request',async()=>{
  const h=backgroundHarness();const a=h.send();await tick();h.creates[0].reject(new Error('startup failed'));
  const result=await a.response;assert.equal(result.ok,false);assert.match(result.error,/startup failed/);
  const b=h.send();await tick();assert.equal(h.creates.length,2);h.creates[1].resolve();assert.equal((await b.response).ok,true);
});

test('background ignores non-island callers and rejects excessive source before initialization',async()=>{
  const h=backgroundHarness();for(const sender of [
    {id:'other-extension',url:'chrome-extension://test-id/island.html'},
    {id:'test-id',url:'https://chatgpt.com/'},
    {id:'test-id',url:'chrome-extension://test-id/island.html.fake'},
    {id:'test-id'}
  ])assert.equal(h.send({},sender).held,undefined);
  assert.equal(h.send({target:'compiler'}).held,undefined);
  const long=h.send({source:'a'.repeat(60001)});assert.equal((await long.response).ok,false);
  assert.equal(h.creates.length,0);assert.equal(h.calls.length,0);
});

test('uncaught worker errors without a request id fail immediately and clean pending work',async()=>{
  const h=compilerHarness({auto:false});const pending=h.compiler.compile('worker-crash');await tick();
  const w=h.workers[0];w.onmessage({data:{type:'uncaughtError',error:{message:'worker crashed'}}});
  const result=await pending;assert.equal(result.ok,false);assert.match(result.error,/worker crashed/);
  assert.equal(w.terminated,true);assert.equal(h.compiler.pending.size,0);h.compiler.stop();
});

test('streaming warmup loads once without compiling and shares startup with the first diagram',async()=>{
  const h=compilerHarness({auto:false});
  const first=h.compiler.warmup(),second=h.compiler.warmup();
  assert.equal(first,second);assert.equal(h.compiler.count,0);assert.equal(h.workers.length,1);
  const w=h.workers[0];assert.deepEqual(w.messages.map(m=>m.method),['load']);
  const render=h.compiler.compile('ready block');await tick();
  assert.equal(w.messages.length,1);w.result(w.messages[0].uid);
  assert.equal((await first).ready,true);await tick();
  assert.deepEqual(w.messages.map(m=>m.method),['load','texify']);
  w.result(w.messages[1].uid,'<svg />');assert.equal((await render).ok,true);
  assert.equal((await h.compiler.warmup()).ok,true);assert.equal(w.messages.length,2);
  assert.ok([...h.timers.values()].some(t=>t.delay===90000));h.compiler.stop();
});

test('warmup alone expires after idle and can recover from an initialization failure',async()=>{
  const h=compilerHarness({auto:false});const failed=h.compiler.warmup();
  const old=h.workers[0];old.fail(old.messages[0].uid,'core unavailable');
  assert.equal((await failed).ok,false);assert.equal(old.terminated,true);assert.equal(h.timers.size,0);
  const retry=h.compiler.warmup(),fresh=h.workers[1];fresh.result(fresh.messages[0].uid);
  assert.equal((await retry).ready,true);
  old.onmessage({data:{type:'uncaughtError',error:{message:'stale crash'}}});
  old.onerror({message:'stale browser error'});assert.equal(fresh.terminated,false);
  const idle=[...h.timers.values()].find(t=>t.delay===90000);assert.ok(idle);idle.fn();
  assert.equal(fresh.terminated,true);assert.equal(h.compiler.worker,null);h.compiler.stop();
});

test('duplicate pending diagrams do not occupy queue slots or wait for later diagrams',async()=>{
  const h=compilerHarness({auto:false});const first=h.compiler.compile('same');
  const unrelated=h.compiler.compile('later');
  const duplicates=Array.from({length:40},()=>h.compiler.compile('same'));
  assert.equal(h.compiler.count,2);await tick();const w=h.workers[0];
  w.result(w.messages[0].uid);await tick();w.result(w.messages[1].uid,'<svg>same</svg>');
  assert.equal((await first).ok,true);assert.ok((await Promise.all(duplicates)).every(r=>r.ok&&r.cached));
  await tick();assert.equal(h.compiler.count,1);assert.equal(w.messages[2].args[0],'later');
  w.result(w.messages[2].uid,'<svg>later</svg>');assert.equal((await unrelated).ok,true);
  assert.equal(h.compiler.inflight.size,0);h.compiler.stop();
});

test('ordinary TeX diagnostics retain the loaded engine and package cache',async()=>{
  const h=compilerHarness({auto:false});const broken=h.compiler.compile('broken'),next=h.compiler.compile('corrected');
  await tick();const w=h.workers[0];w.result(w.messages[0].uid);await tick();
  w.fail(w.messages[1].uid,'TikZJax: TeX did not produce input.dvi.\nUndefined control sequence');
  assert.equal((await broken).ok,false);await tick();assert.equal(w.terminated,false);
  assert.equal(h.workers.length,1);assert.equal(w.messages[2].args[0],'corrected');
  w.result(w.messages[2].uid,'<svg />');assert.equal((await next).ok,true);
  assert.equal(h.compiler.cache.has('broken'),false);h.compiler.stop();
});

test('cache eviction retains recently viewed diagrams and caps SVG memory',async()=>{
  const h=compilerHarness();for(let i=0;i<24;i++)await h.compiler.compile(`figure ${i}`);
  await h.compiler.compile('figure 0');await h.compiler.compile('figure 24');
  assert.equal(h.compiler.cache.has('figure 0'),true);assert.equal(h.compiler.cache.has('figure 1'),false);
  h.compiler.remember('large 1',{ok:true,svg:'<svg>'+ 'a'.repeat(4000000)+'</svg>'});
  h.compiler.remember('large 2',{ok:true,svg:'<svg>'+ 'b'.repeat(4000000)+'</svg>'});
  h.compiler.remember('large 3',{ok:true,svg:'<svg>'+ 'c'.repeat(4000000)+'</svg>'});
  assert.ok(h.compiler.cacheBytes<=20*1024*1024);assert.equal(h.compiler.cache.has('large 1'),false);
  assert.equal(h.compiler.cache.has('large 3'),true);h.compiler.stop();
});

test('background forwards source-free warmup from islands to the shared compiler',async()=>{
  const h=backgroundHarness();const a=h.send({action:'warmup',source:undefined});
  const b=h.send({type:'warmup',source:undefined});assert.equal(a.held,true);await tick();
  assert.equal(h.creates.length,1);h.creates[0].resolve();
  assert.equal((await a.response).ok,true);assert.equal((await b.response).ok,true);
  assert.ok(h.calls.every(m=>m.action==='warmup' && !Object.hasOwn(m,'source')));
  assert.equal(h.send({action:'warmup'}, {id:'test-id',url:'https://chatgpt.com/'}).held,undefined);
});

test('offscreen routes warmup and compilation without accepting external senders',async()=>{
  const listeners=[],calls=[];
  class TikZCompiler {
    warmup(){calls.push('warmup');return Promise.resolve({ok:true,ready:true});}
    compile(source){calls.push(source);return Promise.resolve({ok:true,svg:'<svg />'});}
  }
  const chrome={runtime:{id:'test-id',onMessage:{addListener:fn=>listeners.push(fn)}}};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'offscreen.js'),'utf8'),{chrome,TikZCompiler});
  const send=message=>new Promise(resolve=>assert.equal(listeners[0]({channel:'latex-islands',target:'compiler',...message},{id:'test-id'},resolve),true));
  assert.equal((await send({action:'warmup'})).ready,true);
  assert.equal((await send({source:'diagram'})).ok,true);assert.deepEqual(calls,['warmup','diagram']);
  assert.equal(listeners[0]({channel:'latex-islands',target:'compiler',action:'warmup'},{id:'other'},()=>{}),undefined);
});
