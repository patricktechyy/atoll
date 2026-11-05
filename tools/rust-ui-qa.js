// Executed inside the real platform webview, only in an isolated ATOLL_RUST_TEST_DATA profile.
(async()=>{
 if(window.__rustQARunning)return;window.__rustQARunning=true;
 const passed=[],errors=[];
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const assert=(condition,message)=>{if(!condition)throw new Error(message);passed.push(message);};
 const wait=async(fn,message)=>{for(let i=0;i<200;i++){if(await fn())return;await sleep(50);}throw new Error(message);};
 const call=(channel,...args)=>window.__TAURI__.core.invoke('rpc',{channel,args});
 window.addEventListener('error',e=>errors.push(e.message));
 window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
 try{
  const label=window.__ATOLL_RUNTIME__.windowLabel;
  if(label!=='main'){
    if(label==='settings'){
      await wait(()=>document.querySelector('[data-sec="general"]'),'settings boot');
      for(const section of ['general','appearance','music','notifications','indicators','shortcuts','clipboard','tasks','calendar','focus','system','about']){
        document.querySelector(`[data-sec="${section}"]`).click();await sleep(200);
        assert(document.querySelector('#content').textContent.trim().length>10,`settings/${section} renders`);
      }
      await window.API.openSettings('system');await sleep(1500);
      assert(document.querySelector('#stats').textContent.includes('CPU'),'native stats render');
      assert(document.querySelector('#parts').textContent.includes('excludes OS-managed WebView'),'memory scope is explicit');
    }else if(label==='setup'){
      await wait(()=>document.querySelector('#step').textContent.trim().length>20,'setup boot');
      for(let i=0;i<5;i++){assert(document.querySelector('#step').textContent.trim().length>20,`setup step ${i} renders`);document.querySelector('#next').click();await sleep(150);}
    }else if(label==='toast'){
      await wait(()=>document.querySelector('#n-title').textContent==='Rust notification','toast delivery');
      await sleep(800);const card=document.querySelector('#card').getBoundingClientRect();assert(card.bottom<=innerHeight,'notification fits native window');
      const inset=parseFloat(document.querySelector('#card').style.getPropertyValue('--camera-inset'))||0;
      assert(document.querySelector('#n-title').getBoundingClientRect().top>=inset,'notification text clears camera header');
    }
    assert(errors.length===0,`${label} has no renderer errors`);
    await call('test:window',{ok:true,passed,errors});return;
  }
  await wait(()=>window.__atoll,'renderer boot');
  const api=window.API;
  const store=await api.getStore();assert(store.settings&&Array.isArray(store.todos),'existing store interface');
  assert(!('appleTokens'in store)&&!('clips'in store),'private tokens and clipboard not exposed in public store');
  assert(window.atoll.real&&window.atoll.caps.icsCalendar,'real Rust bridge and platform capabilities');
  const screens=await api.displays();assert(screens.length>0,'native display enumeration');
  api.askPlace();await sleep(300);
  const main=window.__atoll;assert(!main.S.floating,'notch remains attached');
  if(window.atoll.platform==='darwin'&&main.S.cutout)assert(main.S.cutout.height>0,'physical camera geometry delivered');
  for(const layout of ['pages','tabs']){
   const data=await api.getStore();await api.setStore('settings',{...data.settings,layout});await sleep(100);
   for(const page of layout==='pages'?['now','lyrics','today','clipboard','files']:['home','lyrics','files','clipboard','calendar','tasks','focus','stats']){
    main.open(page,{pin:true});await sleep(80);
    assert(document.querySelector('#island.state-panel'),`${layout}/${page} opens`);
    const panel=document.querySelector('#panel').getBoundingClientRect();
    assert(panel.y>=0&&panel.bottom<=innerHeight,`${layout}/${page} stays in viewport`);
    if(main.S.cutout)assert(panel.top>=main.S.cutout.y+main.S.cutout.height,`${layout}/${page} content clears camera`);
   }
  }
  main.open('tasks',{pin:true});await sleep(150);
  const form=document.querySelector('#t-form');document.querySelector('#t-text').value='Rust parity task';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await sleep(150);
  assert((await api.getStore()).todos.some(t=>t.text==='Rust parity task'),'local task creation persists');
  document.querySelector('#w-add').click();await sleep(100);assert((await api.getStore()).water.ml>0,'water tracking persists');
  document.querySelector('#w-undo').click();await sleep(100);assert((await api.getStore()).water.ml===0,'water undo');
  main.timerStart();assert(main.S.timer.running,'focus timer starts');
  main.close();main.S.hud=null;main.showHud(main.volHud(60,false));await sleep(100);
  for(const id of ['hl','hr']){const b=document.getElementById(id).getBoundingClientRect(),c=main.S.cutout;assert(!c||b.right<=c.x||b.left>=c.x+c.width||b.top>=c.y+c.height,`${id} visible beside camera`);}
  const battery=await navigator.getBattery();assert(battery.level>=0&&battery.level<=1,'native battery interface');
  const sample=await api.getStats();assert(sample.memTotal>0&&sample.atollMem>0,'native resource metrics');
  await api.trimNow();assert((await api.getStats()).lastTrim>0,'native memory cleanup command');
  await api.openSettings('general');
  await api.setup.open();
  await api.toast.show({id:'rust-qa',pos:'top-center',title:'Rust notification',body:'Preserved separate notification window',theme:'dark',accent:'#30d5c8',ms:30000});
  await wait(async()=>{const reports=await call('test:windows');return reports?.settings?.ok&&reports?.setup?.ok&&reports?.toast?.ok;},'native secondary windows did not pass');
  const secondary=await call('test:windows');for(const[name,result]of Object.entries(secondary))for(const check of result.passed)passed.push(`${name}: ${check}`);
  const snapshot=await api.getMediaSnapshot();assert(typeof snapshot==='object','native media snapshot interface');
  const diag=await api.diagnostics();assert(diag.runtime==='Rust/Tauri','diagnostics identify Rust runtime');
  assert(Object.values(await api.shortcutsStatus()).some(v=>v==='ok'),'global shortcuts registered');
  const calendar=await api.getCalendar();assert(Array.isArray(calendar.events),'calendar interface');
  const status=await api.lyricSources.status();assert(status.apple&&status.spotify,'both player accounts available');
  const result=await api.getLyrics({title:'Unsupported player'});assert(result.unsupported||result.needsConnect||result.error||result.service,'lyrics route only to current player');
  assert(window.AtollPure.quickParse('call mum tomorrow 8pm').time==='20:00','natural-language tasks preserved');
  assert(window.AtollPure.fixLanguage('en',['這是一首中文歌曲'])==='zh','Traditional Chinese language correction preserved');
  assert(window.AtollPure.romanizeLine('너를 사랑해')==='Neoreul saranghae'&&window.AtollPure.romanizeLine('こんにちは')==='Konnichiwa'&&window.AtollPure.romanizeLine('愛してる')===null&&window.AtollPure.romanizeLine('我爱你，中国')==='Wǒ ài nǐ，zhōng guó','local romanization (Korean, kana, pinyin) works in the WebView');
  if(window.__ATOLL_RUNTIME__.testFeed){
    const up=await api.updater.check();assert(up.state==='uptodate','Rust update feed check');
    await call('http',window.__ATOLL_RUNTIME__.testFeed+'/test/corrupt',{});
    const corrupt=await api.updater.check();assert(corrupt.state==='error'&&/checksum/.test(corrupt.error),'corrupt update rejected before installation');
    await call('http',window.__ATOLL_RUNTIME__.testFeed+'/test/reset',{});
    assert((await api.updater.check()).state==='uptodate','updater recovers after failure');
  }
  assert(errors.length===0,'no renderer errors');
  await call('test:report',{ok:true,passed,errors,platform:window.atoll.platform,runtime:diag.runtime});
 }catch(error){await call(window.__ATOLL_RUNTIME__.windowLabel==='main'?'test:report':'test:window',{ok:false,passed,errors,error:String(error),stack:error.stack,secondary:await call('test:windows')});}
})();
