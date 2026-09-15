'use strict';
history.replaceState({},'','/c/01234567-89ab-4cde-8f01-23456789abcd');
document.getElementById('theme').onclick=()=>document.documentElement.classList.toggle('dark');
window.chrome={storage:{local:{get:async defaults=>({...defaults,...JSON.parse(localStorage.getItem('export-qa')||'{}')}),set:async value=>localStorage.setItem('export-qa',JSON.stringify(value))}}};
const qaMessages=[
 {id:'q1',author:{role:'user'},content:{content_type:'text',parts:['Comment fonctionne un circuit RC ?']}},
 {id:'a1',author:{role:'assistant'},channel:'final',content:{content_type:'text',parts:['Le condensateur se charge progressivement à travers la résistance.\n\nLa constante de temps est \\(\\tau = RC\\).\n\nAprès une durée τ, la tension atteint environ 63 % de sa valeur finale.\n\n```python\nfrom math import exp\nu = 5 * (1 - exp(-t / (R * C)))\n```']}},
 {id:'progress',author:{role:'assistant'},channel:'commentary',content:{content_type:'text',parts:['Je prépare un exemple numérique.']}},
 {id:'q2',author:{role:'user'},content:{content_type:'text',parts:['Et avec R = 10 kΩ et C = 100 μF ?']}},
 {id:'a2',author:{role:'assistant'},channel:'final',content:{content_type:'text',parts:['La constante de temps vaut 1 seconde.\n\nÀ 1 s : environ 3,16 V.\nÀ 5 s : environ 4,97 V.\n\nLe condensateur est alors presque entièrement chargé.']}},
];
window.addEventListener('message',event=>{const request=event.data;if(event.source!==window||request?.channel!=='latex-islands-conversation-export-v1'||request.type!=='request')return;window.postMessage({channel:request.channel,type:'response',requestId:request.requestId,ok:true,payload:{title:'Comprendre un circuit RC',messages:qaMessages,page_info:{has_previous_page:false,has_next_page:false}}},location.origin);});
