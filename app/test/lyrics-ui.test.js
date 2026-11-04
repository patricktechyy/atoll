// Packaged-app test (both platforms). Uses the real lyrics IPC handler with synthetic player events and no
// signed-in accounts, so nothing leaves the machine. Checks that lyrics come only from the playing app.
const { launchAtoll } = require('./launch');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
(async () => {
  const { app, close } = await launchAtoll({ settings: { translateLyrics: false, showRomanization: false }, extra: { firstVersion: '0.11.0' } });
  try {
    const page = await app.firstWindow(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(async () => window.API && (await window.API.diagnostics()).helper.alive);
    // any request to a free lyrics site would show up here
    await app.evaluate(({ session }) => { global.__lyricUrls = []; session.defaultSession.webRequest.onBeforeRequest((d, cb) => { global.__lyricUrls.push(d.url); cb({}); }); });
    const openTab = tab => app.evaluate(({ BrowserWindow }, t) => BrowserWindow.getAllWindows()[0].webContents.send('open-tab', t), tab);
    const play = media => app.evaluate((_e, m) => { global.__atollTest.native.stop(); global.__atollTest.native.emit('media', { active: true, playing: true, position: 5, posSource: 'app', duration: 200, artist: 'QA artist', ...m }); }, media);
    const message = () => page.locator('#m-lyr-empty').innerText();

    await openTab('lyrics');
    await play({ app: 'com.apple.Music', key: 'am1', title: 'Apple song' });
    await page.waitForFunction(() => /Connect Apple Music/.test(document.querySelector('#m-lyr-empty')?.innerText || ''));
    assert.match(await message(), /Apple Music/);
    assert.equal(await page.locator('#m-lyr-empty [data-act="lyr-sources"]').count(), 1, 'offers to connect');
    assert.equal(await page.locator('#m-lyr li').count(), 0);

    await play({ app: 'com.spotify.client', key: 'sp1', title: 'Spotify song' });
    await page.waitForFunction(() => /Connect Spotify/.test(document.querySelector('#m-lyr-empty')?.innerText || ''));

    await play({ app: 'com.google.Chrome', key: 'ch1', title: 'Browser song' });
    await page.waitForFunction(() => /come from Spotify or Apple Music/.test(document.querySelector('#m-lyr-empty')?.innerText || ''));
    assert.equal(await page.locator('#m-lyr-empty [data-act="lyr-sources"]').count(), 0);

    // the real handler: the answers the renderer saw
    const answers = await page.evaluate(async () => ({
      other: await API.getLyrics({ title: 'x', artist: 'y', duration: 100 })
    }));
    assert.equal(answers.other.unsupported, true);

    // settings no longer advertise free services
    const next = app.waitForEvent('window'); await page.evaluate(() => API.openSettings('music')); const settings = await next;
    await settings.locator('.row').first().waitFor();
    const text = await settings.locator('body').innerText();
    assert.doesNotMatch(text, /LRCLIB|NetEase|Free lyrics/i);
    assert.match(text, /Spotify/); assert.match(text, /Apple Music/);

    const urls = await app.evaluate(() => global.__lyricUrls);
    assert.deepEqual(urls.filter(u => /lrclib|163\.com|netease/i.test(u)), [], 'no free lyrics site was contacted');
    assert.deepEqual(errors, []);
    console.log('Lyrics QA passed: Apple Music and Spotify ask to connect, other players are unsupported, settings list only the two apps, no free lyrics site contacted.');
  } finally { await close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
