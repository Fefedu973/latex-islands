const samples={circuit:String.raw`\begin{circuitikz}[american]
\draw (0,0) to[V,l=$E$] (0,3) to[R,l=$R$] (4,3) to[C,l=$C$,v=$u_C$] (4,0) -- (0,0);
\end{circuitikz}`,plot:String.raw`\begin{tikzpicture}
\begin{axis}[width=12cm,height=7cm,axis lines=middle,xlabel={$x$},ylabel={$y$},domain=-6:6,samples=80,grid=major]
\addplot[blue,thick]{sin(deg(x))};
\addplot[red,thick,dashed]{cos(deg(x))};
\end{axis}
\end{tikzpicture}`,flow:String.raw`\begin{tikzpicture}[node distance=16mm,>=Stealth]
\node[draw,rounded corners,minimum width=26mm,minimum height=9mm] (a) {Départ};
\node[draw,diamond,below=of a,aspect=2] (b) {$n>1$ ?};
\node[draw,rounded corners,below left=of b] (c) {Continuer};
\node[draw,rounded corners,below right=of b] (d) {Fin};
\draw[->] (a)--(b);
\draw[->] (b)--node[left]{oui}(c);
\draw[->] (b)--node[right]{non}(d);
\end{tikzpicture}`};
const el=id=>document.getElementById(id);
window.chrome={runtime:{getURL:file=>new URL('../'+file,location.href).href},storage:{local:{get:(defaults,callback)=>callback(defaults)},onChanged:{addListener(){}}}};
el('code').textContent=samples.circuit;
el('theme').onclick=()=>{const dark=document.documentElement.classList.toggle('dark');document.documentElement.classList.toggle('light',!dark);el('theme').textContent=dark?'Thème clair':'Thème sombre';};
el('sample').onchange=()=>{el('code').textContent=samples[el('sample').value];};
el('stream').onclick=()=>{
 el('stream').disabled=true;el('assistant').setAttribute('data-is-streaming','true');el('code').textContent='';
 const source=samples[el('sample').value];let n=0;const start=performance.now();
 const timer=setInterval(()=>{n+=12;el('code').textContent=source.slice(0,n);el('qa-status').textContent='Bloc en cours de réception…';
 if(n>=source.length){clearInterval(timer);const following=document.createElement('p');el('diagram').parentElement.append(following);let word=0;
 const tail=setInterval(()=>{following.textContent+=' La réponse continue.';word++;el('qa-status').textContent='Bloc terminé, réponse encore en streaming ('+Math.round(performance.now()-start)+' ms).';
 if(word===12){clearInterval(tail);el('assistant').removeAttribute('data-is-streaming');el('stream').disabled=false;el('qa-status').textContent='Réponse terminée. Le rendu doit être apparu avant cette étape.';setTimeout(()=>following.remove(),4000);}},350);}
 },70);
};
window.addEventListener('message',event=>{if(event.origin===location.origin && event.data?.channel==='latex-islands' && event.data.type==='result')el('qa-status').textContent='Résultat reçu · réponse '+(el('assistant').hasAttribute('data-is-streaming')?'encore en streaming':'terminée');});
