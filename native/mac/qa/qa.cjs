// Run against the packaged app. Use a temporary profile and a disabled clipboard history.
const { _electron } = require(process.env.ATOLL_PLAYWRIGHT_MODULE || require.resolve('playwright', { paths: [require('node:path').join(__dirname, '..', '..', '..', 'app')] }));
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'atoll-mac-qa-'));
  fs.writeFileSync(path.join(profile,'atoll.json'), JSON.stringify({settings:{clipboardPaused:true, notifyPort:0, artLookup:false}}));
  const app = await _electron.launch({executablePath:path.resolve(process.argv[2] || 'Atoll.app','Contents/MacOS/Atoll'), args:[], chromiumSandbox:true,
    env:{...process.env, ATOLL_TEST:'1', ATOLL_TEST_USER_DATA:profile}});
  let helperPID;
  try {
    const page = await app.firstWindow(); const errors=[];
    app.on('window', w=>w.on('pageerror', e=>errors.push(e.message)));
    page.on('pageerror', e=>errors.push(e.message));
    await page.waitForFunction(()=>!!window.API?.diagnostics);
    await page.waitForFunction(async()=> (await window.API.diagnostics()).helper.alive);
    assert.equal(await page.evaluate(()=>window.atoll.platform),'darwin');
    const metrics=()=>app.evaluate(({app,BrowserWindow})=>({windows:BrowserWindow.getAllWindows().length,processes:app.getAppMetrics().length, heap:process.memoryUsage().heapUsed, rss:process.memoryUsage().rss,helper:global.__atollTest.native.mem.main,arch:process.arch}));
    helperPID=await app.evaluate(()=>global.__atollTest.native.procs.main.pid);
    console.log('startup',await metrics());
    for(let cycle=0;cycle<12;cycle++){
      const next=app.waitForEvent('window');
      await page.evaluate(()=>window.API.openSettings('focus'));
      const settings=await next;
      const toggle=settings.locator('[data-tog="waterReminders"]');
      await toggle.waitFor();
      if(cycle<2) {
        assert.equal(await toggle.getAttribute('aria-checked'),cycle===0?'true':'false');
        await toggle.click();
      }
      await settings.evaluate(()=>window.close());
      await page.waitForTimeout(100);
    }
    const cdp = await page.context().newCDPSession(page);
    const rendererHeap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      return (await cdp.send('Runtime.getHeapUsage')).usedSize;
    };
    const hover = on => app.evaluate(({BrowserWindow},active)=>BrowserWindow.getAllWindows()[0].webContents.send('hover',active),on);
    await hover(true);
    await page.locator('#island.state-panel').waitFor();
    await hover(false);
    await page.waitForFunction(()=>!document.querySelector('#island.state-panel'));
    const beforeHeap=await rendererHeap();
    const framePromise=page.evaluate(()=>new Promise(resolve=>{
      const gaps=[]; let last=performance.now();
      const frame=t=>{if(t>last)gaps.push(t-last);last=t;if(gaps.length===1000) resolve(gaps.sort((a,b)=>a-b));else requestAnimationFrame(frame);};requestAnimationFrame(frame);
    }));
    for (let i=0;i<20;i++) {
      await hover(true); await page.waitForFunction(()=>!!document.querySelector('#island.state-panel'));
      await hover(false); await page.waitForFunction(()=>!document.querySelector('#island.state-panel'));
    }
    const frames=await framePromise;
    console.log('animation frame interval ms median/p95',frames[500],frames[950]); assert.ok(frames[950]<50);
    const afterHeap=await rendererHeap();
    console.log('renderer heap before/after 20 open-close cycles',beforeHeap,afterHeap);
    assert.ok(afterHeap-beforeHeap<4*1024**2);
    await cdp.detach();
    const permissions=await app.evaluate(({systemPreferences})=>({screen:systemPreferences.getMediaAccessStatus('screen'), accessibility:systemPreferences.isTrustedAccessibilityClient(false)}));
    console.log('macOS permission state',permissions);
    const start=await metrics(); assert.equal(start.arch,'arm64'); assert.equal(start.windows,1);
    const samples=[];
    for(let i=0;i<12;i++){await page.waitForTimeout(5000);samples.push(await metrics());}
    const end=samples.at(-1);
    assert.equal(end.windows,1); assert.equal(end.processes,start.processes);
    assert.ok(end.heap-start.heap<12*1024**2); assert.ok(end.helper>0 && end.helper-start.helper<16*1024**2);
    assert.deepEqual(errors,[]); console.log('60s idle baseline/end',start,end);
    if(process.argv.includes('--scan-helper')){
      const scan=require('node:child_process').spawnSync('/usr/bin/leaks',['--noContent','--nostacks',String(helperPID)],{encoding:'utf8',timeout:30000});
      const summary=scan.stdout.split('\n').filter(line=>/leaks? for|leaked bytes/.test(line));
      console.log('Apple leaks scan:',summary.length ? summary : scan.stderr.trim());
      assert.equal(scan.status,0,'leaks must complete and detect zero native helper leaks');
    }
  } finally {await app.close(); fs.rmSync(profile,{recursive:true,force:true});}
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.throws(()=>process.kill(helperPID,0), {code:'ESRCH'});
  console.log('native helper exited with Atoll');
})().catch(e=>{console.error(e);process.exitCode=1});
