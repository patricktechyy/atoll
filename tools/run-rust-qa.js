#!/usr/bin/env node
// Real WKWebView/WebView2 integration tests. A disposable profile; no real account or permission resets.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
let executable=process.env.ATOLL_RUST_APP||process.argv[2]||path.join(root,'rust/target/debug',process.platform==='win32'?'Atoll.exe':'Atoll');
if(executable.endsWith('.app'))executable=path.join(executable,'Contents/MacOS/Atoll');
if(!fs.existsSync(executable))throw new Error('Build Rust first or set ATOLL_RUST_APP: '+executable);
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'atoll-rust-test-'));
const shortcuts=Object.fromEntries(['open','hide','clipboard','area','layout','romanization'].map((k,i)=>[k,`Control+Alt+Shift+F${14+i}`]));
fs.writeFileSync(path.join(profile,'atoll.json'),JSON.stringify({setupSeen:0,firstVersion:require('../app/package.json').version,settings:{clipboardPaused:true,notifyPort:0,autoUpdate:false,artLookup:false,openOn:'click',shortcuts}}));
const http=require('node:http'),crypto=require('node:crypto');const version=require('../app/package.json').version;
let corrupt=false;const payload=Buffer.from('Invalid updater fixture; never executable.');
const server=http.createServer((request,response)=>{
 if(request.url==='/test/corrupt'){corrupt=true;}if(request.url==='/test/reset'){corrupt=false;}
 if(request.url==='/latest-mac.json'||request.url==='/latest.yml'){
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify({version:corrupt?'99.0.0':version,file:'Atoll-macOS-arm64.zip',sha256:'0'.repeat(64),files:[{url:'Atoll-Setup-99.0.0.exe',sha512:Buffer.alloc(64).toString('base64')}]}));
 }else{response.setHeader('Content-Length',payload.length);response.end(payload);}
});
server.listen(0,'127.0.0.1',()=>launch(`http://127.0.0.1:${server.address().port}`));
function launch(feed){
const app=cp.spawn(path.resolve(executable),[],{stdio:['ignore','pipe','pipe'],env:{...process.env,ATOLL_RUST_TEST_DATA:profile,ATOLL_UPDATE_FEED:feed,ATOLL_RUST_TEST_SCRIPT:path.join(__dirname,'rust-ui-qa.js')}});
let output='';for(const stream of [app.stdout,app.stderr])stream.on('data',b=>{output=(output+b).slice(-10000);});
let timedOut=false;const timer=setTimeout(()=>{timedOut=true;app.kill();},120000);
app.on('error',error=>{console.error(error);process.exitCode=1;clearTimeout(timer);server.close();});
app.on('exit',(code)=>{clearTimeout(timer);server.close();const file=path.join(profile,'test-result.json');
 const result=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{ok:false,error:timedOut?'Timed out':'No webview result',code};
 fs.mkdirSync(path.join(root,'.cache'),{recursive:true});fs.writeFileSync(path.join(root,'.cache/rust-qa-latest.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
 if(!result.ok){console.error(output);console.error('Test profile retained: '+profile);process.exitCode=1;}
 else{fs.rmSync(profile,{recursive:true,force:true});}
});

}
