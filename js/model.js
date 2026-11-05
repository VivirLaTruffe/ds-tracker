/* Data model: constants, defaults, validation and small date helpers. No DOM here. */
'use strict';

const DATA_VERSION = 3;

const EXAM_TYPES = [
  { id: 'qcm', label: 'QCM' },
  { id: 'dst', label: 'DST (sur table)' },
  { id: 'online', label: 'En ligne' },
  { id: 'oral', label: 'Oral' },
  { id: 'tp', label: 'TP noté' },
  { id: 'machine', label: 'Sur machine' },
  { id: 'project', label: 'Projet / rapport' },
  { id: 'other', label: 'Autre' },
];

const IMPORTANCE_LEVELS = [
  { id: 1, label: 'Faible' },
  { id: 2, label: 'Normale' },
  { id: 3, label: 'Élevée' },
  { id: 4, label: 'Critique' },
];

const DURATION_PRESETS = [30, 45, 60, 90, 120, 180, 240];

/** How early a TD should show up in "to prepare now": 0 = only on the day itself. */
const TD_LEAD_OPTIONS = [
  { id: 0, label: 'Le jour même' },
  { id: 1, label: 'La veille et le jour même' },
  { id: 2, label: '2 jours avant' },
  { id: 3, label: '3 jours avant' },
];
const DEFAULT_TD_LEAD_DAYS = 1;
const MAX_EVENTS = 5000;
const MAX_CHECKLIST = 50;
const MAX_DISMISSED = 500;

const SUBJECT_COLORS = [
  '#4f6df5', '#e5484d', '#30a46c', '#f5a524', '#8e4ec6', '#0091b2',
  '#e93d82', '#12a594', '#a2632a', '#6b7280',
];

