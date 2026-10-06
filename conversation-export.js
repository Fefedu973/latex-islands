/* SPDX-License-Identifier: GPL-3.0-or-later */
(() => {
  'use strict';
  const extensionAPI=globalThis.browser||globalThis.chrome;
  const chatDOM=globalThis.LatexIslandsChatGPT;
  if (globalThis.__latexIslandsExporterLoaded || !globalThis.LatexIslandsExport || !chatDOM) return;
  globalThis.__latexIslandsExporterLoaded = true;
  const core = globalThis.LatexIslandsExport;
  const CHANNEL = 'latex-islands-conversation-export-v1';
  const defaults = {format:'md',roleMode:'conversation',includeUser:true,includeProgress:false,includeTools:false,includeAttachments:true,includeSources:true,timestamps:false};
  let preferences={...defaults}, preferencesTouched=false;
  let pending=null,running=false,canceled=false,lastFocus=null,tick=0,mountedId=null,snapshot=null,revision=0,snapshotRevision=-1,previewRequested=false;
  let replyElement=null,pdfAbort=null,pdfDocument=null,pdfCapture=null,pdfSelection=null,textSelection=null,pdfViewSequence=0;
  const replyActions=new Map();let knownMessages=new Set();
  const root=document.createElement('div');root.className='li-export';root.dataset.latexIslandsExport='true';
  function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text)node.textContent=text;return node;}
  function button(label,className){const node=element('button',className,label);node.type='button';return node;}
  const toggle=button('','li-export-toggle');toggle.setAttribute('aria-label','Export conversation');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','li-export-panel');
  toggle.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const tooltip=element('div','li-export-tooltip','Export conversation');tooltip.id='li-export-tooltip';tooltip.hidden=true;tooltip.setAttribute('role','tooltip');tooltip.setAttribute('popover','manual');toggle.setAttribute('aria-describedby',tooltip.id);
  let tooltipTimer=0,tooltipAnchor=null,tooltipLabel='',previewTimer=0,automaticPreview=false;
  function hideTooltip(){clearTimeout(tooltipTimer);tooltipTimer=0;tooltipAnchor=null;try{tooltip.hidePopover?.();}catch{}tooltip.hidden=true;}
  function showTooltip(anchor=toggle,label='Export conversation'){
    hideTooltip();if(toggle.getAttribute('aria-expanded')==='true')return;
    tooltipAnchor=anchor;tooltipLabel=label;
    tooltipTimer=setTimeout(()=>{tooltipTimer=0;if(!anchor.isConnected||anchor.hidden||toggle.getAttribute('aria-expanded')==='true')return;
      tooltip.textContent=label;tooltip.hidden=false;tooltip.showPopover?.();const rect=anchor.getBoundingClientRect();
      tooltip.style.top=Math.min(rect.bottom+8,window.innerHeight-tooltip.offsetHeight-8)+'px';
      tooltip.style.left=Math.max(8,Math.min(rect.left+rect.width/2-tooltip.offsetWidth/2,window.innerWidth-tooltip.offsetWidth-8))+'px';
    },300);
  }
  function tooltipViewportChanged(){
    const anchor=tooltipAnchor,label=tooltipLabel;hideTooltip();
    if(anchor?.isConnected&&!anchor.hidden&&document.activeElement===anchor)showTooltip(anchor,label);
  }
  toggle.addEventListener('pointerenter',()=>showTooltip());toggle.addEventListener('pointerleave',hideTooltip);toggle.addEventListener('focus',()=>showTooltip());toggle.addEventListener('blur',hideTooltip);
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
  const {wrapper:formatField,select:format}=selectField('Format','li-export-format',[['md','Markdown (.md)'],['txt','Plain text (.txt)'],['json','Complete archive (.json)'],['pdf','PDF (.pdf)']]);
  const transcriptControls=element('fieldset','li-export-transcript');
  const {wrapper:presetField,select:preset}=selectField('Content','li-export-preset',[['conversation','Conversation'],['answers','Answers only'],['prompts','Prompts only']]);
  const extras=element('details','li-export-options');
  const extrasSummary=element('summary');extrasSummary.append(element('span','','Customize transcript'));
  const extrasChevron=element('span','li-export-options-chevron');extrasChevron.setAttribute('aria-hidden','true');extrasChevron.innerHTML='<svg viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';extrasSummary.append(extrasChevron);extras.append(extrasSummary);
  const checks={};
  for(const [key,label]of [['includeAttachments','Include attachment references'],['includeSources','Include sources and citations'],['timestamps','Show dates and times'],['includeProgress','Include progress updates'],['includeTools','Include tool calls and results']]){
    const row=element('label','li-export-option');const input=element('input','li-export-switch');input.type='checkbox';input.id='li-export-'+key;input.setAttribute('role','switch');checks[key]=input;row.append(element('span','',label),input);extras.append(row);
  }
  transcriptControls.append(presetField,extras);
  const archiveNote=element('p','li-export-archive-note','All messages, metadata and pages received from ChatGPT, unfiltered.');archiveNote.hidden=true;
  controls.append(formatField,transcriptControls,archiveNote);
  const {wrapper:pdfRoleField,select:pdfRole}=selectField('Content','li-export-pdf-role',[['conversation','Conversation'],['answers','Answers only'],['prompts','Prompts only']]);pdfRoleField.hidden=true;
  const pdfNote=element('p','li-export-pdf-note','The page scrolls to load the full conversation and capture its rendered messages. Your scroll position is restored afterwards.');pdfNote.hidden=true;
  const pdfUserRow=element('label','li-export-option');pdfUserRow.hidden=true;
  const pdfUser=element('input','li-export-switch');pdfUser.type='checkbox';pdfUser.id='li-export-pdf-include-user';pdfUser.setAttribute('role','switch');pdfUserRow.append(element('span','','Include prompt'),pdfUser);controls.append(pdfRoleField,pdfUserRow,pdfNote);
  const chooseMessages=button('Choose messages','li-export-choose-messages');controls.append(chooseMessages);
  const attachmentNote=element('p','li-export-detail','Images and files are referenced; their contents are not downloaded.');
  const status=element('p','li-export-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const previewBox=element('section','li-export-preview');previewBox.hidden=true;previewBox.setAttribute('aria-label','Export file preview');
  const previewHeader=element('div','li-export-preview-heading');const previewSummary=element('span');previewHeader.append(previewSummary);
  const previewText=element('pre');previewText.tabIndex=0;previewText.setAttribute('aria-label','File excerpt');const previewNote=element('p','li-export-detail');previewBox.append(previewHeader,previewText,previewNote);
  const previewModes=element('div','li-export-preview-modes');previewModes.setAttribute('role','group');previewModes.setAttribute('aria-label','Preview view');
  const selectionMode=button('Messages','li-export-selection-mode'),dialogueMode=button('Preview','li-export-dialogue-mode'),fileMode=button('Source','li-export-file-mode');previewModes.append(dialogueMode,selectionMode,fileMode);previewHeader.prepend(previewModes);
  const dialoguePreview=element('div','li-export-dialogue');dialoguePreview.tabIndex=0;dialoguePreview.setAttribute('aria-label','Exported conversation');
  const more=button('Show more','li-export-more');more.hidden=true;previewBox.insertBefore(dialoguePreview,previewNote);previewBox.append(more);
  const selectionPane=element('div','li-export-selection');selectionPane.hidden=true;
  const selectionTools=element('div','li-export-selection-tools'),selectAll=button('All','li-export-select-all'),selectNone=button('None','li-export-select-none'),refresh=button('Reload','li-export-refresh');
  const search=element('input','li-export-message-search');search.type='search';search.placeholder='Find a message';search.setAttribute('aria-label','Find a message');
  const selectionCount=element('span','li-export-selection-count');selectionCount.setAttribute('aria-live','polite');
  selectionTools.append(selectAll,selectNone,selectionCount,refresh);const messageList=element('div','li-export-message-list');
  selectionPane.append(search,selectionTools,messageList);previewBox.insertBefore(selectionPane,previewNote);
  const pdfPreview=element('div','li-export-pdf-preview');pdfPreview.hidden=true;previewBox.insertBefore(pdfPreview,previewNote);
  let previewMode='dialogue',visibleEntries=20,visibleCharacters=50000;
  const previewPane=element('div','li-export-preview-pane');const emptyPreview=element('div','li-export-empty');
  emptyPreview.append(element('strong','','Preview'),element('p'));
  previewPane.append(emptyPreview,previewBox);
  const actions=element('div','li-export-actions');
  const inspect=button('Preview','li-export-inspect'),copy=button('Copy','li-export-copy'),save=button('Download','li-export-save'),cancel=button('Cancel','li-export-cancel');cancel.hidden=true;
  const actionButtons={preview:inspect,copy,download:save,messages:chooseMessages,refresh};
  for(const node of Object.values(actionButtons)){
    const label=node.textContent;
    node.setAttribute('aria-label',label);node.setAttribute('aria-busy','false');
    const spinner=element('span','li-export-button-spinner');spinner.setAttribute('aria-hidden','true');spinner.hidden=true;
    node.replaceChildren(element('span','li-export-action-label',label),spinner);
  }
  const settingsPane=element('div','li-export-settings');settingsPane.append(controls,attachmentNote);
  const layout=element('div','li-export-layout');layout.append(settingsPane,previewPane);
  const footer=element('div','li-export-footer');actions.append(inspect,copy,cancel,save);footer.append(status,actions);panel.append(heading,layout,footer);root.append(toggle,tooltip,panel);

  function options(){return {...Object.fromEntries(Object.entries(checks).map(([key,input])=>[key,input.checked])),roleMode:preset.value,includeUser:preset.value!=='answers',selectedMessageIds:textSelection===null?null:[...textSelection]};}
  function applyPreferences(){
    format.value=preferences.format;for(const [key,input]of Object.entries(checks))input.checked=preferences[key];pdfRole.value=preset.value=preferences.roleMode;for(const control of dropdowns.values())control.sync();updateFormat();
  }
  function updateFormat(){
    pdfViewSequence++;pdfDocument?.dispose();pdfDocument=null;
    const isJSON=format.value==='json',isPDF=format.value==='pdf';transcriptControls.hidden=isJSON||isPDF;archiveNote.hidden=!isJSON;dialogueMode.disabled=isJSON;
    pdfNote.hidden=!isPDF;pdfUserRow.hidden=!isPDF||!replyElement;pdfRoleField.hidden=!isPDF||!!replyElement;attachmentNote.hidden=isPDF;copy.hidden=isPDF;chooseMessages.hidden=isJSON;selectionMode.hidden=isJSON;fileMode.hidden=isPDF;
    pdfNote.textContent=replyElement?'Export this reply with its rendered formatting and diagrams.':'The page scrolls to load the full conversation and capture its rendered messages. Your scroll position is restored afterwards.';
    title.textContent=replyElement?'Export reply':'Export conversation';format.disabled=running&&!automaticPreview||!!replyElement;dropdowns.get(format).sync();
    for(const [node,label] of [[inspect,'Preview'],[save,isPDF?'Save PDF':'Download']]){node.querySelector('.li-export-action-label').textContent=label;node.setAttribute('aria-label',label);}
    dialogueMode.textContent='Preview';
    emptyPreview.querySelector('strong').textContent=isPDF?'Preview your PDF':'Preview';
    emptyPreview.querySelector('p').textContent=isPDF?(replyElement?'This reply will keep its formatting and diagrams.':'Select Preview to load the full conversation. The page scrolls while its messages are captured.') : '';
    previewBox.hidden=true;emptyPreview.hidden=false;pdfPreview.hidden=true;
    if(isPDF&&pdfCapture)updatePreview();else if(!isPDF&&previewRequested&&snapshot)updatePreview();
  }
  function remember(){
    preferencesTouched=true;const {selectedMessageIds,...persistent}=options();preferences={...preferences,...persistent,format:format.value};
    try{Promise.resolve(extensionAPI?.storage?.local?.set({exportPreferences:preferences})).catch(()=>{});}catch{}
    if(previewRequested&&(snapshot||pdfCapture))updatePreview();
  }
  format.addEventListener('change',()=>{remember();updateFormat();schedulePreview();});
  pdfUser.addEventListener('change',()=>{if(pdfCapture){pdfSelection=new Set(pdfCapture.messages.filter(entry=>entry.role==='assistant'||pdfUser.checked).map(entry=>entry.key));updatePreview();}});
  pdfRole.addEventListener('change',()=>{updatePreview();});
  preset.addEventListener('change',remember);
  for(const input of Object.values(checks))input.addEventListener('change',remember);
  applyPreferences();
  try{Promise.resolve(extensionAPI?.storage?.local?.get({exportPreferences:defaults})).then(saved=>{
    if(preferencesTouched)return;const next=saved?.exportPreferences;if(!next)return;
    for(const key of Object.keys(defaults)){if(key==='format'){if(['md','txt','json','pdf'].includes(next.format))preferences.format=next.format;}else if(typeof next[key]==='boolean')preferences[key]=next[key];}
    // Earlier Custom/Detailed presets persisted their switches. Keep them, and
    // migrate an excluded user role without restoring a redundant checkbox.
    preferences.roleMode=['answers','prompts'].includes(next.roleMode)?next.roleMode:next.includeUser===false?'answers':'conversation';
    preferences.includeUser=preferences.roleMode!=='answers';applyPreferences();
  }).catch(()=>{});}catch{}

  function show(open){
    clearTimeout(previewTimer);previewTimer=0;
    hideTooltip();globalThis.LatexIslandsNativeControls.closeAll();
    if(!open){if(running)cancelExport();try{panel.close?.();}catch{}snapshot=null;snapshotRevision=-1;previewRequested=false;previewBox.hidden=true;emptyPreview.hidden=false;status.textContent='';replyElement=null;pdfViewSequence++;pdfDocument?.dispose();pdfDocument=null;pdfCapture?.dispose();pdfCapture=null;pdfSelection=null;textSelection=null;previewMode='dialogue';search.value='';}
    panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));
    if(open){lastFocus=document.activeElement;updateFormat();panel.showModal?.();(replyElement?inspect:dropdowns.get(format).trigger).focus();schedulePreview();}
    else if(lastFocus?.isConnected)lastFocus.focus();
  }
  function schedulePreview(){
    clearTimeout(previewTimer);previewTimer=0;
    if(panel.hidden||running||format.value==='pdf'&&!replyElement)return;
    // Opening an export is enough to preview a transcript. Full-history PDF
    // remains explicit because it scrolls the conversation to capture the page.
    previewTimer=setTimeout(()=>{previewTimer=0;if(!panel.hidden&&!running&&(format.value!=='pdf'||replyElement))void run('preview',true);},200);
  }
  toggle.addEventListener('click',()=>{replyElement=null;show(panel.hidden);});close.addEventListener('click',()=>show(false));
  panel.addEventListener('cancel',event=>{event.preventDefault();show(false);});
  document.addEventListener('click',event=>{if(!panel.hidden&&!running&&!root.contains(event.target))show(false);});
  window.addEventListener('resize',tooltipViewportChanged);
  document.addEventListener('scroll',tooltipViewportChanged,{capture:true,passive:true});
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented)return;
    if(event.key==='Escape'&&!tooltip.hidden)hideTooltip();
    if(event.key==='Escape'&&!panel.hidden){show(false);event.preventDefault();event.stopPropagation();}
    if(event.key==='Tab'&&!panel.hidden){const items=[...panel.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary,[tabindex="0"],a[href]')].filter(el=>!el.closest('[hidden]')&&(!el.closest('details')||el.tagName==='SUMMARY'||el.closest('details').open));
      if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}}
  });
  function release(type,requestId){window.postMessage({channel:CHANNEL,type,requestId:requestId||crypto.randomUUID()},location.origin);}
  function cancelExport(){canceled=true;pdfAbort?.abort();if(pending){release('cancel',pending.id);pending.reject(new Error('Export cancelled.'));}}
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
  function candidates(){
    if(format.value==='pdf')return (pdfCapture?.messages||[]).filter(entry=>replyElement||pdfRole.value==='conversation'||entry.role===(pdfRole.value==='prompts'?'user':'assistant'));
    return snapshot?core.buildTranscript(snapshot,{...options(),selectedMessageIds:null}).entries.map(entry=>({...entry,preview:entry.text})):[];
  }
  function selectedKeys(){return format.value==='pdf'?pdfSelection:textSelection;}
  function setSelection(value){if(format.value==='pdf')pdfSelection=value;else textSelection=value;}
  function selectedEntries(){const selected=selectedKeys();return candidates().filter(entry=>selected===null||selected.has(entry.key));}
  function countLabel(count,noun='message'){return count+' '+noun+(count===1?'':'s');}
  function syncSelectionActions(){
    const loaded=format.value==='pdf'?pdfCapture:snapshot;
    const empty=!!loaded&&format.value!=='json'&&!selectedEntries().length;
    copy.disabled=running||empty;save.disabled=running||empty;
    if(empty&&!running){status.dataset.state='empty';status.textContent='Select at least one message to export.';}
    else if(status.dataset.state==='empty'){status.textContent='';status.dataset.state='success';}
    if(loaded&&format.value!=='json')selectionCount.setAttribute('aria-label',selectedEntries().length+' of '+countLabel(candidates().length)+' selected');
  }
  function renderSelection(){
    const entries=candidates(),selected=selectedKeys(),query=search.value.trim().toLocaleLowerCase();
    selectionCount.textContent=selectedEntries().length+' / '+entries.length;
    messageList.replaceChildren();
    for(const [index,entry]of entries.entries()){
      if(query&&!String(entry.preview).toLocaleLowerCase().includes(query))continue;
      const row=element('label','li-export-message-choice'),input=element('input');input.type='checkbox';input.checked=selected===null||selected.has(entry.key);input.dataset.messageKey=entry.key;
      const text=element('span'),label=entry.role==='user'?'You':entry.label||'ChatGPT';
      text.append(element('strong','',(index+1)+'. '+label),element('span','',String(entry.preview||'Message').replace(/\s+/g,' ').slice(0,180)));
      if(entry.error)text.append(element('small','li-export-message-error',String(entry.error).split('\n')[0].slice(0,180)));
      input.setAttribute('aria-label','Include message '+(index+1)+' from '+label);
      input.addEventListener('change',()=>{
        const next=new Set(selectedKeys()??entries.map(item=>item.key));if(input.checked)next.add(entry.key);else next.delete(entry.key);setSelection(next);
        selectionCount.textContent=selectedEntries().length+' / '+entries.length;previewSummary.textContent=countLabel(selectedEntries().length)+' selected';syncSelectionActions();
      });row.append(input,text);messageList.append(row);
    }
    if(!messageList.children.length)messageList.append(element('p','li-export-detail',query?'No matching messages.':'No messages match these options.'));
  }
  function previewLayout(isPDF,isJSON=false){
    const selecting=previewMode==='messages'&&!isJSON;
    selectionPane.hidden=!selecting;selectionMode.setAttribute('aria-pressed',String(selecting));
    pdfPreview.hidden=!isPDF||selecting;previewText.hidden=selecting||isPDF||previewMode==='dialogue'&&!isJSON;
    dialoguePreview.hidden=selecting||isPDF||previewMode!=='dialogue'||isJSON;
    dialogueMode.setAttribute('aria-pressed',String(!selecting&&(isPDF||previewMode==='dialogue'&&!isJSON)));
    fileMode.setAttribute('aria-pressed',String(!selecting&&!isPDF&&(previewMode==='file'||isJSON)));
    if(selecting)renderSelection();syncSelectionActions();
    return selecting;
  }
  async function renderPDF(){
    if(!pdfCapture)return;const token=++pdfViewSequence;
    previewBox.hidden=false;emptyPreview.hidden=true;more.hidden=true;previewNote.textContent='';
    previewSummary.textContent=countLabel(selectedEntries().length);
    if(previewLayout(true))return;
    pdfDocument?.dispose();pdfDocument=null;pdfPreview.replaceChildren();
    if(!selectedEntries().length){pdfPreview.append(element('p','li-export-detail','Select at least one message.'));return;}
    try{
      const prepared=await globalThis.LatexIslandsPDF.prepare({capture:pdfCapture,selectedKeys:pdfSelection===null?null:[...pdfSelection],roleMode:replyElement?'conversation':pdfRole.value,signal:pdfAbort?.signal});
      if(token!==pdfViewSequence){prepared.dispose();return;}
      pdfDocument=prepared;prepared.mountPreview(pdfPreview);
      previewNote.textContent=prepared.warningCount?prepared.warningCount+' diagram'+(prepared.warningCount===1?' could':'s could')+' not be rendered. The PDF includes the source code and error instead.':'';
    }catch(error){if(token===pdfViewSequence){status.dataset.state='error';status.textContent=error.message||'Could not prepare the PDF.';}throw error;}
  }
  function updatePreview(){
    if(format.value==='pdf'){void renderPDF().catch(()=>{});return;}
    if(!snapshot)return;
    const text=output(snapshot),isJSON=format.value==='json',transcript=isJSON?null:core.buildTranscript(snapshot,options());
    previewBox.hidden=false;emptyPreview.hidden=true;previewText.textContent=text.slice(0,visibleCharacters);
    const count=isJSON?snapshot.messages.length:transcript.entries.length;
    previewSummary.textContent=countLabel(count,isJSON?'record':'message');
    const selecting=previewLayout(false,isJSON),reading=previewMode==='dialogue'&&!isJSON;
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
    const limited=reading?count>visibleEntries:text.length>visibleCharacters;more.hidden=selecting||!limited;
    previewNote.textContent=selecting||!limited?'':(reading?'Showing the first '+Math.min(visibleEntries,count)+' messages.':'Showing the first '+visibleCharacters.toLocaleString('en-US')+' characters.')+' Copy and download include the entire file.';
  }
  selectionMode.addEventListener('click',()=>{previewMode='messages';updatePreview();});
  chooseMessages.addEventListener('click',()=>run('messages'));
  search.addEventListener('input',renderSelection);
  selectAll.addEventListener('click',()=>{setSelection(null);updatePreview();});
  selectNone.addEventListener('click',()=>{setSelection(new Set());updatePreview();});
  refresh.addEventListener('click',()=>run('refresh'));
  dialogueMode.addEventListener('click',()=>{previewMode='dialogue';updatePreview();});fileMode.addEventListener('click',()=>{previewMode='file';updatePreview();});
  more.addEventListener('click',()=>{visibleEntries+=20;visibleCharacters+=50000;updatePreview();});
  function setBusy(value,action){
    running=value;for(const node of [inspect,copy,save,format,preset,pdfRole,pdfUser,chooseMessages,selectAll,selectNone,refresh,search,selectionMode,dialogueMode,fileMode,...Object.values(checks),...messageList.querySelectorAll('input')])node.disabled=value;
    if(value&&automaticPreview&&format.value!=='pdf')for(const node of [format,preset,pdfRole,...Object.values(checks)])node.disabled=false;
    format.disabled=value&&!automaticPreview||!!replyElement;cancel.hidden=!value;dialogueMode.disabled=value||format.value==='json';
    for(const node of Object.values(actionButtons)){
      const active=value&&node===actionButtons[action];
      node.setAttribute('aria-busy',String(active));node.querySelector('.li-export-button-spinner').hidden=!active;
    }
    for(const control of dropdowns.values())control.sync();
    panel.setAttribute('aria-busy',String(value));
    syncSelectionActions();
  }
  function download(text,type,name){const url=URL.createObjectURL(new Blob([text],{type})),anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async function run(action,automatic=false){
    clearTimeout(previewTimer);previewTimer=0;
    if(running)return;const id=core.conversationId(location.pathname);if(!id){status.textContent='Open a saved conversation to export it.';return;}
    automaticPreview=automatic;
    const actionFocus=document.activeElement;
    const selectedFormat=format.value,selectedOptions=options();setBusy(true,action);canceled=false;status.textContent='';status.dataset.state='loading';
    try{
      if(selectedFormat==='pdf'){
        if(!globalThis.LatexIslandsPDF)throw new Error('PDF export unavailable. Reload ChatGPT after updating the extension.');
        pdfAbort=new AbortController();
        if(!pdfCapture||action==='refresh'){
          pdfCapture?.dispose();pdfCapture=null;pdfSelection=null;
          pdfCapture=await globalThis.LatexIslandsPDF.collect({replyElement,includePrecedingPrompt:true,signal:pdfAbort.signal,onProgress(){if(core.conversationId(location.pathname)!==id)cancelExport();}});
          if(replyElement)pdfSelection=new Set(pdfCapture.messages.filter(entry=>entry.role==='assistant'||pdfUser.checked).map(entry=>entry.key));
        }
        if(canceled||core.conversationId(location.pathname)!==id)throw new Error('Export cancelled.');
        previewRequested=true;previewMode=action==='messages'||action==='refresh'?'messages':'dialogue';
        await renderPDF();
        if(canceled||core.conversationId(location.pathname)!==id)throw new Error('Export cancelled.');
        if(action==='download'){if(!pdfDocument)throw new Error('Select at least one message.');pdfDocument.print();}
        status.dataset.state='success';return;
      }
      if(!snapshot||snapshotRevision!==revision||action==='refresh'){
        const startedRevision=revision;
        snapshot=await core.collectConversation({id,fetchJSON,onProgress(){
          if(core.conversationId(location.pathname)!==id){cancelExport();throw new Error('Conversation changed. Export cancelled.');}
        }});snapshotRevision=startedRevision;
      }
      if(canceled||core.conversationId(location.pathname)!==id)throw new Error('Export cancelled.');
      const text=output(snapshot,selectedFormat,{...selectedOptions,selectedMessageIds:textSelection===null?null:[...textSelection]});
      if(previewRequested)updatePreview();
      if(action==='preview'||action==='messages'||action==='refresh'){previewRequested=true;previewMode=action==='preview'?'dialogue':'messages';updatePreview();}
      else if(action==='copy'){
        if(selectedFormat!=='json'&&!core.buildTranscript(snapshot,options()).entries.length)throw new Error('Select at least one message.');
        try{await navigator.clipboard.writeText(text);}
        catch{previewRequested=true;updatePreview();throw new Error('Copy unavailable. Download the complete file.');}
      }else{
        if(selectedFormat!=='json'&&!core.buildTranscript(snapshot,options()).entries.length)throw new Error('Select at least one message.');
        const mime={json:'application/json',md:'text/markdown',txt:'text/plain'}[selectedFormat];
        download(text,mime+';charset=utf-8',core.fileName(snapshot.title,selectedFormat));
      }
      status.dataset.state='success';
    }catch(error){status.dataset.state='error';status.textContent=error.message||'Export failed.';}
    finally{if(selectedFormat!=='pdf')release('release');pdfAbort=null;setBusy(false);automaticPreview=false;if(!panel.hidden&&document.activeElement===document.body&&actionFocus?.isConnected)actionFocus.focus();}
  }
  inspect.addEventListener('click',()=>run('preview'));copy.addEventListener('click',()=>run('copy'));save.addEventListener('click',()=>run('download'));
  function moveRoot(parent){
    if(root.parentElement===parent)return;
    const focused=document.activeElement,wasOpen=!panel.hidden;
    parent.append(root);
    // Replacing ChatGPT's titlebar can disconnect an open modal. Restore its
    // top-layer membership without resetting its options or in-flight export.
    if(wasOpen){try{panel.close?.();panel.showModal?.();}catch{}if(panel.contains(focused))focused.focus();}
  }
  const controlSelector='.li-export:not(.li-pdf-root), .li-export-reply';
  const printMedia=window.matchMedia?.('print');
  function unownedControl(node){return node.matches(controlSelector)&&node!==root&&![...replyActions.values()].includes(node);}
  function mount(){
    tick=0;
    // Print styles temporarily hide ChatGPT. Its controls are still live; the
    // body's class removal schedules a fresh mount, including navigation cleanup.
    if(document.body?.classList.contains('li-pdf-printing')||printMedia?.matches)return;
    // ChatGPT's cached DOM can contain copies of our controls without their
    // handlers. Keep the live dialog and tracked actions, and discard the copies.
    for(const node of document.querySelectorAll(controlSelector))if(unownedControl(node))node.remove();
    const id=core.conversationId(location.pathname);
    if(mountedId&&id!==mountedId){if(running)cancelExport();show(false);status.textContent='';snapshot=null;}
    mountedId=id;if(!id){if(running)cancelExport();root.remove();for(const action of replyActions.values())action.remove();replyActions.clear();knownMessages.clear();return;}
    const header=chatDOM.getHeaderActions();
    root.classList.toggle('li-export-fallback',!header);
    if(header||document.body)moveRoot(header||document.body);
    knownMessages=new Set(chatDOM.getMessages());
    const replies=new Set([...knownMessages].filter(message=>chatDOM.role(message)==='assistant'));
    for(const [reply,action]of replyActions)if(!replies.has(reply)){action.remove();replyActions.delete(reply);}
    for(const reply of replies){
      let action=replyActions.get(reply);
      if(!action){
        action=button('','li-export-reply');action.setAttribute('aria-label','Export this reply as PDF');action.setAttribute('aria-describedby',tooltip.id);
        action.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" stroke-linejoin="round"/><path d="M14 3v5h5M12 11v6m-2.5-2.5L12 17l2.5-2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        action.addEventListener('pointerenter',()=>showTooltip(action,'Export reply as PDF'));action.addEventListener('pointerleave',hideTooltip);action.addEventListener('focus',()=>showTooltip(action,'Export reply as PDF'));action.addEventListener('blur',hideTooltip);
        action.addEventListener('click',event=>{event.stopPropagation();if(running||!reply.isConnected||chatDOM.role(reply)!=='assistant'||!chatDOM.isVisible(reply)||chatDOM.isStreaming(reply))return;replyElement=reply;format.value='pdf';preferencesTouched=true;pdfUser.checked=false;show(true);});
        replyActions.set(reply,action);
      }
      const actions=chatDOM.getReplyActions?.(reply),host=actions||reply;
      action.hidden=chatDOM.isStreaming(reply);
      if(action.hidden&&tooltipAnchor===action)hideTooltip();
      action.classList.toggle('li-export-reply-toolbar',!!actions);
      if(action.parentElement!==host)host.append(action);
    }
  }
  const observer=new MutationObserver(records=>{
    // ChatGPT can replace only an injected control. Do not filter that removal
    // as our own mutation; after a normal move/insert every control is connected.
    const lostControls=mountedId&&(!root.isConnected||[...replyActions].some(([reply,action])=>reply.isConnected&&!action.isConnected));
    const clonedControls=records.some(record=>record.type==='childList'&&[...record.addedNodes].some(node=>node.nodeType===1&&(unownedControl(node)||[...node.querySelectorAll(controlSelector)].some(unownedControl))));
    if((lostControls||clonedControls)&&!tick)tick=setTimeout(mount,250);
    const own=node=>{const el=node.nodeType===1?node:node.parentElement;return !!el?.closest('.li-export, .li-export-reply, .li-pdf-root');};
    const external=records.filter(record=>!own(record.target)&&!(record.type==='childList'&&[...record.addedNodes,...record.removedNodes].length&&[...record.addedNodes,...record.removedNodes].every(own)));if(!external.length)return;
    let visibleMessages;
    if(external.some(record=>{
      const el=record.target.nodeType===1?record.target:record.target.parentElement;
      if(!el||el.closest('.latex-islands-container'))return false;
      if(record.type==='attributes'&&['class','style'].includes(record.attributeName)){
        if((!snapshot&&!running)||document.body?.classList.contains('li-pdf-printing'))return false;
        const streaming=value=>/(?:^|\s)(?:result-streaming|streaming-animation)(?:\s|$)/.test(value||'');
        if(record.attributeName==='class'&&streaming(record.oldValue)!==streaming(el.getAttribute('class'))&&(chatDOM.getMessage(el)||[...knownMessages].some(message=>el.contains(message))))return true;
        // Hover and layout styles do not change the saved transcript. A style
        // that changes which messages are available still invalidates it.
        visibleMessages??=new Set(chatDOM.getMessages());
        return visibleMessages.size!==knownMessages.size||[...visibleMessages].some(message=>!knownMessages.has(message));
      }
      if(chatDOM.getMessage(el)||knownMessages.has(el))return true;
      if(record.type!=='childList')return false;
      return [...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&(chatDOM.getMessage(node)||chatDOM.getMessages(node).length||[...knownMessages].some(message=>node===message||node.contains(message))));
    })){
      revision++;
      if(previewRequested&&snapshot&&!running){status.textContent='The conversation has changed. Refresh the preview; the next export will fetch the latest version.';status.dataset.state='stale';}
    }
    if(!tick)tick=setTimeout(mount,250);
  });
  observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeOldValue:true,attributeFilter:chatDOM.observedAttributes});
  // afterprint can precede the switch back to screen media. Visibility under
  // print CSS must never be interpreted as deleted conversation messages.
  printMedia?.addEventListener?.('change',event=>{if(!event.matches)mount();});
  window.addEventListener('popstate',mount);window.addEventListener('pagehide',()=>{cancelExport();pdfDocument?.dispose();});mount();
})();
