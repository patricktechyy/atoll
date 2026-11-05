// Checks the executable adapters, not a separately maintained list of expected method names.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const renderer=path.join(__dirname,'../renderer');let electron;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../preload.js'),'utf8'),{process:{platform:'darwin'},require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,api)=>{if(name==='atoll')electron=api;}},ipcRenderer:{on(){},sendSync(){return {};}}};}});
function methods(object,prefix=''){return Object.entries(object).flatMap(([key,value])=>typeof value==='function'?[prefix+key]:value&&typeof value==='object'?methods(value,prefix+key+'.'):[]).sort();}
for(const platform of ['darwin','win32']){
 const invoked=[],events={};const window={__ATOLL_RUNTIME__:{platform,caps:{}},AtollPure:{normalizeMedia:v=>v},__TAURI__:{core:{invoke:async(channel,args)=>{invoked.push([channel,args]);if(args.channel==='battery')return {level:.7,charging:false};return {};},Channel:class{}},event:{listen:async(channel,fn)=>{events[channel]=fn;return ()=>{};}}}};
 vm.runInNewContext(fs.readFileSync(path.join(renderer,'rust-bridge.js'),'utf8'),{window,navigator:{},EventTarget,Event,Headers,URLSearchParams,console,setTimeout,clearTimeout});
 assert.deepEqual(methods(window.atoll),methods(electron),platform+' must retain every public Electron bridge method');
 assert.equal(methods(window.atoll).length,95);
 window.atoll.media('seek',12);
 assert.equal(window.atoll.caps,window.__ATOLL_RUNTIME__.caps);
 assert.equal(typeof window.snip.done,'function');assert.equal(typeof window.toastApi.onShow,'function');
}
const auth=JSON.parse(fs.readFileSync(path.join(__dirname,'../../rust/capabilities/auth.json')));
assert.deepEqual(auth.permissions,['allow-capture-session']);assert.equal(auth.remote.urls.length,2);
const conf=JSON.parse(fs.readFileSync(path.join(__dirname,'../../rust/tauri.conf.json')));
assert.equal(conf.identifier,'app.atoll.notch');assert.equal(conf.version,'../app/package.json');
assert(conf.app.security.csp.includes('blob:'));
console.log('Rust adapters retain all 95 Electron methods on both platforms; remote player pages have no desktop permissions.');
