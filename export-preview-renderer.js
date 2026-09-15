/* SPDX-License-Identifier: GPL-3.0-or-later */
(function(root,factory){
  'use strict';const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.LatexIslandsPreview=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const fence=line=>line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  const heading=line=>line.match(/^ {0,3}(#{1,6})\s+(.+)$/);
  const list=line=>line.match(/^ {0,3}(\d+[.)]|[-+*])\s+(.+)$/);
  const rule=line=>/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
  function literal(text,index){
    const rest=text.slice(index),code=rest.match(/^(`+)/);
    if(code){const end=text.indexOf(code[1],index+code[1].length);if(end>=0)return {end:end+code[1].length,text:text.slice(index+code[1].length,end),code:true};}
    const opening=rest.startsWith('\\(')?'\\(':rest.startsWith('\\[')?'\\[':rest.startsWith('$$')?'$$':rest[0]==='$'&&text[index-1]!=='\\'?'$':'';
    if(!opening)return null;
    const closing=opening==='\\('? '\\)':opening==='\\['?'\\]':opening;
    const end=text.indexOf(closing,index+opening.length);
    return end<0?null:{end:end+closing.length,text:text.slice(index,end+closing.length)};
  }
  function safeURL(value){
    try{const url=new URL(value);return /^https?:$/.test(url.protocol)?url.href:'';}catch{return '';}
  }
  function endMarker(text,start,marker){
    for(let index=start;index<text.length;){
      const span=literal(text,index);if(span){index=span.end;continue;}
      if(text.startsWith(marker,index))return index;index++;
    }return -1;
  }
  function inline(parent,text,depth=0){
    const doc=parent.ownerDocument;let pending='';
    function flush(){if(pending){parent.append(doc.createTextNode(pending));pending='';}}
    if(depth>8){parent.append(doc.createTextNode(text));return;}
    for(let index=0;index<text.length;){
      const span=literal(text,index);
      if(span){flush();if(span.code){const code=doc.createElement('code');code.textContent=span.text;parent.append(code);}else parent.append(doc.createTextNode(span.text));index=span.end;continue;}
      const rest=text.slice(index),link=rest.match(/^(!?)\[([^\]\n]+)\]\(([^\s)]+)\)/);
      if(link){
        const url=!link[1]&&safeURL(link[3]);
        if(url){flush();const anchor=doc.createElement('a');anchor.textContent=link[2];anchor.href=url;anchor.target='_blank';anchor.rel='noopener noreferrer';parent.append(anchor);}
        else pending+=link[0];
        index+=link[0].length;continue;
      }
      const marker=rest.startsWith('**')?'**':rest.startsWith('__')?'__':rest[0]==='*'?'*':rest[0]==='_'?'_':'';
      if(marker&&!(marker[0]==='_'&&/\w/.test(text[index-1]||''))){
        const end=endMarker(text,index+marker.length,marker),body=text.slice(index+marker.length,end);
        if(end>index+marker.length&&body.trim()&&!(marker[0]==='_'&&/\w/.test(text[end+marker.length]||''))){flush();const element=doc.createElement(marker.length===2?'strong':'em');inline(element,body,depth+1);parent.append(element);index=end+marker.length;continue;}
      }
      pending+=text[index++];
    }
    flush();
  }
  function cells(line){
    const result=[];let cell='';
    for(let index=0;index<line.length;){
      const span=literal(line,index);
      if(span){cell+=line.slice(index,span.end);index=span.end;continue;}
      if(line[index]==='\\'&&line[index+1]==='|'){cell+='|';index+=2;continue;}
      if(line[index]==='|'){result.push(cell.trim());cell='';index++;continue;}
      cell+=line[index++];
    }
    result.push(cell.trim());if(!result[0])result.shift();if(!result.at(-1))result.pop();return result;
  }
  function tableAt(lines,index){
    if(!lines[index]?.includes('|')||!lines[index+1]?.includes('|'))return null;
    const headers=cells(lines[index]),separators=cells(lines[index+1]);
    return headers.length&&headers.length===separators.length&&separators.every(cell=>/^:?-{3,}:?$/.test(cell))?{headers,separators}:null;
  }
  function startsBlock(lines,index){
    const line=lines[index];
    return !line.trim()||fence(line)||heading(line)||list(line)||rule(line)||/^ {0,3}(?:>|\\\[|\$\$)/.test(line)||tableAt(lines,index);
  }
  function render(container,markdown,depth=0){
    const doc=container.ownerDocument,fragment=doc.createDocumentFragment(),lines=String(markdown??'').replace(/\r\n?/g,'\n').split('\n');
    if(depth>8){container.textContent=String(markdown??'');return;}
    function element(tag,text,parent=fragment){const node=doc.createElement(tag);if(text!=null)inline(node,text);parent.append(node);return node;}
    for(let index=0;index<lines.length;){
      const line=lines[index];if(!line.trim()){index++;continue;}
      const start=fence(line);
      if(start){
        const code=[];index++;
        while(index<lines.length){const end=lines[index].match(/^ {0,3}(`+|~+)\s*$/);if(end&&end[1][0]===start[1][0]&&end[1].length>=start[1].length){index++;break;}code.push(lines[index++]);}
        const wrapper=element('div');wrapper.className='li-preview-code';
        if(start[2].trim()){const label=element('span',null,wrapper);label.className='li-preview-language';label.textContent=start[2].trim();}
        element('code',null,element('pre',null,wrapper)).textContent=code.join('\n');continue;
      }
      const math=line.match(/^ {0,3}(\\\[|\$\$)/);
      if(math){
        const closing=math[1]==='\\['?'\\]':'$$',content=[line];index++;
        if(!line.slice(line.indexOf(math[1])+math[1].length).includes(closing))while(index<lines.length){const next=lines[index++];content.push(next);if(next.includes(closing))break;}
        const node=element('pre');node.className='li-preview-math';node.textContent=content.join('\n');continue;
      }
      const title=heading(line);if(title){element('h'+title[1].length,title[2]);index++;continue;}
      if(rule(line)){element('hr');index++;continue;}
      if(/^ {0,3}>/.test(line)){
        const content=[];while(index<lines.length&&/^ {0,3}>/.test(lines[index]))content.push(lines[index++].replace(/^ {0,3}> ?/,''));
        render(element('blockquote'),content.join('\n'),depth+1);continue;
      }
      const bullet=list(line);
      if(bullet){
        const ordered=/^\d/.test(bullet[1]),node=element(ordered?'ol':'ul');if(ordered)node.start=parseInt(bullet[1],10);
        while(index<lines.length){const item=list(lines[index]);if(!item||/^\d/.test(item[1])!==ordered)break;element('li',item[2],node);index++;}continue;
      }
      const table=tableAt(lines,index);
      if(table){
        const node=element('table'),header=element('tr',null,element('thead',null,node)),body=element('tbody',null,node);
        const align=table.separators.map(value=>value.endsWith(':')?value.startsWith(':')?'center':'right':'left');
        table.headers.forEach((value,column)=>{element('th',value,header).style.textAlign=align[column];});index+=2;
        while(index<lines.length&&lines[index].trim()&&lines[index].includes('|')){
          const row=element('tr',null,body),values=cells(lines[index++]);
          for(let column=0;column<Math.max(values.length,table.headers.length);column++)element('td',values[column]||'',row).style.textAlign=align[column]||'left';
        }continue;
      }
      const paragraph=[line];index++;
      while(index<lines.length&&!startsBlock(lines,index))paragraph.push(lines[index++]);
      element('p',paragraph.join('\n')).style.whiteSpace='pre-wrap';
    }
    container.replaceChildren(fragment);
  }
  return {render};
});
