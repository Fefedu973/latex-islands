/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
const compiler = new TikZCompiler();
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if(message?.channel !== 'latex-islands' || message.target !== 'compiler' || sender.id !== chrome.runtime.id) return;
  const work=message.action==='warmup' || message.type==='warmup' ? compiler.warmup() : compiler.compile(message.source);
  work.then(respond,error=>respond({ok:false,error:error.message}));
  return true;
});
