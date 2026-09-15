/* SPDX-License-Identifier: GPL-3.0-or-later */
(() => {
  'use strict';
  if (globalThis.__latexIslandsContentLoaded) return;
  globalThis.__latexIslandsContentLoaded = true;
  const core = globalThis.LatexIslandsCore;
  if (!core || !globalThis.chrome?.runtime) return;
  const CHANNEL = 'latex-islands', MAX_SOURCE = 60000, SETTLE_MS = 180;
  const EXTENSION_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '');
  const assistantSelector = '[data-message-author-role="assistant"]';
  const excludedSelector = 'textarea, input, [contenteditable="true"], [role="textbox"], #prompt-textarea, [data-testid="composer"]';
  const streamingSelector = '[data-is-streaming="true"], .result-streaming, .streaming-animation, [aria-busy="true"]';
  const states = new Map(), ids = new Map(), dirty = new Set();
  const settings = {enabled:true, autoRender:true, scale:1, renderColors:'chatgpt'};
  let timer = 0, timerDue = Infinity, sequence = 0, fullScan = true, editor = null;
  let pageThemeKey = '', storedThemeKey = '', themeStorageReady = false;
  // Throttle: unrelated tokens never postpone a closed block indefinitely.
  function schedule(delay = 60) {
    const due = Date.now() + delay;
    if (timer && timerDue <= due) return;
    clearTimeout(timer); timerDue = due;
    timer = setTimeout(() => { timer = 0; timerDue = Infinity; scan(); }, delay);
  }
  function ownNode(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(el?.closest('.latex-islands-container, .latex-islands-editor, .li-export'));
  }
  function currentSource(el, type) {
    if (type === 'error') return [el.getAttribute('data-latex'), el.textContent, el.getAttribute('title')].find(v => v && core.detectKind(v)) || '';
    if(type === 'raw') return el.textContent || '';
    const content=el.querySelector('code') || (el.matches('.cm-content')?el:el.querySelector('.cm-content')) || el;
    const lines=content.querySelectorAll('.cm-line');
    // CodeMirror can represent newlines as block elements. textContent would join
    // them and let a TeX % comment swallow the remainder of the diagram.
    return lines.length?[...lines].map(line=>line.textContent || '').join('\n'):content.textContent || '';
  }
  function language(el) {
    const code = el.querySelector('code') || el;
    const value = String(code.className || '').match(/(?:^|\s)language-([^\s]+)/);
    if (value) return value[1];
    const explicit = code.getAttribute('data-language') || el.getAttribute('data-language');
    if (explicit) return explicit;
    // Current ChatGPT has a language header outside its nested CodeMirror <pre>.
    for (const label of el.querySelectorAll('.font-medium, [data-testid="code-block-language"]')) {
      if (!label.closest('code, .cm-content, button, [role="button"]') && /^[a-z][a-z0-9#+_.-]{0,30}$/i.test(label.textContent.trim())) return label.textContent.trim();
    }
    return '';
  }
  function isStreaming(el) {
    const assistant = el.closest(assistantSelector);
    if (!assistant) return false;
    if (assistant.closest(streamingSelector) || assistant.querySelector(streamingSelector)) return true;
    if (!document.querySelector('[data-testid="stop-button"]')) return false;
    const assistants = document.querySelectorAll(assistantSelector);
    return assistant === assistants[assistants.length - 1];
  }
  function hasFollowingContent(el) {
    const assistant = el.closest(assistantSelector);
    const boundary=el.closest('.markdown, .prose, li, blockquote') || assistant;
    // Only another Markdown block proves that the code fence has closed. A copy
    // button or footer inside the code widget can already exist during streaming.
    let block=el;
    while(block && block.parentElement!==boundary) block=block.parentElement;
    if(!block) return false;
    const content='p, pre, ul, ol, blockquote, table, h1, h2, h3, h4, h5, h6, hr, .katex-display';
    const controls='button, [role="button"], [role="toolbar"], [aria-hidden="true"]';
    for(let next=block.nextElementSibling;next;next=next.nextElementSibling) {
      if(ownNode(next) || next.matches(controls)) continue;
      const candidates=next.matches(content)?[next]:next.querySelectorAll(content);
      for(const candidate of candidates) if(!ownNode(candidate) && !candidate.closest(controls) && (candidate.matches('hr') || candidate.textContent.trim())) return true;
    }
    return false;
  }
  function completeTeX(source) {
    // A structural fallback when the Markdown closing fence is not exposed by the DOM.
    const text = source.split('\n').map(line => {
      for(let i=0;i<line.length;i++) { if(line[i]==='\\') {i++;continue;} if(line[i]==='%') return line.slice(0,i); }
      return line;
    }).join('\n').trim();
    let braces=0;
    for(let i=0;i<text.length;i++) {
      if(text[i]==='\\' && /[{}%\\]/.test(text[i+1] || '')) {i++;continue;}
      if(text[i]==='{') braces++;
      if(text[i]==='}' && --braces<0) return false;
    }
    if(braces) return false;
    const stack=[]; let sawEnvironment=false;
    for(const match of text.matchAll(/\\(begin|end)\s*\{([^}]+)\}/g)) {
      sawEnvironment=true;
      if(match[1]==='begin') stack.push(match[2]); else if(stack.pop()!==match[2]) return false;
    }
    if(stack.length) return false;
    if(sawEnvironment) return /\\end\s*\{[^}]+\}\s*$/.test(text);
    if(/\\chemfig\s*(?:\[[\s\S]*?\])?\s*\{/.test(text)) return text.endsWith('}');
    return /\\(?:tikz|draw|node|path|fill|coordinate|shade)\b/.test(text) && /[;}]$/.test(text);
  }
  function appearance(el) {
    const root=document.documentElement, css=getComputedStyle(el?.closest(assistantSelector) || document.body);
    const dark=root.classList.contains('dark') || root.dataset.theme==='dark' || (!root.classList.contains('light') && css.colorScheme==='dark');
    let background=dark?'#212121':'#ffffff';
    for(let parent=el?.parentElement || document.body;parent;parent=parent.parentElement) {
      const color=getComputedStyle(parent).backgroundColor;
      if(color && color!=='transparent' && !/rgba\([^)]*,\s*0\)$/.test(color)) {background=color;break;}
    }
    return {theme:dark?'dark':'light',colors:{background,text:css.color || (dark?'#ececec':'#0d0d0d'),surface:dark?'#2f2f2f':'#f4f4f4',border:dark?'#424242':'#e5e5e5'}};
  }
  function pageTheme() {return appearance(document.querySelector(assistantSelector) || document.body);}
  function themeKey(theme) {return JSON.stringify([theme?.theme,...['text','background','surface','border'].map(key=>theme?.colors?.[key])]);}
  function sendView(state) {
    post(state,{type:'view',mode:editor?.state===state?'editor':'inline',renderColors:settings.renderColors,...appearance(state.element)});
  }
  function syncPageTheme() {
    const theme=pageTheme(),key=themeKey(theme);
    if(key!==pageThemeKey) {pageThemeKey=key;for(const state of states.values())sendView(state);}
    if(themeStorageReady && key!==storedThemeKey) {
      storedThemeKey=key;
      chrome.storage.local.set({chatgptTheme:theme},()=>{if(chrome.runtime.lastError)storedThemeKey='';});
    }
  }
  function post(state,data) {
    if(state.ready && state.frame?.contentWindow) state.frame.contentWindow.postMessage({channel:CHANNEL,id:state.id,...data},EXTENSION_ORIGIN);
  }
  function send(state,force=false) {
    const source=state.complete && state.draftSource!=null?state.draftSource:state.source;
    const type=state.complete?'render':'prepare', key=type+'\0'+source+'\0'+settings.autoRender+'\0'+settings.scale;
    if(!state.ready || (!force && state.sentKey===key)) return;
    post(state,{type,source,kind:'tikz',streaming:!state.complete,autoRender:settings.autoRender,scale:settings.scale,renderColors:settings.renderColors,mode:editor?.state===state?'editor':'inline',...appearance(state.element)});
    state.sentKey=key;state.sentSource=state.complete?source:null;
    if(!state.complete && state.type!=='raw') state.element.classList.add('latex-islands-original-hidden');
  }
  function addIsland(el,state) {
    const container=document.createElement('div');container.className='latex-islands-container';
    container.setAttribute('role','region');container.setAttribute('aria-label','Diagramme TikZ');
    const frame=document.createElement('iframe');frame.title='Diagramme TikZ — aperçu, code et téléchargement';
    frame.src=chrome.runtime.getURL('island.html')+'#'+encodeURIComponent(state.id);
    frame.setAttribute('scrolling','no');frame.setAttribute('allow','clipboard-write');frame.referrerPolicy='no-referrer';
    frame.addEventListener('load',()=>{state.ready=true;send(state,true);});
    state.container=container;state.frame=frame;ids.set(state.id,state);
    container.append(frame);el.insertAdjacentElement('afterend',container);
  }
  function closeEditor() {
    if(!editor) return;
    const {state,dialog,focus}=editor;editor=null;
    try { if (state.container.hidePopover) state.container.hidePopover(); } catch { /* Removed by navigation. */ }
    state.container.removeAttribute('popover');
    state.container.setAttribute('role','region');state.container.removeAttribute('aria-modal');
    state.container.classList.remove('latex-islands-is-editing');dialog.remove();
    document.documentElement.classList.remove('latex-islands-editor-open');
    sendView(state);
    (focus?.isConnected?focus:state.frame)?.focus();
  }
  function openEditor(state) {
    if(editor?.state===state) return;closeEditor();
    const dialog=document.createElement('div');dialog.className='latex-islands-editor';
    dialog.setAttribute('aria-hidden','true');document.body.append(dialog);
    // Moving an iframe reloads it. The popover top layer escapes ChatGPT's transformed
    // and clipped ancestors while preserving the live document, SVG and zoom state.
    editor={state,dialog,focus:document.activeElement};
    state.container.classList.add('latex-islands-is-editing');
    state.container.setAttribute('role','dialog');state.container.setAttribute('aria-modal','true');
    state.container.setAttribute('popover','manual');
    if (state.container.showPopover) state.container.showPopover();
    document.documentElement.classList.add('latex-islands-editor-open');
    sendView(state);state.frame.focus();
  }
  function removeState(el,state) {
    if(editor?.state===state) closeEditor();
    el.classList.remove('latex-islands-original-hidden');state.container?.remove();ids.delete(state.id);states.delete(el);
  }
  function consider(el,type,sourceOverride) {
    if(el.closest(excludedSelector)) return;
    const source=core.stripFence(sourceOverride ?? currentSource(el,type));
    const kind=core.detectKind(source,type==='code'?language(el):'');
    if(source.length>MAX_SOURCE || !kind) {const old=states.get(el);if(old)removeState(el,old);return;}
    let state=states.get(el);
    if(!state) {state={id:'li-'+Date.now().toString(36)+'-'+(++sequence),source,type,element:el,updated:Date.now(),complete:false,ready:false,sentSource:null};states.set(el,state);addIsland(el,state);}
    else if(state.source!==source) {el.classList.remove('latex-islands-original-hidden');state.source=source;state.draftSource=null;state.updated=Date.now();}
    const streaming=isStreaming(el), settled=Date.now()-state.updated>=SETTLE_MS;
    state.complete=Boolean(source.trim()) && (!streaming || hasFollowingContent(el) || (settled && completeTeX(source)));
    if(!state.complete && source && !settled) {dirty.add(el.closest(assistantSelector));schedule(SETTLE_MS-(Date.now()-state.updated));}
    send(state);
  }
  function scan() {
    if(!settings.enabled) return;
    for(const [el,state]of states) if(!el.isConnected || !el.closest(assistantSelector) || el.closest(excludedSelector)) removeState(el,state);
    const assistants=fullScan?document.querySelectorAll(assistantSelector):[...dirty];fullScan=false;dirty.clear();
    for(const assistant of assistants) {
      if(!assistant?.isConnected) continue;
      for(const pre of assistant.querySelectorAll('pre')) if(!ownNode(pre) && !pre.parentElement.closest('pre') && !pre.closest(excludedSelector)) consider(pre,'code');
      for(const error of assistant.querySelectorAll('.katex-error, [data-latex]')) {
        if(ownNode(error) || error.closest('pre') || (error.closest('.katex') && !error.classList.contains('katex-error'))) continue;
        consider(error,'error');
      }
      for(const block of assistant.querySelectorAll('p, .markdown > div, .prose > div')) {
        if(ownNode(block) || block.closest('pre, .katex, code') || block.querySelector('pre, code, p, div, .katex, .katex-error, .latex-islands-container')) continue;
        if(!(block.textContent || '').includes('\\begin')) continue;
        const diagrams=core.splitIslands(block.textContent).filter(token=>token.type==='latex');
        if(diagrams.length===1) consider(block,'raw',diagrams[0].value);
      }
    }
  }
  window.addEventListener('message',event=>{
    if(event.origin!==EXTENSION_ORIGIN) return;
    const data=event.data;if(!data || data.channel!==CHANNEL || typeof data.id!=='string') return;
    const state=ids.get(data.id);if(!state?.frame || event.source!==state.frame.contentWindow) return;
    if(data.type==='ready') {state.ready=true;send(state);}
    if(data.type==='resize' && Number.isFinite(data.height) && editor?.state!==state) state.frame.style.height=Math.max(80,Math.min(16000,Math.ceil(data.height)))+'px';
    if(data.type==='open-editor') openEditor(state);
    if(data.type==='close-editor' && editor?.state===state) closeEditor();
    if(data.type==='source-change' && state.complete && typeof data.source==='string' && data.source.length<=MAX_SOURCE) {
      state.draftSource=data.source;state.sentSource=data.source;
      state.sentKey='render\0'+data.source+'\0'+settings.autoRender+'\0'+settings.scale;
    }
    if(data.type==='result' && state.type!=='raw') {
      if(!state.complete || (typeof data.source==='string' && data.source!==state.sentSource) || state.sentSource!==(state.draftSource??state.source)) return;
      state.element.classList.toggle('latex-islands-original-hidden',data.ok===true || (typeof data.svg==='string' && data.svg.length>0 && !data.error));
    }
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && editor) {event.preventDefault();closeEditor();}});
  const observer=new MutationObserver(mutations=>{
    if(!settings.enabled) return;let changed=false;
    for(const mutation of mutations) {
      if(ownNode(mutation.target)) continue;
      const el=mutation.target.nodeType===Node.ELEMENT_NODE?mutation.target:mutation.target.parentElement;
      if(mutation.type==='attributes') {
        if(mutation.attributeName==='class') {
          const clean=value=>(value || '').replace(/\blatex-islands-[\w-]+\b/g,'').trim();
          if(clean(mutation.oldValue)===clean(el.className)) continue;
        }
      }
      if(mutation.type==='childList' && [...mutation.addedNodes,...mutation.removedNodes].every(ownNode)) continue;
      const assistant=el.closest(assistantSelector);
      if(assistant) dirty.add(assistant);
      else {
        // Streaming markers may live above the assistant. Inspect affected
        // descendants even when a class has just been removed and no longer matches.
        if(mutation.type==='attributes' && ['class','data-is-streaming','aria-busy'].includes(mutation.attributeName)) {
          for(const descendant of el.querySelectorAll(assistantSelector)) dirty.add(descendant);
        }
        for(const node of mutation.addedNodes || []) if(node.nodeType===Node.ELEMENT_NODE && !ownNode(node)) {
          if(node.matches(assistantSelector)) dirty.add(node);
          for(const match of node.querySelectorAll(assistantSelector)) dirty.add(match);
        }
        if(el.matches(streamingSelector) || mutation.attributeName==='data-is-streaming' || mutation.attributeName==='aria-busy' || el.querySelector?.('[data-testid="stop-button"]') || [...(mutation.removedNodes || [])].some(n=>n.nodeType===1 && (n.matches('[data-testid="stop-button"]') || n.querySelector('[data-testid="stop-button"]')))) {
          for(const state of states.values()) dirty.add(state.element.closest(assistantSelector));
        }
      }
      changed=true;
    }
    if(changed) schedule();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeOldValue:true,attributeFilter:['data-is-streaming','aria-busy','class','data-theme','data-language']});
  // Theme tracking is independent of diagram detection, including when islands
  // are disabled. One observer batch and palette comparison avoid storage writes
  // for every streamed token, every island, or our own fullscreen class changes.
  const themeObserver=new MutationObserver(syncPageTheme);
  for(const element of [document.documentElement,document.body]) if(element)themeObserver.observe(element,{attributes:true,attributeFilter:['class','data-theme','style']});
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',syncPageTheme);
  function updateSettings(next) {
    const previousColors=settings.renderColors;
    for(const key of Object.keys(settings))if(Object.hasOwn(next,key))settings[key]=next[key];
    settings.scale=Math.max(.25,Math.min(4,Number(settings.scale)||1));
    settings.renderColors=settings.renderColors==='native'?'native':'chatgpt';
    if(!settings.enabled) {for(const [el,state]of states) removeState(el,state);}
    else {for(const state of states.values()) {send(state);if(previousColors!==settings.renderColors)sendView(state);}fullScan=true;schedule(0);}
  }
  chrome.storage.local.get({...settings,chatgptTheme:null},saved=>{
    if(chrome.runtime.lastError)return;
    storedThemeKey=themeKey(saved?.chatgptTheme);themeStorageReady=true;
    syncPageTheme();updateSettings(saved || {});
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local') return;const next={};
    for(const key of Object.keys(settings)) if(changes[key]) next[key]=changes[key].newValue;
    if(Object.keys(next).length) updateSettings(next);
  });
})();
