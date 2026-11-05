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
  // Same for the notes written on a TD.
  const noteByTitleStart = new Map(
    data.schedule.events.filter((e) => inRange(e) && data.tdNotes[e.uid]).map((e) => [`${e.title}|${e.start}`, data.tdNotes[e.uid]]));

  const kept = data.schedule.events.filter((e) => !inRange(e));
  const merged = kept.concat(events).sort((a, b) => a.start.localeCompare(b.start)).slice(0, MAX_EVENTS);
  data.schedule.events = merged;
  data.schedule.importedAt = new Date().toISOString();
  data.schedule.source = source.slice(0, 200);

  const uids = new Set(merged.map((e) => e.uid));
  for (const e of events) {
    if (doneByTitleStart.has(`${e.title}|${e.start}`)) data.tdDone[e.uid] = true;
    const note = noteByTitleStart.get(`${e.title}|${e.start}`);
    if (note && !data.tdNotes[e.uid]) data.tdNotes[e.uid] = note;
  }
  for (const k of Object.keys(data.tdDone)) if (!uids.has(k)) delete data.tdDone[k];
  for (const k of Object.keys(data.tdNotes)) if (!uids.has(k)) delete data.tdNotes[k];
}

/* ---- DS found in the timetable become exams to revise ---- */

/** Stable identity of a timetable event when its UID changes between two exports. */
function dsKey(ev) {
  return `${normalizeText(ev.title)}|${ev.start}`;
}

/** Exam type guessed from a DS title ("QCM Bases de données", "DS machine C++"...). */
function guessExamType(title) {
  const t = ` ${normalizeText(title)} `;
  if (/[^a-z]qcm[^a-z]/.test(t)) return 'qcm';
  if (/[^a-z]oral[^a-z]/.test(t)) return 'oral';
  if (/[^a-z](machine|ordinateur|pc)[^a-z]/.test(t)) return 'machine';
  if (/[^a-z0-9]tp\s?\d*(?![a-z])/.test(t)) return 'tp';
  if (/[^a-z](en ligne|online|moodle)[^a-z]/.test(t)) return 'online';
  return 'dst';
}

/**
 * Create an exam for every upcoming DS of the timetable that is not tracked yet.
 *
 * - An exam remembers the event it came from (UID, plus title + start because ADE may
 *   change UIDs between exports), so re-importing never duplicates it.
 * - If the DS moved in the timetable, its date, time and duration follow; everything the
 *   user added (chapters, notes, importance, "revised") is kept.
 * - A DS the user deleted stays deleted (data.dsDismissed).
 * Returns { added, updated }.
 */
function syncDsFromSchedule(data, events, now = new Date()) {
  const result = { added: 0, updated: 0 };
  if (!data.settings.autoImportDs) return result;
  const today = toDateStr(now);
  const dismissed = new Set(data.dsDismissed);

  for (const ev of events) {
    if (classifyEvent(ev.title) !== 'ds' || ev.start.slice(0, 10) < today) continue;
    const key = dsKey(ev);
    if (dismissed.has(ev.uid) || dismissed.has(key)) continue;

    const date = ev.start.slice(0, 10);
    const time = ev.start.slice(11, 16);
    const duration = Math.max(0, Math.round((parseLocalDateTime(ev.end) - parseLocalDateTime(ev.start)) / 60000));
    const existing = data.exams.find((e) => (e.source && e.source === ev.uid) || (e.sourceKey && e.sourceKey === key));
    if (existing) {
      if (existing.date !== date || existing.time !== time || existing.duration !== duration) {
        Object.assign(existing, { date, time, duration });
        result.updated += 1;
      }
      existing.source = ev.uid;
      existing.sourceKey = key;
      continue;
    }

    const { label } = courseLabel(ev.title);
    const subject = subjectForLabel(label, data);
    data.exams.push({
      id: newId(),
      title: label.slice(0, 120),
      subjectId: subject ? subject.id : '',
      type: guessExamType(ev.title),
      date,
      time,
      duration: duration <= 1440 ? duration : 0,
      importance: 2,
      revised: false,
      notes: ev.location ? `Salle : ${ev.location}` : '',
      checklist: [],
      source: ev.uid,
      sourceKey: key,
    });
    result.added += 1;
  }
  return result;
}

/** Remember that an imported DS was deleted on purpose, so a re-import skips it. */
function dismissImportedDs(data, exam) {
  if (!exam.source && !exam.sourceKey) return;
  for (const k of [exam.source, exam.sourceKey]) {
    if (k && !data.dsDismissed.includes(k)) data.dsDismissed.push(k);
  }
  if (data.dsDismissed.length > MAX_DISMISSED) data.dsDismissed = data.dsDismissed.slice(-MAX_DISMISSED);
}
