/*
 * Timetable logic (pure functions, no DOM): what kind of session is an event, which subject does
 * it belong to, and which TD should be prepared right now.
 */
'use strict';

function normalizeText(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * 'ds' | 'td' | 'tp' | 'cm' | 'other', guessed from the event title.
 * Titles look like "Mathématiques TD 01", "1- Electrostatique_TD1", "Winform_CM 01", "DS1 - Partie 1_CM1".
 * "DS" wins over the session type: "DS Classe, ..._TP1" is an exam, not a lab.
 */
function classifyEvent(title) {
  const t = ` ${normalizeText(title)} `;
  if (/[^a-z0-9](?:ds\d*|devoir surveille|partiel|examen)(?![a-z0-9])/.test(t)) return 'ds';
  if (/[^a-z0-9]td\s?\d*(?![a-z])/.test(t)) return 'td';
  if (/[^a-z0-9]tp\s?\d*(?![a-z])/.test(t)) return 'tp';
  if (/[^a-z0-9]cm\s?\d*(?![a-z])/.test(t)) return 'cm';
  return 'other';
}

/** "Mathématiques TD 01" -> { label: "Mathématiques", suffix: "TD 01" } */
function courseLabel(title) {
  const s = title.trim().replace(/^\d+\s*[-–.)]\s*/, ''); // "1- Electrostatique_TD1" -> "Electrostatique_TD1"
  const m = /(?:^|[\s_-]+)((?:td|tp|cm)\s?\d*)(?![a-z]).*$/i.exec(s);
  if (!m) return { label: s, suffix: '' };
  return { label: s.slice(0, m.index).trim(), suffix: m[1].toUpperCase() };
}

/** Subject whose name looks like the course label ("Mécanique" ~ "Mécanique cinématique"), or null. */
function autoSubjectForLabel(label, subjects) {
  const key = normalizeText(label);
  if (key.length < 4) return null;
  for (const s of subjects) {
    const n = normalizeText(s.name);
    if (n.length >= 4 && (key.includes(n) || n.includes(key))) return s;
  }
  return null;
}

/** An explicit alias chosen by the user wins over the automatic name match. */
function subjectForLabel(label, data) {
  const aliasId = data.aliases[normalizeText(label)];
  if (aliasId) {
    const s = data.subjects.find((x) => x.id === aliasId);
    if (s) return s;
  }
  return autoSubjectForLabel(label, data.subjects);
}

/** Every TD of the imported timetable, soonest first. */
function buildTdItems(data) {
  return data.schedule.events
    .filter((ev) => classifyEvent(ev.title) === 'td')
    .map((ev) => {
      const { label, suffix } = courseLabel(ev.title);
      return {
        key: ev.uid,
        ev,
        label,
        suffix,
        subject: subjectForLabel(label, data),
        day: ev.start.slice(0, 10),
        start: parseLocalDateTime(ev.start),
        end: parseLocalDateTime(ev.end),
        done: data.tdDone[ev.uid] === true,
      };
    })
    .sort((a, b) => a.start - b.start);
}

/** Not prepared yet, class not over, and within `lead` days (0 = the day itself). */
function isPrepNow(item, lead, now = new Date()) {
  if (item.done || item.end <= now) return false;
  const d = daysUntil(item.day, toDateStr(now));
  return d >= 0 && d <= lead;
}

/**
 * Merge freshly parsed events into data.schedule. Events whose day falls inside the imported range
 * are replaced (so re-importing an updated week fixes it); older/later ones are kept, which lets
 * the user import the timetable in several chunks. "Prepared" flags survive a re-import.
 */
function mergeSchedule(data, events, source) {
  const days = events.map((e) => e.start.slice(0, 10)).sort();
  const lo = days[0];
  const hi = days[days.length - 1];
  const inRange = (e) => e.start.slice(0, 10) >= lo && e.start.slice(0, 10) <= hi;

  // ADE may hand out different UIDs on each export: remember what was done by title + start too.
  const doneByTitleStart = new Set(
    data.schedule.events.filter((e) => inRange(e) && data.tdDone[e.uid]).map((e) => `${e.title}|${e.start}`));

  const kept = data.schedule.events.filter((e) => !inRange(e));
  const merged = kept.concat(events).sort((a, b) => a.start.localeCompare(b.start)).slice(0, MAX_EVENTS);
  data.schedule.events = merged;
  data.schedule.importedAt = new Date().toISOString();
  data.schedule.source = source.slice(0, 200);

  const uids = new Set(merged.map((e) => e.uid));
  for (const e of events) {
    if (doneByTitleStart.has(`${e.title}|${e.start}`)) data.tdDone[e.uid] = true;
  }
  for (const k of Object.keys(data.tdDone)) if (!uids.has(k)) delete data.tdDone[k];
}
