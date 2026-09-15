/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
class TikZCompiler {
  constructor() {
    this.worker=null;this.loading=null;this.warming=null;this.pending=new Map();this.inflight=new Map();
    this.uid=0;this.tail=Promise.resolve();this.count=0;this.cache=new Map();this.cacheBytes=0;this.idle=null;
  }
  stop(reason='Compilation interrompue.') {
    this.worker?.terminate();this.worker=null;this.loading=null;clearTimeout(this.idle);this.idle=null;
    for(const p of this.pending.values()) {clearTimeout(p.timer);p.reject(new Error(reason));}
    this.pending.clear();
  }
  scheduleIdle() {
    clearTimeout(this.idle);this.idle=null;
    if(this.worker && !this.count) this.idle=setTimeout(()=>this.stop(),90000);
  }
  rpc(method,args,timeout=30000) {
    const uid=++this.uid;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.stop('Le schéma a dépassé 30 secondes de compilation. Simplifie-le puis réessaie.'),timeout);
      this.pending.set(uid,{resolve,reject,timer,method});
      try {this.worker.postMessage({type:'run',uid,method,args});}
      catch(error) {clearTimeout(timer);this.pending.delete(uid);reject(error);}
    });
  }
  async load() {
    if(this.loading) return this.loading;
    const base=new URL('vendor/tikzjax/',location.href).href;
    const worker=new Worker(base+'run-tex.js');this.worker=worker;
    worker.onmessage=({data})=>{
      // A late crash/response from a terminated worker must not affect its successor.
      if(this.worker!==worker) return;
      if(data.type==='uncaughtError'){this.stop(data.error?.message || 'Erreur interne du moteur TeX.');return;}
      const p=this.pending.get(data.uid);if(!p) return;
      if(data.type==='error') {
        clearTimeout(p.timer);this.pending.delete(data.uid);
        const error=new Error(data.error?.message || 'Erreur du moteur TeX.');
        // The bundled engine cleans the TeX filesystem in finally and creates fresh
        // WASM memory on every texify call. Only its known TeX diagnostic is recoverable.
        error.recoverable=p.method==='texify' && error.message.startsWith('TikZJax: TeX did not produce input.dvi.');
        p.reject(error);
      }
      else if(data.type==='result' && data.complete) {clearTimeout(p.timer);this.pending.delete(data.uid);p.resolve(data.payload);}
    };
    worker.onerror=e=>{if(this.worker===worker)this.stop(e.message || 'Le moteur TikZ ne peut pas démarrer.');};
    this.loading=this.rpc('load',[base]).catch(e=>{if(this.worker===worker)this.stop();throw e;});
    return this.loading;
  }
  warmup() {
    clearTimeout(this.idle);this.idle=null;
    if(this.warming) return this.warming;
    const start=performance.now();
    // Streaming can prepare the worker without submitting incomplete TeX or taking
    // a compilation queue slot. Concurrent islands share the same load promise.
    this.warming=this.load()
      .then(()=>({ok:true,ready:true,duration:Math.round(performance.now()-start)}))
      .catch(error=>({ok:false,error:String(error.message || error)}))
      .finally(()=>{this.warming=null;this.scheduleIdle();});
    return this.warming;
  }
  cached(source) {
    const result=this.cache.get(source);if(!result)return null;
    // Refresh insertion order so frequently used diagrams survive cache eviction.
    this.cache.delete(source);this.cache.set(source,result);
    return {...result,cached:true};
  }
  remember(source,result) {
    this.cache.set(source,result);this.cacheBytes+=2*(source.length+result.svg.length);
    while(this.cache.size>24 || this.cacheBytes>20*1024*1024) {
      const oldest=this.cache.keys().next().value,entry=this.cache.get(oldest);
      this.cache.delete(oldest);this.cacheBytes-=2*(oldest.length+entry.svg.length);
    }
  }
  compile(source) {
    if(typeof source !== 'string' || !source.trim()) return Promise.resolve({ok:false,error:'Le code TikZ est vide.'});
    if(source.length>60000) return Promise.resolve({ok:false,error:'Limite : 60 000 caractères par schéma.'});
    const cached=this.cached(source);if(cached)return Promise.resolve(cached);
    // Join identical active/queued requests immediately: duplicates must neither
    // fill the 24-diagram queue nor wait behind unrelated compilations.
    const existing=this.inflight.get(source);
    if(existing)return existing.then(result=>result.ok?{...result,cached:true}:result);
    if(this.count>=24) return Promise.resolve({ok:false,error:'Trop de schémas en attente. Réessaie dans un instant.'});
    this.count++;clearTimeout(this.idle);this.idle=null;
    const queued=performance.now();
    const run=this.tail.then(async()=>{
      const norm=LatexIslandsCore.normalizeTeX(source);
      const start=performance.now();
      await this.load();
      const loaded=performance.now();
      const svg=await this.rpc('texify',[norm.body,{texPackages:norm.texPackages || {},tikzLibraries:norm.tikzLibraries || '',addToPreamble:norm.addToPreamble || ''}]);
      if(typeof svg!=='string' || !svg.includes('<svg') || svg.length>5000000) throw new Error('Le moteur n’a pas produit de schéma SVG valide.');
      const end=performance.now();
      const result={ok:true,svg,warnings:norm.warnings || [],duration:Math.round(end-start),
        timings:{queue:Math.round(start-queued),load:Math.round(loaded-start),compile:Math.round(end-loaded)}};
      this.remember(source,result);return result;
    }).catch(e=>{
      if(!e.recoverable)this.stop();
      const message=String(e.message || e);
      return {ok:false,error:message.length>5000?message.slice(0,500)+'\n[… journal abrégé …]\n'+message.slice(-4300):message};
    }).finally(()=>{this.count--;this.inflight.delete(source);this.scheduleIdle();});
    this.inflight.set(source,run);this.tail=run.then(()=>{});return run;
  }
}
globalThis.TikZCompiler=TikZCompiler;
