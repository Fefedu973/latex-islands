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
  custom.value = 'custom'; custom.textContent = 'My diagram'; examples.append(custom);
  const controls = new Map([...document.querySelectorAll('select')].map(select => [select, LatexIslandsNativeControls.enhanceSelect(select)]));

  function countLines() {
    const lines = source.value.split('\n').length;
    document.getElementById('source-count').textContent = lines + (lines === 1 ? ' line' : ' lines');
  }
  async function persistSource() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    const revision = saveRevision;
    try {
      if (extensionAPI?.storage?.local) {
        await extensionAPI.storage.local.set({demoSource: source.value, demoExample: examples.value});
        if (revision === saveRevision) {dirty = false; sourceStatus.textContent = '';}
      } else sourceStatus.textContent = '';
    } catch { sourceStatus.textContent = 'Could not save'; }
  }
  function saveSource() {
    clearTimeout(saveTimer);
    dirty = true; saveRevision++;
    countLines();
    sourceStatus.textContent = 'Saving…';
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
    themeSelect.title = themeSelect.value !== 'chatgpt' ? 'Editor appearance' : followed ? 'Uses the last theme seen in ChatGPT' : 'System theme until a ChatGPT tab is opened';
    controls.get(themeSelect).sync();
    updateView();
  }
  function applyRenderColors(value) {
    colorSelect.value = value === 'native' ? 'native' : 'chatgpt';
    document.documentElement.dataset.renderColors = colorSelect.value;
    controls.get(colorSelect).sync();
    updateView();
  }
  function updateView() {
    if (currentRender) {currentRender = {...currentRender, ...theme()}; sendView(editorState ? 'fullscreen' : 'preview');}
  }
  function setSourceVisible(visible) {
    sourcePanel.hidden = !visible;
    document.getElementById('workspace').classList.toggle('source-hidden', !visible);
    toggleSource.setAttribute('aria-expanded', String(visible));
    toggleSource.querySelector('span').textContent = visible ? 'Hide code' : 'Show code';
  }
  function setRunning(value) {
    running = value;
    renderButton.disabled = value;
    renderButton.querySelector('span').textContent = value ? 'Compiling…' : 'Compile';
    preview.setAttribute('aria-busy', String(value));
  }
  function sendRender() {
    if (frame?.contentWindow && currentRender) frame.contentWindow.postMessage({...currentRender,mode:editorState ? 'fullscreen' : 'preview'}, extensionOrigin);
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
    sendView('preview');saved.focus?.focus();
  }
  function openEditor() {
    if (editorState || !frame) return;
    editorState={previewStyle:preview.style.cssText,frameStyle:frame.style.cssText,overflow:document.body.style.overflow,focus:document.activeElement};
    preview.setAttribute('role','dialog');preview.setAttribute('aria-modal','true');preview.setAttribute('aria-label','Full-screen TikZ diagram');
    preview.classList.add('editor-expanded');
    frame.style.cssText='width:100%;height:100%;display:block;border:0';document.body.style.overflow='hidden';
    if (typeof preview.showPopover==='function') {preview.setAttribute('popover','manual');preview.showPopover();}
    sendView('fullscreen');frame.focus();
  }
  function render() {
    if (running) return;
    if (!source.value.trim()) { renderStatus.textContent = 'Add TikZ code to get started.'; source.focus(); return; }
    if (source.value.length > 60000) { renderStatus.textContent = 'Code exceeds the 60,000-character limit.'; return; }
    setRunning(true);
    renderStatus.textContent = 'Compiling locally…';
    currentRender = {channel:'latex-islands',type:'render',id:'demo-'+(++renderId),source:source.value,kind:'tikz',autoRender:true,scale,...theme()};
    if (!frame) {
      frame = document.createElement('iframe');
      frame.title = 'TikZ diagram preview';
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
    // The standalone preview owns its available height. Inline ChatGPT islands
    // still report natural height to content.js; that must not shrink this panel.
    if (message.type === 'open-editor') {openEditor();return;}
    if (message.type === 'close-editor') {closeEditor();return;}
    if (message.type === 'show-source') {closeEditor();setSourceVisible(true);source.focus();return;}
    if (message.type === 'source-change' && typeof message.source==='string' && message.source.length<=60000) {
      source.value=message.source;currentRender={...currentRender,source:message.source};examples.value='custom';controls.get(examples).sync();saveSource();
      setRunning(true);renderStatus.textContent='Compiling locally…';return;
    }
    if (message.type === 'result') {
      setRunning(false);
      renderStatus.textContent = source.value !== currentRender.source ? 'Uncompiled changes' : message.ok === false || message.error ? 'Compilation error' : '';
    }
  });
  source.addEventListener('input', () => { examples.value = 'custom'; controls.get(examples).sync(); saveSource(); if (!running) renderStatus.textContent = 'Uncompiled changes'; });
  source.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); const start=source.selectionStart,end=source.selectionEnd; source.setRangeText('  ',start,end,'end'); examples.value='custom';controls.get(examples).sync();saveSource(); if (!running) renderStatus.textContent = 'Uncompiled changes'; }
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
  const copyButton = document.getElementById('copy-source');
  const copyIcon = copyButton.querySelector('svg');
  const originalCopyIcon = [...copyIcon.childNodes].map(node => node.cloneNode(true));
  let copyFeedbackTimer;
  function resetCopyFeedback() {
    clearTimeout(copyFeedbackTimer);
    copyIcon.replaceChildren(...originalCopyIcon.map(node => node.cloneNode(true)));
    copyButton.setAttribute('aria-label', 'Copy code');
    copyButton.title = 'Copy code';
  }
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(source.value);
      clearTimeout(copyFeedbackTimer);
      if (sourceStatus.textContent === 'Could not copy') sourceStatus.textContent = '';
      copyIcon.innerHTML = '<path d="m5 12 4 4L19 6"/>';
      copyButton.setAttribute('aria-label', 'Copied');
      copyButton.title = 'Copied';
      copyFeedbackTimer = setTimeout(resetCopyFeedback, 1800);
    }
    catch { resetCopyFeedback(); sourceStatus.textContent = 'Could not copy'; }
  });
  themeSelect.addEventListener('change', async () => {
    applyTheme(themeSelect.value);
    try { if (extensionAPI?.storage?.local) await extensionAPI.storage.local.set({uiTheme: themeSelect.value}); }
    catch { sourceStatus.textContent = 'Appearance could not be saved'; }
  });
  colorSelect.addEventListener('change', async () => {
    applyRenderColors(colorSelect.value);
    try { if (extensionAPI?.storage?.local) await extensionAPI.storage.local.set({renderColors: colorSelect.value}); }
    catch { sourceStatus.textContent = 'Colors could not be saved'; }
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
    try { if (extensionAPI?.storage?.local) saved=await extensionAPI.storage.local.get({demoSource:first.source,demoExample:first.id,scale:1,uiTheme:'chatgpt',chatgptTheme:null,renderColors:'chatgpt'}); } catch { sourceStatus.textContent='Settings unavailable'; }
    chatgptTheme = saved.chatgptTheme;
    applyTheme(saved.uiTheme);
    applyRenderColors(saved.renderColors);
    source.value = typeof saved.demoSource==='string' ? saved.demoSource : first.source;
    examples.value = [...examples.options].some(option=>option.value===saved.demoExample) ? saved.demoExample : first.id;
    controls.get(examples).sync();
    scale = [.75,1,1.25,1.5,2].includes(Number(saved.scale)) ? Number(saved.scale) : 1;
    countLines();
    render();
  }
  initialize();
})();
