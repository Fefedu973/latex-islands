/* SPDX-License-Identifier: GPL-3.0-or-later */
(() => {
  'use strict';
  if(globalThis.LatexIslandsNativeControls)return;
  const enhanced=new WeakMap();let openDropdown=null;
  const create=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text)node.textContent=text;return node;};
  function enhanceSelect(select,{prefix='li-native',labelledBy}={}){
    if(enhanced.has(select))return enhanced.get(select);
    if(!select.id)throw Error('Enhanced selects require an id.');
    const id=select.id,labels=[...select.labels];
    if(!labelledBy)labelledBy=select.getAttribute('aria-labelledby')||labels.map((label,index)=>{if(!label.id)label.id=id+'-label-'+index;return label.id;}).join(' ');
    const wrapper=create('span',prefix+'-select'),trigger=create('button',prefix+'-select-trigger'),valueLabel=create('span',prefix+'-select-value');
    trigger.type='button';trigger.id=id+'-trigger';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-autocomplete','none');
    if(labelledBy)trigger.setAttribute('aria-labelledby',labelledBy);else trigger.setAttribute('aria-label',select.getAttribute('aria-label')||id);
    const arrow=create('span',prefix+'-select-arrow');arrow.setAttribute('aria-hidden','true');arrow.innerHTML='<svg viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';trigger.append(valueLabel,arrow);
    const menu=create('div',prefix+'-select-menu');menu.id=id+'-menu';menu.hidden=true;menu.setAttribute('role','listbox');menu.setAttribute('popover','manual');trigger.setAttribute('aria-controls',menu.id);
    if(labelledBy)menu.setAttribute('aria-labelledby',labelledBy);else menu.setAttribute('aria-label',trigger.getAttribute('aria-label'));
    select.before(wrapper);wrapper.append(select,trigger,menu);select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    for(const label of labels)if(label.htmlFor===id)label.htmlFor=trigger.id;
    let rows=[],options=[],signature='',activeIndex=0,search='',searchTime=0;
    const enabled=()=>options.map((option,index)=>option.disabled?-1:index).filter(index=>index>=0);
    function setActive(index){
      const available=enabled();if(!available.length)return;
      activeIndex=available.includes(index)?index:available[0];
      rows.forEach((row,rowIndex)=>row.dataset.active=String(rowIndex===activeIndex));
      if(!menu.hidden){trigger.setAttribute('aria-activedescendant',rows[activeIndex].id);rows[activeIndex].scrollIntoView?.({block:'nearest'});}
    }
    function moveActive(direction){const available=enabled(),position=available.indexOf(activeIndex);setActive(available[(position+direction+available.length)%available.length]);}
    function close(focus=false){
      try{menu.hidePopover?.();}catch{}
      menu.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant');
      if(openDropdown===controller)openDropdown=null;
      search='';if(focus&&!trigger.disabled)trigger.focus();
    }
    function position(){
      const rect=trigger.getBoundingClientRect(),roomBelow=window.innerHeight-rect.bottom-14,roomAbove=rect.top-14;
      menu.style.width=Math.min(window.innerWidth-16,Math.max(180,rect.width))+'px';
      menu.style.maxHeight=Math.max(36,Math.min(300,Math.max(roomAbove,roomBelow)))+'px';
      menu.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-menu.offsetWidth-8))+'px';
      menu.style.top=(rect.bottom+6+menu.offsetHeight<=window.innerHeight-8?rect.bottom+6:Math.max(8,rect.top-menu.offsetHeight-6))+'px';
    }
    function sync(){
      options=[...select.options];
      const next=JSON.stringify(options.map(option=>[option.value,option.textContent,option.disabled]));
      if(signature!==next){
        signature=next;menu.replaceChildren();
        rows=options.map((option,index)=>{
          const row=create('div',prefix+'-select-option');row.id=id+'-option-'+index;row.dataset.value=option.value;row.setAttribute('role','option');row.setAttribute('aria-disabled',String(option.disabled));row.append(create('span','',option.textContent));
          const check=create('span',prefix+'-select-check');check.setAttribute('aria-hidden','true');check.innerHTML='<svg viewBox="0 0 20 20" fill="none"><path d="m4 10 4 4 8-8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';row.append(check);
          row.addEventListener('pointermove',()=>{if(!option.disabled)setActive(index);});row.addEventListener('pointerdown',event=>event.preventDefault());row.addEventListener('click',()=>choose(index));menu.append(row);return row;
        });
      }
      valueLabel.textContent=select.selectedOptions[0]?.textContent||'';
      rows.forEach((row,index)=>row.setAttribute('aria-selected',String(options[index].selected)));
      trigger.disabled=select.matches(':disabled')||!enabled().length;
      trigger.title=select.title;
      const describedBy=select.getAttribute('aria-describedby');if(describedBy)trigger.setAttribute('aria-describedby',describedBy);else trigger.removeAttribute('aria-describedby');
      if(trigger.disabled)close();else if(!menu.hidden){setActive(Math.max(0,select.selectedIndex));position();}
    }
    function open(){
      sync();if(trigger.disabled)return;
      if(openDropdown&&openDropdown!==controller)openDropdown.close();
      menu.hidden=false;trigger.setAttribute('aria-expanded','true');menu.showPopover?.();openDropdown=controller;
      position();setActive(Math.max(0,select.selectedIndex));trigger.focus();
    }
    function choose(index){
      if(options[index]?.disabled||trigger.disabled)return;
      select.value=options[index].value;select.dispatchEvent(new Event('change',{bubbles:true}));close(true);
    }
    const controller={wrapper,trigger,menu,sync,close,position};enhanced.set(select,controller);
    trigger.addEventListener('click',()=>menu.hidden?open():close());select.addEventListener('change',sync);
    trigger.addEventListener('keydown',event=>{
      const {key}=event;
      if(key==='Tab'){close();return;}
      if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(key)){
        event.preventDefault();const wasOpen=!menu.hidden;if(!wasOpen)open();
        if(trigger.disabled)return;
        if(key==='Home')setActive(enabled()[0]);else if(key==='End')setActive(enabled().at(-1));
        else if(wasOpen&&key==='ArrowDown')moveActive(1);else if(wasOpen&&key==='ArrowUp')moveActive(-1);
        else if(wasOpen&&(key==='Enter'||key===' '))choose(activeIndex);return;
      }
      if(key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
        event.preventDefault();if(menu.hidden)open();const now=Date.now();search=now-searchTime>700?key:search+key;searchTime=now;
        const query=[...search].every(character=>character.toLowerCase()===key.toLowerCase())?key:search;
        const start=query.length===1?activeIndex+1:activeIndex;
        for(let offset=0;offset<options.length;offset++){const index=(start+offset)%options.length;if(!options[index].disabled&&options[index].textContent.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())){setActive(index);break;}}
      }
    });
    new MutationObserver(sync).observe(select,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','label','selected','title','aria-describedby']});
    sync();return controller;
  }
  document.addEventListener('pointerdown',event=>{if(openDropdown&&!openDropdown.wrapper.contains(event.target))openDropdown.close();});
  document.addEventListener('focusin',event=>{if(openDropdown&&!openDropdown.wrapper.contains(event.target))openDropdown.close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&openDropdown){event.preventDefault();event.stopImmediatePropagation();openDropdown.close(true);}},{capture:true});
  document.addEventListener('scroll',event=>{if(openDropdown&&!openDropdown.menu.contains(event.target))openDropdown.close();},{capture:true,passive:true});
  window.addEventListener('resize',()=>openDropdown?.position());
  globalThis.LatexIslandsNativeControls={enhanceSelect,closeAll:()=>openDropdown?.close()};
})();
