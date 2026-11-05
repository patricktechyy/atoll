// Injected only into the player's account webview. The only permitted host command captures a
// session for this player; remote web content cannot invoke Atoll's desktop/storage commands.
(() => {
  const apple=location.hostname==='music.apple.com',spotify=location.hostname==='open.spotify.com';
  if(!apple&&!spotify)return;
  const capture=value=>window.__TAURI_INTERNALS__?.invoke('capture_session',{value}).catch(()=>{});
  let last='',pending=null,clientToken='',settle=null;
  const finish=()=>{if(!pending)return;clearTimeout(settle);const value={...pending,clientToken};pending=null;capture(value);};
  const take=(url,headers={})=>{if(!spotify)return;try{const u=new URL(url,location.href);if(!/(^|\.)spotify\.com$/.test(u.hostname))return;const h=new Headers(headers);clientToken=h.get('client-token')||clientToken;const auth=h.get('authorization');if(auth?.startsWith('Bearer ')){const token=auth.slice(7);if(token!==last){last=token;pending={token,exp:Date.now()+50*60e3};}}if(pending){if(clientToken)finish();else if(!settle)settle=setTimeout(finish,1500);}}catch{}};
  if(spotify){const original=window.fetch;window.fetch=function(input,options){take(typeof input==='string'?input:input.url,options?.headers||input?.headers);return original.apply(this,arguments);};const open=XMLHttpRequest.prototype.open,set=XMLHttpRequest.prototype.setRequestHeader,send=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(m,u){this.__atollUrl=u;this.__atollHeaders={};return open.apply(this,arguments);};XMLHttpRequest.prototype.setRequestHeader=function(k,v){this.__atollHeaders[k]=v;return set.apply(this,arguments);};XMLHttpRequest.prototype.send=function(){take(this.__atollUrl,this.__atollHeaders);return send.apply(this,arguments);};}
  setInterval(()=>{try{if(apple){const k=window.MusicKit?.getInstance();if(k?.isAuthorized&&k.developerToken&&k.musicUserToken&&last!==k.musicUserToken){last=k.musicUserToken;capture({dev:k.developerToken,user:k.musicUserToken,sf:k.storefrontId||k.storefrontCountryCode||'us'});}}}catch{}},1500);
})();
