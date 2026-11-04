// Sync with your Todolist. Works with both of your servers:
//   • Whats Up (railway-whatsapp) with the Todolist built in at /todo  (cookie "wah")
//   • the standalone Todolist website (ming2-s-todolist-website)       (cookie "todo")
// Atoll signs in once with your username and password, keeps only the session cookie
// (encrypted with Windows DPAPI via Electron safeStorage) and uses the website's own API:
//   GET {api}/data · GET {api}/parse?text= (Whats Up only) · POST {api}/tasks · PATCH/DELETE {api}/tasks/:id

class TodolistSync {
  /** transport(method, url, {headers, body}) -> {status, headers: {lowercase: string|string[]}, text} */
  constructor(store, safeStorage, transport) {
    this.store = store;
    this.safe = safeStorage;
    this.transport = transport || nodeTransport;
  }

  get conf() { return this.store.get('todolist') || {}; }
  get connected() { return !!(this.conf.url && this.conf.cookie); }

  publicInfo() {
    const c = this.conf;
    return {
      url: c.url || '', user: c.user || '', name: c.name || '', connected: this.connected,
      kind: c.prefix === '/todo' ? 'whatsup' : c.prefix === '' ? 'standalone' : '',
      webUrl: c.url ? c.url + (c.prefix === '/todo' ? '/todo/' : '/') : ''
    };
  }

  encrypt(v) {
    if (this.safe && this.safe.isEncryptionAvailable()) return 'enc:' + this.safe.encryptString(v).toString('base64');
    return 'raw:' + Buffer.from(v).toString('base64');
  }
  decrypt(v) {
    if (!v) return '';
    try {
      if (v.startsWith('enc:')) return this.safe.decryptString(Buffer.from(v.slice(4), 'base64'));
      if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString();
    } catch (_) {}
    return '';
  }

  // Accepts "myapp.up.railway.app", "https://myapp.up.railway.app/todo/", ".../u/gavin/", "http://…" …
  static normalizeUrl(u) {
    u = String(u || '').trim().replace(/\s+/g, '');
    if (!u) throw new Error('Paste the address of your Railway app first.');
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    let parsed;
    try { parsed = new URL(u); } catch (_) { throw new Error('That doesn’t look like a web address. Copy it from your browser’s address bar.'); }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('Use the https:// address of your Railway app.');
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname);
    if (!local) parsed.protocol = 'https:'; // Railway is always https; quietly upgrade http://
    return parsed.origin;
  }

  friendly(e, host) {
    const m = [e && e.message, e && e.cause && (e.cause.code || e.cause.message), e && e.code].filter(Boolean).join(' ') || String(e);
    if (/NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(m)) return `Can’t find ${host}. Check the address (copy it from your browser) and your internet.`;
    if (/CONNECTION_REFUSED|ECONNREFUSED/i.test(m)) return `${host} refused the connection. Is the Railway app running?`;
    if (/TIMED_OUT|ETIMEDOUT|aborted|timeout/i.test(m)) return `${host} didn’t answer in time. Try again in a moment (Railway may be waking up).`;
    if (/CERT|SSL|certificate/i.test(m)) return `Secure connection to ${host} failed (${m}). Is the address right?`;
    if (/INTERNET_DISCONNECTED|ENETUNREACH/i.test(m)) return 'You’re offline.';
    return m;
  }

  cookieHeader() { return this.decrypt(this.conf.cookie); }

  async http(method, url, body, cookie) {
    const headers = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const r = await this.transport(method, url, { headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = JSON.parse(r.text); } catch (_) {}
    return { ...r, data };
  }

  async call(method, path, body) {
    if (!this.connected) throw Object.assign(new Error('Not signed in to your Todolist'), { code: 401 });
    const c = this.conf;
    let r;
    try { r = await this.http(method, c.url + c.prefix + path, body, this.cookieHeader()); }
    catch (e) { throw Object.assign(new Error(this.friendly(e, new URL(c.url).host)), { code: 0 }); }
    if (r.status === 401) {
      this.store.set('todolist', { ...c, cookie: '' }); // session expired or password changed
      throw Object.assign(new Error('Your Todolist sign-in expired. Sign in again in Settings.'), { code: 401 });
    }
    if (r.status < 200 || r.status >= 300) throw Object.assign(new Error((r.data && (r.data.error || r.data.message)) || `Todolist returned ${r.status}`), { code: r.status });
    return r.data;
  }

  async login(url, username, password) {
    const base = TodolistSync.normalizeUrl(url);
    const host = new URL(base).host;
    username = String(username || '').trim();
    if (!username || !password) throw new Error('Enter your username and password.');

    let r;
    try { r = await this.http('POST', base + '/api/login', { username, password, next: '/todo/' }); }
    catch (e) { throw new Error(this.friendly(e, host)); }
    if (r.status === 404 || r.status === 405 || (!r.data && r.status < 500)) {
      throw new Error(`${host} answered, but it isn’t your Whats Up or Todolist server. Use the address you sign in at.`);
    }
    if (r.status < 200 || r.status >= 300) throw new Error((r.data && r.data.error) || `Sign-in failed (${r.status})`);

    // keep every cookie the server set (Whats Up uses "wah", the standalone site "todo")
    let set = r.headers['set-cookie'] || [];
    if (!Array.isArray(set)) set = String(set).split(/,(?=\s*[A-Za-z0-9_-]+=)/);
    const jar = set.map((x) => x.split(';')[0].trim()).filter((x) => /^[^=]+=.+/.test(x));
    if (!jar.length) throw new Error('Signed in, but the server didn’t start a session. Try again, or check the address.');
    const cookie = jar.join('; ');

    // Where's the Todolist API? Whats Up serves it under /todo, the standalone site at the root.
    let prefix = null, me = null;
    for (const p of ['/todo', '']) {
      try {
        const t = await this.http('GET', base + p + '/api/me', null, cookie);
        if (t.status === 200 && t.data && typeof t.data === 'object') { prefix = p; me = t.data; break; }
      } catch (e) { throw new Error(this.friendly(e, host)); }
    }
    if (prefix === null) throw new Error('Signed in, but couldn’t find the Todolist on this server. Open it once in your browser, then try again.');

    this.store.set('todolist', { url: base, user: username, name: me.name || (me.profile && me.profile.name) || username, prefix, cookie: this.encrypt(cookie) });
    return this.publicInfo();
  }

  logout() {
    const c = this.conf;
    this.store.set('todolist', { url: c.url || '', user: c.user || '', name: '', prefix: c.prefix, cookie: '' });
    this.store.set('remoteNotified', {});
    return this.publicInfo();
  }

  async tasks() {
    const d = await this.call('GET', '/api/data');
    const lists = new Map((d.lists || []).map((l) => [l.id, l.name || l.title || '']));
    return (d.tasks || []).map((t) => ({
      id: t.id, text: t.title, done: !!t.done, doneAt: t.doneAt || null, due: t.due || null, time: t.time || null,
      priority: t.priority || 0, status: t.status || 'todo', list: lists.get(t.listId) || '', repeat: !!t.repeat
    }));
  }

  async add(text, due, time) {
    let body = { title: text };
    if (due) body = { title: text, due, time: time || null };
    else {
      let parsed = null;
      try { // Whats Up's own parser reads "tomorrow 8pm", "friday", etc.
        const p = await this.call('GET', '/api/parse?text=' + encodeURIComponent(text));
        if (p && p.title) parsed = { title: p.title, due: p.due || null, time: p.time || null };
      } catch (e) { if (e.code === 401) throw e; }
      body = parsed || quickParse(text); // the standalone site has no parser: use Atoll's small one
    }
    return this.call('POST', '/api/tasks', body);
  }

  update(id, patch) { return this.call('PATCH', '/api/tasks/' + encodeURIComponent(id), patch); }
  remove(id) { return this.call('DELETE', '/api/tasks/' + encodeURIComponent(id)); }
}

