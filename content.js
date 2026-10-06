/* SPDX-License-Identifier: GPL-3.0-or-later */
(() => {
  'use strict';
  if (globalThis.__latexIslandsContentLoaded) return;
  const core = globalThis.LatexIslandsCore, chatgpt = globalThis.LatexIslandsChatGPT;
  if (!core || !chatgpt || !globalThis.chrome?.runtime) return;
  globalThis.__latexIslandsContentLoaded = true;
  const CHANNEL = 'latex-islands', MAX_SOURCE = 60000, SETTLE_MS = 180, BOOT_TIMEOUT_MS = 15000;
  const EXTENSION_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '');
  const excludedSelector = 'textarea, input, [contenteditable="true"], [role="textbox"], #prompt-textarea, [data-testid="composer"]';
  const codeSelector = 'pre, .cm-content, [data-markdown-copy="code-block"]';
  const HIDDEN_ATTRIBUTE = 'data-latex-islands-hidden';
  const states = new Map(), ids = new Map(), dirty = new Set();
  const snapshots = new Map(), MAX_SNAPSHOT = 10 * 1024 * 1024;
  const printMedia=window.matchMedia?.('print');
  let snapshotSequence = 0, diagnosticSequence = 0;
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
    return Boolean(el?.closest('.latex-islands-container, .latex-islands-editor, .li-export, .li-export-reply, .li-pdf-root'));
  }
  function assistantFor(node) {
    const message=chatgpt.getMessage(node);
    return message && chatgpt.role(message)==='assistant'?message:null;
  }
  function assistantsWithin(root) {return chatgpt.getMessages(root).filter(message=>chatgpt.role(message)==='assistant' && !ownNode(message));}
  function printingPDF() {return document.body?.classList.contains('li-pdf-printing') || printMedia?.matches;}
  function setSourceHidden(state,hidden) {
    state.hideSource=state.type!=='raw' && hidden;
    const el=state.element;
    if(el.classList.contains('latex-islands-original-hidden')!==state.hideSource)el.classList.toggle('latex-islands-original-hidden',state.hideSource);
    // React owns className and may rewrite it during hydration. This separate
    // marker keeps the source hidden throughout that update, before any paint.
    if(state.hideSource) {if(el.getAttribute(HIDDEN_ATTRIBUTE)!=='true')el.setAttribute(HIDDEN_ATTRIBUTE,'true');}
    else if(el.hasAttribute(HIDDEN_ATTRIBUTE))el.removeAttribute(HIDDEN_ATTRIBUTE);
    const toggle=state.boot?.querySelector('.latex-islands-boot-source');
    if(toggle){const label=state.hideSource?'Show code':'Hide code',expanded=String(!state.hideSource);if(toggle.textContent!==label)toggle.textContent=label;if(toggle.getAttribute('aria-expanded')!==expanded)toggle.setAttribute('aria-expanded',expanded);}
  }
  function currentSource(el, type) {
    if (type === 'error') return [el.getAttribute('data-latex'), el.textContent, el.getAttribute('title')].find(v => v && core.detectKind(v)) || '';
    if(type === 'raw') return el.textContent || '';
    return chatgpt.source(el);
  }
  function hasFollowingContent(el) {
    const assistant = assistantFor(el);
    const boundary=el.closest('[data-markdown-text-style="assistant-message"], .markdown, .prose, li, blockquote') || assistant;
    // Only another Markdown block proves that the code fence has closed. A copy
    // button or footer inside the code widget can already exist during streaming.
    let block=el;
    while(block && block.parentElement!==boundary) block=block.parentElement;
    if(!block) return false;
    const content='p, '+codeSelector+', ul, ol, blockquote, table, h1, h2, h3, h4, h5, h6, hr, .katex-display';
    const controls='button, [role="button"], [role="toolbar"], [aria-hidden="true"], [data-markdown-copy="exclude"]';
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
    const root=document.documentElement, css=getComputedStyle(assistantFor(el) || document.body);
    const dark=root.classList.contains('dark') || root.dataset.theme==='dark' || (!root.classList.contains('light') && css.colorScheme==='dark');
    let background=dark?'#212121':'#ffffff';
    for(let parent=el?.parentElement || document.body;parent;parent=parent.parentElement) {
      const color=getComputedStyle(parent).backgroundColor;
      if(color && color!=='transparent' && !/rgba\([^)]*,\s*0\)$/.test(color)) {background=color;break;}
    }
    const tooltip=Object.fromEntries(Object.entries({background:'--color-background-tooltip',text:'--color-text-tooltip',border:'--color-border-tooltip',shadow:'--shadow-tooltip'}).map(([key,name])=>[key,css.getPropertyValue(name).trim()]).filter(([,value])=>value));
    const hover=css.getPropertyValue('--color-background-primary-ghost-hover').trim();
    return {theme:dark?'dark':'light',colors:{background,text:css.color || (dark?'#ececec':'#0d0d0d'),surface:dark?'#2f2f2f':'#f4f4f4',border:dark?'#424242':'#e5e5e5',...(hover?{hover}:{})},...(Object.keys(tooltip).length?{tooltip}:{})};
  }
  function pageTheme() {return appearance(assistantsWithin()[0] || document.body);}
  function themeKey(theme) {return JSON.stringify([theme?.theme,...['text','background','surface','border','hover'].map(key=>theme?.colors?.[key]),...['background','text','border','shadow'].map(key=>theme?.tooltip?.[key])]);}
  function sendView(state) {
    post(state,{type:'view',mode:editor?.state===state?'editor':'inline',renderColors:settings.renderColors,...appearance(state.element)});
  }
  function syncPageTheme() {
    if(!globalThis.document?.body || printingPDF())return;
    const theme=pageTheme(),key=themeKey(theme);
    if(key!==pageThemeKey) {pageThemeKey=key;for(const state of states.values())sendView(state);}
    if(themeStorageReady && key!==storedThemeKey) {
      storedThemeKey=key;
      chrome.storage.local.set({chatgptTheme:theme},()=>{if(chrome.runtime.lastError)storedThemeKey='';});
    }
  }
  function post(state,data) {
    if(!state.ready || !state.port || !liveFrame(state)) return false;
    // The port belongs to the verified extension document, unlike WindowProxy,
    // which can temporarily point at an inherited about:blank during navigation.
    state.port.postMessage({channel:CHANNEL,id:state.id,...data});
    return true;
  }
  function attachedFrame(state) {return ids.get(state.id)===state && state.element.isConnected && state.container?.isConnected && state.frame?.isConnected && state.frame.parentElement===state.container;}
  function liveFrame(state) {return attachedFrame(state) && !state.documentDetached && !state.frame.hasAttribute('srcdoc') && state.frame.src===state.frameURL;}
  function recordDiagnostic(state,event,reason) {
    state.diagnostics ||= [];state.diagnosticStart ??=Date.now();
    const source=state.frame?.getAttribute('src') || '';
    // Record only lifecycle facts. Never retain diagram text, chat/message IDs,
    // URLs, compiler logs, composer drafts, or iframe document contents.
    const src=source===state.frameURL?'renderer':!source?'missing':source==='about:blank'?'about-blank':/^https?:/i.test(source)?'web':/^(?:chrome|moz)-extension:/i.test(source)?'extension':'other';
    state.diagnostics.push({ms:Date.now()-state.diagnosticStart,event,...(reason?{reason}:{}),frame:state.diagnosticFrame || 0,generation:state.generation || 0,src,srcdoc:Boolean(state.frame?.hasAttribute('srcdoc')),ready:Boolean(state.ready),port:Boolean(state.port),attached:Boolean(attachedFrame(state)),detached:Boolean(state.documentDetached),visible:Boolean(state.element?.isConnected && chatgpt.isVisible(state.element.parentElement)),routeChanged:Boolean(state.href && state.href!==location.href),recoveries:state.navigationRecoveries || 0,pageVisible:document.visibilityState==='visible',sinceReadyMs:state.diagnosticReadyAt==null?null:Date.now()-state.diagnosticReadyAt,sinceResultMs:state.diagnosticResult==null?null:Date.now()-state.diagnosticResult.at,lastResult:state.diagnosticResult?.ok ?? null});
    if(state.diagnostics.length>64)state.diagnostics.splice(0,state.diagnostics.length-64);
  }
  function diagnosticReport(state) {
    return JSON.stringify({extension:'LaTeX Islands',version:chrome.runtime.getManifest?.().version || 'unknown',diagram:state.diagnosticNumber,elapsedMs:Date.now()-(state.diagnosticStart || Date.now()),events:state.diagnostics || []},null,2);
  }
  function sourceForSnapshot(state) {
    const source=currentSource(state.element,state.type);
    return core.stripFence(state.type==='raw'?core.splitIslands(source).find(token=>token.type==='latex')?.value || '':source);
  }
  function snapshotCurrent(request) {
    const {state,port,source,hostSource,href,generation}=request;
    return location.href===href && liveFrame(state) && !state.frame.hasAttribute('srcdoc') && state.ready && state.port===port && state.generation===generation && state.complete &&
      state.sentSource===source && (state.draftSource??state.source)===source && state.source===hostSource && sourceForSnapshot(state)===hostSource;
  }
  function snapshotSourceCurrent(request) {
    const {state,source,hostSource,href}=request;
    // A failed renderer can still export its code, but never code from another
    // conversation or an edited/replaced message.
    return location.href===href && ids.get(state.id)===state && state.element.isConnected && state.container?.isConnected && state.complete &&
      (state.draftSource??state.source)===source && state.source===hostSource && sourceForSnapshot(state)===hostSource;
  }
  function diagramSnapshotError(message) {const error=new Error(message);error.code='LI_DIAGRAM_UNAVAILABLE';return error;}
  function conciseDiagramError(message) {
    const lines=String(message || 'The diagram could not be rendered.').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    return (lines.find(line=>/^!|^Package .+ Error:|^Please use /.test(line)) || lines[0] || 'The diagram could not be rendered.').replace(/^!\s*/,'').slice(0,500);
  }
  function snapshotUnavailableMessage(request) {
    const {state,source,hostSource}=request;
    if(!liveFrame(state) || state.frame.hasAttribute('srcdoc'))return 'The diagram is unavailable. Reload the conversation and try again.';
    if(!state.ready || !state.port)return 'The diagram connection is still loading. Wait for it to finish, then export again.';
    if(!state.complete)return 'The diagram code is still streaming. Wait for it to finish rendering, then export again.';
    if(state.sentSource!==source)return 'The latest diagram code has not been sent for rendering. Wait for it to render, then export again.';
    if(sourceForSnapshot(state)!==hostSource)return 'The diagram source changed before export. Wait for the latest code to render, then export again.';
    return 'The diagram or conversation changed. Try exporting the PDF again.';
  }
  function cancelSnapshots(state,message) {
    for(const request of snapshots.values())if(!state || request.state===state)request.finish(new Error(message));
  }
  function checkSnapshots() {
    for(const request of snapshots.values())if(!snapshotCurrent(request))request.finish(new Error('The diagram or conversation changed. Try exporting the PDF again.'));
  }
  async function fixError(state,data) {
    if(typeof data.requestId!=='string' || !/^fix-\d{1,10}$/.test(data.requestId))return;
    state.fixResponses ||=new Map();
    if(state.fixResponses.has(data.requestId)){post(state,state.fixResponses.get(data.requestId));return;}
    state.fixPending ||=new Set();const pending=state.fixPending;if(pending.has(data.requestId))return;pending.add(data.requestId);
    const port=state.port;
    const respond=(ok,message)=>{
      pending.delete(data.requestId);if(state.port!==port)return;
      const response={type:'fix-error-result',requestId:data.requestId,ok,...(message?{message}:{})};
      state.fixResponses.set(data.requestId,response);while(state.fixResponses.size>20)state.fixResponses.delete(state.fixResponses.keys().next().value);
      try{post(state,response);}catch{ /* A navigating document can close the port before acknowledgement. */ }
    };
    if(!liveFrame(state) || state.href!==location.href || assistantFor(state.element)!==state.message || chatgpt.messageId(state.message)!==state.messageId || !state.complete || typeof data.source!=='string' || data.source.length>MAX_SOURCE ||
      data.source!==(state.draftSource??state.source) || data.source!==state.sentSource || sourceForSnapshot(state)!==state.source ||
      typeof data.error!=='string' || !data.error.trim() || data.error.length>60000){respond(false,'The diagram changed. Render it again before asking ChatGPT to fix it.');return;}
    const candidates=[...document.querySelectorAll('#prompt-textarea, [data-chatgpt-composer] textarea, [data-chatgpt-composer] [contenteditable="true"], [data-chatgpt-composer] [contenteditable="plaintext-only"]')];
    const composer=candidates.find(node=>chatgpt.isVisible(node) && !node.disabled && !node.readOnly && node.getAttribute('aria-readonly')!=='true' &&
      !node.closest('.latex-islands-container, .latex-islands-editor, .li-export, [data-message-author-role], [data-chatgpt-search-unit-key], [data-chatgpt-selection-message-id]') &&
      (node.localName==='textarea' || node.matches('[contenteditable="true"], [contenteditable="plaintext-only"]')));
    if(!composer){respond(false,'The ChatGPT composer is not available. Open the conversation and try again.');return;}
    const log=data.error;
    const fence='`'.repeat(Math.max(3,...[... (data.source+log).matchAll(/`+/g)].map(match=>match[0].length+1)));
    const prompt=['Please fix this TikZ/LaTeX diagram so it renders correctly. Return the corrected diagram in a single tikz Markdown code block.','',fence+'tikz',data.source,fence,'','Renderer error:',fence+'text',log,fence].join('\n');
    const readComposer=()=>{
      if(composer.localName==='textarea')return composer.value;
      // innerText reflects CSS whitespace collapsing, not the draft's retained
      // text: ordinary paragraph styling can turn a valid TeX log's two spaces
      // into one. Read text nodes and explicit line/block boundaries instead.
      const read=node=>{
        if(node.nodeType===Node.TEXT_NODE)return node.textContent;
        if(node.nodeType!==Node.ELEMENT_NODE)return '';
        if(node.localName==='br')return '\n';
        const text=[...node.childNodes].map(read).join('');
        return /^(p|div|li|blockquote|pre|h[1-6])$/.test(node.localName)?'\n'+text+'\n':text;
      };
      return [...composer.childNodes].map(read).join('');
    };
    const existing=readComposer();
    const insertion=(existing.trim()?'\n\n':'')+prompt;
    if(editor?.state===state)closeEditor();
    try{
      composer.focus();
      if(composer.localName==='textarea'){
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(composer,existing+insertion);
        composer.setSelectionRange(composer.value.length,composer.value.length);
        composer.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:insertion}));
      }else{
        const selection=document.getSelection(),range=document.createRange();range.selectNodeContents(composer);range.collapse(false);selection.removeAllRanges();selection.addRange(range);
        if(typeof document.execCommand!=='function' || !document.execCommand('insertText',false,insertion))throw Error('Composer editing unavailable');
      }
      // Verify the editor/framework accepted the draft, including asynchronous
      // input reconciliation. Never retry insertion automatically after a partial edit.
      await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timeout);resolve();};const timeout=setTimeout(finish,100);requestAnimationFrame(finish);});
      const normalize=text=>text.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').split('\n').map(line=>line.trimEnd()).filter(Boolean).join('\n');
      if(!composer.isConnected || normalize(readComposer())!==normalize(existing+insertion))throw Error('Composer did not retain the request');
      // Populate the draft only. Sending remains the user's explicit action.
      respond(true);
    }catch{respond(false,'Could not add the repair request to the composer. Try again.');}
  }
  function receiveSnapshot(state,port,data) {
    if(state.port!==port || data?.channel!==CHANNEL || data.id!==state.id)return;
    if(data.type==='document-pong'){if(state.documentProbe?.port===port && state.documentProbe.requestId===data.requestId){recordDiagnostic(state,'probe-ack');stopDocumentProbe(state);}return;}
    if(data.type==='fix-error'){fixError(state,data);return;}
    if(data.type==='snapshot-unavailable') {
      recordDiagnostic(state,'connection-lost','renderer-pagehide');
      cancelSnapshots(state,'The diagram reloaded. Wait for it to render, then export again.');
      stopDocumentProbe(state);state.ready=false;state.port.close();state.port=null;startBootWatchdog(state,true);return;
    }
    if(data.type!=='snapshot-result' || typeof data.requestId!=='string')return;
    const request=snapshots.get(data.requestId);
    if(!request || request.state!==state || request.port!==port)return;
    if(!snapshotCurrent(request) || data.source!==request.source) {request.finish(new Error('The diagram changed. Wait for the latest render, then export again.'));return;}
    if(data.ok!==true) {
      const message=typeof data.error==='string'?data.error.slice(0,500):'The diagram could not be exported. Render it and try again.';
      request.finish(/^The diagram (?:has changed|changed|is still streaming)/.test(message)?new Error(message):diagramSnapshotError(message));return;
    }
    if(typeof data.svg!=='string' || !data.svg || data.svg.length>MAX_SNAPSHOT || new Blob([data.svg]).size>MAX_SNAPSHOT ||
      !Number.isFinite(data.width) || !Number.isFinite(data.height) || data.width<=0 || data.height<=0 || data.width>100000 || data.height>100000) {
      request.finish(diagramSnapshotError('The diagram export has invalid dimensions or exceeds the 10 MB limit.'));return;
    }
    request.finish(null,{sourceElement:state.element,containerElement:state.container,svg:data.svg,width:data.width,height:data.height});
  }
  function snapshotState(request,signal,timeoutMs=10000) {
    return new Promise((resolve,reject)=>{
      const {state,source}=request,requestId='snapshot-'+(++snapshotSequence);
      let timeout=0,finished=false;
      const abort=()=>request.finish(new DOMException('PDF export was cancelled.','AbortError'));
      request.finish=(error,value)=>{
        if(finished)return;finished=true;clearTimeout(timeout);signal?.removeEventListener('abort',abort);snapshots.delete(requestId);
        if(error) {
          try {request.port?.postMessage({channel:CHANNEL,id:state.id,type:'snapshot-cancel',requestId});} catch { /* The document may have closed its channel. */ }
          reject(error);
        } else resolve(value);
      };
      if(signal?.aborted) {abort();return;}
      if(!snapshotCurrent(request)) {request.finish(new Error(snapshotUnavailableMessage(request)));return;}
      snapshots.set(requestId,request);signal?.addEventListener('abort',abort,{once:true});
      timeout=setTimeout(()=>request.finish(diagramSnapshotError('The diagram export timed out. Render the diagram again and retry the PDF export.')),timeoutMs);
      try {if(!post(state,{type:'snapshot',requestId,source}))request.finish(diagramSnapshotError('The diagram is unavailable. Reload it and try exporting again.'));}
      catch {request.finish(diagramSnapshotError('The diagram disconnected. Reload it and try exporting again.'));}
    });
  }
  async function tolerantSnapshot(request,signal) {
    const {state,source}=request,deadline=Date.now()+10000;
    const fallback=message=>({sourceElement:state.element,containerElement:state.container,source,error:conciseDiagramError(message)});
    const check=()=>{
      if(signal.aborted)throw new DOMException('PDF export was cancelled.','AbortError');
      if(!snapshotSourceCurrent(request))throw new Error('The diagram or conversation changed. Try exporting the PDF again.');
    };
    const pause=()=>new Promise((resolve,reject)=>{
      const finish=()=>{signal.removeEventListener('abort',abort);resolve();};
      const timer=setTimeout(finish,Math.min(200,Math.max(0,deadline-Date.now())));
      const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('PDF export was cancelled.','AbortError'));};
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    });
    while(true) {
      check();
      request.port=state.port;request.generation=state.generation;
      if(snapshotCurrent(request)) {
        try {return await snapshotState(request,signal,Math.max(1,deadline-Date.now()));}
        catch(error) {
          check();
          if(error.code!=='LI_DIAGRAM_UNAVAILABLE')throw error;
          if(!/still rendering|still loading/.test(error.message) || Date.now()>=deadline)return fallback(state.failedSource===source && state.renderError || error.message);
        }
      }
      if(Date.now()>=deadline)return fallback(snapshotUnavailableMessage(request));
      await pause();
    }
  }
  globalThis.LatexIslandsDiagramExport=Object.freeze({async snapshot(element,{signal,tolerateErrors=false}={}) {
    if(signal?.aborted)throw new DOMException('PDF export was cancelled.','AbortError');
    if(!element?.isConnected || typeof element.contains!=='function')throw new Error('The conversation is no longer available.');
    // Include diagrams added since the last scheduled scan; do not silently print their source instead.
    fullScan=true;scan();
    const selected=[...states.values()].filter(state=>element.contains(state.element));
    const checkpoints=selected.map(state=>({state,port:state.port,source:state.draftSource??state.source,hostSource:state.source,href:location.href,generation:state.generation}));
    const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});window.addEventListener('pagehide',abort,{once:true});
    try {
      const results=await Promise.all(checkpoints.map(request=>tolerateErrors?tolerantSnapshot(request,controller.signal):snapshotState(request,controller.signal)));
      if(controller.signal.aborted)throw new DOMException('PDF export was cancelled.','AbortError');
      if(!element.isConnected || checkpoints.some((request,index)=>!element.contains(request.state.element)||!(results[index].error?snapshotSourceCurrent(request):snapshotCurrent(request))))throw new Error('The diagram or conversation changed. Try exporting the PDF again.');
      return results;
    }
    finally {controller.abort();signal?.removeEventListener('abort',abort);window.removeEventListener('pagehide',abort);}
  }});
  function send(state,force=false) {
    const source=state.complete && state.draftSource!=null?state.draftSource:state.source;
    const type=state.complete?'render':'prepare', key=type+'\0'+source+'\0'+settings.autoRender+'\0'+settings.scale;
    // Replace existing-chat code on the detection pass, before the iframe has
    // loaded. Errors and explicit manual rendering keep their original source.
    if(state.type!=='raw' && state.failedSource!==source && !state.revealedSource && (!state.complete || settings.autoRender))setSourceHidden(state,true);
    if(state.boot && !state.bootFailed) {
      const status=state.boot.querySelector('[role="status"]'),text=!state.complete?'Writing diagram…':settings.autoRender?'Rendering diagram…':'Loading preview…';
      if(status.textContent!==text)status.textContent=text;
    }
    if(!state.ready || (!force && state.sentKey===key)) return;
    state.loading=!state.complete || (settings.autoRender && (force || state.sentSource!==source));
    state.heightFloor=Number.parseFloat(state.frame.style.height) || 222;
    if(!post(state,{type,source,kind:'tikz',streaming:!state.complete,autoRender:settings.autoRender,scale:settings.scale,renderColors:settings.renderColors,mode:editor?.state===state?'editor':'inline',...appearance(state.element)})) return;
    state.sentKey=key;state.sentSource=state.complete?source:null;
  }
  function finishBoot(state) {
    state.boot?.remove();state.boot=null;state.container.classList.remove('latex-islands-booting');
  }
  function addBoot(state) {
    if(state.boot)return;
    const boot=document.createElement('div');boot.className='latex-islands-boot';
    const spinner=document.createElement('span');spinner.className='latex-islands-boot-spinner';spinner.setAttribute('aria-hidden','true');
    const status=document.createElement('span');status.setAttribute('role','status');status.textContent='Loading diagram…';
    const actions=document.createElement('div');actions.className='latex-islands-boot-actions';
    const reveal=document.createElement('button');reveal.type='button';reveal.className='latex-islands-boot-source';
    reveal.textContent=state.hideSource?'Show code':'Hide code';reveal.setAttribute('aria-expanded',String(!state.hideSource));
    reveal.addEventListener('click',()=>{if(state.boot!==boot || !boot.isConnected)return;const hidden=!state.hideSource;state.revealedSource=!hidden;setSourceHidden(state,hidden);});
    if(state.type==='raw')reveal.hidden=true;
    const retry=document.createElement('button');retry.type='button';retry.textContent='Retry';retry.className='latex-islands-boot-retry';retry.hidden=true;
    retry.addEventListener('click',()=>{if(state.boot===boot && boot.isConnected)retryIsland(state);});actions.append(reveal,retry);
    const diagnostics=document.createElement('details');diagnostics.className='latex-islands-boot-diagnostics';diagnostics.hidden=true;
    const summary=document.createElement('summary');summary.textContent='Technical details';
    const report=document.createElement('pre');report.className='latex-islands-boot-report';
    const copy=document.createElement('button');copy.type='button';copy.className='latex-islands-boot-copy-diagnostics';copy.textContent='Copy diagnostics';
    copy.addEventListener('click',async()=>{
      if(state.boot!==boot || !boot.isConnected)return;
      try{await navigator.clipboard.writeText(diagnosticReport(state));copy.textContent='Copied';}
      catch{copy.textContent='Select diagnostics';diagnostics.open=true;const range=document.createRange();range.selectNodeContents(report);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);}
    });diagnostics.append(summary,report,copy);
    boot.append(spinner,status,actions,diagnostics);state.boot=boot;state.container.append(boot);state.container.classList.add('latex-islands-booting');
  }
  function stopBootWatchdog(state) {clearTimeout(state.bootWatchdog);state.bootWatchdog=0;}
  function stopDocumentProbe(state) {clearTimeout(state.documentProbe?.timer);state.documentProbe=null;}
  function probeDocument(state) {
    stopDocumentProbe(state);if(!state.ready || !state.port || !liveFrame(state))return;
    state.probeSequence=(state.probeSequence || 0)+1;
    const probe={port:state.port,requestId:'ping-'+state.probeSequence};state.documentProbe=probe;
    recordDiagnostic(state,'probe-start');
    probe.timer=setTimeout(()=>{if(state.documentProbe!==probe)return;stopDocumentProbe(state);restartIsland(state,true,'probe-timeout');},5000);
    try{post(state,{type:'document-ping',requestId:probe.requestId});}catch{stopDocumentProbe(state);restartIsland(state,true,'probe-send-failed');}
  }
  function resetBoot(state) {
    state.bootFailed=false;
    if(!state.boot)return;
    const status=state.boot.querySelector('[role="status"], [role="alert"]');status.setAttribute('role','status');status.textContent='Connecting diagram…';
    state.boot.querySelector('.latex-islands-boot-spinner').hidden=false;state.boot.querySelector('.latex-islands-boot-retry').hidden=true;
    state.boot.querySelector('.latex-islands-boot-diagnostics').hidden=true;state.boot.removeAttribute('data-latex-islands-error-reason');
  }
  function failBoot(state,message,reason) {
    recordDiagnostic(state,'boot-error',reason);
    addBoot(state);state.bootFailed=true;
    const status=state.boot.querySelector('[role="status"], [role="alert"]');status.setAttribute('role','alert');status.textContent=message;
    state.boot.querySelector('.latex-islands-boot-spinner').hidden=true;state.boot.querySelector('.latex-islands-boot-retry').hidden=false;
    state.boot.setAttribute('data-latex-islands-error-reason',reason || 'unknown');state.boot.querySelector('.latex-islands-boot-report').textContent=diagnosticReport(state);state.boot.querySelector('.latex-islands-boot-diagnostics').hidden=false;
  }
  function startBootWatchdog(state,recoverLostDocument=false) {
    stopBootWatchdog(state);
    if(!attachedFrame(state) || state.ready)return;
    addBoot(state);resetBoot(state);
    state.bootWatchdog=setTimeout(()=>{
      state.bootWatchdog=0;
      if(!settings.enabled || state.ready || !attachedFrame(state))return;
      if(recoverLostDocument){restartIsland(state,true,'pagehide-timeout');return;}
      failBoot(state,'The diagram preview did not connect. Retry or show the code.','initial-handshake-timeout');
    },BOOT_TIMEOUT_MS);
  }
  function restartIsland(state,automatic=false,reason='manual-retry') {
    if(!settings.enabled || !attachedFrame(state) || state.href!==location.href || assistantFor(state.element)!==state.message ||
      chatgpt.messageId(state.message)!==state.messageId || (automatic && state.navigationFailed))return false;
    recordDiagnostic(state,automatic?'automatic-recovery':'manual-retry',reason);
    stopBootWatchdog(state);stopDocumentProbe(state);cancelSnapshots(state,'The diagram is reconnecting. Wait for it to render, then export again.');
    state.ready=false;state.port?.close();state.port=null;
    // A cached page may replace the document while retaining its iframe node.
    // Retire that document once, never mutate its srcdoc or use its window as a
    // trusted destination. Repeated interruptions require an explicit retry.
    if(automatic && state.navigationRecoveries>=1){state.navigationFailed=true;failBoot(state,'The diagram preview was interrupted again. Retry or show the code.',reason);return false;}
    const recoveries=automatic?(state.navigationRecoveries || 0)+1:0;
    // Refresh source before rebuilding: late hydration may have changed it in
    // the same mutation batch as the iframe, invalidating an old local draft.
    consider(state.element,state.type,sourceForSnapshot(state));if(!attachedFrame(state))return false;
    if(editor?.state===state)closeEditor();
    state.container.remove();state.boot=null;state.sentKey=null;state.sentSource=null;
    addIsland(state.element,state,recoveries);send(state);return true;
  }
  function retryIsland(state) {restartIsland(state);}
  function addIsland(el,state,navigationRecoveries=0) {
    stopBootWatchdog(state);stopDocumentProbe(state);state.boot=null;state.documentDetached=false;state.navigationRecoveries=navigationRecoveries;state.navigationFailed=false;
    const container=document.createElement('div');container.className='latex-islands-container latex-islands-booting';
    container.setAttribute('role','region');container.setAttribute('aria-label','TikZ diagram');
    const frame=document.createElement('iframe');frame.title='TikZ diagram — preview, code and download';
    frame.style.height=(state.lastHeight || 222)+'px';
    frame.src=chrome.runtime.getURL('island.html')+'?parentOrigin='+encodeURIComponent(location.origin)+'#'+encodeURIComponent(state.id);
    state.frameURL=frame.src;state.generation=0;state.diagnosticFrame=(state.diagnosticFrame || 0)+1;state.diagnosticReadyAt=null;state.diagnosticResult=null;
    frame.addEventListener('load',()=>{if(state.frame!==frame)return;recordDiagnostic(state,'frame-load');state.generation++;cancelSnapshots(state,'The diagram reloaded. Wait for it to render, then export again.');probeDocument(state);});
    frame.setAttribute('scrolling','no');frame.setAttribute('allow','clipboard-write');frame.referrerPolicy='no-referrer';
    state.container=container;state.frame=frame;ids.set(state.id,state);
    container.append(frame);addBoot(state);el.insertAdjacentElement('afterend',container);recordDiagnostic(state,'frame-created');startBootWatchdog(state);
  }
  const editorBoundsProperties=['--li-editor-left','--li-editor-top','--li-editor-width','--li-editor-height'];
  function trackEditorBounds(active) {
    let pending=0,region;
    const request=window.requestAnimationFrame?.bind(window) || (callback=>setTimeout(callback,16));
    const cancel=window.cancelAnimationFrame?.bind(window) || clearTimeout;
    const resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(scheduleBounds):null;
    function updateBounds() {
      pending=0;
      if(editor!==active)return;
      if(!active.state.element.isConnected) {closeEditor();return;}
      const next=chatgpt.getViewport(active.state.element);
      if(next!==region) {
        region=next;resizeObserver?.disconnect();
        for(let ancestor=region || document.body;ancestor;ancestor=ancestor.parentElement)resizeObserver?.observe(ancestor);
      }
      const visual=window.visualViewport;
      const viewport={left:visual?.offsetLeft || 0,top:visual?.offsetTop || 0,width:visual?.width || window.innerWidth,height:visual?.height || window.innerHeight};
      const rect=region?.getBoundingClientRect();
      let left=viewport.left,top=viewport.top,right=left+viewport.width,bottom=top+viewport.height;
      if(rect?.width>0 && rect.height>0) {
        const clipped={left:Math.max(left,rect.left),top:Math.max(top,rect.top),right:Math.min(right,rect.right),bottom:Math.min(bottom,rect.bottom)};
        if(clipped.right>clipped.left && clipped.bottom>clipped.top) ({left,top,right,bottom}=clipped);
      }
      const values=[left,top,right-left,bottom-top].map(value=>value+'px');
      for(const element of [active.state.container,active.dialog])editorBoundsProperties.forEach((property,index)=>{
        if(element.style.getPropertyValue(property)!==values[index])element.style.setProperty(property,values[index]);
      });
    }
    function scheduleBounds() {if(!pending && editor===active)pending=request(updateBounds);}
    // ResizeObserver tracks the sidebar's width transition. Class/style changes
    // and transitionend also cover layouts which move without resizing a panel.
    const layoutObserver=new MutationObserver(mutations=>{
      if(!globalThis.document?.documentElement){layoutObserver.disconnect();return;}
      if(editor!==active)return;
      if(!active.state.element.isConnected) {closeEditor();return;}
      if(mutations.some(mutation=>{
        const target=mutation.target.nodeType===Node.ELEMENT_NODE?mutation.target:mutation.target.parentElement;
        return !ownNode(target) && !assistantFor(target) && !(mutation.type==='childList' && [...mutation.addedNodes,...mutation.removedNodes].every(ownNode));
      }))scheduleBounds();
    });
    layoutObserver.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden','aria-expanded','data-state','data-collapsed']});
    window.addEventListener('resize',scheduleBounds);
    window.visualViewport?.addEventListener('resize',scheduleBounds);
    window.visualViewport?.addEventListener('scroll',scheduleBounds);
    document.addEventListener('transitionend',scheduleBounds,true);
    updateBounds();
    return ()=>{
      if(pending)cancel(pending);resizeObserver?.disconnect();layoutObserver.disconnect();
      window.removeEventListener('resize',scheduleBounds);
      window.visualViewport?.removeEventListener('resize',scheduleBounds);
      window.visualViewport?.removeEventListener('scroll',scheduleBounds);
      document.removeEventListener('transitionend',scheduleBounds,true);
      for(const property of editorBoundsProperties)active.state.container.style.removeProperty(property);
    };
  }
  function closeEditor() {
    if(!editor) return;
    const {state,dialog,focus,stopTracking}=editor;editor=null;stopTracking?.();
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
    editor.stopTracking=trackEditorBounds(editor);
    sendView(state);state.frame.focus();
  }
  function removeState(el,state) {
    stopBootWatchdog(state);stopDocumentProbe(state);
    cancelSnapshots(state,'The diagram was removed. Try exporting the current conversation again.');
    state.ready=false;state.port?.close();state.port=null;
    if(editor?.state===state) closeEditor();
    setSourceHidden(state,false);state.container?.remove();ids.delete(state.id);states.delete(el);
  }
  function rebindHydratedSource(state) {
    if(state.type!=='code' || state.documentDetached || state.element.isConnected || state.href!==location.href || !state.message?.isConnected ||
      !state.container?.isConnected || !state.frame?.isConnected || state.frame.parentElement!==state.container || state.frame.src!==state.frameURL)return;
    const replacement=state.container.previousElementSibling;
    // Adjacency disambiguates repeated identical diagrams. Reuse only the live
    // iframe left in place by a source-only replacement, never move its DOM.
    if(!replacement || states.has(replacement) || replacement.closest(excludedSelector) || assistantFor(replacement)!==state.message ||
      chatgpt.messageId(state.message)!==state.messageId || !chatgpt.getCodeBlocks(state.message).includes(replacement) ||
      core.stripFence(currentSource(replacement,'code'))!==state.source)return;
    cancelSnapshots(state,'The diagram source was replaced. Try exporting the PDF again.');
    const previous=state.element,hidden=state.hideSource;
    setSourceHidden(state,false);states.delete(previous);state.element=replacement;states.set(replacement,state);
    setSourceHidden(state,hidden);dirty.add(state.message);
  }
  function removeCachedIslands(assistant) {
    const owned=new Set([...states.values()].map(state=>state.container));
    for(const container of assistant.querySelectorAll('.latex-islands-container')) {
      if(owned.has(container))continue;
      const frame=[...container.children].find(node=>node.localName==='iframe');if(!frame)continue;
      let url;try{url=new URL(frame.getAttribute('src') || '',location.href);}catch{continue;}
      if(url.protocol+'//'+url.host!==EXTENSION_ORIGIN || url.pathname!=='/island.html' || url.searchParams.get('parentOrigin')!==location.origin || !/^#li-/.test(url.hash))continue;
      // A cached HTML clone has no document-bound port or runtime state. Never
      // adopt its iframe: rebuild from the rediscovered source with a fresh ID.
      container.remove();
    }
  }
  function consider(el,type,sourceOverride) {
    if(el.closest(excludedSelector)) return;
    const source=core.stripFence(sourceOverride ?? currentSource(el,type));
    const kind=core.detectKind(source,type==='code'?chatgpt.language(el):'');
    if(source.length>MAX_SOURCE || !kind) {const old=states.get(el);if(old)removeState(el,old);return;}
    let state=states.get(el);
    const message=assistantFor(el),messageId=chatgpt.messageId(message);
    if(state && (state.href!==location.href || state.message!==message || state.messageId!==messageId)){removeState(el,state);state=null;}
    if(!state) {state={id:'li-'+Date.now().toString(36)+'-'+(++sequence),diagnosticNumber:++diagnosticSequence,source,type,element:el,updated:Date.now(),complete:false,ready:false,sentSource:null};setSourceHidden(state,false);states.set(el,state);addIsland(el,state);}
    else if(state.source!==source) {setSourceHidden(state,false);state.source=source;state.draftSource=null;state.failedSource=null;state.revealedSource=false;state.updated=Date.now();}
    state.message=assistantFor(el);state.messageId=chatgpt.messageId(state.message);state.href=location.href;
    const streaming=chatgpt.isStreaming(el), settled=Date.now()-state.updated>=SETTLE_MS;
    state.complete=Boolean(source.trim()) && (!streaming || hasFollowingContent(el) || (settled && completeTeX(source)));
    if(!state.complete && source && !settled) {dirty.add(assistantFor(el));schedule(SETTLE_MS-(Date.now()-state.updated));}
    send(state);
  }
  function scan() {
    if(!settings.enabled) return;
    // Our print stylesheet temporarily hides the app. Its message visibility
    // says nothing about navigation; keep the ready documents and editor drafts.
    if(printingPDF()){fullScan=true;return;}
    for(const state of [...states.values()])rebindHydratedSource(state);
    for(const [el,state]of states) {
      const assistant=assistantFor(el);
      if(!el.isConnected || !assistant || el.closest(excludedSelector) || state.href!==location.href || state.message!==assistant || state.messageId!==chatgpt.messageId(assistant)) {removeState(el,state);if(assistant)dirty.add(assistant);}
      else if(attachedFrame(state) && !state.documentDetached && (state.frame.hasAttribute('srcdoc') || state.frame.src!==state.frameURL))restartIsland(state,true,state.frame.hasAttribute('srcdoc')?'srcdoc-override':'src-changed');
      else if(!liveFrame(state)) {
        // React can replace an injected sibling while retaining the original
        // code widget. Rebuild its document without discarding the user's draft.
        cancelSnapshots(state,'The diagram reloaded. Wait for it to render, then export again.');
        state.ready=false;state.port?.close();state.port=null;
        if(editor?.state===state)closeEditor();
        setSourceHidden(state,false);state.container?.remove();
        state.sentKey=null;state.sentSource=null;addIsland(el,state);dirty.add(assistant);
      }
    }
    const assistants=fullScan?assistantsWithin():[...dirty];fullScan=false;dirty.clear();
    for(const assistant of assistants) {
      if(!assistant?.isConnected || chatgpt.role(assistant)!=='assistant' || ownNode(assistant)) continue;
      removeCachedIslands(assistant);
      for(const block of chatgpt.getCodeBlocks(assistant)) if(!ownNode(block) && !block.closest(excludedSelector)) consider(block,'code');
      for(const error of assistant.querySelectorAll('.katex-error, [data-latex]')) {
        if(ownNode(error) || error.closest(codeSelector) || (error.closest('.katex') && !error.classList.contains('katex-error'))) continue;
        consider(error,'error');
      }
      for(const block of assistant.querySelectorAll('p, .markdown > div, .prose > div, [data-markdown-text-style="assistant-message"] > div')) {
        if(ownNode(block) || block.closest(codeSelector+', .katex, code') || block.querySelector(codeSelector+', code, p, div, .katex, .katex-error, .latex-islands-container')) continue;
        if(!(block.textContent || '').includes('\\begin')) continue;
        const diagrams=core.splitIslands(block.textContent).filter(token=>token.type==='latex');
        if(diagrams.length===1) consider(block,'raw',diagrams[0].value);
      }
    }
  }
  window.addEventListener('message',event=>{
    if(event.origin!==EXTENSION_ORIGIN) return;
    const data=event.data;if(!data || data.channel!==CHANNEL || typeof data.id!=='string') return;
    const state=ids.get(data.id);if(!state?.frame || !liveFrame(state) || event.source!==state.frame.contentWindow) return;
    if(data.type==='ready') {
      const port=event.ports?.[0];if(!port) return;
      cancelSnapshots(state,'The diagram reloaded. Wait for it to render, then export again.');
      state.port?.close();state.port=port;state.ready=true;state.generation++;
      state.diagnosticReadyAt=Date.now();recordDiagnostic(state,'ready');
      state.navigationFailed=false;state.fixResponses=new Map();state.fixPending=new Set();
      stopBootWatchdog(state);stopDocumentProbe(state);resetBoot(state);
      port.onmessage=message=>receiveSnapshot(state,port,message.data);port.start?.();send(state,true);
    }
    if(data.type==='resize' && Number.isFinite(data.height) && editor?.state!==state) {
      const height=Math.max(80,Math.min(16000,Math.ceil(data.height)));
      state.lastHeight=state.loading?Math.max(height,state.heightFloor || 0):height;state.frame.style.height=state.lastHeight+'px';
      if(state.ready)finishBoot(state);
    }
    if(data.type==='open-editor') openEditor(state);
    if(data.type==='close-editor' && editor?.state===state) closeEditor();
    if(data.type==='source-change' && state.complete && typeof data.source==='string' && data.source.length<=MAX_SOURCE) {
      state.draftSource=data.source;state.sentSource=data.source;
      state.sentKey='render\0'+data.source+'\0'+settings.autoRender+'\0'+settings.scale;
    }
    if(data.type==='result') {
      if(!state.complete || (typeof data.source==='string' && data.source!==state.sentSource) || state.sentSource!==(state.draftSource??state.source)) return;
      const success=data.ok===true || (typeof data.svg==='string' && data.svg.length>0 && !data.error);
      state.diagnosticResult={at:Date.now(),ok:success};recordDiagnostic(state,'render-result',success?'success':'failure');
      state.loading=false;state.failedSource=success?null:state.sentSource;state.renderError=success?null:conciseDiagramError(data.error);state.revealedSource=false;finishBoot(state);
      setSourceHidden(state,success);
    }
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && editor) {event.preventDefault();closeEditor();}});
  const observer=new MutationObserver(mutations=>{
    if(!globalThis.document?.documentElement)return;
    checkSnapshots();
    // Snapshot validation above still catches real source edits and removals.
    // The body class removal schedules a complete scan after printing finishes.
    if(printingPDF()){fullScan=true;return;}
    if(!settings.enabled) return;let changed=false,urgent=false;
    // Final connectedness misses detach/restore within one mutation batch.
    // Removing an iframe's ancestor discards its document even if the host
    // reattaches that same node from a conversation cache before this callback.
    for(const state of states.values()){
      for(const mutation of mutations)if(mutation.type==='attributes' && mutation.target===state.frame && ['src','srcdoc'].includes(mutation.attributeName))recordDiagnostic(state,'frame-attribute',mutation.attributeName+'-'+(mutation.oldValue===null?'added':state.frame.hasAttribute(mutation.attributeName)?'changed':'removed'));
      if(!state.documentDetached && mutations.some(mutation=>mutation.type==='childList' && [...mutation.removedNodes].some(node=>node===state.frame || node.contains?.(state.frame)))){state.documentDetached=true;recordDiagnostic(state,'frame-detached');}
    }
    // Our own insertions are ignored below, but a host update removing an island
    // still needs a scan even if the mutation contains only extension nodes.
    for(const state of states.values())if(!liveFrame(state) && (!state.navigationFailed || state.documentDetached || !attachedFrame(state))){dirty.add(assistantFor(state.element));changed=urgent=true;}
    for(const mutation of mutations) {
      if(ownNode(mutation.target)) continue;
      const el=mutation.target.nodeType===Node.ELEMENT_NODE?mutation.target:mutation.target.parentElement;
      if(mutation.type==='attributes') {
        const state=states.get(el);
        if(state && (mutation.attributeName==='class' || mutation.attributeName===HIDDEN_ATTRIBUTE))setSourceHidden(state,Boolean(state.hideSource));
        if(mutation.attributeName===HIDDEN_ATTRIBUTE)continue;
        if(mutation.attributeName==='class') {
          const clean=value=>(value || '').replace(/\blatex-islands-[\w-]+\b/g,'').trim();
          if(clean(mutation.oldValue)===clean(el.className)) continue;
        }
      }
      if(mutation.type==='childList' && [...mutation.addedNodes,...mutation.removedNodes].every(ownNode)) continue;
      const assistant=assistantFor(el);
      if(assistant) {
        dirty.add(assistant);
        const code=el.closest(codeSelector);
        if(code && ![...states.keys()].some(source=>source.contains(code)))urgent=true;
      }
      else {
        // Streaming markers may live above the assistant. Inspect affected
        // descendants even when a class has just been removed and no longer matches.
        if(mutation.type==='attributes') {
          for(const descendant of assistantsWithin(el)) dirty.add(descendant);
        }
        for(const node of mutation.addedNodes || []) if(node.nodeType===Node.ELEMENT_NODE && !ownNode(node)) {
          const message=assistantFor(node);if(message)dirty.add(message);
          for(const match of assistantsWithin(node)) dirty.add(match);
        }
        // Composer controls and ancestor streaming flags are outside a message.
        // Let the adapter re-evaluate each pending diagram after those mutations.
        for(const state of states.values())if(!state.complete)dirty.add(assistantFor(state.element));
      }
      // Structural hydration can expose a fresh code widget for one frame if it
      // waits for the token throttle. Discover it in this observer microtask;
      // ordinary text streaming still uses the bounded scheduled scan.
      if(mutation.type==='childList' && [...mutation.addedNodes].some(node=>node.nodeType===Node.ELEMENT_NODE && !ownNode(node) && (node.matches(codeSelector) || node.querySelector(codeSelector))))urgent=true;
      if(mutation.type==='attributes' && /^(?:data-message-author-role|data-chatgpt-search-unit-key|data-chatgpt-selection-message-id|data-conversation-role|data-markdown-text-style|data-markdown-copy|data-language)$/.test(mutation.attributeName))urgent=true;
      if(mutation.type==='attributes' && ['hidden','inert','aria-hidden'].includes(mutation.attributeName))urgent=true;
      if(mutation.type==='attributes' && ['style','class'].includes(mutation.attributeName) && assistantsWithin(el).some(message=>chatgpt.getCodeBlocks(message).some(code=>!states.has(code))))urgent=true;
      changed=true;
    }
    if(changed) {if(urgent)scan();else schedule();}
  });
  window.addEventListener('pagehide',()=>cancelSnapshots(null,'The conversation closed. Try exporting the current conversation again.'));
  window.addEventListener('popstate',checkSnapshots);
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeOldValue:true,attributeFilter:[...new Set([...chatgpt.observedAttributes,'class','data-theme','data-language','src','srcdoc',HIDDEN_ATTRIBUTE])]});
  // Theme tracking is independent of diagram detection, including when islands
  // are disabled. One observer batch and palette comparison avoid storage writes
  // for every streamed token, every island, or our own fullscreen class changes.
  const themeObserver=new MutationObserver(syncPageTheme);
  for(const element of [document.documentElement,document.body]) if(element)themeObserver.observe(element,{attributes:true,attributeFilter:['class','data-theme','style']});
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',syncPageTheme);
  // afterprint can fire before Chromium stops applying print styles. Keep the
  // live conversation intact until screen media resumes, even without a DOM mutation.
  printMedia?.addEventListener?.('change',event=>{if(!event.matches){fullScan=true;schedule(0);syncPageTheme();}});
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
