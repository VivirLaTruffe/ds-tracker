/*
 * Minimal iCalendar (.ics) reader — just enough for a school timetable export (ADE and friends).
 * Keeps only what the app needs: uid, title, start, end, location. The description is dropped on
 * purpose (it usually holds teacher names). Everything is parsed locally, nothing leaves the browser.
 */
'use strict';

function icsUnescape(text) {
  return text.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

/** 'YYYYMMDD[THHMM[SS][Z]]' -> local 'YYYY-MM-DDTHH:MM', or '' if unreadable. */
function icsDateToLocal(value) {
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T00:00`; // all-day event
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(?:\d{2})?(Z?)$/.exec(value);
  if (!m) return '';
  const [, y, mo, d, h, mi, utc] = m;
  if (!utc) return `${y}-${mo}-${d}T${h}:${mi}`; // floating or TZID=...: taken as the user's local time
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}T${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

/** Returns [{uid, title, start, end, location}]. Throws if the text is not an iCalendar file. */
function parseICS(text) {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("Ce fichier n'est pas un calendrier iCalendar (.ics).");
  // Unfold: a line starting with a space/tab continues the previous one.
  const lines = text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');

  const events = [];
  let cur = null;
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (upper === 'END:VEVENT') {
      if (cur) {
        const ev = finishIcsEvent(cur);
        if (ev) events.push(ev);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const name = line.slice(0, idx).split(';')[0].toUpperCase();
    if (!(name in cur)) cur[name] = line.slice(idx + 1); // first occurrence wins
  }
  return events.slice(0, MAX_EVENTS);
}

function finishIcsEvent(raw) {
  if ((raw.STATUS || '').toUpperCase() === 'CANCELLED') return null;
  const title = icsUnescape(raw.SUMMARY || '').slice(0, 200);
  const start = icsDateToLocal((raw.DTSTART || '').trim());
  if (!title || !start) return null;
  const endCandidate = icsDateToLocal((raw.DTEND || '').trim());
  const end = endCandidate && endCandidate >= start ? endCandidate : start;
  return {
    uid: (raw.UID || '').trim().slice(0, 200) || `${title}|${start}`,
    title,
    start,
    end,
    location: icsUnescape(raw.LOCATION || '').slice(0, 120),
  };
}
