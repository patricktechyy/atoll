const { _electron }=require(process.env.ATOLL_PLAYWRIGHT_MODULE || require.resolve('playwright', { paths: [require('node:path').join(__dirname, '..', '..', '..', 'app')] }));
const { openTab: openTabHelper } = require('../../../app/test/launch');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'atoll-flows-'));
  fs.writeFileSync(path.join(profile,'atoll.json'),JSON.stringify({firstVersion:"0.10.7",settings:{clipboardPaused:true,notifyPort:0,artLookup:false,translateLyrics:false,showRomanization:false}}));
  const app=await _electron.launch({executablePath:path.resolve(process.argv[2]||'Atoll.app','Contents/MacOS/Atoll'),chromiumSandbox:true,env:{...process.env,ATOLL_TEST:'1',ATOLL_TEST_USER_DATA:profile}});
  try {
    const p=await app.firstWindow();const errors=[];p.on('pageerror',e=>errors.push(e.message));
    await p.waitForFunction(async()=>window.API && (await window.API.diagnostics()).helper.alive);
    const openTab=tab=>openTabHelper(app,p,tab);
    await openTab('today');
    await p.locator('#w-add').click();
    assert.equal((await p.evaluate(()=>API.getStore())).water.ml,250);
    await p.locator('#w-undo').click();assert.equal((await p.evaluate(()=>API.getStore())).water.ml,0);
    await p.locator('#t-text').fill('Mac QA task');await p.locator('#t-text').press('Enter');
    await p.locator('#t-list .t-check').click();assert.equal((await p.evaluate(()=>API.getStore())).todos[0].done,true);
    await p.locator('#f-start').click();assert.match(await p.locator('#f-start').textContent(),/Pause/i);
    await p.locator('#f-reset').click();
    const next=app.waitForEvent('window');await p.evaluate(()=>API.setup.open());
    const setup=await next;setup.on('pageerror',e=>errors.push(e.message));
    await setup.locator('#step h1').waitFor();await setup.locator('#next').click();
    await setup.locator('[data-layout-style="tabs"]').click();
    assert.equal((await p.evaluate(()=>API.getStore())).settings.layout,'tabs');
    await setup.evaluate(()=>window.close());
    const details=await p.evaluate(async()=>({stats:await API.getStats(),screens:await API.displays(),keys:await API.shortcutsStatus()}));
    assert.ok(details.stats.atollMem>0 && details.screens.length>0);
    console.log('registered shortcuts',details.keys);
    const pos=await p.evaluate(async()=>{const s=(await API.getStore()).settings;await API.setStore('settings',{...s,position:{mode:'side',side:'left',display:'primary',cy:300}});return (await API.getStore()).settings.position});
    assert.equal(pos.mode,'side');
    await p.evaluate(()=>API.resetPosition());
    await app.evaluate(({ipcMain})=>{
      global.__atollTest.native.stop();
      ipcMain.removeHandler('lyrics');ipcMain.handle('lyrics',()=>({synced:[{t:0,text:'Intro'},{t:15,text:'Verse'},{t:30,text:'Chorus'}],source:'QA'}));
      global.__atollTest.native.emit('media',{active:true,app:'com.apple.Music',playing:true,position:17,posSource:'app',key:'qa',duration:100,title:'QA song',artist:'QA artist'});
    });
    await openTab('lyrics');
    await p.waitForFunction(()=>document.querySelector('#m-lyr li.on')?.textContent.includes('Verse'));
    assert.deepEqual(errors,[]);
    console.log('Passed water, tasks, focus, setup, layout, stats and synthetic Mac Music lyric display');
  }finally{await app.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
