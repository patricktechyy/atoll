#!/usr/bin/env node
// Preserve the existing updater feed and release asset contract across the runtime migration.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),version=require('../app/package.json').version;
const out=path.join(root,'dist/rust');fs.mkdirSync(out,{recursive:true});
const notes=require('./release-notes').section(fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8'),version);
if(!notes)throw new Error('Missing changelog section for '+version);
function copy(from,to){fs.copyFileSync(from,path.join(out,to));}
async function main(){
 if(process.platform==='darwin'){
  const bundle=path.join(root,'rust/target/release/bundle/macos/Atoll.app');
  const name='Atoll-macOS-arm64.zip',zip=path.join(out,name);
  cp.execFileSync('ditto',['-c','-k','--sequesterRsrc','--keepParent',bundle,zip]);
  const feed=require('./release-notes').macFeed({version,zipPath:zip,notes});
  fs.writeFileSync(path.join(out,'latest-mac.json'),JSON.stringify(feed,null,2)+'\n');
  fs.writeFileSync(zip+'.sha256',feed.sha256+'\n');
 }else if(process.platform==='win32'){
  const dir=path.join(root,'rust/target/release/bundle/nsis');
  const installer=fs.readdirSync(dir).filter(f=>f.endsWith('.exe')&&f.includes(`_${version}_`));if(installer.length!==1)throw new Error('Expected exactly one NSIS installer');
  const name=`Atoll-Setup-${version}.exe`,file=path.join(out,name);copy(path.join(dir,installer[0]),name);
  const {executeAppBuilderAsJson}=require('../app/node_modules/app-builder-lib/out/util/appBuilder');
  const info=await executeAppBuilderAsJson(['blockmap','--input',file,'--output',file+'.blockmap']);
  const bytes=fs.readFileSync(file),sha512=crypto.createHash('sha512').update(bytes).digest('base64');
  // JSON is valid YAML 1.2, accepted by both the old electron-updater and the Rust updater.
  fs.writeFileSync(path.join(out,'latest.yml'),JSON.stringify({version,files:[{url:name,sha512,size:bytes.length}],path:name,sha512,releaseDate:new Date().toISOString(),releaseNotes:notes,blockMapSize:info.blockMapSize},null,2)+'\n');
 }else throw new Error('Release on macOS or Windows');
 console.log('Rust release assets: '+out);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
