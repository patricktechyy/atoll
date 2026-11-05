// Build-time only. The shipped Rust app has no Node.js or Electron runtime.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const root = path.join(__dirname, '..'), out = path.join(root, '.cache/rust-ui'), helper = path.join(root, '.cache/rust-helper');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out, {recursive:true}); fs.rmSync(helper,{recursive:true,force:true});fs.mkdirSync(helper,{recursive:true});
if(!fs.existsSync(path.join(root,'.cache/rust-notices.txt')))fs.writeFileSync(path.join(root,'.cache/rust-notices.txt'),fs.readFileSync(path.join(root,'LICENSE')));
for(const name of fs.readdirSync(path.join(root,'app/renderer'))) {
  if (/preload/.test(name)) continue;
  const from=path.join(root,'app/renderer',name); if(!fs.statSync(from).isFile()) continue;
  let data=fs.readFileSync(from);
  if(name.endsWith('.html')) data=Buffer.from(data.toString().replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'').replace('</head>','<script src="rust-pure.js"></script><script src="rust-bridge.js"></script></head>'));
  fs.writeFileSync(path.join(out,name),data);
}
const defaults=require('../app/src/store').DEFAULTS;
fs.writeFileSync(path.join(out,'defaults.json'),JSON.stringify(defaults));
fs.writeFileSync(path.join(out,'install.sh'),require('../app/src/updater').INSTALL_SCRIPT);
let pure='window.AtollPure = {};\n';
function expose(file,end,names){let source=fs.readFileSync(path.join(root,'app/src',file),'utf8');source=source.slice(0,source.indexOf(end)).replace(/^const (fs|path|crypto) = require\([^\n]+\n/gm,'');if(file==='translate.js')source='const fetch = (...args) => window.__AtollHttp(...args);\n'+source;pure+=`(()=>{${source}\nObject.assign(window.AtollPure,{${names}});})();\n`;}
expose('lyrics.js','// ---- caches','cleanTitle,stripFeat,cleanAlbum');
expose('calendar.js','async function fetchCalendar','parseIcs,expand');
expose('lyrics-sources.js','// ---------------- Electron side','pickSpotifyTrack,spotifyToResult,pickAppleSong,parseTtml');
expose('media.js','module.exports','normalizeMedia,fixArtData,pickItunesArt');
expose('translate.js','module.exports','translateLines,fixLanguage');
const todo=fs.readFileSync(path.join(root,'app/src/todolist.js'),'utf8');pure+=`(()=>{${todo.slice(todo.indexOf('function quickParse'),todo.indexOf('// Plain Node fetch'))}Object.assign(window.AtollPure,{quickParse});})();`;
fs.writeFileSync(path.join(out,'rust-pure.js'),pure);
for(const name of ['rust-bridge.js','rust-auth.js']) if(fs.existsSync(path.join(root,'app/renderer',name))) fs.copyFileSync(path.join(root,'app/renderer',name),path.join(out,name));
if(process.platform==='darwin') cp.execFileSync('clang',['-arch','arm64','-mmacosx-version-min=13.0','-O2','-fobjc-arc','-framework','AppKit','-framework','ApplicationServices','-framework','ImageIO','-framework','AudioToolbox','-framework','CoreAudio','-framework','Carbon',path.join(root,'native/mac/helper.m'),'-o',path.join(helper,'atoll-mac')],{stdio:'inherit'});
if(process.platform==='win32') {cp.execFileSync(process.execPath,[path.join(root,'native/win/build-helper.js')],{stdio:'inherit'});fs.cpSync(path.join(root,'app/build/helper'),helper,{recursive:true});fs.copyFileSync(path.join(root,'app/src/native.ps1'),path.join(helper,'native.ps1'));}
if(process.platform==='darwin')cp.execFileSync('codesign',['--force','--sign',process.env.ATOLL_SIGN_IDENTITY||process.env.APPLE_SIGNING_IDENTITY||'-','--timestamp=none',path.join(helper,'atoll-mac')],{stdio:'inherit'});
console.log('Prepared shared frontend and native helper for Rust');
