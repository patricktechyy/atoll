// Local notification endpoint so scripts, build tools, Home Assistant, etc. can push into the island.
//   curl -X POST http://127.0.0.1:47821/notify -H "X-Atoll-Token: <token>" -d "{\"title\":\"Build done\",\"body\":\"All tests passed\"}"
// Only listens on 127.0.0.1, requires the token, and rejects browser requests (Origin header),
// so random web pages can't spam you.
const http = require('http');

function startNotifyServer({ port, token, onNotify }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers.origin) return reply(403, { error: 'browser requests not allowed' });
    if (url.pathname !== '/notify') return reply(404, { error: 'POST /notify' });
    const given = req.headers['x-atoll-token'] || url.searchParams.get('token');
    if (given !== token) return reply(401, { error: 'bad token' });

    const finish = (payload) => {
      const n = {
        title: String(payload.title || 'Notification').slice(0, 80),
        body: String(payload.body || '').slice(0, 240),
        app: String(payload.app || '').slice(0, 40),
        icon: String(payload.icon || '').slice(0, 4),
        url: /^https?:\/\//.test(payload.url || '') ? String(payload.url) : null,
        duration: Math.min(30000, Math.max(2000, Number(payload.duration) || 6000))
      };
      onNotify(n);
      reply(200, { ok: true });
    };

    if (req.method === 'GET') return finish(Object.fromEntries(url.searchParams));
    if (req.method !== 'POST') return reply(405, { error: 'use POST' });
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (_) { payload = { body }; }
      finish(payload);
    });
  });
  server.on('error', (e) => console.error('[notify] server error', e.message));
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { startNotifyServer };
