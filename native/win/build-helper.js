// Builds the Windows native helpers into app/build/helper (packaged as resources/helper by electron-builder).
// Windows only: it uses the C# compiler that ships with Windows (csc.exe) through the same code the app uses
// for its own first-run fallback (app/src/native.js), so the build and the fallback can never drift apart.
// If a variant does not compile, the committed prebuilt copy in native/win/prebuilt is used and a warning is
// printed. Set ATOLL_REQUIRE_FRESH_HELPER=1 (CI does) to fail instead of falling back.
const fs = require('fs');
const path = require('path');
const { buildHelper } = require('../../app/src/native');

const out = path.join(__dirname, '..', '..', 'app', 'build', 'helper');
const prebuilt = path.join(__dirname, 'prebuilt');
const strict = process.env.ATOLL_REQUIRE_FRESH_HELPER === '1';
const variants = [['full', 'atoll-helper.exe'], ['core', 'atoll-helper-core.exe']];

(async () => {
  if (process.platform !== 'win32') {
    console.log('Skipping the Windows helper build on', process.platform);
    return;
  }
  fs.mkdirSync(out, { recursive: true });
  const scratch = path.join(out, '.compile');
  let failed = false;
  for (const [variant, name] of variants) {
    const r = await buildHelper(scratch, variant, { force: true });
    if (r.exe && fs.existsSync(r.exe)) {
      fs.copyFileSync(r.exe, path.join(out, name));
      console.log(`built ${name}${r.uia === false ? ' (without UI Automation extras)' : ''}`);
    } else {
      failed = true;
      console.warn(`could not build ${name}: ${r.error || 'unknown error'}`);
      if (strict) continue;
      fs.copyFileSync(path.join(prebuilt, name), path.join(out, name));
      console.warn(`using the committed prebuilt ${name} instead`);
    }
  }
  fs.rmSync(scratch, { recursive: true, force: true });
  if (failed && strict) { console.error('Helper build failed and ATOLL_REQUIRE_FRESH_HELPER=1 is set.'); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
