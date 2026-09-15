/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';
(() => {
  const extensionAPI=globalThis.browser||globalThis.chrome;
  const defaults = {enabled: true, autoRender: true, scale: 1, uiTheme: 'chatgpt', renderColors: 'chatgpt'};
  const status = document.getElementById('save-status');
  const themeSelect = document.getElementById('uiTheme');
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  let feedbackTimer, chatgptTheme = null;
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
    document.getElementById('theme-help').textContent = themeSelect.value !== 'chatgpt' ? 'Popup and editor.' : followed ? 'Last ChatGPT theme: ' + (chatgptTheme.theme === 'dark' ? 'dark.' : 'light.') : 'System theme until ChatGPT is opened.';
  }
  systemTheme.addEventListener('change', () => applyTheme(themeSelect.value));
  extensionAPI?.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.chatgptTheme) chatgptTheme = changes.chatgptTheme.newValue;
    if (changes.uiTheme || changes.chatgptTheme) applyTheme(changes.uiTheme ? changes.uiTheme.newValue : themeSelect.value);
    if (changes.renderColors) document.getElementById('renderColors').value = changes.renderColors.newValue === 'native' ? 'native' : 'chatgpt';
  });
  async function load() {
    try {
      const settings = await extensionAPI.storage.local.get({...defaults, chatgptTheme: null});
      document.getElementById('enabled').checked = settings.enabled;
      document.getElementById('autoRender').checked = settings.autoRender;
      document.getElementById('scale').value = String([0.75,1,1.25,1.5,2].includes(Number(settings.scale)) ? Number(settings.scale) : 1);
      chatgptTheme = settings.chatgptTheme;
      applyTheme(settings.uiTheme);
      document.getElementById('renderColors').value = settings.renderColors === 'native' ? 'native' : 'chatgpt';
    } catch { status.textContent = 'Could not load settings.'; }
  }
  for (const key of Object.keys(defaults)) document.getElementById(key).addEventListener('change', async event => {
    const value = key === 'uiTheme' || key === 'renderColors' ? event.target.value : key === 'scale' ? Number(event.target.value) : event.target.checked;
    if (key === 'uiTheme') applyTheme(value);
    try {
      await extensionAPI.storage.local.set({[key]: value});
      clearTimeout(feedbackTimer);
      status.textContent = 'Setting saved';
      feedbackTimer = setTimeout(() => { status.textContent = 'Settings saved locally'; }, 2200);
    } catch { status.textContent = 'Could not save. Please try again.'; }
  });
  document.getElementById('open-demo').addEventListener('click', () => {
    if (extensionAPI?.tabs?.create) extensionAPI.tabs.create({url: extensionAPI.runtime.getURL('demo.html')});
    else window.open('demo.html', '_blank', 'noopener');
  });
  load();
})();
