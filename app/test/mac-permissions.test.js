// "Fix permission": which command runs for which permission, and that nothing runs when it must not.
const assert = require('node:assert/strict');
const { BUNDLE_ID, SERVICES, resetCommand, resetPermission } = require('../src/mac-permissions');

assert.equal(BUNDLE_ID, 'app.atoll.notch');
assert.equal(BUNDLE_ID, require('../package.json').build.appId, 'matches the app id the Mac build writes into Info.plist');
assert.deepEqual(Object.keys(SERVICES).sort(), ['accessibility', 'automation', 'calendar', 'screen']);
assert.deepEqual(resetCommand('calendar'), ['/usr/bin/tccutil', ['reset', 'Calendar', 'app.atoll.notch']]);
assert.deepEqual(resetCommand('screen')[1], ['reset', 'ScreenCapture', 'app.atoll.notch']);
assert.deepEqual(resetCommand('accessibility')[1], ['reset', 'Accessibility', 'app.atoll.notch']);
assert.deepEqual(resetCommand('automation')[1], ['reset', 'AppleEvents', 'app.atoll.notch']);
// never "All": that would wipe every service
for (const kind of Object.keys(SERVICES)) assert.notEqual(resetCommand(kind)[1][1], 'All');
assert.equal(resetCommand('toString'), null, 'inherited names are not permissions');
assert.equal(resetCommand('../../x'), null);

(async () => {
  const calls = [];
  const run = async (cmd, args) => { calls.push([cmd, args]); };
  assert.deepEqual(await resetPermission('calendar', { run }), { ok: true });
  assert.deepEqual(calls, [['/usr/bin/tccutil', ['reset', 'Calendar', 'app.atoll.notch']]]);
  assert.equal((await resetPermission('nope', { run })).ok, false);
  assert.equal(calls.length, 1, 'an unknown permission runs nothing');
  const dev = await resetPermission('calendar', { run, packaged: false });
  assert.equal(dev.ok, false); assert.match(dev.error, /installed Atoll/); assert.equal(calls.length, 1, 'an unpackaged app runs nothing');
  const failing = await resetPermission('screen', { run: async () => { throw Object.assign(new Error('x'), { stderr: 'tccutil: Failed to reset\nmore' }); } });
  assert.deepEqual(failing, { ok: false, error: 'tccutil: Failed to reset' });
  console.log('Mac permission reset: commands per permission, never "All", refuses unknown and unpackaged, reports failures.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
