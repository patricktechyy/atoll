const { launchAtoll } = require('./launch');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const { app, close } = await launchAtoll();
  try {
    const p=await app.firstWindow();await p.waitForFunction(()=>!!window.API);
    const open=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('open-tab','todo'));
    await open(); await p.locator('#t-time-open').click();
    await p.locator('#t-hour').fill('13'); await p.locator('#t-minute').fill('25'); await p.locator('#t-minute').press('Enter');
    assert.equal(await p.locator('#t-time').inputValue(),'13:25');
    assert.equal((await p.evaluate(()=>API.getStore())).todos.length,0,'Enter in picker must not submit a task');
    await p.locator('#t-time-open').click(); await p.locator('#t-hour').fill('24'); await p.locator('#t-time-done').click();
    assert.equal(await p.locator('#t-time-picker').isVisible(),true);
    await p.locator('#t-hour').press('Escape'); assert.equal(await p.locator('#t-time-picker').isVisible(),false);
    assert.equal(await p.locator('#t-time').inputValue(),'13:25');
    await p.locator('#t-text').fill('Time picker QA'); await p.locator('#t-text').press('Enter');
    const todo=(await p.evaluate(()=>API.getStore())).todos[0];assert.equal(new Date(todo.due).getHours(),13);assert.equal(new Date(todo.due).getMinutes(),25);
    assert.equal(await p.locator('#t-time-label').textContent(),'Set time');
    for(const theme of ['dark','light']) {
      for(const mode of ['top','side']) {
        await p.evaluate(async({theme,mode})=>{const s=(await API.getStore()).settings;await API.setStore('settings',{...s,theme,position:{mode,side:'right',display:'primary',cy:320}})},{theme,mode});
        // The initiating renderer does not receive its own store broadcast.
        await app.evaluate(async({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0]; const s=await w.webContents.executeJavaScript('API.getStore()');w.webContents.send('store',s);});
        await open(); await p.locator('#t-time-open').click();
        await p.waitForTimeout(450);
        const bounds=await p.evaluate(()=>{const a=document.querySelector('#t-time-picker').getBoundingClientRect(),b=document.querySelector('#panel').getBoundingClientRect();return {a:{left:a.left,right:a.right,top:a.top,bottom:a.bottom},b:{left:b.left,right:b.right,top:b.top,bottom:b.bottom}}});
        assert.ok(bounds.a.left>=bounds.b.left && bounds.a.right<=bounds.b.right && bounds.a.bottom<=bounds.b.bottom,JSON.stringify(bounds));
        if (process.env.ATOLL_PICKER_SCREENSHOT && theme === 'dark' && mode === 'top') await p.screenshot({path:process.env.ATOLL_PICKER_SCREENSHOT});
        await p.locator('#t-time-clear').click();assert.equal(await p.locator('#t-time').inputValue(),'');
      }
    }
    console.log('Time picker selection, validation, Escape, task due time, clearing, dark/light and top/side bounds passed.');
  } finally {await close();}
})().catch(error=>{console.error(error);process.exitCode=1});
