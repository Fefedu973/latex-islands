/* SPDX-License-Identifier: GPL-3.0-or-later */
// Offline extraction only: never fetch or execute upstream package code.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import yauzl from 'yauzl';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archiveDir = path.join(root, 'vendor/tikzjax/extra-tex-source');
const outputDir = path.join(root, 'vendor/tikzjax/tex_files');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = process.argv.includes('--write');
if (process.argv.slice(2).some(arg => arg !== '--write' && arg !== '--check')) throw Error('Usage: node scripts/vendor-tex-packages.mjs [--check | --write]');
if (write && process.argv.includes('--check')) throw Error('Choose --check or --write, not both.');

function extractSelected(bytes, required) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, {lazyEntries:true, validateEntrySizes:true}, (error, archive) => {
      if (error) return reject(error);
      const found = new Map();
      const fail = error => {archive.close();reject(error);};
      archive.on('error', fail);
      archive.on('end', () => {
        const missing = [...required].filter(name => !found.has(name));
        if (missing.length) reject(Error('Missing archived source: '+missing.join(', ')));
        else resolve(found);
      });
      archive.on('entry', entry => {
        if (!required.has(entry.fileName)) return archive.readEntry();
        if (found.has(entry.fileName) || entry.uncompressedSize > 2_000_000) return fail(Error('Invalid source entry: '+entry.fileName));
        archive.openReadStream(entry, (error, stream) => {
          if (error) return fail(error);
          const chunks = [];
          stream.on('error', fail);
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {found.set(entry.fileName,Buffer.concat(chunks));archive.readEntry();});
        });
      });
      archive.readEntry();
    });
  });
}

const manifest = JSON.parse(await fs.readFile(path.join(archiveDir, 'manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 1) throw Error('Unsupported package manifest.');
const outputs = new Set();
const pending = [];
function prepareOutput(item, bytes) {
  if (!/^[A-Za-z0-9._-]+\.(?:sty|tex|fd|tfm|trsl)\.gz$/.test(item.file) || outputs.has(item.file)) throw Error('Invalid or duplicate output: '+item.file);
  outputs.add(item.file);
  if (hash(bytes) !== item.sha256) throw Error('Source SHA-256 mismatch: '+(item.entry || item.source));
  const compressed = gzipSync(bytes, {level:9});
  compressed[9] = 255; // RFC 1952 unknown OS: identical header on every platform.
  if (hash(compressed) !== item.gzipSha256) throw Error('Generated gzip SHA-256 mismatch: '+item.file);
  pending.push({file:item.file,bytes:compressed});
}
for (const source of manifest.archives) {
  if (!/^[A-Za-z0-9._-]+\.zip$/.test(source.file)) throw Error('Invalid archive name.');
  const archive = await fs.readFile(path.join(archiveDir, source.file));
  if (hash(archive) !== source.sha256) throw Error('Archive SHA-256 mismatch: '+source.file);
  const files = await extractSelected(archive, new Set([...source.outputs, ...(source.sourceChecks || [])].map(item => item.entry)));
  for (const item of source.sourceChecks || []) {
    if (hash(files.get(item.entry)) !== item.sha256) throw Error('Archived upstream source SHA-256 mismatch: '+item.entry);
  }
  for (const item of source.outputs) {
    prepareOutput(item, files.get(item.entry));
  }
}
for (const item of manifest.localSources || []) {
  if (!/^[A-Za-z0-9._-]+\.sty$/.test(item.source)) throw Error('Invalid local source name.');
  // Text is normalized exactly as in release source ZIPs and Git checkout.
  const bytes = Buffer.from((await fs.readFile(path.join(archiveDir,item.source),'utf8')).replace(/\r\n/g,'\n'));
  prepareOutput(item, bytes);
}
// Validate all archives and outputs before replacing any generated asset.
for (const item of pending) {
  const filename = path.join(outputDir, item.file);
  if (write) await fs.writeFile(filename, item.bytes);
  else if (!(await fs.readFile(filename)).equals(item.bytes)) throw Error('Bundled asset differs from pinned source: '+item.file);
}
console.log(`${write ? 'Reproduced' : 'Verified'} ${pending.length} TeX assets from ${manifest.archives.length} pinned source archives and ${(manifest.localSources || []).length} local adapters (offline).`);
