#!/usr/bin/env node
// Shared Rust entry point on macOS and Windows. Node is a build tool, never part of the shipped app.
const cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),cwd=path.join(root,'rust');
const [mode='dev',...args]=process.argv.slice(2);
function run(executable,args,options={}){const result=cp.spawnSync(executable,args,{cwd,env:process.env,stdio:'inherit',...options});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);}
if(!['darwin','win32'].includes(process.platform))throw new Error('Atoll targets macOS and Windows');
run(process.execPath,[path.join(root,'tools/prepare-rust.js')]);
if(mode==='dev')run('cargo',['run','--locked',...args]);
else if(mode==='test'||mode==='check')run('cargo',[mode,'--locked',...args]);
else if(mode==='build'){
 run(process.execPath,[path.join(root,'tools/rust-licenses.js')]);
 const env={...process.env};if(process.platform==='darwin'&&env.ATOLL_SIGN_IDENTITY)env.APPLE_SIGNING_IDENTITY=env.ATOLL_SIGN_IDENTITY;
 const bundles=args.includes('--no-bundle')?[]:['--bundles',process.platform==='darwin'?'app':'nsis'];
 run(process.execPath,[path.join(root,'app/node_modules/@tauri-apps/cli/tauri.js'),'build',...bundles,...args],{env});
}else throw new Error('Use dev, build, check or test');
