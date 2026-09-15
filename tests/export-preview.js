'use strict';
history.replaceState({},'','/c/01234567-89ab-4cde-8f01-23456789abcd');
document.getElementById('theme').onclick=()=>document.documentElement.classList.toggle('dark');
window.chrome={storage:{local:{get:async defaults=>({...defaults,...JSON.parse(localStorage.getItem('export-qa')||'{}')}),set:async value=>localStorage.setItem('export-qa',JSON.stringify(value))}}};
const qaMessages=[
 {id:'q1',author:{role:'user'},content:{content_type:'text',parts:['How does an RC circuit work?']}},
 {id:'a1',author:{role:'assistant'},channel:'final',content:{content_type:'text',parts:['The capacitor charges gradually through the resistor.\n\nThe time constant is \\(\\tau = RC\\).\n\nAfter one time constant τ, the voltage reaches about 63% of its final value.\n\n```python\nfrom math import exp\nu = 5 * (1 - exp(-t / (R * C)))\n```']}},
 {id:'progress',author:{role:'assistant'},channel:'commentary',content:{content_type:'text',parts:['Let me work through a numerical example.']}},
 {id:'q2',author:{role:'user'},content:{content_type:'text',parts:['What if R = 10 kΩ and C = 100 μF?']}},
 {id:'a2',author:{role:'assistant'},channel:'final',content:{content_type:'text',parts:['The time constant is 1 second.\n\nAt 1 s: about 3.16 V.\nAt 5 s: about 4.97 V.\n\nThe capacitor is then almost fully charged.']}},
];
window.addEventListener('message',event=>{const request=event.data;if(event.source!==window||request?.channel!=='latex-islands-conversation-export-v1'||request.type!=='request')return;window.postMessage({channel:request.channel,type:'response',requestId:request.requestId,ok:true,payload:{title:'Understanding an RC circuit',messages:qaMessages,page_info:{has_previous_page:false,has_next_page:false}}},location.origin);});
