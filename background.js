/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
let creating;
async function ensureCompiler() {
  const url = chrome.runtime.getURL('offscreen.html');
  const contexts = await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]});
  if (contexts.length) return;
  if (!creating) creating = chrome.offscreen.createDocument({url:'offscreen.html',reasons:['WORKERS'],justification:'Compiler localement les schémas TikZ dans un unique worker.'}).finally(() => {creating=null;});
  await creating;
}
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (message?.channel !== 'latex-islands' || message.target !== 'background') return;
  if (sender.id !== chrome.runtime.id || sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL('island.html')) return;
  const warmup=message.action==='warmup' || message.type==='warmup';
  if (!warmup && (typeof message.source !== 'string' || message.source.length > 60000)) {respond({ok:false,error:'Ce schéma dépasse la limite de 60 000 caractères.'});return;}
  (async () => {
    await ensureCompiler();
    return chrome.runtime.sendMessage(warmup
      ? {channel:'latex-islands',target:'compiler',action:'warmup'}
      : {channel:'latex-islands',target:'compiler',source:message.source});
  })().then(respond,error=>respond({ok:false,error:error.message}));
  return true;
});
