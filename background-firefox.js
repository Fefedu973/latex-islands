/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
// Firefox MV3 runs an event page, which can own the same worker/compiler used by
// Chrome's offscreen document. An outstanding response keeps this work attached
// to the originating runtime message; idle page eviction may discard the cache.
(() => {
  const api=globalThis.browser||globalThis.chrome;
  let compiler;
  api.runtime.onMessage.addListener((message,sender)=>{
    if(message?.channel!=='latex-islands'||message.target!=='background')return;
    if(sender.id!==api.runtime.id||sender.url?.split(/[?#]/)[0]!==api.runtime.getURL('island.html'))return;
    const warmup=message.action==='warmup'||message.type==='warmup';
    if(!warmup&&(typeof message.source!=='string'||message.source.length>60000))return Promise.resolve({ok:false,error:'This diagram exceeds the 60,000-character limit.'});
    return Promise.resolve().then(()=>{
      compiler ||= new TikZCompiler();
      return warmup?compiler.warmup():compiler.compile(message.source);
    }).catch(error=>({ok:false,error:String(error.message||error)}));
  });
})();
