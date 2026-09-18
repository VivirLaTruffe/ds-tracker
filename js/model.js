/* Data model: constants, defaults, validation and small date helpers. No DOM here. */
'use strict';

const DATA_VERSION = 1;

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
    });
  });

  return { version: DATA_VERSION, subjects, exams };
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

function formatDuration(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${pad2(m)}` : `${h} h`;
}
