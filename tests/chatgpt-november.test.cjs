/* Minimal synthetic counterpart of the semantic attributes observed 2026-11-04. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
test('November message keys support content wrappers and deduplicate their selection children',()=>{
  const dom=new JSDOM(`<main><div data-app-action-timeline-scroll role="region"><div data-chatgpt-search-unit-key="exchange-1:0:user" data-chatgpt-search-message-ids="prompt-1"><div data-content-search-unit-key="exchange-1:0:user">Synthetic prompt</div></div><div data-content-search-unit-key="exchange-1:2:assistant" data-chatgpt-search-unit-key="exchange-1:2:assistant" data-chatgpt-search-message-ids="answer-1 answer-1"><div data-chatgpt-selection-message-id="answer-1"><div data-markdown-text-style="assistant-message"><p>Synthetic answer</p></div></div></div></div></main>`,{runScripts:'outside-only'});
  try {
    dom.window.eval(fs.readFileSync(path.join(__dirname,'../chatgpt-dom.js'),'utf8'));
    const api=dom.window.LatexIslandsChatGPT;
    assert.deepEqual(Array.from(api.getMessages(),api.role),['user','assistant']);
    assert.deepEqual(Array.from(api.getMessages(),api.messageId),['prompt-1','answer-1']);
    // Content search keys are also meaningful before the outer search wrapper
    // hydrates. Adding that wrapper later must not duplicate a message.
    for(const el of dom.window.document.querySelectorAll('[data-chatgpt-search-unit-key]'))el.removeAttribute('data-chatgpt-search-unit-key');
    assert.deepEqual(Array.from(api.getMessages(),api.role),['user','assistant']);
    assert.equal(api.getMessage(dom.window.document.querySelector('p')),api.getMessages()[1]);
    assert.equal(api.getScrollRoot().getAttribute('role'),'region');
  }finally{dom.window.close();}
});