const DEFAULT_SUBJECT_NAMES = [
  'Anglais',
  'Communication',
  'Électromagnétisme et Optique',
  'Équations différentielles',
  'Mécanique',
  'Thermodynamique',
  'Bases de données',
  'C++',
  'C#',
  'HTML / PHP',
  'Intelligence artificielle',
  'Rapport',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const EVENT_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/; // local date-time, 'YYYY-MM-DDTHH:MM'

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function defaultData() {
  return {
    version: DATA_VERSION,
    subjects: DEFAULT_SUBJECT_NAMES.map((name, i) => ({
      id: newId(),
      name,
      color: SUBJECT_COLORS[i % SUBJECT_COLORS.length],
    })),
    exams: [],
    schedule: { events: [], importedAt: '', source: '' },
    aliases: {},
    tdDone: {},
    tdNotes: {},
    dsDismissed: [],
    settings: { tdLeadDays: DEFAULT_TD_LEAD_DAYS, autoImportDs: true },
  };
}

/** A checklist item ({id, text, done}) from untrusted input, or null. */
function sanitizeChecklistItem(item) {
  if (!item || typeof item.text !== 'string' || !item.text.trim()) return null;
  return {
    id: typeof item.id === 'string' && item.id ? item.id.slice(0, 60) : newId(),
    text: item.text.trim().slice(0, 120),
    done: item.done === true,
  };
}

/**
 * Validate and normalise untrusted data (an imported/linked file or localStorage).
 * Throws an Error with a user-readable message when the file is unusable;
 * silently repairs individual bad fields; drops entries that cannot be repaired.
 */
function sanitizeData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error("Ce fichier n'a pas le format attendu.");
  }
  const version = Number.isInteger(raw.version) ? raw.version : 1;
  if (version > DATA_VERSION) {
    throw new Error(`Ce fichier vient d'une version plus récente de l'app (v${version}).`);
  }

  const subjects = [];
  const seenSubjectIds = new Set();
  (Array.isArray(raw.subjects) ? raw.subjects : []).forEach((s, i) => {
    if (!s || typeof s.name !== 'string' || !s.name.trim()) return;
    let id = typeof s.id === 'string' && s.id ? s.id : newId();
    if (seenSubjectIds.has(id)) id = newId();
    seenSubjectIds.add(id);
    subjects.push({
      id,
      name: s.name.trim().slice(0, 80),
      color: COLOR_RE.test(s.color) ? s.color : SUBJECT_COLORS[i % SUBJECT_COLORS.length],
    });
  });

  const exams = [];
  const seenExamIds = new Set();
  (Array.isArray(raw.exams) ? raw.exams : []).forEach((e) => {
    if (!e || typeof e.date !== 'string' || !DATE_RE.test(e.date)) return;
    let id = typeof e.id === 'string' && e.id ? e.id : newId();
    if (seenExamIds.has(id)) id = newId();
    seenExamIds.add(id);
    const duration = Number.isFinite(e.duration) ? Math.round(e.duration) : 0;
    exams.push({
      id,
      title: typeof e.title === 'string' ? e.title.trim().slice(0, 120) : '',
      subjectId: typeof e.subjectId === 'string' ? e.subjectId : '',
      type: EXAM_TYPES.some((t) => t.id === e.type) ? e.type : 'other',
      date: e.date,
      time: typeof e.time === 'string' && TIME_RE.test(e.time) ? e.time : '',
      duration: duration >= 0 && duration <= 1440 ? duration : 0,
      importance: IMPORTANCE_LEVELS.some((l) => l.id === e.importance) ? e.importance : 2,
      revised: e.revised === true,
      notes: typeof e.notes === 'string' ? e.notes.slice(0, 2000) : '',
      // v3: chapters to revise, and the timetable event an exam was imported from.
      checklist: (Array.isArray(e.checklist) ? e.checklist : [])
        .map(sanitizeChecklistItem).filter(Boolean).slice(0, MAX_CHECKLIST),
      source: typeof e.source === 'string' ? e.source.slice(0, 200) : '',
      sourceKey: typeof e.sourceKey === 'string' ? e.sourceKey.slice(0, 260) : '',
    });
  });

  // ---- v2: imported timetable, course-name -> subject aliases, TD "prepared" flags, settings.
  // A v1 file simply has none of these and gets the empty defaults.
  const sch = raw.schedule && typeof raw.schedule === 'object' && !Array.isArray(raw.schedule) ? raw.schedule : {};
  const events = [];
  const seenEventUids = new Set();
  (Array.isArray(sch.events) ? sch.events : []).slice(0, MAX_EVENTS).forEach((ev) => {
    if (!ev || typeof ev.title !== 'string' || typeof ev.start !== 'string' || !EVENT_DT_RE.test(ev.start)) return;
    const end = typeof ev.end === 'string' && EVENT_DT_RE.test(ev.end) && ev.end >= ev.start ? ev.end : ev.start;
    let uid = typeof ev.uid === 'string' && ev.uid ? ev.uid.slice(0, 200) : `${ev.title}|${ev.start}`;
    if (seenEventUids.has(uid)) uid = `${uid}#${events.length}`;
    seenEventUids.add(uid);
    events.push({
      uid,
      title: ev.title.trim().slice(0, 200),
      start: ev.start,
      end,
      location: typeof ev.location === 'string' ? ev.location.trim().slice(0, 120) : '',
    });
  });

  const aliases = {};
  if (raw.aliases && typeof raw.aliases === 'object' && !Array.isArray(raw.aliases)) {
    for (const [k, v] of Object.entries(raw.aliases)) {
      if (k !== '__proto__' && typeof v === 'string') aliases[k.slice(0, 200)] = v;
    }
  }
  const tdDone = {};
  if (raw.tdDone && typeof raw.tdDone === 'object' && !Array.isArray(raw.tdDone)) {
    for (const [k, v] of Object.entries(raw.tdDone)) {
      if (k !== '__proto__' && v === true) tdDone[k.slice(0, 200)] = true;
    }
  }
  const lead = raw.settings && raw.settings.tdLeadDays;
  const tdLeadDays = TD_LEAD_OPTIONS.some((o) => o.id === lead) ? lead : DEFAULT_TD_LEAD_DAYS;

  // ---- v3: a note per TD, exams auto-imported from the timetable and later deleted by the
  // user (so a re-import does not bring them back), and the auto-import switch.
  const tdNotes = {};
  if (raw.tdNotes && typeof raw.tdNotes === 'object' && !Array.isArray(raw.tdNotes)) {
    for (const [k, v] of Object.entries(raw.tdNotes)) {
      if (k !== '__proto__' && typeof v === 'string' && v.trim()) tdNotes[k.slice(0, 200)] = v.slice(0, 1000);
    }
  }
  const dsDismissed = (Array.isArray(raw.dsDismissed) ? raw.dsDismissed : [])
    .filter((k) => typeof k === 'string' && k).map((k) => k.slice(0, 260)).slice(-MAX_DISMISSED);
  const autoImportDs = !(raw.settings && raw.settings.autoImportDs === false);

  return {
    version: DATA_VERSION,
    subjects,
    exams,
    schedule: {
      events,
      importedAt: typeof sch.importedAt === 'string' ? sch.importedAt.slice(0, 40) : '',
      source: typeof sch.source === 'string' ? sch.source.slice(0, 200) : '',
    },
    aliases,
    tdDone,
    tdNotes,
    dsDismissed,
    settings: { tdLeadDays, autoImportDs },
  };
}

/* ---- Dates: everything is local time, dates are 'YYYY-MM-DD' strings ---- */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayStr() {
  return toDateStr(new Date());
}

/** Whole calendar days from today to dateStr (negative = past). DST-safe. */
function daysUntil(dateStr, from = todayStr()) {
  const a = parseDateStr(from);
  const b = parseDateStr(dateStr);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
    - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

/** 'YYYY-MM-DDTHH:MM' (local) -> Date */
function parseLocalDateTime(s) {
  return new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)),
    Number(s.slice(11, 13)), Number(s.slice(14, 16)));
}

function formatDuration(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${pad2(m)}` : `${h} h`;
}
