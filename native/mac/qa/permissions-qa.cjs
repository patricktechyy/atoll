// Inspect grants and test only against a temporary Atoll window. Screen pixels
// stay in memory; the keyboard test cancels the keystroke before pasting.
const { _electron } = require(process.env.ATOLL_PLAYWRIGHT_MODULE || require.resolve('playwright', { paths: [require('node:path').join(__dirname, '..', '..', '..', 'app')] }));
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
(async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'atoll-privacy-qa-'));
  fs.writeFileSync(path.join(profile,'atoll.json'), JSON.stringify({settings:{clipboardPaused:true, notifyPort:0,artLookup:false,windowsNotifications:false}}));
  const app=await _electron.launch({executablePath:path.resolve(process.argv[2]||'Atoll.app','Contents/MacOS/Atoll'),chromiumSandbox:true,env:{...process.env,ATOLL_TEST:'1',ATOLL_TEST_USER_DATA:profile}});
  try {
    const page=await app.firstWindow();
    await page.waitForFunction(async()=>window.API && (await window.API.diagnostics()).helper.alive);
    const state=await app.evaluate(({systemPreferences})=>({screen:systemPreferences.getMediaAccessStatus('screen'), ax:systemPreferences.isTrustedAccessibilityClient(false)}));
    let helper;
    for(let i=0;i<20;i++){
      helper=await page.evaluate(()=>window.API.toastsStatus());
      if(typeof helper.ok==='boolean') break;
      await page.waitForTimeout(250);
    }
    console.log('grants:', state, 'helper can use accessibility:',helper.ok);
    if(state.screen!=='granted' && !helper.ok) return;
    console.log(await app.evaluate(async({BrowserWindow,desktopCapturer,screen},grants)=>{
      const d=screen.getPrimaryDisplay();
      const w=new BrowserWindow({width:240,height:160,x:d.bounds.x+90,y:d.bounds.y+140,frame:false,backgroundColor:'#12cd34',alwaysOnTop:true,webPreferences:{sandbox:true}});
      try {
        await w.loadURL('data:text/html,<body style="background:%2312cd34"><input autofocus>Atoll QA</body>');
        w.show();w.focus();w.webContents.focus();await new Promise(r=>setTimeout(r,400));
        const result={};
        if(grants.screen==='granted'){
          const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:d.size});
          const image=sources.find(s=>s.display_id===String(d.id))?.thumbnail;
          if(!image || image.isEmpty()) throw Error('No display image');
          const size=image.getSize();const rect=w.getBounds();
          const sample=image.crop({x:Math.floor((rect.x+170-d.bounds.x)*size.width/d.size.width),y:Math.floor((rect.y+100-d.bounds.y)*size.height/d.size.height),width:1,height:1}).toBitmap();
          if(Math.abs(sample[1]-205)>22 || Math.abs(sample[2]-18)>22) throw Error('Screen capture did not include QA window');
          result.capture='captured the QA color target';
        }
        if(grants.ax){
          await w.webContents.executeJavaScript("window.addEventListener('keydown', e=>{e.preventDefault(); if(e.metaKey && e.code==='KeyV') window.received=true})");
          if(!w.isFocused()) throw Error('QA window must have focus for keyboard check');
          global.__atollTest.native.send({cmd:'paste'});
          await new Promise(r=>setTimeout(r,400));
          if(!await w.webContents.executeJavaScript('!!window.received'))throw Error('QA window did not receive Command+V');
          result.paste='helper delivered Command+V to QA window';
        }
        return result;
      }finally{w.destroy();}
    },{screen:state.screen,ax:helper.ok}));
  }finally{await app.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
