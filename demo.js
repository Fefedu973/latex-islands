/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
(() => {
  const extensionAPI=globalThis.browser||globalThis.chrome;
  const source = document.getElementById('source');
  const examples = document.getElementById('example');
  const renderButton = document.getElementById('render');
  const renderStatus = document.getElementById('render-status');
  const sourceStatus = document.getElementById('source-status');
  const preview = document.getElementById('preview');
  const themeSelect = document.getElementById('uiTheme');
  const colorSelect = document.getElementById('renderColors');
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const sourcePanel = document.getElementById('source-panel');
  const toggleSource = document.getElementById('toggle-source');
  const expandPreview = document.getElementById('expand-preview');
  const extensionOrigin = location.protocol + '//' + location.host;
  let frame = null, renderId = 0, saveTimer, scale = 1, currentRender = null, running = false, editorState = null, dirty = false, saveRevision = 0, chatgptTheme = null;

  for (const example of globalThis.LatexIslandsExamples) {
    const option = document.createElement('option');
    option.value = example.id;
    option.textContent = example.title;
    examples.append(option);
  }
  const custom = document.createElement('option');
  custom.value = 'custom'; custom.textContent = 'Mon schéma'; examples.append(custom);

  function countLines() {
    const lines = source.value.split('\n').length;
    document.getElementById('source-count').textContent = lines + (lines === 1 ? ' ligne' : ' lignes');
  }
  async function persistSource() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    const revision = saveRevision;
    try {
      if (extensionAPI?.storage?.local) {
        await extensionAPI.storage.local.set({demoSource: source.value, demoExample: examples.value});
        if (revision === saveRevision) {dirty = false; sourceStatus.textContent = 'Enregistré localement';}
      } else sourceStatus.textContent = 'Conservé pour cette session';
    } catch { sourceStatus.textContent = 'Enregistrement impossible'; }
  }
  function saveSource() {
    clearTimeout(saveTimer);
    dirty = true; saveRevision++;
    countLines();
    sourceStatus.textContent = 'Enregistrement…';
    saveTimer = setTimeout(persistSource, 350);
  }
  function applyTheme(value) {
    themeSelect.value = ['chatgpt', 'system', 'light', 'dark'].includes(value) ? value : 'chatgpt';
    const followed = themeSelect.value === 'chatgpt' && ['light', 'dark'].includes(chatgptTheme?.theme);
    const root = document.documentElement;
    root.dataset.theme = followed ? chatgptTheme.theme : ['light', 'dark'].includes(themeSelect.value) ? themeSelect.value : systemTheme.matches ? 'dark' : 'light';
    const properties = {'--page':'surface','--surface':'background','--soft':'surface','--ink':'text','--line':'border','--accent':'text','--on-accent':'background'};
    for (const [property, key] of Object.entries(properties)) {
      root.style.removeProperty(property);
      const color = followed && chatgptTheme.colors?.[key];
      if (typeof color === 'string' && /^(#[\da-f]{3,8}|rgba?\([\d\s.,%/]+\))$/i.test(color)) root.style.setProperty(property, color);
    }
    themeSelect.title = themeSelect.value !== 'chatgpt' ? 'Apparence de l’éditeur' : followed ? 'Suit le dernier thème observé dans ChatGPT' : 'Thème système en attendant un onglet ChatGPT';
    updateView();
  }
  function applyRenderColors(value) {
    colorSelect.value = value === 'native' ? 'native' : 'chatgpt';
    document.documentElement.dataset.renderColors = colorSelect.value;
    updateView();
  }
  function updateView() {
    if (currentRender) {currentRender = {...currentRender, ...theme()}; sendView(editorState ? 'editor' : 'inline');}
  }
  function setSourceVisible(visible) {
    sourcePanel.hidden = !visible;
    document.getElementById('workspace').classList.toggle('source-hidden', !visible);
    toggleSource.setAttribute('aria-expanded', String(visible));
    toggleSource.querySelector('span').textContent = visible ? 'Masquer le code' : 'Afficher le code';
  }
  function setRunning(value) {
    running = value;
    renderButton.disabled = value;
    renderButton.querySelector('span').textContent = value ? 'Compilation…' : 'Compiler';
    preview.setAttribute('aria-busy', String(value));
  }
  function sendRender() {
    if (frame?.contentWindow && currentRender) frame.contentWindow.postMessage(currentRender, extensionOrigin);
  }
  function theme() {
    const css=getComputedStyle(document.documentElement),read=name=>css.getPropertyValue(name).trim();
    return {theme:document.documentElement.dataset.theme || (systemTheme.matches ? 'dark' : 'light'),renderColors:colorSelect.value === 'native' ? 'native' : 'chatgpt',colors:{text:read('--ink'),background:read('--surface'),surface:read('--soft'),border:read('--line')}};
  }
  function sendView(mode) {
    if (frame?.contentWindow && currentRender) frame.contentWindow.postMessage({channel:'latex-islands',type:'view',id:currentRender.id,mode,...theme()},extensionOrigin);
  }
  function closeEditor() {
    if (!editorState) return;
    const saved=editorState;editorState=null;
    if (typeof preview.hidePopover==='function' && preview.matches(':popover-open')) preview.hidePopover();
    preview.removeAttribute('popover');preview.removeAttribute('role');preview.removeAttribute('aria-modal');preview.removeAttribute('aria-label');
    preview.classList.remove('editor-expanded');
    preview.style.cssText=saved.previewStyle;frame.style.cssText=saved.frameStyle;document.body.style.overflow=saved.overflow;
    sendView('inline');saved.focus?.focus();
  }
  function openEditor() {
    if (editorState || !frame) return;
    editorState={previewStyle:preview.style.cssText,frameStyle:frame.style.cssText,overflow:document.body.style.overflow,focus:document.activeElement};
    preview.setAttribute('role','dialog');preview.setAttribute('aria-modal','true');preview.setAttribute('aria-label','Éditeur du schéma TikZ');
    preview.classList.add('editor-expanded');
    frame.style.cssText='width:100%;height:100%;display:block;border:0';document.body.style.overflow='hidden';
    if (typeof preview.showPopover==='function') {preview.setAttribute('popover','manual');preview.showPopover();}
    sendView('editor');frame.focus();
  }
  function render() {
    if (running) return;
    if (!source.value.trim()) { renderStatus.textContent = 'Ajoutez du code TikZ pour commencer.'; source.focus(); return; }
    if (source.value.length > 60000) { renderStatus.textContent = 'Le code dépasse la limite de 60 000 caractères.'; return; }
    setRunning(true);
    renderStatus.textContent = 'Compilation locale…';
    currentRender = {channel:'latex-islands',type:'render',id:'demo-'+(++renderId),source:source.value,kind:'tikz',autoRender:true,scale,...theme()};
    if (!frame) {
      frame = document.createElement('iframe');
      frame.title = 'Rendu du schéma TikZ';
      frame.allow = 'clipboard-write';
      frame.className = 'island-frame';
      frame.src = extensionAPI?.runtime?.getURL ? extensionAPI.runtime.getURL('island.html') : 'island.html';
      frame.addEventListener('load', sendRender);
      preview.replaceChildren(frame);
      expandPreview.disabled = false;
    } else sendRender();
  }
  window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== extensionOrigin) return;
    const message = event.data;
    if (!message || message.channel !== 'latex-islands') return;
    if (message.type === 'ready') { sendRender(); return; }
    if (message.id !== currentRender?.id) return;
    if (message.type === 'resize' && Number.isFinite(message.height) && !editorState) frame.style.height = Math.max(160,Math.min(2400,message.height))+'px';
    if (message.type === 'open-editor') {openEditor();return;}
    if (message.type === 'close-editor') {closeEditor();return;}
    if (message.type === 'source-change' && typeof message.source==='string' && message.source.length<=60000) {
      source.value=message.source;currentRender={...currentRender,source:message.source};examples.value='custom';saveSource();
      setRunning(true);renderStatus.textContent='Compilation locale…';return;
    }
    if (message.type === 'result') {
      setRunning(false);
      renderStatus.textContent = source.value !== currentRender.source ? 'Modifications à compiler' : message.ok === false || message.error ? 'Erreur de compilation' : 'Schéma prêt';
    }
  });
  source.addEventListener('input', () => { examples.value = 'custom'; saveSource(); if (!running) renderStatus.textContent = 'Modifications à compiler'; });
  source.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); const start=source.selectionStart,end=source.selectionEnd; source.setRangeText('  ',start,end,'end'); examples.value='custom';saveSource(); if (!running) renderStatus.textContent = 'Modifications à compiler'; }
  });
  examples.addEventListener('change', () => {
    const example = globalThis.LatexIslandsExamples.find(item => item.id === examples.value);
    if (example) { source.value = example.source; saveSource(); if (!running) render(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key==='Escape' && editorState) {event.preventDefault();closeEditor();return;}
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); render(); }
  });
  renderButton.addEventListener('click', render);
  expandPreview.addEventListener('click', openEditor);
  toggleSource.addEventListener('click', () => setSourceVisible(sourcePanel.hidden));
  document.getElementById('copy-source').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(source.value); sourceStatus.textContent = 'Code copié'; }
    catch { sourceStatus.textContent = 'Copie impossible'; }
  });
  themeSelect.addEventListener('change', async () => {
    applyTheme(themeSelect.value);
    try { if (extensionAPI?.storage?.local) await extensionAPI.storage.local.set({uiTheme: themeSelect.value}); }
    catch { sourceStatus.textContent = 'Apparence non enregistrée'; }
  });
  colorSelect.addEventListener('change', async () => {
    applyRenderColors(colorSelect.value);
    try { if (extensionAPI?.storage?.local) await extensionAPI.storage.local.set({renderColors: colorSelect.value}); }
    catch { sourceStatus.textContent = 'Couleurs non enregistrées'; }
  });
  systemTheme.addEventListener('change', () => applyTheme(themeSelect.value));
  extensionAPI?.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.chatgptTheme) chatgptTheme = changes.chatgptTheme.newValue;
    if (changes.uiTheme || changes.chatgptTheme) applyTheme(changes.uiTheme ? changes.uiTheme.newValue : themeSelect.value);
    if (changes.renderColors) applyRenderColors(changes.renderColors.newValue);
  });
  document.addEventListener('visibilitychange', () => {if (document.hidden) persistSource();});
  window.addEventListener('pagehide', persistSource);
  async function initialize() {
    const first = globalThis.LatexIslandsExamples[0];
    let saved = {};
    try { if (extensionAPI?.storage?.local) saved=await extensionAPI.storage.local.get({demoSource:first.source,demoExample:first.id,scale:1,uiTheme:'chatgpt',chatgptTheme:null,renderColors:'chatgpt'}); } catch { sourceStatus.textContent='Préférences indisponibles'; }
    chatgptTheme = saved.chatgptTheme;
    applyTheme(saved.uiTheme);
    applyRenderColors(saved.renderColors);
    source.value = typeof saved.demoSource==='string' ? saved.demoSource : first.source;
    examples.value = [...examples.options].some(option=>option.value===saved.demoExample) ? saved.demoExample : first.id;
    scale = [.75,1,1.25,1.5,2].includes(Number(saved.scale)) ? Number(saved.scale) : 1;
    countLines();
    render();
  }
  initialize();
})();
