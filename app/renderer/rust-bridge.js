// The existing renderer contract implemented by a Rust/Tauri host. No Node.js compatibility runtime.
(() => {
  if (!window.__ATOLL_RUNTIME__ || !window.__TAURI__) return;
  const T = window.__TAURI__, boot = window.__ATOLL_RUNTIME__, subscriptions = [];
  const call = (channel, ...args) => T.core.invoke('rpc', {channel, args});
  const on = channel => callback => { let unsubscribe; const ready=T.event.listen(channel,event=>callback(event.payload)).then(fn=>unsubscribe=fn); subscriptions.push(ready); return ()=>ready.then(()=>unsubscribe()); };
  const send = (channel,...args) => Promise.all(subscriptions).then(()=>call(channel,...args)).catch(error=>console.error('Atoll command failed',channel,String(error)));
  const http = async (url, options={}) => { const response=await call('http',String(url),options); return {ok:response.status>=200&&response.status<300,status:response.status,headers:new Headers(response.headers),json:async()=>JSON.parse(response.text),text:async()=>response.text}; };
  window.__AtollHttp=http;
  const P=window.AtollPure, lyricPending=new Map();
  let media=null,artTimer=null;const artCache=new Map(),artGot=new Set();
  async function scheduleArt(value){
    const key=value?.key;if(media?.key===key)return;media=value;clearTimeout(artTimer);
    if(!key||!value.active||boot.windowLabel!=='main')return;
    artTimer=setTimeout(async()=>{try{
      if(media?.key!==key||artGot.has(key)||(await call('store:all')).settings.artLookup===false)return;
      const cacheKey=[value.title,value.artist].join('|').toLowerCase();let data=artCache.get(cacheKey);
      if(!artCache.has(cacheKey)){
        const query=new URLSearchParams({term:`${value.artist||''} ${value.title||''}`,media:'music',entity:'song',limit:'8'});
        const response=await http('https://itunes.apple.com/search?'+query);
        const url=response.ok&&P.pickItunesArt((await response.json()).results,value.title,value.artist);
        data=url?await call('art:download',url):null;artCache.set(cacheKey,data);
        if(artCache.size>6)artCache.delete(artCache.keys().next().value);
      }
      if(data&&media?.key===key&&!artGot.has(key))await call('art:publish',{key,data,source:'itunes'});
    }catch(_){}},/apple|itunes/i.test(value.app||'')?1200:6000);
  }
  const clips=items=>items.map(item=>({...item,thumb:boot.platform==='win32'&&item.thumb?.startsWith('atoll://clip/')?item.thumb.replace('atoll://clip/','http://atoll.localhost/clip/'):item.thumb}));
  const drag=async path=>T.core.invoke('plugin:drag|start_drag',{item:[path],image:boot.dragIcon,options:{mode:'copy'},onEvent:new T.core.Channel()});
  window.close=()=>send('close-window');
  async function lyrics(meta={}) {
    const service=await call('lyrics:service'); if(!service)return {unsupported:true,synced:null,plain:null};
    const sources=await call('lyric-sources:status');if(!sources[service]?.connected)return {needsConnect:service,synced:null,plain:null};
    const q={title:P.stripFeat(P.cleanTitle(meta.title)),artist:String(meta.artist||'').replace(/\s*-\s*Topic$/i,'').trim(),album:P.cleanAlbum(meta.album),duration:Math.round(meta.duration||0)};
    const key=JSON.stringify(['v3',service,q.title.toLowerCase(),q.artist.toLowerCase(),q.album.toLowerCase(),q.duration]);
    if(!meta.force){const cached=await call('cache:get',key);if(cached)return cached;}
    if(lyricPending.has(key))return lyricPending.get(key);
    const pending=(async()=>{try{
      const data=await call('player:request',service,'search',q);
      const track=service==='spotify'?P.pickSpotifyTrack(data.tracks?.items,q.title,q.artist,q.duration):P.pickAppleSong(data.results?.songs?.data,q.title,q.artist,q.duration);
      if(!track)return {synced:null,plain:null,service};
      const raw=await call('player:request',service,'lyrics',{id:track.id});
      const result=service==='spotify'?P.spotifyToResult(raw):P.parseTtml(raw.data?.[0]?.attributes?.ttml);
      const out={...(result||{synced:null,plain:null}),service};if(result)await call('cache:set',key,out);return out;
    }catch(error){return {error:'unreachable',detail:String(error),service,retryIn:60000};}})().finally(()=>lyricPending.delete(key));
    lyricPending.set(key,pending);return pending;
  }
  function normalizeCalendar(value){if(value?.ics){const now=Date.now();return {...value,events:P.expand(P.parseIcs(value.ics),now-12*3600e3,now+7*86400e3)};}return value;}
  const bridge={real:true,platform:boot.platform,caps:boot.caps,
    macPermissions:()=>call('mac:permissions'),requestMacPermission:k=>call('mac:request',k),fixMacPermission:k=>call('mac:fix',k),
    getStore:()=>call('store:all'),getMediaSnapshot:()=>call('media:snapshot').then(v=>{scheduleArt(v);return P.normalizeMedia(v);}),setStore:(k,v)=>call('store:set',k,v),setHitRect:r=>send('hit-rect',r),repaint:()=>{},trimNow:()=>call('trim-now'),holdPointer:v=>send('hold-pointer',v),media:(cmd,pos)=>send('media',cmd,pos),getLyrics:lyrics,
    updater:{state:()=>call('updater:state'),check:()=>call('updater:check'),install:()=>call('updater:install'),openPage:()=>call('updater:open-page')},
    lyricSources:{status:()=>call('lyric-sources:status'),connect:n=>call('lyric-sources:connect',n),disconnect:n=>call('lyric-sources:disconnect',n)},
    setup:{open:()=>send('setup:open'),done:v=>send('setup:done',v),info:()=>call('setup:info'),openWindowsSettings:p=>send('open-ms-settings',p),testClipboard:t=>call('setup:clip-test',t)},
    getStats:()=>call('stats'),getCalendar:()=>call('calendar:get').then(normalizeCalendar),refreshCalendar:()=>call('calendar:refresh').then(normalizeCalendar),connectAppleCalendar:()=>call('calendar:connect-apple').then(normalizeCalendar),fileIcon:p=>call('file-icon',p),pathForFile:f=>f.path||f.__atollPath||'',
    openPath:p=>send('open-path',p),showInFolder:p=>send('show-in-folder',p),openUrl:u=>send('open-url',u),startDrag:drag,notifyInfo:()=>call('notify-info'),copy:t=>send('copy',t),focusWindow:()=>send('focus-window'),quit:()=>send('quit'),openSettings:s=>send('open-settings',s),openClipboard:()=>send('open-clipboard'),notchMenu:()=>send('notch-menu'),setVolume:v=>send('set-volume',v),openPlayer:a=>send('open-player',a),notifyTest:n=>send('notify-test',n),restart:()=>send('restart'),statsActive:on=>send('stats-active',on),
    translate:async(key,lines,to,understood)=>{try{return {ok:true,data:await P.translateLines(key,lines,to,understood)};}catch(error){return {ok:false,error:String(error)};}},
    displays:()=>call('displays'),moveToDisplay:id=>send('move-to-display',id),dragNotch:(v,g)=>send('drag-notch',v,g),moveMode:on=>send('move-mode',on),resetPosition:()=>send('reset-position'),nudge:d=>send('nudge',d),toast:{show:n=>send('toast:show',n)},askPlace:()=>send('place?'),shot:m=>send('shot',m),shortcutsStatus:()=>call('shortcuts:status'),toastsStatus:()=>call('toasts:status'),diagnostics:()=>call('diagnostics'),
    clip:{list:()=>call('clip:list').then(clips),status:()=>call('clip:status'),use:(id,paste)=>call('clip:use',id,paste),pin:(id,on)=>send('clip:pin',id,on),remove:id=>send('clip:remove',id),clear:()=>send('clip:clear'),drag:async id=>drag(await call('clip:file',id))},
    todo:{info:()=>call('todo:info'),login:(u,n,p)=>call('todo:login',u,n,p),logout:()=>call('todo:logout'),list:()=>call('todo:list'),add:(t,d,h)=>call('todo:add',t,d,h,d?null:P.quickParse(t)),update:(id,p)=>call('todo:update',id,p),remove:id=>call('todo:remove',id)}
  };
  const events={Hover:'hover',Media:'media',MediaNote:'media-note',Art:'art',System:'system',Notify:'notify',Calendar:'calendar',OpenTab:'open-tab',Store:'store',Fullscreen:'fullscreen',Place:'place',SnapGuide:'snap-guide',MoveMode:'move-mode',ToastEvent:'toast-event',Clips:'clips',ClipStatus:'clip-status',ShotSaved:'shot-saved',Shortcuts:'shortcuts',ToastsStatus:'toasts-status',SettingsSection:'settings-section',LyricsSources:'lyrics-sources',Updater:'updater'};
  for(const[name,event]of Object.entries(events))bridge['on'+name]=event==='calendar'?cb=>on(event)(v=>cb(normalizeCalendar(v))):event==='media'?cb=>on(event)(v=>{scheduleArt(v);cb(P.normalizeMedia(v));}):event==='art'?cb=>on(event)(v=>{if(v.data){artGot.add(v.key);if(artGot.size>128)artGot.delete(artGot.values().next().value);}cb({...v,data:P.fixArtData(v.data)});}):event==='clips'?cb=>on(event)(v=>cb(clips(v))):on(event);
  bridge.onSystem=callback=>{const stop=on('system')(callback);call('system:snapshot').then(v=>{if(Object.keys(v).length)callback(v);});return stop;};
  bridge.onFullscreen=callback=>{const stop=on('fullscreen')(callback);call('fullscreen:state').then(callback);return stop;};
  window.atoll=bridge;window.API=bridge;
  const battery = new EventTarget(); Object.assign(battery,{charging:true,level:1,chargingTime:Infinity,dischargingTime:Infinity});
  function updateBattery(value){battery.chargingTime=value.present===false?0:Infinity;for(const key of ['level','charging'])if(typeof value[key]===typeof battery[key]&&battery[key]!==value[key]){battery[key]=value[key];battery.dispatchEvent(new Event(key+'change'));}}
  const batteryReady=call('battery').then(updateBattery).then(()=>battery);
  navigator.getBattery=()=>batteryReady;
  on('battery')(updateBattery);
  window.snip={onImage:cb=>{const stop=on('snip:image')(cb);Promise.all(subscriptions).then(()=>call('snip:request'));return stop;},ready:()=>send('snip:ready'),done:r=>send('snip:done',r)};
  window.toastApi={onShow:on('toast'),onPlace:on('toast-place'),ready:()=>send('toast:ready'),interactive:on=>send('toast:interactive',on),event:e=>send('toast:event',e)};
  for(const [native,event]of [['tauri://drag-enter','dragenter'],['tauri://drag-over','dragover'],['tauri://drag-leave','dragleave']])on(native)(()=>{const e=new Event(event,{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:{types:['Files'],files:[]}});(document.querySelector('#island')||document.body).dispatchEvent(e);});
  on('tauri://drag-drop')(({paths=[]})=>{const files=paths.map(p=>({name:p.split(/[\\/]/).pop(),path:p}));const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files,types:['Files']}});(document.querySelector('#shelf-drop')||document.body).dispatchEvent(event);});
  on('rust:close-window')(()=>T.window.getCurrentWindow().close());
})();
