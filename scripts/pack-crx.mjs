/* SPDX-License-Identifier: GPL-3.0-or-later
 * Run after npm run build: node scripts/pack-crx.mjs [absolute-private-key.pem]
 * CHROME_BINARY overrides Chrome discovery. The persistent signing key stays
 * outside this repository; it must be retained to keep the same extension ID.
 * CRX3 format: https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/crx3.proto
 * Signature algorithm follows Chromium's crx_creator.cc / crx_verifier.cc.
 */
import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {constants,createHash,createPublicKey,generateKeyPairSync,verify} from 'node:crypto';
import yauzl from 'yauzl';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=data=>createHash('sha256').update(data).digest('hex');
const inside=(parent,target)=>{const relative=path.relative(parent,target);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
async function exists(filename){try{await fs.access(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function fields(buffer){
  let offset=0;const result=new Map();
  const varint=()=>{let value=0,multiplier=1;for(let index=0;index<8;index++){if(offset>=buffer.length)throw Error('Truncated CRX3 protobuf.');const byte=buffer[offset++];value+=(byte&127)*multiplier;if(!Number.isSafeInteger(value))throw Error('Invalid CRX3 protobuf integer.');if(!(byte&128))return value;multiplier*=128;}throw Error('Invalid CRX3 protobuf integer.');};
  while(offset<buffer.length){
    const tag=varint(),number=Math.floor(tag/8),wire=tag%8;if(!number)throw Error('Invalid CRX3 protobuf field.');
    if(wire===2){const length=varint();if(offset+length>buffer.length)throw Error('Truncated CRX3 protobuf field.');const value=buffer.subarray(offset,offset+length);offset+=length;const values=result.get(number)||[];values.push(value);result.set(number,values);}
    else if(wire===0)varint();else if(wire===1)offset+=8;else if(wire===5)offset+=4;else throw Error('Unsupported CRX3 protobuf field.');
    if(offset>buffer.length)throw Error('Truncated CRX3 protobuf field.');
  }
  return result;
}
function one(map,key){const values=map.get(key);if(values?.length!==1)throw Error('Missing or repeated CRX3 field '+key);return values[0];}
export function verifySignature(crx){
  if(crx.length<12||crx.toString('ascii',0,4)!=='Cr24'||crx.readUInt32LE(4)!==3)throw Error('Expected a CRX3 package.');
  const length=crx.readUInt32LE(8);if(!length||length>1024*1024||12+length>=crx.length)throw Error('Invalid CRX3 header size.');
  const header=fields(crx.subarray(12,12+length)),signed=one(header,10000),id=one(fields(signed),1),archive=crx.subarray(12+length);
  if(id.length!==16||archive.readUInt32LE(0)!==0x04034b50)throw Error('Invalid CRX3 ID or ZIP payload.');
  const size=Buffer.alloc(4);size.writeUInt32LE(signed.length);
  const message=Buffer.concat([Buffer.from('CRX3 SignedData\0'),size,signed,archive]);
  let developerProof=false,proofs=0;
  for(const [field,algorithm] of [[2,'rsa'],[3,'ec']])for(const proofBytes of header.get(field)||[]){
    const proof=fields(proofBytes),publicBytes=one(proof,1),signature=one(proof,2);
    const key=createPublicKey({key:publicBytes,format:'der',type:'spki'});
    if(key.asymmetricKeyType!==algorithm||!verify('sha256',message,algorithm==='rsa'?{key,padding:constants.RSA_PKCS1_PADDING}:key,signature))throw Error('CRX3 cryptographic signature verification failed.');
    if(createHash('sha256').update(publicBytes).digest().subarray(0,16).equals(id))developerProof=true;
    proofs++;
  }
  if(!proofs||!developerProof)throw Error('CRX3 developer signature is missing.');
  const extensionId=[...id.toString('hex')].map(character=>String.fromCharCode(97+parseInt(character,16))).join('');
  return {extensionId,archive,proofs};
}
async function filesUnder(directory,prefix=''){
  const result=new Map();
  for(const item of await fs.readdir(directory,{withFileTypes:true})){
    const filename=path.join(directory,item.name),name=prefix+item.name;
    if(item.isSymbolicLink())throw Error('Symlinks are not allowed in the Chrome package.');
    if(item.isDirectory())for(const [child,digest]of await filesUnder(filename,name+'/'))result.set(child,digest);
    else if(item.isFile()){
      if(/\.(?:pem|key|p12|pfx)$/i.test(name))throw Error('Private-key file found in the package directory.');
      result.set(name,hash(await fs.readFile(filename)));
    }else throw Error('Non-regular file found in the Chrome package.');
  }
  return result;
}
export async function verifyPayload(archive,expected,version){
  const remaining=new Map(expected);let fileCount=0,manifestSeen=false;
  await new Promise((resolve,reject)=>{
    yauzl.fromBuffer(archive,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
      if(error){reject(error);return;}
      const fail=error=>{zip.close();reject(error);};zip.on('error',fail);
      zip.on('entry',entry=>{
        if(entry.fileName.endsWith('/')){zip.readEntry();return;}
        if(!remaining.has(entry.fileName)){fail(Error('Unexpected or duplicate CRX file: '+entry.fileName));return;}
        zip.openReadStream(entry,(error,stream)=>{
          if(error){fail(error);return;}
          const chunks=[];stream.on('data',chunk=>chunks.push(chunk));stream.on('error',fail);
          stream.on('end',()=>{
            try{
              const bytes=Buffer.concat(chunks);if(hash(bytes)!==remaining.get(entry.fileName))throw Error('CRX content differs from dist/chrome: '+entry.fileName);
              if(entry.fileName==='manifest.json'){if(JSON.parse(bytes.toString('utf8')).version!==version)throw Error('CRX manifest version mismatch.');manifestSeen=true;}
              remaining.delete(entry.fileName);fileCount++;zip.readEntry();
            }catch(error){fail(error);}
          });
        });
      });
      zip.on('end',()=>{if(remaining.size||!manifestSeen)reject(Error('CRX ZIP is missing release files.'));else resolve();});zip.readEntry();
    });
  });
  return fileCount;
}
async function runChrome(binary,args){
  await new Promise((resolve,reject)=>{
    const process=spawn(binary,args,{windowsHide:true,stdio:'ignore'});
    const timeout=setTimeout(()=>{process.kill();reject(Error('Chrome packaging timed out.'));},45000);
    process.once('error',error=>{clearTimeout(timeout);reject(error);});
    process.once('exit',code=>{clearTimeout(timeout);if(code===0)resolve();else reject(Error('Chrome packaging failed with exit code '+code));});
  });
}
export async function pack(keyArgument){
  const repo=await fs.realpath(ROOT),dist=path.join(repo,'dist'),source=path.join(dist,'chrome');
  if(await fs.realpath(source)!==source)throw Error('dist/chrome must not be a symlink.');
  const base=JSON.parse(await fs.readFile(path.join(repo,'manifest.json'),'utf8')),manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
  if(manifest.version!==base.version||!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version))throw Error('Run npm run build for the current version before packaging.');
  const target=path.join(dist,'latex-islands-chrome-'+manifest.version+'.crx'),intermediate=path.join(dist,'chrome.crx');
  if(await exists(target)||await exists(intermediate))throw Error('CRX output already exists; refusing to overwrite a release package.');
  const expected=await filesUnder(source);
  const dataRoot=process.env.LOCALAPPDATA||(process.platform==='darwin'?path.join(os.homedir(),'Library/Application Support'):path.join(os.homedir(),'.local/share'));
  const key=path.resolve(keyArgument||path.join(dataRoot,'LaTeX Islands/signing/chrome.pem'));
  if(inside(repo,key))throw Error('The signing key must be outside the repository.');
  await fs.mkdir(path.dirname(key),{recursive:true,mode:0o700});
  if(inside(repo,await fs.realpath(path.dirname(key))))throw Error('The signing directory resolves inside the repository.');
  let keyCreated=false;
  if(!await exists(key)){
    const pair=generateKeyPairSync('rsa',{modulusLength:2048});
    // Private material is written only here; never printed, archived or read back.
    await fs.writeFile(key,pair.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});keyCreated=true;
  }
  const keyStat=await fs.lstat(key);if(!keyStat.isFile()||keyStat.isSymbolicLink()||!keyStat.size)throw Error('Expected a regular private-key file outside the repository.');
  const binary=process.env.CHROME_BINARY||(process.platform==='win32'?path.join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'):process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome');
  if(!await exists(binary))throw Error('Chrome not found. Set CHROME_BINARY to the installed executable.');
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'latex-islands-crx-profile-'));
  try{
    await runChrome(binary,['--headless=new','--no-first-run','--no-default-browser-check','--no-message-box','--user-data-dir='+temporary,'--pack-extension='+source,'--pack-extension-key='+key]);
    const crx=await fs.readFile(intermediate),signature=verifySignature(crx),fileCount=await verifyPayload(signature.archive,expected,manifest.version);
    const current=await filesUnder(source);if(current.size!==expected.size||[...expected].some(([name,digest])=>current.get(name)!==digest))throw Error('dist/chrome changed during packaging.');
    await fs.copyFile(intermediate,target,fsConstants.COPYFILE_EXCL);
    return {file:target,version:manifest.version,extensionId:signature.extensionId,signature:'CRX3 signature verified',fileCount,sha256:hash(crx),keyCreated};
  }finally{
    await fs.rm(intermediate,{force:true});
    const resolved=path.resolve(temporary);
    if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('latex-islands-crx-profile-'))throw Error('Unsafe temporary profile path.');
    await fs.rm(resolved,{recursive:true,force:true,maxRetries:20,retryDelay:200});
  }
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  pack(process.argv[2]).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
