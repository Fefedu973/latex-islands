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
  const toggle=button('','li-export-toggle');toggle.title='Exporter la conversation';toggle.setAttribute('aria-label',toggle.title);toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','li-export-panel');
  toggle.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const panel=element('dialog','li-export-panel');panel.id='li-export-panel';panel.hidden=true;panel.setAttribute('aria-label','Exporter la conversation');
  const heading=element('div','li-export-heading');const title=element('strong','','Exporter la conversation');title.id='li-export-title';panel.setAttribute('aria-labelledby',title.id);panel.setAttribute('aria-modal','true');
  const close=button('×','li-export-close');close.setAttribute('aria-label','Fermer les options d’export');heading.append(title,close);
  const detail=element('p','li-export-detail','Une transcription prête à lire et à partager.');
  const controls=element('div','li-export-controls');
  function selectField(label,id,values){const wrapper=element('label','li-export-field');const caption=element('span','',label);const select=element('select');select.id=id;for(const [value,text]of values){const option=element('option','',text);option.value=value;select.append(option);}wrapper.append(caption,select);return {wrapper,select};}
  const {wrapper:formatField,select:format}=selectField('Format','li-export-format',[['md','Markdown (.md)'],['txt','Texte brut (.txt)'],['json','Archive complète (.json)']]);
  const transcriptControls=element('fieldset','li-export-transcript');
  const {wrapper:presetField,select:preset}=selectField('Contenu','li-export-preset',[['dialogue','Dialogue'],['detailed','Contexte détaillé'],['answers','Réponses uniquement'],['custom','Personnalisé']]);
  const extras=element('details','li-export-options');extras.open=true;extras.append(element('summary','','Personnaliser le transcript'));
  const checks={};
  for(const [key,label]of [['includeUser','Inclure mes messages'],['includeAttachments','Mentionner les pièces jointes'],['includeSources','Conserver les sources et citations'],['timestamps','Afficher les dates et heures'],['includeProgress','Inclure les étapes intermédiaires'],['includeTools','Inclure les appels et résultats d’outils']]){
    const row=element('label','li-export-option');const input=element('input');input.type='checkbox';input.id='li-export-'+key;checks[key]=input;row.append(input,element('span','',label));extras.append(row);
  }
  transcriptControls.append(presetField,extras);
  const archiveNote=element('p','li-export-archive-note','Tous les messages, métadonnées et pages reçues de ChatGPT, sans filtre.');archiveNote.hidden=true;
  controls.append(formatField,transcriptControls,archiveNote);
  const attachmentNote=element('p','li-export-detail','Les images et fichiers sont mentionnés ; leurs contenus ne sont pas téléchargés.');
  const status=element('p','li-export-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const previewBox=element('section','li-export-preview');previewBox.hidden=true;previewBox.setAttribute('aria-label','Aperçu du fichier exporté');
  const previewHeader=element('div','li-export-preview-heading');const previewTitle=element('strong','','Aperçu');const previewSummary=element('span');previewHeader.append(previewTitle,previewSummary);
  const previewText=element('pre');previewText.tabIndex=0;previewText.setAttribute('aria-label','Extrait du fichier');const previewNote=element('p','li-export-detail');previewBox.append(previewHeader,previewText,previewNote);
  const previewModes=element('div','li-export-preview-modes');previewModes.setAttribute('role','group');previewModes.setAttribute('aria-label','Vue de l’aperçu');
  const dialogueMode=button('Dialogue','li-export-dialogue-mode'),fileMode=button('Fichier','li-export-file-mode');previewModes.append(dialogueMode,fileMode);previewHeader.append(previewModes);
  const dialoguePreview=element('div','li-export-dialogue');dialoguePreview.tabIndex=0;dialoguePreview.setAttribute('aria-label','Dialogue exporté');
  const more=button('Afficher la suite','li-export-more');more.hidden=true;previewBox.insertBefore(dialoguePreview,previewNote);previewBox.append(more);
  let previewMode='dialogue',visibleEntries=20,visibleCharacters=50000;
  const previewPane=element('div','li-export-preview-pane');const emptyPreview=element('div','li-export-empty');
  emptyPreview.append(element('strong','','Votre conversation, prête à emporter'),element('p','','Choisissez le contenu puis cliquez sur Aperçu. Vos options s’appliqueront immédiatement au dialogue.'));
  previewPane.append(emptyPreview,previewBox);
  const actions=element('div','li-export-actions');
  const inspect=button('Aperçu','li-export-inspect'),copy=button('Copier','li-export-copy'),save=button('Télécharger','li-export-save'),cancel=button('Annuler','li-export-cancel');cancel.hidden=true;
  const sessionNote=element('p','li-export-detail','Lecture auprès de ChatGPT avec votre session. Export local.');
  const settingsPane=element('div','li-export-settings');settingsPane.append(detail,controls,attachmentNote,sessionNote);
  const layout=element('div','li-export-layout');layout.append(settingsPane,previewPane);
  const footer=element('div','li-export-footer');actions.append(inspect,copy,save,cancel);footer.append(status,actions);panel.append(heading,layout,footer);root.append(toggle,panel);

  function options(){return Object.fromEntries(Object.entries(checks).map(([key,input])=>[key,input.checked]));}
  function guessedPreset(value){if(!value.includeUser)return value.includeProgress||value.includeTools?'custom':'answers';if(value.includeProgress&&value.includeTools)return 'detailed';if(!value.includeProgress&&!value.includeTools)return 'dialogue';return 'custom';}
  function applyPreferences(){
    format.value=preferences.format;for(const [key,input]of Object.entries(checks))input.checked=preferences[key];preset.value=guessedPreset(preferences);updateFormat();
  }
  function updateFormat(){
    const isJSON=format.value==='json';transcriptControls.hidden=isJSON;archiveNote.hidden=!isJSON;dialogueMode.disabled=isJSON;
    detail.textContent=isJSON?'Une archive fidèle aux données de la conversation.':'Une transcription prête à lire et à partager.';
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
  for(const input of Object.values(checks))input.addEventListener('change',()=>{remember();preset.value=guessedPreset(preferences);});
  applyPreferences();
  try{Promise.resolve(extensionAPI?.storage?.local?.get({exportPreferences:defaults})).then(saved=>{
    if(preferencesTouched)return;const next=saved?.exportPreferences;if(!next)return;
    for(const key of Object.keys(defaults)){if(key==='format'){if(['md','txt','json'].includes(next.format))preferences.format=next.format;}else if(typeof next[key]==='boolean')preferences[key]=next[key];}
    applyPreferences();
  }).catch(()=>{});}catch{}

  function show(open){
    if(!open){if(running)cancelExport();try{panel.close?.();}catch{}snapshot=null;snapshotRevision=-1;previewRequested=false;previewBox.hidden=true;emptyPreview.hidden=false;status.textContent='';}
    panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));
    if(open){lastFocus=document.activeElement;panel.showModal?.();format.focus();}
    else if(lastFocus?.isConnected)lastFocus.focus();
  }
  toggle.addEventListener('click',()=>show(panel.hidden));close.addEventListener('click',()=>show(false));
  panel.addEventListener('cancel',event=>{event.preventDefault();show(false);});
  document.addEventListener('click',event=>{if(!panel.hidden&&!running&&!root.contains(event.target))show(false);});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!panel.hidden){show(false);event.preventDefault();event.stopPropagation();}
    if(event.key==='Tab'&&!panel.hidden){const items=[...panel.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary,[tabindex="0"],a[href]')].filter(el=>!el.closest('[hidden]')&&(!el.closest('details')||el.tagName==='SUMMARY'||el.closest('details').open));
      if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}}
  });
  function release(type,requestId){window.postMessage({channel:CHANNEL,type,requestId:requestId||crypto.randomUUID()},location.origin);}
  function cancelExport(){canceled=true;if(pending){release('cancel',pending.id);pending.reject(new Error('Export annulé.'));}}
  cancel.addEventListener('click',cancelExport);
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.channel!==CHANNEL||event.data.type!=='response'||!pending||event.data.requestId!==pending.id)return;
    const {ok,payload,error,status:httpStatus}=event.data;if(ok)pending.resolve(payload);else pending.reject(Object.assign(new Error(error||'Lecture impossible.'),{status:httpStatus}));
  });
  function fetchJSON(path){
    if(canceled)return Promise.reject(new Error('Export annulé.'));
    return new Promise((resolve,reject)=>{
      const id=crypto.randomUUID();
      const timer=setTimeout(()=>{release('cancel',id);finish(reject,new Error('ChatGPT ne répond pas. Rechargez la page après la mise à jour de l’extension.'));},50000);
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
    previewSummary.textContent=count+(isJSON?' enregistrements':' messages');
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
      if(!count)dialoguePreview.append(element('p','','Aucun message ne correspond à ces options.'));
    }
    const limited=reading?count>visibleEntries:text.length>visibleCharacters;more.hidden=!limited;
    previewNote.textContent=limited?(reading?Math.min(visibleEntries,count)+' premiers messages affichés.':'Extrait de '+visibleCharacters.toLocaleString('fr-FR')+' caractères.')+' Copie et téléchargement incluent tout le fichier.':'Copie et téléchargement incluent tout le fichier.';
  }
  dialogueMode.addEventListener('click',()=>{previewMode='dialogue';updatePreview();});fileMode.addEventListener('click',()=>{previewMode='file';updatePreview();});
  more.addEventListener('click',()=>{visibleEntries+=20;visibleCharacters+=50000;updatePreview();});
  function setBusy(value){
    running=value;for(const node of [inspect,copy,save,format,preset,...Object.values(checks)])node.disabled=value;cancel.hidden=!value;
    panel.setAttribute('aria-busy',String(value));
  }
  function download(text,type,name){const url=URL.createObjectURL(new Blob([text],{type})),anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async function run(action){
    if(running)return;const id=core.conversationId(location.pathname);if(!id){status.textContent='Ouvrez une conversation enregistrée pour l’exporter.';return;}
    const actionFocus=document.activeElement;
    const selectedFormat=format.value,selectedOptions=options();setBusy(true);canceled=false;status.dataset.state='loading';
    try{
      if(!snapshot||snapshotRevision!==revision){
        status.textContent='Récupération de la conversation…';const startedRevision=revision;
        snapshot=await core.collectConversation({id,fetchJSON,onProgress(progress){
          if(core.conversationId(location.pathname)!==id){cancelExport();throw new Error('Conversation changée. Export annulé.');}
          status.textContent=progress.messages+' messages récupérés…';
        }});snapshotRevision=startedRevision;
      }
      if(canceled||core.conversationId(location.pathname)!==id)throw new Error('Export annulé.');
      const text=output(snapshot,selectedFormat,selectedOptions);
      if(previewRequested)updatePreview();
      if(action==='preview'){previewRequested=true;updatePreview();status.textContent='Aperçu prêt. Ajustez les options avant de copier ou télécharger.';}
      else if(action==='copy'){
        try{await navigator.clipboard.writeText(text);status.textContent='Conversation copiée.';}
        catch{previewRequested=true;updatePreview();throw new Error('Copie indisponible. Téléchargez le fichier complet.');}
      }else{
        const mime={json:'application/json',md:'text/markdown',txt:'text/plain'}[selectedFormat];
        download(text,mime+';charset=utf-8',core.fileName(snapshot.title,selectedFormat));status.textContent='Conversation téléchargée.';
      }
      status.dataset.state='success';
    }catch(error){status.dataset.state='error';status.textContent=error.message||'Export impossible.';}
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
      if(previewRequested&&snapshot&&!running){status.textContent='La conversation a changé. Actualisez l’aperçu ; le prochain export récupérera la version à jour.';status.dataset.state='stale';}
    }
    if(!tick)tick=setTimeout(mount,250);
  });
  observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  window.addEventListener('popstate',mount);window.addEventListener('pagehide',cancelExport);mount();
})();
