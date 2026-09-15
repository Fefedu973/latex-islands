const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.wasm':'application/wasm','.gz':'application/octet-stream','.json':'application/json'};
// Test-only Chrome APIs, scoped to synthetic preview data. Production files stay intact.
const popupPreviewShim=`<base href="/">
<script>
(() => {
  const key='latex-islands-popup-preview-v1';
  const defaults={enabled:true,autoRender:true,scale:1,uiTheme:'chatgpt',renderColors:'chatgpt',chatgptTheme:{theme:'dark',colors:{text:'#ececec',background:'#171717',surface:'#212121',border:'#383838'}}};
  const listeners=new Set();
  function read(){try{return {...defaults,...JSON.parse(localStorage.getItem(key)||'{}')};}catch{return {...defaults};}}
  function emit(before,after){const changes={};for(const item of new Set([...Object.keys(before),...Object.keys(after)])){if(JSON.stringify(before[item])!==JSON.stringify(after[item]))changes[item]={oldValue:before[item],newValue:after[item]};}if(Object.keys(changes).length)for(const listener of listeners)listener(changes,'local');}
  const local={
    get(request,callback){const saved=read();let result;if(typeof request==='string')result={[request]:saved[request]};else if(Array.isArray(request))result=Object.fromEntries(request.map(item=>[item,saved[item]]));else result=request?{...request,...saved}:saved;if(callback)callback(result);return Promise.resolve(result);},
    set(values,callback){const before=read(),after={...before,...values};localStorage.setItem(key,JSON.stringify(after));emit(before,after);callback?.();return Promise.resolve();}
  };
  window.chrome={...window.chrome,storage:{local,onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}},runtime:{getURL:file=>new URL(file,location.origin+'/').href},tabs:{create:({url})=>window.open(url,'_blank','noopener')}};
  window.addEventListener('storage',event=>{if(event.key===key){try{emit({...defaults,...JSON.parse(event.oldValue||'{}')},{...defaults,...JSON.parse(event.newValue||'{}')});}catch{}}});
})();
</script>`;
http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname==='/'){res.writeHead(302,{Location:'/tests/browser-preview.html'});res.end();return;}
  if(pathname==='/tests/popup-preview.html'){
    fs.readFile(path.join(root,'popup.html'),'utf8',(error,html)=>{if(error){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':types['.html'],'Cache-Control':'no-store'});res.end(html.replace('<head>','<head>\n'+popupPreviewShim));});return;
  }
  const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});}).listen(8765,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:8765/tests/browser-preview.html'));
