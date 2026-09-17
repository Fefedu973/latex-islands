/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME_FILES = [
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'manifest.json',
  'docs/runtime-dependency-licenses.md', 'docs/licenses/LPPL-1.3c.txt', 'docs/licenses/Apache-2.0.txt',
  'background.js', 'compiler.js', 'content.css', 'content.js',
  'conversation-bridge.js', 'conversation-export.js', 'core.js',
  'demo.html', 'demo.js', 'examples.js', 'export-core.js', 'export-preview-renderer.js',
  'island.css', 'island.html', 'island.js', 'native-controls.js', 'offscreen.html', 'offscreen.js',
  'popup.html', 'popup.js', 'ui.css',
  'vendor/tikzjax/core.dump.gz', 'vendor/tikzjax/tex.wasm.gz',
  'vendor/tikzjax/run-tex.js', 'vendor/tikzjax/fonts.css',
  'vendor/tikzjax/LICENSE', 'vendor/tikzjax/FONTS-LICENSE.txt',
  'vendor/tikzjax/NOTICE.md', 'vendor/tikzjax/run-tex.js.LICENSE.txt'
];
const SOURCE_FILES = [
  'package.json', 'package-lock.json', 'package-extension.ps1', '.gitignore', '.gitattributes',
  'README.md', 'CONTRIBUTING.md', 'PRIVACY.md', 'SECURITY.md', 'USER-GUIDE.md', 'EXPORT.md',
  'VALIDATION.md', 'tests/performance-results.md', 'icons/brand.svg',
  'vendor/tikzjax/patch-runtime.py',
  'vendor/tikzjax/upstream-source-v1.6.0.tar.gz',
  'vendor/tikzjax/dvi2html-source-0.0.7-beta7.tar.gz',
  'vendor/tikzjax/web2js-source-1.0.3.tar.gz'
];
const TEXT_FILE = /\.(?:[cm]?js|html|css|json|md|txt|ps1|py|ya?ml|svg)$|(?:^|\/)(?:LICENSE|\.gitignore|\.gitattributes)$/i;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function safeName(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..') || /^[a-z]:/i.test(name)) throw Error('Unsafe archive path: '+name);
  return name;
}
async function readEntry(root, name) {
  safeName(name);
  const target = path.join(root, name);
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Expected regular source file: '+name);
  let data = await fs.readFile(target);
  if (TEXT_FILE.test(name)) data = Buffer.from(data.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
  return {name, data};
}
async function listFiles(root, directory, accept, optional=false) {
  let entries;
  try {entries = await fs.readdir(path.join(root,directory), {withFileTypes:true});}
  catch(error) {if (optional && error.code === 'ENOENT') return []; throw error;}
  const result = [];
  for (const entry of entries) {
    const name = directory+'/'+entry.name;
    if (entry.isSymbolicLink()) throw Error('Symlink not permitted in a build: '+name);
    if (entry.isDirectory()) result.push(...await listFiles(root,name,accept));
    else if (entry.isFile() && accept(name)) result.push(name);
  }
  return result.sort(compare);
}
export function mergeManifest(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) throw Error('Firefox manifest override must be an object.');
  const merged = structuredClone(base);
  for (const [key,value] of Object.entries(override)) {
    if (['__proto__','constructor','prototype'].includes(key)) throw Error('Unsafe manifest key: '+key);
    if (value === null) delete merged[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) merged[key] = mergeManifest(merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key]) ? merged[key] : {}, value);
    else merged[key] = structuredClone(value);
  }
  return merged;
}
function manifestAssets(manifest) {
  return [
    manifest.background?.service_worker, ...(manifest.background?.scripts || []),
    manifest.background?.page, manifest.action?.default_popup,
    ...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap(script => [...(script.js || []), ...(script.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap(group => group.resources || [])
  ].filter(Boolean).map(safeName);
}
export async function collectRuntime(root, manifest, browser) {
  const files = new Set(RUNTIME_FILES);
  if (browser === 'firefox') for (const file of ['background.js','offscreen.html','offscreen.js']) files.delete(file);
  for (const file of manifestAssets(manifest)) files.add(file);
  for (const [directory,expression] of [['icons',/\.png$/],['vendor/tikzjax/fonts',/\.woff2$/],['vendor/tikzjax/tex_files',/\.gz$/]]) {
    const names = await listFiles(root, directory, name => expression.test(name) && !/\.tar\.gz$/i.test(name));
    if (!names.length) throw Error('Missing runtime assets in '+directory);
    for (const name of names) files.add(name);
  }
  const entries = [];
  for (const name of [...files].sort(compare)) entries.push(name === 'manifest.json' ? {name,data:Buffer.from(JSON.stringify(manifest,null,2)+'\n')} : await readEntry(root,name));
  return entries;
}
const crcTable = Uint32Array.from({length:256},(_,n) => {let c=n;for(let bit=0;bit<8;bit++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(data) {let crc=0xffffffff;for(const byte of data)crc=crcTable[(crc^byte)&0xff]^(crc>>>8);return (crc^0xffffffff)>>>0;}
// Fixed 1980-01-01 UTC timestamps, sorted UTF-8 paths, no platform metadata or extra fields.
export function createZip(input) {
  const entries = [...input].sort((a,b)=>compare(a.name,b.name)), names = new Set(), bodies = [], central = [];
  let offset = 0;
  if (entries.length > 65535) throw Error('ZIP64 is not supported.');
  for (const entry of entries) {
    safeName(entry.name);
    if (names.has(entry.name)) throw Error('Duplicate archive path: '+entry.name);
    names.add(entry.name);
    const name = Buffer.from(entry.name), data = Buffer.from(entry.data), compressed = deflateRawSync(data,{level:9});
    if (Math.max(data.length,compressed.length,offset) > 0xffffffff || name.length > 65535) throw Error('ZIP64 is not supported.');
    const crc = crc32(data), header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);
    header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    bodies.push(header,name,compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(0x0314,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x0800,8);directory.writeUInt16LE(8,10);directory.writeUInt16LE(33,14);
    directory.writeUInt32LE(crc,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);
    directory.writeUInt32LE(0x81a40000,38);directory.writeUInt32LE(offset,42);central.push(directory,name);
    offset += header.length+name.length+compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...bodies,directory,end]);
}
async function writeArtifact(output, filename, entries) {
  const bytes = createZip(entries), target = path.join(output,filename);
  await fs.writeFile(target, bytes);
  return {file:filename,files:entries.length,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
async function sourceEntries(root, runtime) {
  const files = new Set(runtime.map(entry=>entry.name));
  for (const name of SOURCE_FILES) {try {await fs.access(path.join(root,name));files.add(name);} catch(error) {if(error.code!=='ENOENT' || name.startsWith('vendor/') || name.startsWith('package'))throw error;}}
  for (const [directory,accept] of [
    ['scripts',/\.(?:[cm]?js|ps1)$/],['config',/\.json$/],['docs',/\.(?:md|txt)$/],['docs/store-assets',/\.(?:png|html)$/],
    ['tests',/\.(?:[cm]?js|html)$/],['vendor/tikzjax/source',/\.js$/],['.github/workflows',/\.ya?ml$/]
  ]) for (const name of await listFiles(root,directory,name=>accept.test(name),true)) files.add(name);
  // Use the unmodified Chrome manifest with the Firefox override and build tooling alongside it.
  return Promise.all([...files].sort(compare).map(name=>readEntry(root,name)));
}
export async function build({rootDir=ROOT,outputDir=path.join(rootDir,'dist')}={}) {
  const root = path.resolve(rootDir), output = path.resolve(outputDir);
  if (output === root || !output.startsWith(root+path.sep)) throw Error('Build output must be a child directory of the project.');
  const manifest = JSON.parse((await fs.readFile(path.join(root,'manifest.json'),'utf8')).replace(/^\uFEFF/,''));
  const pkg = JSON.parse((await fs.readFile(path.join(root,'package.json'),'utf8')).replace(/^\uFEFF/,''));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.version !== pkg.version) throw Error('Manifest and package versions must match.');
  const override = JSON.parse((await fs.readFile(path.join(root,'config/firefox.json'),'utf8')).replace(/^\uFEFF/,''));
  const firefox = mergeManifest(manifest, override);
  if (firefox.version !== manifest.version) throw Error('Browser versions must match.');
  const chromeEntries = await collectRuntime(root,manifest,'chrome'), firefoxEntries = await collectRuntime(root,firefox,'firefox');
  const sources = await sourceEntries(root,[...chromeEntries,...firefoxEntries]);
  await fs.mkdir(output,{recursive:true});
  // Only replace generated unpacked outputs after validating the absolute directory boundaries.
  for (const [browser,entries] of [['chrome',chromeEntries],['firefox',firefoxEntries]]) {
    const destination = path.resolve(output,browser);
    if (!destination.startsWith(output+path.sep)) throw Error('Unsafe unpacked output directory.');
    await fs.rm(destination,{recursive:true,force:true});await fs.mkdir(destination,{recursive:true});
    for (const {name,data} of entries) {const filename=path.join(destination,name);await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,data);}
  }
  const artifacts=[];
  for (const [target,entries] of [['chrome',chromeEntries],['firefox',firefoxEntries],['source',sources]]) artifacts.push(await writeArtifact(output,`latex-islands-${target}-${manifest.version}.zip`,entries));
  await fs.writeFile(path.join(output,'SHA256SUMS'),artifacts.map(item=>`${item.sha256}  ${item.file}`).join('\n')+'\n');
  return artifacts;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  build().then(artifacts=>{for(const artifact of artifacts)console.log(`${artifact.file}: ${artifact.files} files, ${artifact.bytes} bytes, SHA-256 ${artifact.sha256}`);}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
