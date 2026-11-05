// Packaged main-process placement and renderer layout around the physical camera housing.
const assert = require('node:assert/strict');
const { launchAtoll, openTab } = require('./launch');
(async () => {
  const { app, close } = await launchAtoll({ settings: { openOn: 'click' } });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.__atoll);
    const fixture = await app.evaluate(({ app, screen, BrowserWindow }) => {
      const require = process.mainModule.require.bind(process.mainModule);
      const caps = require(require('path').join(app.getAppPath(), 'src/platform')).capabilities();
      const primary = screen.getPrimaryDisplay();
      const laptop = { ...primary, internal: true };
      const external = { ...primary, id: 777002, internal: false, bounds: { ...primary.bounds, x: primary.bounds.x + primary.bounds.width } };
      global.__safeAreas = [{ id: primary.id, top: 38, left: primary.bounds.width / 2 - 110, width: 220 }, { id: external.id, top: 0, left: 0, width: 0 }];
      if (caps.displaySafeArea) {
        const file = require('path').join(process.resourcesPath, 'helper', 'platform.node');
        const native = require(file), areas = native.screenSafeAreas();
        if (!areas.some((d) => String(d.id) === String(primary.id)) || !areas.every((d) => Number.isFinite(d.top) && Number.isFinite(d.left) && Number.isFinite(d.width))) throw new Error('Native geometry did not match Electron displays');
        global.__realSafeAreas = areas;
        require('module')._cache[file].exports = Object.defineProperty(Object.create(native), 'screenSafeAreas', { value: () => global.__safeAreas });
      }
      global.__laptop = laptop;
      screen.getPrimaryDisplay = () => laptop;
      screen.getAllDisplays = () => [laptop, external];
      const win = BrowserWindow.getAllWindows().find((w) => /renderer[\\/]index\.html/.test(w.webContents.getURL()));
      const original = win.setBounds.bind(win);
      win.setBounds = (bounds, ...args) => { global.__placement = bounds; return original(bounds, ...args); };
      app.on('browser-window-created', (_event, window) => {
        const original = window.setBounds.bind(window);
        window.setBounds = (bounds, ...args) => { global.__toastPlacement = bounds; return original(bounds, ...args); };
      });
      return { bounds: primary.bounds, externalId: String(external.id), camera: caps.displaySafeArea, native: global.__realSafeAreas };
    });
    const update = async (patch, position = {}) => {
      await page.evaluate(async ({ patch, position }) => {
        const s = (await API.getStore()).settings;
        await API.setStore('settings', { ...s, ...patch, position: { ...s.position, ...position } });
      }, { patch, position });
      await app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((w) => /renderer[\\/]index\.html/.test(w.webContents.getURL()));
        w.webContents.send('store', await w.webContents.executeJavaScript('API.getStore()'));
      });
    };
    const where = () => app.evaluate(() => global.__placement);
    const metrics = () => app.evaluate(({ screen }) => screen.emit('display-metrics-changed', {}, global.__laptop, ['bounds']));
    const attached = async () => {
      assert.equal((await where()).y, fixture.bounds.y, 'the window stays at the physical top edge');
      assert.equal(await page.locator('#island').evaluate((e) => e.classList.contains('floating')), false, 'camera never creates a floating pill');
      assert.equal(await page.evaluate(() => __atoll.S.top), 0, 'no automatic vertical separation');
    };
    const contentSafe = async (selector) => {
      const result = await page.evaluate((selector) => {
        const c = __atoll.S.cutout;
        const b = document.querySelector(selector).getBoundingClientRect();
        return { clear: !c || b.bottom <= c.y || b.top >= c.y + c.height || b.right <= c.x || b.left >= c.x + c.width, b: b.toJSON(), c };
      }, selector);
      assert.ok(result.clear, `${selector} is outside the camera rectangle: ${JSON.stringify(result)}`);
    };
    await update({ size: 'm' }, { mode: 'top', frac: 0.5, top: 0, display: 'primary' });
    await metrics();
    for (const size of ['s', 'm', 'l']) {
      await update({ size });
      await page.evaluate(() => { __atoll.close(); __atoll.S.notif = null; __atoll.showHud(__atoll.volHud(60, false)); });
      await attached();
      await contentSafe('#hl'); await contentSafe('#hr');
      await page.evaluate(() => {
        const { S, layout } = __atoll;
        S.hud = null;
        S.cal.events = [{ title: 'A long upcoming meeting title', start: Date.now() + 60000, end: Date.now() + 3600000 }];
        layout();
      });
      await contentSafe('#wl'); await contentSafe('#wr');
      await page.evaluate(() => { __atoll.S.cal.events = []; __atoll.layout(); });
      if (fixture.camera) {
        const c = await page.evaluate(() => __atoll.S.cutout);
        assert.ok(Math.abs(c.width * ({ s: 0.85, m: 1, l: 1.2 }[size]) - 220) < 0.01, 'camera width stays fixed in physical display points');
      }
      for (const layout of ['pages', 'tabs']) {
        await update({ layout });
        for (const tab of ['music', 'lyrics', 'todo', 'clipboard', 'shelf']) {
          await page.evaluate(() => { __atoll.S.hud = null; __atoll.S.notif = null; });
          await openTab(app, page, tab);
          await attached(); await contentSafe('#panel');
          const fits = await page.locator('#panel').evaluate((el) => { const b = el.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; });
          assert.ok(fits, `${layout}/${tab} fits inside the window at size ${size}`);
        }
      }
    }
    await page.reload(); await page.waitForFunction(() => !!window.__atoll);
    await openTab(app, page, 'music'); await attached(); await contentSafe('#panel');
    await page.evaluate(() => { __atoll.close(); __atoll.S.hud = null; __atoll.notify({ title: 'Camera-safe notification', body: 'Still joined to the notch', force: true }); });
    await page.locator('#notif.on').waitFor(); await attached(); await contentSafe('#notif');
    await page.evaluate(() => __atoll.setMoving(true));
    await page.locator('#mover.on').waitFor(); await attached(); await contentSafe('#mover');
    await page.evaluate(() => __atoll.setMoving(false));

    const nextToast = app.waitForEvent('window');
    await page.evaluate(() => API.toast.show({ id: 'camera-test', pos: 'top-center', title: 'Joined notification', theme: 'dark', accent: '#30d5c8', ms: 60000 }));
    const toast = await nextToast;
    await toast.locator('#card.p-top-center').waitFor();
    await toast.waitForFunction(() => document.querySelector('#card').getAnimations().every((animation) => animation.playState === 'finished'));
    const toastPlacement = () => app.evaluate(() => global.__toastPlacement);
    assert.equal((await toastPlacement()).y, fixture.bounds.y, 'separate top notification also joins the top edge');
    const toastInset = () => toast.locator('#notif').evaluate((e) => e.getBoundingClientRect().top);
    assert.ok(await toastInset() >= (fixture.camera ? 38 / 1.2 : 0), 'notification text is below the camera');
    await update({}, { display: fixture.externalId });
    assert.equal(await page.evaluate(() => __atoll.S.cutout), null, 'external display removes camera layout');
    await toast.waitForFunction(() => document.querySelector('#notif').getBoundingClientRect().top === 0);
    await update({}, { mode: 'side', side: 'right' });
    assert.equal(await page.evaluate(() => __atoll.S.cutout), null, 'side mode has no camera reserve');
    await update({ size: 'm' }, { mode: 'top', frac: 0.5, top: 0, display: 'primary' });
    await attached();
    await app.evaluate(() => { global.__safeAreas[0].top = 0; }); await metrics();
    assert.equal(await page.evaluate(() => __atoll.S.cutout), null, 'notch-free display metrics restore normal layout');
    await app.evaluate(() => { global.__safeAreas[0].top = 38; });
    await update({}, { display: fixture.externalId });
    await app.evaluate(({ screen }) => { screen.getAllDisplays = () => [global.__laptop]; screen.emit('display-removed', {}, { id: 777002 }); });
    await attached();
    assert.equal(!!(await page.evaluate(() => __atoll.S.cutout)), fixture.camera, 'unplug restores the built-in camera geometry');
    assert.equal((await page.evaluate(() => API.getStore())).settings.position.top, 0, 'saved position remains at zero');
    console.log('Integrated notch UI passed: native geometry, S/M/L, HUD wings, Pages/Tabs, five pages, reload, notifications, move controls, external, side, metrics and unplug.', JSON.stringify(fixture.native || []));
  } finally { await close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
