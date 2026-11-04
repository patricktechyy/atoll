// Choosing which monitor the notch lives on. Runs on the packaged app with a faked second monitor.
const { launchAtoll } = require('./launch');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
(async () => {
  const { app, close } = await launchAtoll();
  try {
    const p = await app.firstWindow(); await p.waitForFunction(() => !!window.API);
    // one real screen: the control explains instead of offering a choice
    let w = app.waitForEvent('window'); await p.evaluate(() => API.openSettings('appearance')); let s = await w;
    const realCount = await app.evaluate(({ screen }) => screen.getAllDisplays().length);
    if (realCount === 1) await s.getByText('Only one screen is connected').waitFor();
    else await s.locator('[data-display]').first().waitFor();
    await s.evaluate(() => window.close());

    // fake a second monitor to the right of the real one
    const first = await app.evaluate(({ screen, BrowserWindow }) => {
      const real = screen.getAllDisplays();
      const d0 = real[0];
      const fake = { id: 777001, label: 'Fake Side Display', bounds: { x: d0.bounds.x + d0.bounds.width, y: d0.bounds.y, width: 1280, height: 720 }, size: { width: 1280, height: 720 }, workArea: { x: d0.bounds.x + d0.bounds.width, y: d0.bounds.y, width: 1280, height: 720 }, scaleFactor: 1 };
      global.__fake = fake;
      screen.getAllDisplays = () => [...real, fake];
      // macOS pulls a window back onto a real screen, so record what Atoll asks for
      const main = BrowserWindow.getAllWindows().find((w) => /renderer\/index\.html/.test(w.webContents.getURL())); const orig = main.setBounds.bind(main);
      main.setBounds = (b, ...r) => { global.__req = { ...b }; return orig(b, ...r); };
      return { d0: d0.bounds, win: BrowserWindow.getAllWindows()[0].getBounds() };
    });
    const where = () => app.evaluate(() => global.__req);
    w = app.waitForEvent('window'); await p.evaluate(() => API.openSettings('appearance')); s = await w;
    const fakeBtn = s.locator('[data-display="777001"]');
    await fakeBtn.waitFor();
    assert.equal(await s.locator('[data-display]').count(), realCount + 1);
    assert.equal(await s.locator('[data-display="primary"].on').count(), 1, 'primary is selected first');

    await fakeBtn.click();
    await p.waitForFunction(async () => (await API.getStore()).settings.position.display === '777001');
    await s.locator('[data-display="777001"].on').waitFor();
    const moved = await where();
    assert.ok(moved.x >= first.d0.x + first.d0.width, `window moved onto the second screen (x=${moved.x})`);

    // switching layout keeps the chosen screen
    await s.locator('[data-layout="right"]').click();
    await p.waitForFunction(async () => { const q = (await API.getStore()).settings.position; return q.mode === 'side' && q.side === 'right' && q.display === '777001'; });
    const side = await where();
    assert.ok(side.x + side.width <= first.d0.x + first.d0.width + 1280 && side.x >= first.d0.x + first.d0.width, 'right-edge layout is on the second screen');
    await s.locator('[data-layout="top"]').click();
    await p.waitForFunction(async () => (await API.getStore()).settings.position.display === '777001');

    // back to the main screen
    await s.locator('[data-display="primary"]').click();
    await p.waitForFunction(async () => (await API.getStore()).settings.position.display === 'primary');
    const back = await where();
    assert.ok(back.x < first.d0.x + first.d0.width, 'window is back on the main screen');

    // an unplugged screen falls back to the main one instead of losing the notch
    await app.evaluate(({ screen }) => { const real = screen.getAllDisplays().filter((d) => d.id !== 777001); screen.getAllDisplays = () => real; });
    await p.evaluate(async () => { const st = (await API.getStore()).settings; await API.setStore('settings', { ...st, position: { ...st.position, display: '777001' } }); });
    await p.waitForTimeout(300);
    assert.ok((await where()).x < first.d0.x + first.d0.width, 'unknown screen falls back to the main one');
    console.log('Screen selection passed: single-screen note (when one screen), choice, layout switch keeps screen, return, fallback.');
  } finally { await close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
