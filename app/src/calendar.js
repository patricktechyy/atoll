// Minimal iCalendar (.ics) reader: works with the "secret iCal address" from Google Calendar
// and the "Publish calendar" ICS link from Outlook. Handles time zones, all-day events,
// RRULE (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY), EXDATE and
// moved/cancelled instances (RECURRENCE-ID).

const WIN_TZ = {
  'SE Asia Standard Time': 'Asia/Bangkok', 'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo', 'China Standard Time': 'Asia/Shanghai',
  'India Standard Time': 'Asia/Kolkata', 'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin', 'Romance Standard Time': 'Europe/Paris',
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver', 'Pacific Standard Time': 'America/Los_Angeles',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'UTC': 'UTC'
};

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseLine(line) {
  const i = line.indexOf(':');
  if (i < 0) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...params] = head.split(';');
  const p = {};
  for (const kv of params) { const [k, v] = kv.split('='); p[k.toUpperCase()] = (v || '').replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params: p, value };
}

function unescape(v) {
  return (v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function tzOffsetMs(utcMs, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - utcMs;
}

function zoned(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  try {
    let t = guess - tzOffsetMs(guess, tz);
    t = guess - tzOffsetMs(t, tz);
    return t;
  } catch (_) {
    return new Date(y, mo, d, h, mi, s).getTime(); // unknown zone: treat as local
  }
}

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
function safeTz(tz) {
  if (!tz) return LOCAL_TZ;
  tz = WIN_TZ[tz] || tz;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (_) { return LOCAL_TZ; }
}

// Returns { t: epoch ms, allDay, tz }
function parseDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec((value || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { t: new Date(+y, +mo - 1, +d).getTime(), allDay: true, tz: LOCAL_TZ };
  if (z) return { t: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)), allDay: false, tz: 'UTC' };
  const tz = safeTz(params && params.TZID);
  return { t: zoned(+y, +mo - 1, +d, +h, +mi, +(s || 0), tz), allDay: false, tz };
}

// Wall-clock parts of an instant in a zone
function wallParts(t, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month - 1, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v || '');
  if (!m) return 0;
  const ms = ((+m[2] || 0) * 7 * 86400 + (+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

const LINK_RE = /https?:\/\/(?:[\w-]+\.)*(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|meet\.jit\.si)\/[^\s<>"')\]]+/i;

function parseIcs(text) {
  const events = [];
  let cur = null;
  for (const raw of unfold(text)) {
    if (raw === 'BEGIN:VEVENT') { cur = { exdates: new Set() }; continue; }
    if (raw === 'END:VEVENT') { if (cur && cur.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const l = parseLine(raw);
    if (!l) continue;
    switch (l.name) {
      case 'UID': cur.uid = l.value; break;
      case 'SUMMARY': cur.title = unescape(l.value); break;
      case 'LOCATION': cur.location = unescape(l.value); break;
      case 'DESCRIPTION': cur.description = unescape(l.value); break;
      case 'URL': cur.url = l.value; break;
      case 'STATUS': cur.status = l.value.toUpperCase(); break;
      case 'RRULE': cur.rrule = Object.fromEntries(l.value.split(';').map((kv) => kv.split('='))); break;
      case 'DTSTART': { const d = parseDate(l.value, l.params); if (d) { cur.start = d.t; cur.allDay = d.allDay; cur.tz = d.tz; } break; }
      case 'DTEND': { const d = parseDate(l.value, l.params); if (d) cur.end = d.t; break; }
      case 'DURATION': cur.duration = parseDuration(l.value); break;
      case 'EXDATE': for (const v of l.value.split(',')) { const d = parseDate(v, l.params); if (d) cur.exdates.add(d.t); } break;
      case 'RECURRENCE-ID': { const d = parseDate(l.value, l.params); if (d) cur.recurrenceId = d.t; break; }
      case 'X-GOOGLE-CONFERENCE': cur.conference = l.value; break;
    }
  }
  for (const e of events) {
    if (!e.end) e.end = e.start + (e.duration || (e.allDay ? 86400000 : 0));
    const hay = [e.conference, e.location, e.url, e.description].filter(Boolean).join(' ');
    const m = LINK_RE.exec(hay);
    e.link = m ? m[0] : null;
  }
  return events;
}

const DAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// Recurrences are generated on the event's own wall clock (its TZID), as RFC 5545 requires,
// so weekdays and DST transitions are right even when this PC is in another zone.
function* occurrences(ev, limitEnd) {
  const r = ev.rrule;
  const freq = (r.FREQ || '').toUpperCase();
  const interval = Math.max(1, +r.INTERVAL || 1);
  const count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? (parseDate(r.UNTIL, {}) || {}).t : Infinity;
  const tz = ev.tz || LOCAL_TZ;
  const w = wallParts(ev.start, tz);
  const dow = new Date(Date.UTC(w.y, w.mo, w.d)).getUTCDay();
  const wall = (y, mo, d) => Date.UTC(y, mo, d, w.h, w.mi, w.s); // "fake UTC" wall time
  const toReal = (fake) => {
    const d = new Date(fake);
    return zoned(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), tz);
  };
  const byDay = r.BYDAY ? r.BYDAY.split(',').map((d) => DAY[d.slice(-2)]).filter((x) => x !== undefined) : null;
  let n = 0;

  for (let k = 0; k < 5000; k++) {
    let batch;
    if (freq === 'DAILY') batch = [wall(w.y, w.mo, w.d + k * interval)];
    else if (freq === 'WEEKLY') {
      const days = byDay && byDay.length ? [...byDay].sort((a, b) => a - b) : [dow];
      batch = days.map((d) => wall(w.y, w.mo, w.d - dow + k * 7 * interval + d));
    } else if (freq === 'MONTHLY') batch = [wall(w.y, w.mo + k * interval, w.d)];
    else if (freq === 'YEARLY') batch = [wall(w.y + k * interval, w.mo, w.d)];
    else return;
    for (const fake of batch) {
      if ((freq === 'MONTHLY' || freq === 'YEARLY') && new Date(fake).getUTCDate() !== w.d) continue; // no Feb 30
      const t = toReal(fake);
      if (t > limitEnd || t > until || n >= count) return;
      if (t < ev.start) continue;
      n++;
      yield t;
    }
  }
}

function expand(events, from, to) {
  const overrides = new Map(); // uid -> Set(recurrenceId)
  for (const e of events) if (e.recurrenceId) {
    if (!overrides.has(e.uid)) overrides.set(e.uid, new Set());
    overrides.get(e.uid).add(e.recurrenceId);
  }
  const out = [];
  for (const e of events) {
    if (e.status === 'CANCELLED') continue;
    const dur = e.end - e.start;
    const push = (t) => {
      if (t + dur < from || t > to) return;
      out.push({
        id: `${e.uid || e.title}@${t}`, title: e.title || '(No title)', start: t, end: t + dur,
        allDay: !!e.allDay, location: e.location || '', link: e.link
      });
    };
    if (e.rrule && !e.recurrenceId) {
      const skip = overrides.get(e.uid) || new Set();
      for (const t of occurrences(e, to)) if (!e.exdates.has(t) && !skip.has(t)) push(t);
    } else push(e.start);
  }
  return out.sort((a, b) => a.start - b.start);
}

async function fetchCalendar(url, days = 7) {
  if (!url) return { events: [], error: null };
  const u = url.trim().replace(/^webcal:\/\//i, 'https://');
  if (!/^https:\/\//i.test(u)) return { events: [], error: 'Use an https:// or webcal:// ICS link' };
  const res = await fetch(u, { headers: { 'User-Agent': 'Atoll/0.1' } });
  if (!res.ok) return { events: [], error: `Calendar returned ${res.status}` };
  const now = Date.now();
  const events = expand(parseIcs(await res.text()), now - 12 * 3600e3, now + days * 86400e3);
  return { events, error: null, fetchedAt: now };
}

module.exports = { LINK_RE, parseIcs, expand, fetchCalendar, parseDate };