// "call mum tomorrow 8pm" -> {title:'call mum', due:'YYYY-MM-DD', time:'20:00'} (today/tonight/tomorrow/weekdays, 8pm/20:00/8.30pm)
function quickParse(text, now = new Date()) {
  let t = ' ' + text + ' ';
  let date = null, time = null;
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tm = /\s(?:at\s)?(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm)?(?=\s)/i.exec(t);
  if (tm && (tm[2] || tm[3])) {
    let h = +tm[1]; const mi = +(tm[2] || 0); const ap = (tm[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    if (h < 24 && mi < 60) { time = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`; t = t.replace(tm[0], ' '); }
  }
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dm = /\s(today|tonight|tomorrow|tmr|(?:next\s)?(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?)(?=\s)/i.exec(t);
  if (dm) {
    const w = dm[1].toLowerCase(); const d = new Date(now);
    if (w === 'tomorrow' || w === 'tmr') d.setDate(d.getDate() + 1);
    else if (w === 'tonight') { if (!time) time = '20:00'; }
    else if (w !== 'today') {
      const idx = days.findIndex((x) => x.startsWith(w.replace(/^next\s/, '').slice(0, 3)));
      let add = (idx - d.getDay() + 7) % 7 || 7;
      if (w.startsWith('next ') && add < 7) add += 7;
      d.setDate(d.getDate() + add);
    }
    date = ymd(d); t = t.replace(dm[0], ' ');
  }
  if (time && !date) { const d = new Date(now); const [h, mi] = time.split(':').map(Number); if (h * 60 + mi <= d.getHours() * 60 + d.getMinutes()) d.setDate(d.getDate() + 1); date = ymd(d); }
  const title = t.replace(/\s+(by|on|at|for|this)\s*$/i, ' ').replace(/\s+/g, ' ').trim() || text;
  return { title, due: date, time };
}

// Plain Node fetch (tests, or if Electron's network stack isn't available)
async function nodeTransport(method, url, { headers, body }) {
  const res = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  const h = {};
  res.headers.forEach((v, k) => { h[k] = v; });
  if (typeof res.headers.getSetCookie === 'function') h['set-cookie'] = res.headers.getSetCookie();
  return { status: res.status, headers: h, text: await res.text() };
}

// Electron's Chromium network stack: uses Windows' proxy settings and certificate store
// (antivirus HTTPS scanning, company proxies) and still lets us read Set-Cookie.
function electronTransport(net) {
  return (method, url, { headers, body }) => new Promise((resolve, reject) => {
    const req = net.request({ method, url, redirect: 'manual', useSessionCookies: false, credentials: 'omit' });
    for (const [k, v] of Object.entries(headers || {})) req.setHeader(k, v);
    const timer = setTimeout(() => { req.abort(); reject(new Error('timeout')); }, 20000);
    req.on('redirect', (status, _m, _url, resHeaders) => {
      clearTimeout(timer);
      req.abort();
      resolve({ status, headers: resHeaders || {}, text: '' });
    });
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }); });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    if (body) req.write(body);
    req.end();
  });
}

// Node first (full control over cookies); if it can't connect at all (proxy, antivirus certificate),
// retry through Chromium's stack.
function chainTransport(...ts) {
  return async (...args) => {
    let last;
    for (const t of ts) { try { return await t(...args); } catch (e) { last = e; } }
    throw last;
  };
}

module.exports = { TodolistSync, nodeTransport, electronTransport, chainTransport, quickParse };
