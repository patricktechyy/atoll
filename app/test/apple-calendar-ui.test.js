const { launchAtoll } = require('./launch');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
 const { app, close } = await launchAtoll();
 try {
  const p=await app.firstWindow();await p.waitForFunction(()=>!!window.API);
  const native=await app.evaluate(async({app})=>{
   const require=process.mainModule.require.bind(process.mainModule);
   const platform=require(require('path').join(process.resourcesPath,'helper/platform.node'));
   const status=JSON.parse(await platform.calendarEvents(false));
   return {authorized:status.authorized,hasEvents:Array.isArray(status.events),hasCalendars:Array.isArray(status.calendars),error:!!status.error};
  });
  assert.equal(native.hasEvents,true);assert.equal(native.hasCalendars,true);
  if(!native.authorized)assert.equal(native.error,true);
  console.log('Native EventKit query completed; permission granted:',native.authorized);
  // Keep UI fixtures separate from real accounts. The fixture models both access states.
  await app.evaluate(({app})=>{
   const require=process.mainModule.require.bind(process.mainModule);
   const mod=require(require('path').join(app.getAppPath(),'src/calendar-mac'));
   global.__calendarRequests=[];
   mod.readAppleCalendar=async(ids=[],request=false)=>{
    global.__calendarRequests.push(request);
    const authorized=global.__calendarRequests.includes(true);
    return {authorized,calendars:authorized?[{id:'work',title:'Work',account:'QA'},{id:'personal',title:'Personal',account:'QA'}]:[],events:authorized && (!ids.length||ids.includes('work'))?[{id:'event',title:'Calendar QA event',start:Date.now()+3600000,end:Date.now()+7200000,allDay:false,location:'',link:null}]:[],error:authorized?null:'Allow Calendar access in System Settings'};
   };
  });
  const next=app.waitForEvent('window');await p.evaluate(()=>API.openSettings('calendar'));const s=await next;
  await s.locator('[data-calendar-source="apple"]').click();
  await s.locator('#apple-cal-connect').waitFor();
  assert.equal(await app.evaluate(()=>global.__calendarRequests.includes(true)),false,'source selection must not prompt');
  await s.locator('#apple-cal-connect').click();
  await s.locator('[data-apple-calendar="work"]').waitFor();
  assert.equal((await p.evaluate(()=>API.getCalendar())).events[0].title,'Calendar QA event');
  await s.locator('[data-apple-calendar="personal"]').check();
  await p.waitForFunction(async()=>!(await API.getCalendar()).events.length);
  assert.deepEqual((await p.evaluate(()=>API.getStore())).settings.appleCalendarIds,['personal']);
  await s.locator('#apple-cal-off').click();
  await s.locator('#ics').waitFor();assert.equal((await p.evaluate(()=>API.getStore())).settings.calendarSource,'ics');
  assert.equal((await p.evaluate(()=>API.getCalendar())).events.length,0);
  console.log('Apple source, access request, events, calendar filtering and disconnect passed.');
 }finally{await close();}
})().catch(error=>{console.error(error);process.exitCode=1});
