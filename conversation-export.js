/* SPDX-License-Identifier: GPL-3.0-or-later */
(() => {
  'use strict';
  const extensionAPI=globalThis.browser||globalThis.chrome;
  if (globalThis.__latexIslandsExporterLoaded || !globalThis.LatexIslandsExport) return;
  globalThis.__latexIslandsExporterLoaded = true;
  const core = globalThis.LatexIslandsExport;
  const CHANNEL = 'latex-islands-conversation-export-v1';
  const defaults = {format:'md',includeUser:true,includeProgress:false,includeTools:false,includeAttachments:true,includeSources:true,timestamps:false};
  let preferences={...defaults}, preferencesTouched=false;
  let pending=null,running=false,canceled=false,lastFocus=null,tick=0,mountedId=null,snapshot=null,revision=0,snapshotRevision=-1,previewRequested=false;
  const root=document.createElement('div');root.className='li-export';root.dataset.latexIslandsExport='true';
  function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text)node.textContent=text;return node;}
  function button(label,className){const node=element('button',className,label);node.type='button';return node;}
  const toggle=button('','li-export-toggle');toggle.setAttribute('aria-label','Export conversation');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','li-export-panel');
  toggle.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const tooltip=element('div','li-export-tooltip','Export conversation');tooltip.id='li-export-tooltip';tooltip.hidden=true;tooltip.setAttribute('role','tooltip');tooltip.setAttribute('popover','manual');toggle.setAttribute('aria-describedby',tooltip.id);
  let tooltipTimer=0;
  function hideTooltip(){clearTimeout(tooltipTimer);tooltipTimer=0;try{tooltip.hidePopover?.();}catch{}tooltip.hidden=true;}
  function showTooltip(){
    hideTooltip();if(toggle.getAttribute('aria-expanded')==='true')return;
    tooltipTimer=setTimeout(()=>{tooltipTimer=0;if(!toggle.isConnected||toggle.getAttribute('aria-expanded')==='true')return;
      tooltip.hidden=false;tooltip.showPopover?.();const rect=toggle.getBoundingClientRect();
      tooltip.style.top=Math.min(rect.bottom+8,window.innerHeight-tooltip.offsetHeight-8)+'px';
      tooltip.style.left=Math.max(8,Math.min(rect.left+rect.width/2-tooltip.offsetWidth/2,window.innerWidth-tooltip.offsetWidth-8))+'px';
    },300);
  }
  toggle.addEventListener('pointerenter',showTooltip);toggle.addEventListener('pointerleave',hideTooltip);toggle.addEventListener('focus',showTooltip);toggle.addEventListener('blur',hideTooltip);
  const panel=element('dialog','li-export-panel');panel.id='li-export-panel';panel.hidden=true;panel.setAttribute('aria-label','Export conversation');
  const heading=element('div','li-export-heading');const title=element('strong','','Export conversation');title.id='li-export-title';panel.setAttribute('aria-labelledby',title.id);panel.setAttribute('aria-modal','true');
  const close=button('','li-export-close');close.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke-linecap="round"/></svg>';close.setAttribute('aria-label','Close export options');heading.append(title,close);
  const controls=element('div','li-export-controls');
  const dropdowns=new Map();
  function selectField(label,id,values){
    const wrapper=element('div','li-export-field'),caption=element('span','',label),select=element('select');
    caption.id=id+'-label';select.id=id;
    for(const [value,text]of values){const option=element('option','',text);option.value=value;select.append(option);}
    wrapper.append(caption,select);
    dropdowns.set(select,globalThis.LatexIslandsNativeControls.enhanceSelect(select,{prefix:'li-export',labelledBy:caption.id}));
    return {wrapper,select};
  }
  const {wrapper:formatField,select:format}=selectField('Format','li-export-format',[['md','Markdown (.md)'],['txt','Plain text (.txt)'],['json','Complete archive (.json)']]);
  const transcriptControls=element('fieldset','li-export-transcript');
  const {wrapper:presetField,select:preset}=selectField('Content','li-export-preset',[['dialogue','Conversation'],['detailed','Detailed context'],['answers','Answers only'],['custom','Custom']]);
  const extras=element('details','li-export-options');extras.open=true;
  const extrasSummary=element('summary');extrasSummary.append(element('span','','Customize transcript'));
  const extrasChevron=element('span','li-export-options-chevron');extrasChevron.setAttribute('aria-hidden','true');extrasChevron.innerHTML='<svg viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';extrasSummary.append(extrasChevron);extras.append(extrasSummary);
  const checks={};
  for(const [key,label]of [['includeUser','Include my messages'],['includeAttachments','Include attachment references'],['includeSources','Include sources and citations'],['timestamps','Show dates and times'],['includeProgress','Include progress updates'],['includeTools','Include tool calls and results']]){
    const row=element('label','li-export-option');const input=element('input','li-export-switch');input.type='checkbox';input.id='li-export-'+key;input.setAttribute('role','switch');checks[key]=input;row.append(element('span','',label),input);extras.append(row);
  }
  transcriptControls.append(presetField,extras);
  const archiveNote=element('p','li-export-archive-note','All messages, metadata and pages received from ChatGPT, unfiltered.');archiveNote.hidden=true;
  controls.append(formatField,transcriptControls,archiveNote);
  const attachmentNote=element('p','li-export-detail','Images and files are referenced; their contents are not downloaded.');
  const status=element('p','li-export-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const previewBox=element('section','li-export-preview');previewBox.hidden=true;previewBox.setAttribute('aria-label','Export file preview');
  const previewHeader=element('div','li-export-preview-heading');const previewTitle=element('strong','','Preview');const previewSummary=element('span');previewHeader.append(previewTitle,previewSummary);
  const previewText=element('pre');previewText.tabIndex=0;previewText.setAttribute('aria-label','File excerpt');const previewNote=element('p','li-export-detail');previewBox.append(previewHeader,previewText,previewNote);
  const previewModes=element('div','li-export-preview-modes');previewModes.setAttribute('role','group');previewModes.setAttribute('aria-label','Preview view');
  const dialogueMode=button('Conversation','li-export-dialogue-mode'),fileMode=button('File','li-export-file-mode');previewModes.append(dialogueMode,fileMode);previewHeader.append(previewModes);
  const dialoguePreview=element('div','li-export-dialogue');dialoguePreview.tabIndex=0;dialoguePreview.setAttribute('aria-label','Exported conversation');
  const more=button('Show more','li-export-more');more.hidden=true;previewBox.insertBefore(dialoguePreview,previewNote);previewBox.append(more);
  let previewMode='dialogue',visibleEntries=20,visibleCharacters=50000;
  const previewPane=element('div','li-export-preview-pane');const emptyPreview=element('div','li-export-empty');
  emptyPreview.append(element('strong','','Your conversation, ready to save'),element('p','','Choose the content, then select Preview. Your options apply immediately to the conversation.'));
  previewPane.append(emptyPreview,previewBox);
  const actions=element('div','li-export-actions');
  const inspect=button('Preview','li-export-inspect'),copy=button('Copy','li-export-copy'),save=button('Download','li-export-save'),cancel=button('Cancel','li-export-cancel');cancel.hidden=true;
  const actionButtons={preview:inspect,copy,download:save};
  for(const node of Object.values(actionButtons)){
    const label=node.textContent;
    node.setAttribute('aria-label',label);node.setAttribute('aria-busy','false');
    const spinner=element('span','li-export-button-spinner');spinner.setAttribute('aria-hidden','true');spinner.hidden=true;
    node.replaceChildren(element('span','li-export-action-label',label),spinner);
  }
  const settingsPane=element('div','li-export-settings');settingsPane.append(controls,attachmentNote);
  const layout=element('div','li-export-layout');layout.append(settingsPane,previewPane);
  const footer=element('div','li-export-footer');actions.append(inspect,copy,cancel,save);footer.append(status,actions);panel.append(heading,layout,footer);root.append(toggle,tooltip,panel);

  function options(){return Object.fromEntries(Object.entries(checks).map(([key,input])=>[key,input.checked]));}
  function guessedPreset(value){if(!value.includeUser)return value.includeProgress||value.includeTools?'custom':'answers';if(value.includeProgress&&value.includeTools)return 'detailed';if(!value.includeProgress&&!value.includeTools)return 'dialogue';return 'custom';}
  function applyPreferences(){
    format.value=preferences.format;for(const [key,input]of Object.entries(checks))input.checked=preferences[key];preset.value=guessedPreset(preferences);for(const control of dropdowns.values())control.sync();updateFormat();
  }
  function updateFormat(){
    const isJSON=format.value==='json';transcriptControls.hidden=isJSON;archiveNote.hidden=!isJSON;dialogueMode.disabled=isJSON;
    if(previewRequested&&snapshot)updatePreview();
  }
  function remember(){
    preferencesTouched=true;preferences={...preferences,...options(),format:format.value};
    try{Promise.resolve(extensionAPI?.storage?.local?.set({exportPreferences:preferences})).catch(()=>{});}catch{}
    if(previewRequested&&snapshot)updatePreview();
  }
  format.addEventListener('change',()=>{remember();updateFormat();});
  preset.addEventListener('change',()=>{
    if(preset.value==='dialogue')Object.assign(preferences,{includeUser:true,includeProgress:false,includeTools:false});
    if(preset.value==='answers')Object.assign(preferences,{includeUser:false,includeProgress:false,includeTools:false});
    if(preset.value==='detailed')Object.assign(preferences,{includeUser:true,includeProgress:true,includeTools:true});
    for(const key of ['includeUser','includeProgress','includeTools'])checks[key].checked=preferences[key];remember();
  });
  for(const input of Object.values(checks))input.addEventListener('change',()=>{remember();preset.value=guessedPreset(preferences);dropdowns.get(preset).sync();});
  applyPreferences();
  try{Promise.resolve(extensionAPI?.storage?.local?.get({exportPreferences:defaults})).then(saved=>{
    if(preferencesTouched)return;const next=saved?.exportPreferences;if(!next)return;
    for(const key of Object.keys(defaults)){if(key==='format'){if(['md','txt','json'].includes(next.format))preferences.format=next.format;}else if(typeof next[key]==='boolean')preferences[key]=next[key];}
    applyPreferences();
  }).catch(()=>{});}catch{}

  function show(open){
    hideTooltip();globalThis.LatexIslandsNativeControls.closeAll();
    if(!open){if(running)cancelExport();try{panel.close?.();}catch{}snapshot=null;snapshotRevision=-1;previewRequested=false;previewBox.hidden=true;emptyPreview.hidden=false;status.textContent='';}
    panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));
    if(open){lastFocus=document.activeElement;panel.showModal?.();dropdowns.get(format).trigger.focus();}
    else if(lastFocus?.isConnected)lastFocus.focus();
  }
  toggle.addEventListener('click',()=>show(panel.hidden));close.addEventListener('click',()=>show(false));
  panel.addEventListener('cancel',event=>{event.preventDefault();show(false);});
  document.addEventListener('click',event=>{if(!panel.hidden&&!running&&!root.contains(event.target))show(false);});
  window.addEventListener('resize',hideTooltip);
  document.addEventListener('scroll',hideTooltip,{capture:true,passive:true});
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented)return;
    if(event.key==='Escape'&&!tooltip.hidden)hideTooltip();
    if(event.key==='Escape'&&!panel.hidden){show(false);event.preventDefault();event.stopPropagation();}
    if(event.key==='Tab'&&!panel.hidden){const items=[...panel.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary,[tabindex="0"],a[href]')].filter(el=>!el.closest('[hidden]')&&(!el.closest('details')||el.tagName==='SUMMARY'||el.closest('details').open));
      if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}}
  });
  function release(type,requestId){window.postMessage({channel:CHANNEL,type,requestId:requestId||crypto.randomUUID()},location.origin);}
  function cancelExport(){canceled=true;if(pending){release('cancel',pending.id);pending.reject(new Error('Export cancelled.'));}}
  cancel.addEventListener('click',cancelExport);
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.channel!==CHANNEL||event.data.type!=='response'||!pending||event.data.requestId!==pending.id)return;
    const {ok,payload,error,status:httpStatus}=event.data;if(ok)pending.resolve(payload);else pending.reject(Object.assign(new Error(error||'Could not read the conversation.'),{status:httpStatus}));
  });
  function fetchJSON(path){
    if(canceled)return Promise.reject(new Error('Export cancelled.'));
    return new Promise((resolve,reject)=>{
      const id=crypto.randomUUID();
      const timer=setTimeout(()=>{release('cancel',id);finish(reject,new Error('ChatGPT is not responding. Reload the page after updating the extension.'));},50000);
      function finish(callback,value){clearTimeout(timer);if(pending?.id===id)pending=null;callback(value);}
      pending={id,resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)};
      window.postMessage({channel:CHANNEL,type:'request',requestId:id,path},location.origin);
    });
  }
  function output(archive,selectedFormat=format.value,selectedOptions=options()){
    if(selectedFormat==='json')return JSON.stringify(archive,null,2);
    return selectedFormat==='txt'?core.toText(archive,selectedOptions):core.toMarkdown(archive,selectedOptions);
  }
  function updatePreview(){
    if(!snapshot)return;
    const text=output(snapshot),isJSON=format.value==='json',transcript=isJSON?null:core.buildTranscript(snapshot,options());
    previewBox.hidden=false;emptyPreview.hidden=true;previewText.textContent=text.slice(0,visibleCharacters);
    const count=isJSON?snapshot.messages.length:transcript.entries.length;
    previewSummary.textContent=count+(isJSON?' records':' messages');
    const reading=previewMode==='dialogue'&&!isJSON;previewText.hidden=reading;dialoguePreview.hidden=!reading;
    dialogueMode.setAttribute('aria-pressed',String(reading));fileMode.setAttribute('aria-pressed',String(!reading));
    dialoguePreview.replaceChildren();
    if(reading){
      dialoguePreview.append(element('h2','',transcript.title));
      for(const entry of transcript.entries.slice(0,visibleEntries)){
        const article=element('article','li-export-message');article.dataset.role=entry.role;
        article.append(element('h3','',entry.label));if(options().timestamps&&entry.timestamp)article.append(element('small','',entry.timestamp));
        const body=element('div','li-export-message-body');
        if(globalThis.LatexIslandsPreview)globalThis.LatexIslandsPreview.render(body,entry.text);else body.textContent=entry.text;
        article.append(body);
        dialoguePreview.append(article);
      }
      if(!count)dialoguePreview.append(element('p','','No messages match these options.'));
    }
    const limited=reading?count>visibleEntries:text.length>visibleCharacters;more.hidden=!limited;
    previewNote.textContent=limited?(reading?'Showing the first '+Math.min(visibleEntries,count)+' messages.':'Showing the first '+visibleCharacters.toLocaleString('en-US')+' characters.')+' Copy and download include the entire file.':'Copy and download include the entire file.';
  }
  dialogueMode.addEventListener('click',()=>{previewMode='dialogue';updatePreview();});fileMode.addEventListener('click',()=>{previewMode='file';updatePreview();});
  more.addEventListener('click',()=>{visibleEntries+=20;visibleCharacters+=50000;updatePreview();});
  function setBusy(value,action){
    running=value;for(const node of [inspect,copy,save,format,preset,...Object.values(checks)])node.disabled=value;cancel.hidden=!value;
    for(const node of Object.values(actionButtons)){
      const active=value&&node===actionButtons[action];
      node.setAttribute('aria-busy',String(active));node.querySelector('.li-export-button-spinner').hidden=!active;
    }
    for(const control of dropdowns.values())control.sync();
    panel.setAttribute('aria-busy',String(value));
  }
  function download(text,type,name){const url=URL.createObjectURL(new Blob([text],{type})),anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async function run(action){
    if(running)return;const id=core.conversationId(location.pathname);if(!id){status.textContent='Open a saved conversation to export it.';return;}
    const actionFocus=document.activeElement;
    const selectedFormat=format.value,selectedOptions=options();setBusy(true,action);canceled=false;status.textContent='';status.dataset.state='loading';
    try{
      if(!snapshot||snapshotRevision!==revision){
        const startedRevision=revision;
        snapshot=await core.collectConversation({id,fetchJSON,onProgress(){
          if(core.conversationId(location.pathname)!==id){cancelExport();throw new Error('Conversation changed. Export cancelled.');}
        }});snapshotRevision=startedRevision;
      }
      if(canceled||core.conversationId(location.pathname)!==id)throw new Error('Export cancelled.');
      const text=output(snapshot,selectedFormat,selectedOptions);
      if(previewRequested)updatePreview();
      if(action==='preview'){previewRequested=true;updatePreview();}
      else if(action==='copy'){
        try{await navigator.clipboard.writeText(text);}
        catch{previewRequested=true;updatePreview();throw new Error('Copy unavailable. Download the complete file.');}
      }else{
        const mime={json:'application/json',md:'text/markdown',txt:'text/plain'}[selectedFormat];
        download(text,mime+';charset=utf-8',core.fileName(snapshot.title,selectedFormat));
      }
      status.dataset.state='success';
    }catch(error){status.dataset.state='error';status.textContent=error.message||'Export failed.';}
    finally{release('release');setBusy(false);if(!panel.hidden&&document.activeElement===document.body&&actionFocus?.isConnected)actionFocus.focus();}
  }
  inspect.addEventListener('click',()=>run('preview'));copy.addEventListener('click',()=>run('copy'));save.addEventListener('click',()=>run('download'));
  function mount(){
    tick=0;const id=core.conversationId(location.pathname);
    if(mountedId&&id!==mountedId){if(running)cancelExport();show(false);status.textContent='';snapshot=null;}
    mountedId=id;if(!id){if(running)cancelExport();root.remove();return;}
    const header=document.querySelector('#conversation-header-actions')||document.querySelector('[data-testid="thread-header-right-actions"], #conversation-header, [data-testid="conversation-header"], #page-header, main header, header');
    if(header&&!header.contains(root)){root.classList.remove('li-export-fallback');header.append(root);}else if(!header&&!root.isConnected&&document.body){root.classList.add('li-export-fallback');document.body.append(root);}
  }
  const observer=new MutationObserver(records=>{
    const external=records.filter(record=>!root.contains(record.target));if(!external.length)return;
    if(external.some(record=>{const el=record.target.nodeType===1?record.target:record.target.parentElement;return el&&!el.closest('.latex-islands-container')&&(el.closest('[data-message-author-role]')||[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches('[data-message-author-role]')||node.querySelector('[data-message-author-role]'))));})){
      revision++;
      if(previewRequested&&snapshot&&!running){status.textContent='The conversation has changed. Refresh the preview; the next export will fetch the latest version.';status.dataset.state='stale';}
    }
    if(!tick)tick=setTimeout(mount,250);
  });
  observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  window.addEventListener('popstate',mount);window.addEventListener('pagehide',cancelExport);mount();
})();
