const { LINK_RE } = require('./calendar');
async function readAppleCalendar(selectedIds = [], requestAccess = false) {
  const platform = require(require('path').join(process.resourcesPath, 'helper', 'platform.node'));
  const result = JSON.parse(await platform.calendarEvents(requestAccess));
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  return {
    authorized: !!result.authorized, calendars: result.calendars || [], error: result.error || null, fetchedAt: Date.now(),
    events: (result.events || []).filter(event => !selected.size || selected.has(event.calendarId)).map(({ notes, url, ...event }) => ({
      ...event, link: ([url, event.location, notes].filter(Boolean).join(' ').match(LINK_RE) || [])[0] || null
    }))
  };
}
module.exports = { readAppleCalendar };
