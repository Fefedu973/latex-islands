/* Firefox event-page transport tests; the real browser/worker smoke test is separate. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..'),ID='latex-islands@fefedu973',ORIGIN='moz-extension://installation-uuid';
function harness(){
  const listeners=[],instances=[],calls=[];
  class TikZCompiler{
    constructor(){instances.push(this);}
    compile(source){return new Promise((resolve,reject)=>calls.push({source,resolve,reject}));}
    warmup(){return new Promise((resolve,reject)=>calls.push({warmup:true,resolve,reject}));}
  }
  const browser={runtime:{id:ID,getURL:file=>ORIGIN+'/'+file,onMessage:{addListener:fn=>listeners.push(fn)}}};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'background-firefox.js'),'utf8'),{browser,TikZCompiler});
  const send=(extra={},sender={id:ID,url:ORIGIN+'/island.html#diagram-1'})=>listeners[0]({channel:'latex-islands',target:'background',source:'TikZ diagram',...extra},sender);
  return {send,instances,calls};
}
test('Firefox handles concurrent islands through one compiler and keeps responses asynchronous',async()=>{
  const h=harness(),first=h.send(),second=h.send({source:'another diagram'}),warm=h.send({action:'warmup'});
  assert.equal(typeof first.then,'function');await Promise.resolve();
  assert.equal(h.instances.length,1);assert.equal(h.calls.length,3);assert.equal(h.calls[1].source,'another diagram');assert.equal(h.calls[2].warmup,true);
  h.calls[0].resolve({ok:true,svg:'<svg />'});h.calls[1].resolve({ok:true,cached:true});h.calls[2].resolve({ok:true,ready:true});
  assert.equal((await first).ok,true);assert.equal((await second).cached,true);assert.equal((await warm).ready,true);
});
test('Firefox rejects unrelated targets, foreign senders and oversized source before compiler startup',async()=>{
  const h=harness();
  for(const sender of [{id:'other',url:ORIGIN+'/island.html'},{id:ID,url:'https://chatgpt.com/'},{id:ID,url:ORIGIN+'/island.html.fake'},{id:ID,url:ORIGIN+'/demo.html'},{id:ID}])assert.equal(h.send({},sender),undefined);
  assert.equal(h.send({target:'compiler'}),undefined);assert.equal(h.send({channel:'other'}),undefined);
  for(const source of ['x'.repeat(60001),{},null])assert.equal((await h.send({source})).ok,false);
  assert.equal(h.instances.length,0);assert.equal(h.calls.length,0);
});
test('Firefox reports compiler failures and permits subsequent attempts',async()=>{
  const h=harness(),first=h.send();await Promise.resolve();h.calls[0].reject(new Error('Synthetic failure'));
  assert.match((await first).error,/Synthetic failure/);
  const second=h.send();await Promise.resolve();h.calls[1].resolve({ok:true,svg:'<svg />'});assert.equal((await second).ok,true);assert.equal(h.instances.length,1);
});
test('Firefox override removes unsupported Chrome APIs and declares the audited data transfer',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(ROOT,'config/firefox.json'),'utf8'));
  assert.equal(config.minimum_chrome_version,null);assert.equal(config.background.service_worker,null);assert.equal(config.background.persistent,false);
  assert.deepEqual(config.background.scripts,['core.js','compiler.js','background-firefox.js']);assert.deepEqual(config.permissions,['storage','clipboardWrite']);
  assert.equal(config.browser_specific_settings.gecko.id,ID);assert.equal(config.browser_specific_settings.gecko.strict_min_version,'140.0');
  assert.deepEqual(config.browser_specific_settings.gecko.data_collection_permissions.required,['authenticationInfo','browsingActivity']);
});
