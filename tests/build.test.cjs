/* Reproducible browser packages, inspected with an independent ZIP reader. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const yauzl=require('yauzl');
const load=()=>import('../scripts/build.mjs');
async function unzip(bytes){return new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true},(error,zip)=>{
  if(error)return reject(error);const files=new Map();zip.on('error',reject);zip.on('end',()=>resolve(files));
  zip.on('entry',entry=>zip.openReadStream(entry,(error,stream)=>{if(error)return reject(error);const chunks=[];stream.on('data',chunk=>chunks.push(chunk));stream.on('error',reject);stream.on('end',()=>{files.set(entry.fileName,{data:Buffer.concat(chunks),entry});zip.readEntry();});}));zip.readEntry();
}));}
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'latex-islands-build-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const {RUNTIME_FILES}=await load();
  const write=async(name,data='fixture\r\n')=>{await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),data);};
  for(const name of RUNTIME_FILES)await write(name);
  for(const name of ['icons/16.png','vendor/tikzjax/fonts/cmr10.woff2','vendor/tikzjax/tex_files/tikz.sty.gz'])await write(name,Buffer.from([0,255,1,2,13,10]));
  const manifest={manifest_version:3,name:'Fixture',version:'1.4.0',minimum_chrome_version:'116',permissions:['storage','offscreen'],background:{service_worker:'background.js'},action:{default_popup:'popup.html'},icons:{16:'icons/16.png'},content_scripts:[{js:['core.js','content.js'],css:['content.css']}],web_accessible_resources:[{resources:['island.html'],matches:['https://chatgpt.com/*']}]};
  await write('manifest.json',JSON.stringify(manifest));await write('package.json',JSON.stringify({name:'fixture',version:'1.4.0'}));
  await write('config/firefox.json',JSON.stringify({minimum_chrome_version:null,permissions:['storage'],background:{service_worker:null,scripts:['core.js','compiler.js','background-firefox.js']},browser_specific_settings:{gecko:{id:'fixture@example.test'}}}));
  for(const name of ['background-firefox.js','package-lock.json','package-extension.ps1','vendor/tikzjax/patch-runtime.py','vendor/tikzjax/upstream-source-v1.6.0.tar.gz','vendor/tikzjax/dvi2html-source-0.0.7-beta7.tar.gz','vendor/tikzjax/web2js-source-1.0.3.tar.gz','vendor/tikzjax/source/run-tex.js','scripts/build.mjs','tests/core.test.cjs'])await write(name);
  await write('VALIDATION.md','Public validation notes');await write('tests/performance-results.md','Historical public timings');
  await write('icons/brand.svg','<svg/>');await write('docs/store-assets/screenshot.png',Buffer.from([0,255,1]));await write('docs/store-assets/promo.html','<h1>Synthetic promo</h1>');
  await write('private-conversation.json','NEVER INCLUDE');await write('tests/session.har','NEVER INCLUDE');await write('node_modules/dependency/index.js','NEVER INCLUDE');await write('vendor/tikzjax/debug.map','NEVER INCLUDE');await write('vendor/tikzjax/tex_files/build-sources.tar.gz','NEVER INCLUDE');
  return {root,write};
}

test('manifest override removes null fields, merges objects and replaces arrays without mutating source',async()=>{
  const {mergeManifest}=await load();const base={permissions:['storage','offscreen'],background:{service_worker:'background.js'},icons:{16:'a.png',32:'b.png'}};
  const merged=mergeManifest(base,{permissions:['storage'],background:{service_worker:null,scripts:['background-firefox.js']},icons:{32:'new.png'}});
  assert.deepEqual(merged,{permissions:['storage'],background:{scripts:['background-firefox.js']},icons:{16:'a.png',32:'new.png'}});
  assert.equal(base.background.service_worker,'background.js');assert.throws(()=>mergeManifest(base,JSON.parse('{"__proto__":{}}')),/Unsafe/);
});

test('ZIP has deterministic ordering, fixed timestamps, valid CRC and safe names',async()=>{
  const {createZip,crc32}=await load();assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
  const a={name:'a.txt',data:Buffer.from('first')},b={name:'b.txt',data:Buffer.from('second')};
  const zip=createZip([b,a]);assert.deepEqual(zip,createZip([a,b]));const files=await unzip(zip);
  assert.deepEqual([...files.keys()],['a.txt','b.txt']);assert.equal(files.get('a.txt').data.toString(),'first');
  assert.equal(files.get('a.txt').entry.lastModFileDate,33);assert.equal(files.get('a.txt').entry.lastModFileTime,0);
  for(const name of ['../outside','/absolute','C:/outside','folder\\file'])assert.throws(()=>createZip([{name,data:Buffer.alloc(0)}]),/Unsafe/);
  assert.throws(()=>createZip([a,a]),/Duplicate/);
});

test('browser ZIPs have manifest at root, complete runtime assets and no test/private/source baggage',async t=>{
  const {root}=await fixture(t),{build}=await load();const reports=await build({rootDir:root});assert.equal(reports.length,3);
  const chrome=await unzip(await fs.readFile(path.join(root,'dist/latex-islands-chrome-1.4.0.zip'))),firefox=await unzip(await fs.readFile(path.join(root,'dist/latex-islands-firefox-1.4.0.zip')));
  for(const files of [chrome,firefox]){
    for(const name of ['manifest.json','vendor/tikzjax/core.dump.gz','vendor/tikzjax/tex.wasm.gz','vendor/tikzjax/fonts/cmr10.woff2','vendor/tikzjax/tex_files/tikz.sty.gz','THIRD_PARTY_NOTICES.md','docs/runtime-dependency-licenses.md','docs/licenses/LPPL-1.3c.txt'])assert.ok(files.has(name),name);
    assert.ok([...files.keys()].every(name=>!/^latex-islands\/|^tests\/|^node_modules\/|^scripts\/|^config\/|\.tar\.gz$|\.map$|\.har$|private|VALIDATION/.test(name)));
    assert.equal(files.get('core.js').data.toString(),'fixture\n');
    assert.deepEqual(files.get('icons/16.png').data,Buffer.from([0,255,1,2,13,10]));
  }
  const cm=JSON.parse(chrome.get('manifest.json').data),fm=JSON.parse(firefox.get('manifest.json').data);
  assert.equal(cm.background.service_worker,'background.js');assert.ok(chrome.has('offscreen.html'));
  assert.equal(fm.background.service_worker,undefined);assert.equal(fm.minimum_chrome_version,undefined);
  assert.ok(firefox.has('background-firefox.js'));assert.equal(firefox.has('offscreen.html'),false);assert.equal(firefox.has('background.js'),false);
  assert.ok(fm.background.scripts.every(name=>firefox.has(name)));
  const sources=await unzip(await fs.readFile(path.join(root,'dist/latex-islands-source-1.4.0.zip')));
  for(const name of ['vendor/tikzjax/upstream-source-v1.6.0.tar.gz','vendor/tikzjax/patch-runtime.py','vendor/tikzjax/source/run-tex.js','config/firefox.json','package-lock.json','scripts/build.mjs','tests/core.test.cjs','VALIDATION.md','tests/performance-results.md','icons/brand.svg','docs/store-assets/screenshot.png','docs/store-assets/promo.html'])assert.ok(sources.has(name),name);
  for(const name of ['icons/brand.svg','docs/store-assets/screenshot.png','docs/store-assets/promo.html'])assert.equal(chrome.has(name),false);
  assert.equal(sources.has('private-conversation.json'),false);assert.equal(sources.has('tests/session.har'),false);
});

test('repeat builds ignore mtimes and line endings and replace only generated browser folders',async t=>{
  const {root,write}=await fixture(t),{build}=await load();const before=await build({rootDir:root});
  await write('dist/chrome/stale.txt','stale');await write('dist/keep.txt','leave me');await write('core.js','fixture\n');
  await fs.utimes(path.join(root,'core.js'),new Date(),new Date());const after=await build({rootDir:root});
  assert.deepEqual(after.map(item=>item.sha256),before.map(item=>item.sha256));
  await assert.rejects(fs.access(path.join(root,'dist/chrome/stale.txt')));assert.equal(await fs.readFile(path.join(root,'dist/keep.txt'),'utf8'),'leave me');
});

test('build fails before writing on version mismatch or missing Firefox configuration',async t=>{
  const {root,write}=await fixture(t),{build}=await load();await write('package.json',JSON.stringify({version:'9.0.0'}));
  await assert.rejects(build({rootDir:root}),/versions must match/);await assert.rejects(fs.access(path.join(root,'dist')));
  await write('package.json',JSON.stringify({version:'1.4.0'}));await fs.unlink(path.join(root,'config/firefox.json'));
  await assert.rejects(build({rootDir:root}),/ENOENT/);await assert.rejects(build({rootDir:root,outputDir:root}),/child directory/);
});
