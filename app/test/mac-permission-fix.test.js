// macOS only: "Fix permission" in Settings. The packaged app records the reset command instead of running
// tccutil (ATOLL_TEST), because this build shares Atoll's bundle id and a real reset would clear the user's
// real permissions. Screen Recording and Accessibility are not clicked: asking again would open real prompts.
const assert = require('node:assert/strict');
const { launchAtoll } = require('./launch');

if (process.platform !== 'darwin') { console.log('Skipped: macOS only.'); process.exit(0); }

(async () => {
  const { app, close } = await launchAtoll();
  try {
    const page = await app.firstWindow(); await page.waitForFunction(() => !!window.API);
    const calls = () => app.evaluate(() => global.__tccCalls || []);

    // not from the notch window, not for an unknown permission
    const fromNotch = await page.evaluate(() => API.fixMacPermission('calendar'));
    assert.equal(fromNotch.ok, false); assert.deepEqual(await calls(), [], 'only the Settings window may reset a permission');

    // a stand-in for the Calendar reader: refuses until access has been requested again
    await app.evaluate(({ app: electronApp }) => {
      const require = process.mainModule.require.bind(process.mainModule);
      const mod = require(require('path').join(electronApp.getAppPath(), 'src/calendar-mac'));
      global.__requests = [];
      mod.readAppleCalendar = async (ids = [], request = false) => {
        global.__requests.push(request);
        const authorized = global.__requests.includes(true);
        return { authorized, calendars: authorized ? [{ id: 'work', title: 'Work', account: 'QA' }] : [], events: [], error: authorized ? null : 'Allow Calendar access for Atoll in System Settings → Privacy & Security → Calendars.' };
      };
    });

    // Settings → System: every permission has a Fix permission button
    let next = app.waitForEvent('window'); await page.evaluate(() => API.openSettings('system')); const settings = await next;
    for (const kind of ['calendar', 'screen', 'accessibility', 'automation']) await settings.locator(`[data-mac-fix="${kind}"]`).waitFor();
    assert.equal(await settings.locator('[data-mac-fix]').count(), 4);
    assert.match(await settings.locator('body').innerText(), /Allowed in System Settings but not working/);
    const unknown = await settings.evaluate(() => API.fixMacPermission('All'));
    assert.equal(unknown.ok, false); assert.deepEqual(await calls(), [], '"All" and unknown names run nothing');

    // Automation: resets that service only, then tells the user what to do
    await settings.locator('[data-mac-fix="automation"]').click();
    await settings.getByText('Play a song in Music or Spotify').waitFor();
    assert.deepEqual(await calls(), [['/usr/bin/tccutil', ['reset', 'AppleEvents', 'app.atoll.notch']]]);

    // Calendar: reset, then asks for access again, and the Calendar page recovers
    await settings.locator('[data-mac-fix="calendar"]').click();
    await page.waitForFunction(async () => (await API.getCalendar()).authorized === true);
    assert.deepEqual((await calls()).at(-1), ['/usr/bin/tccutil', ['reset', 'Calendar', 'app.atoll.notch']]);
    assert.equal(await app.evaluate(() => global.__requests.includes(true)), true, 'access was requested again after the reset');
    assert.equal((await page.evaluate(() => API.getStore())).settings.calendarSource, 'apple');
    assert.equal((await calls()).length, 2, 'exactly the two resets that were clicked');

    // Calendar settings: the button shows while access is missing and goes away once it is back
    await app.evaluate(() => { global.__requests = []; });
    await page.evaluate(() => API.refreshCalendar());
    await settings.evaluate(() => { location.hash = '#calendar'; });
    await settings.locator('#apple-cal-connect').waitFor();
    assert.equal(await settings.locator('[data-mac-fix="calendar"]').count(), 1, 'missing access offers Fix permission');
    assert.match(await settings.locator('body').innerText(), /Already switched on in System Settings/);
    await settings.locator('[data-mac-fix="calendar"]').click();
    await settings.locator('[data-apple-calendar="work"]').waitFor();
    assert.equal(await settings.locator('[data-mac-fix="calendar"]').count(), 0, 'no Fix permission once access works');
    console.log('Fix permission passed: four buttons, correct tccutil command per permission, calendar re-requested and recovered, Settings-only, never "All".');
  } finally { await close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
