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

/* ---- Writing: the exams as an iCalendar file, for a phone or desktop calendar ---- */

function icsEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets, as RFC 5545 asks (continuation lines start with a space). */
function icsFold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

function icsLocalStamp(dateStr, time) {
  return `${dateStr.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

/**
 * Upcoming exams as an .ics file. Times are written as floating local times (no time zone):
 * the calendar shows them at the hour typed in the app, wherever the phone is. An exam without
 * a start time becomes an all-day event. Each event has a reminder the day before.
 */
function buildICS(exams, subjectOf) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DS Tracker//FR', 'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:DS Tracker'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  for (const exam of exams) {
    const subject = subjectOf(exam.subjectId);
    const type = EXAM_TYPES.find((t) => t.id === exam.type);
    const summary = ['DS', subject.name, exam.title].filter(Boolean).join(' — ');
    const details = [type ? type.label : '', exam.notes];
    if (exam.checklist.length) {
      details.push('Chapitres :\n' + exam.checklist.map((c) => `${c.done ? '[x]' : '[ ]'} ${c.text}`).join('\n'));
    }
    lines.push('BEGIN:VEVENT', `UID:${exam.id}@ds-tracker`, `DTSTAMP:${stamp}`, `SUMMARY:${icsEscape(summary)}`);
    if (exam.time) {
      const start = parseLocalDateTime(`${exam.date}T${exam.time}`);
      const end = new Date(start.getTime() + (exam.duration || 60) * 60000);
      lines.push(`DTSTART:${icsLocalStamp(exam.date, exam.time)}`,
        `DTEND:${icsLocalStamp(toDateStr(end), `${pad2(end.getHours())}:${pad2(end.getMinutes())}`)}`);
    } else {
      const next = parseDateStr(exam.date);
      next.setDate(next.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${exam.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${toDateStr(next).replace(/-/g, '')}`);
    }
    const description = details.filter(Boolean).join('\n\n');
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(summary)} demain`, 'TRIGGER:-P1D',
      'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
