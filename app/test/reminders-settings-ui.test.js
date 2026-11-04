const { chromium } = require(process.env.ATOLL_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
 const browser = await chromium.launch({executablePath:process.env.ATOLL_CHROME_PATH, headless:true});
 try {
 const page = await browser.newPage({viewport:{width:1024,height:800}});
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 await page.goto(pathToFileURL(path.join(__dirname, '../renderer/settings.html')).href + '#focus');
 const toggle = page.locator('[data-tog="waterReminders"]');
 await toggle.waitFor();
 assert.equal(await toggle.getAttribute('aria-checked'), 'true');
 await toggle.click();
 await page.waitForFunction(() => !document.querySelector('[data-num="waterEveryMin"]'));
 assert.equal((await page.evaluate(() => window.API.getStore())).settings.waterReminders, false);
 assert.equal(await page.locator('[data-tog="waterEnabled"]').getAttribute('aria-checked'), 'true');
 assert.equal(await page.locator('[data-num="waterGoalMl"]').count(), 1);
 await toggle.click();
 await page.locator('[data-num="waterEveryMin"]').waitFor();
 if (process.env.ATOLL_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.ATOLL_SCREENSHOT_DIR, 'atoll-water-settings.png'), animations:'disabled'});
 await page.evaluate(() => location.hash = 'music');
 await page.locator('#lyr-off').waitFor();
 assert.equal(await page.locator('#lyr-off').getAttribute('max'), '10');
 await page.locator('#lyr-off').fill('7');
 assert.equal(await page.locator('#lyr-off-v').textContent(), 'Earlier 7.0 s');
 assert.equal((await page.evaluate(() => window.API.getStore())).settings.lyricOffset, 7);
 await page.locator('#lyr-off').fill('-5');
 assert.equal(await page.locator('#lyr-off-v').textContent(), 'Later 5.0 s');
 if (process.env.ATOLL_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.ATOLL_SCREENSHOT_DIR, 'atoll-music-settings.png'), animations:'disabled'});
 assert.deepEqual(errors, []);
 console.log('Browser settings toggle, retained tracking, interval visibility, offset direction and persistence checks passed.');
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
