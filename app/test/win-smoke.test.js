// Windows-only smoke test for the packaged app (CI runs it on windows-latest; it cannot run on a Mac).
// Starts the unpacked build with a throwaway profile and checks the pieces a broken Windows build loses first:
// the notch window, the preload bridge, the native helper, Settings and the About/updater section.
const assert = require('node:assert/strict');
const { launchAtoll } = require('./launch');

if (process.platform !== 'win32') { console.log('Skipped: Windows only.'); process.exit(0); }

(async () => {
  const { app, close } = await launchAtoll();
  try {
    const page = await app.firstWindow(); const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForFunction(() => !!window.API);
    assert.equal(await page.evaluate(() => window.atoll.platform), 'win32');
    assert.equal(await page.evaluate(() => window.atoll.caps.appleCalendar), false);
    const diag = await page.evaluate(() => API.diagnostics());
    assert.ok(diag.version, 'diagnostics report a version');
    console.log('helper:', JSON.stringify(diag.helper && { kind: diag.helper.kind, alive: diag.helper.alive }));
    assert.ok(diag.helper, 'the native helper bridge reports its state');

    const next = app.waitForEvent('window'); await page.evaluate(() => API.openSettings('about')); const settings = await next;
    await settings.getByText('Software update').waitFor();
    assert.match(await settings.locator('body').innerText(), /Update automatically/);
    // Calendar offers the iCal link only: Apple Calendar is macOS only
    await settings.evaluate(() => { location.hash = '#calendar'; });
    await settings.locator('#ics').waitFor();
    assert.equal(await settings.locator('[data-calendar-source="apple"]').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Windows smoke passed: window, bridge, native helper report, About/updater and Calendar settings.');
  } finally { await close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
