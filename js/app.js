/* UI + application state. Depends on model.js and storage.js. */
'use strict';

/* ------------------------------------------------------------------ helpers */

const $ = (id) => document.getElementById(id);

/** Tiny DOM builder. Text is always inserted as text nodes, never as HTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (val == null || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key === 'vars') for (const [k, v] of Object.entries(val)) el.style.setProperty(k, v);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), val);
    else if (key === 'aria' || key === 'data') {
      for (const [k, v] of Object.entries(val)) el.setAttribute(key === 'aria' ? `aria-${k}` : `data-${k}`, v);
    } else if (key in el) el[key] = val;
    else el.setAttribute(key, val === true ? '' : val);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

function option(value, label, selected) {
  return h('option', { value, selected: !!selected }, label);
}

const fmtDate = (s, opts) => parseDateStr(s).toLocaleDateString('fr-FR', opts);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/* -------------------------------------------------------------------- state */

const state = {
  data: null,
  view: 'list',
  calMonth: todayStr().slice(0, 7), // 'YYYY-MM'
  filters: { subject: '', type: '', importance: '', revision: '', showPast: false },
  file: 'none', // 'none' | 'ready' | 'needs-permission'
  save: 'idle', // 'idle' | 'saving' | 'saved' | 'error'
  editingId: null,
};

const UNKNOWN_SUBJECT = { id: '', name: 'Sans matière', color: '#6b7280' };

function subjectById(id) {
  return state.data.subjects.find((s) => s.id === id) || UNKNOWN_SUBJECT;
}

function savePrefs() {
  Local.savePrefs({ view: state.view, filters: state.filters });
}

/* ---------------------------------------------------------------- persistence */

let writeTimer = null;
let writeInFlight = false;
let writePending = false;

/** Apply a change to the data, re-render, and persist everywhere. */
function commit(mutator) {
  mutator(state.data);
  Local.saveData(state.data);
  scheduleFileWrite();
  render();
}

function scheduleFileWrite() {
  if (state.file !== 'ready') return;
  writePending = true;
  setSave('saving');
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flushFileWrite, 250);
}

async function flushFileWrite() {
  if (writeInFlight) return; // the running write re-checks writePending when it finishes
  writeInFlight = true;
  try {
    while (writePending) {
      writePending = false;
      await FileLink.write(state.data);
    }
    setSave('saved');
  } catch (e) {
    setSave('error');
    showBanner(`Impossible d'écrire dans « ${FileLink.name} » (${e.message || e.name}).`, 'err', {
      label: 'Réessayer',
      run: () => {
        hideBanner();
        writePending = true;
        setSave('saving');
        flushFileWrite();
      },
    });
  } finally {
    writeInFlight = false;
  }
}

function replaceData(data) {
  state.data = data;
  Local.saveData(state.data);
  scheduleFileWrite();
  render();
}

/** Use data that just came *from* the linked file: no need to write it back. */
function adoptData(data) {
  state.data = data;
  Local.saveData(data);
  render();
}

function sameContent(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ------------------------------------------------------------ banner / toast */

function showBanner(message, kind, action) {
  const box = $('banner');
  box.className = 'banner' + (kind === 'err' ? ' err' : '');
  box.replaceChildren(h('span', {}, message));
  if (action) box.append(h('button', { type: 'button', onclick: action.run }, action.label));
  box.hidden = false;
}

function hideBanner() {
  $('banner').hidden = true;
}

let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function setSave(status) {
  state.save = status;
  renderStatus();
}

function renderStatus() {
  const el = $('save-status');
  let text = '';
  let cls = 'status';
  if (state.file === 'ready') {
    if (state.save === 'saving') text = 'Enregistrement…';
    else if (state.save === 'error') { text = '⚠ Échec de l\'enregistrement'; cls += ' err'; }
    else { text = `✓ Lié à ${FileLink.name}`; cls += ' ok'; }
  } else if (state.file === 'needs-permission') {
    text = `Fichier ${FileLink.name} : reconnexion requise`;
    cls += ' warn';
  } else {
    text = FileLink.supported
      ? 'Données dans ce navigateur uniquement'
      : 'Données dans ce navigateur (utilise Exporter pour les sauvegarder)';
    cls += ' warn';
  }
  el.className = cls;
  el.textContent = text;
}

/* ------------------------------------------------------------------- exams */

function examSortKey(e) {
  return `${e.date} ${e.time || '99:99'}`;
}

function filteredExams({ includePast }) {
  const f = state.filters;
  return state.data.exams
    .filter((e) => (!f.subject || e.subjectId === f.subject)
      && (!f.type || e.type === f.type)
      && (!f.importance || e.importance >= Number(f.importance))
      && (!f.revision || (f.revision === 'todo' ? !e.revised : e.revised))
      && (includePast || daysUntil(e.date) >= 0))
    .sort((a, b) => examSortKey(a).localeCompare(examSortKey(b)) || b.importance - a.importance);
}

/** '' | 'warn' | 'danger' — how loudly an unprepared exam should shout. */
function urgency(exam) {
  if (exam.revised) return '';
  const d = daysUntil(exam.date);
  if (d < 0) return '';
  if (d <= 2 || (exam.importance >= 3 && d <= 7)) return 'danger';
  if (d <= 7 || (exam.importance >= 3 && d <= 14)) return 'warn';
  return '';
}

function countdownLabel(d) {
  if (d < 0) return { big: 'Passé', small: `il y a ${plural(-d, 'jour', 'jours')}` };
  if (d === 0) return { big: "Aujourd'hui", small: '' };
  if (d === 1) return { big: 'Demain', small: '' };
  return { big: `J-${d}`, small: d >= 14 ? `${Math.round(d / 7)} sem.` : '' };
}

function toggleRevised(id) {
  commit((data) => {
    const exam = data.exams.find((e) => e.id === id);
    if (exam) exam.revised = !exam.revised;
  });
}

/* -------------------------------------------------------------- summary tiles */

function renderSummary() {
  const upcoming = state.data.exams
    .filter((e) => daysUntil(e.date) >= 0)
    .sort((a, b) => examSortKey(a).localeCompare(examSortKey(b)));
  const next = upcoming[0];
  const todo = upcoming.filter((e) => !e.revised);
  const week = upcoming.filter((e) => daysUntil(e.date) <= 7);
  const urgentTodo = todo.filter((e) => urgency(e) === 'danger');

  const tiles = [];
  if (next) {
    const d = daysUntil(next.date);
    tiles.push(h('div', { class: 'tile' },
      h('div', { class: 'label' }, 'Prochain DS'),
      h('div', { class: 'value' }, countdownLabel(d).big),
      h('div', { class: 'sub' }, subjectById(next.subjectId).name)));
  } else {
    tiles.push(h('div', { class: 'tile' },
      h('div', { class: 'label' }, 'Prochain DS'),
      h('div', { class: 'value' }, '—'),
      h('div', { class: 'sub' }, 'Aucun DS à venir')));
  }
  tiles.push(h('div', { class: 'tile' },
    h('div', { class: 'label' }, 'À venir'),
    h('div', { class: 'value' }, upcoming.length),
    h('div', { class: 'sub' }, `dont ${week.length} dans les 7 jours`)));
  tiles.push(h('div', { class: 'tile' + (urgentTodo.length ? ' alert' : '') },
    h('div', { class: 'label' }, 'Reste à réviser'),
    h('div', { class: 'value' }, todo.length),
    h('div', { class: 'sub' }, urgentTodo.length
      ? `dont ${urgentTodo.length} urgent${urgentTodo.length > 1 ? 's' : ''}`
      : 'rien d\'urgent')));
  $('summary').replaceChildren(...tiles);
}

/* ----------------------------------------------------------------- list view */

function groupExams(exams) {
  const dow = (new Date().getDay() + 6) % 7; // Monday = 0
  const toSunday = 6 - dow;
  const groups = [
    { title: "Aujourd'hui", items: [] },
    { title: 'Cette semaine', items: [] },
    { title: 'Semaine prochaine', items: [] },
    { title: 'Plus tard', items: [] },
    { title: 'Passés', items: [] },
  ];
  for (const e of exams) {
    const d = daysUntil(e.date);
    let idx;
    if (d < 0) idx = 4;
    else if (d === 0) idx = 0;
    else if (d <= toSunday) idx = 1;
    else if (d <= toSunday + 7) idx = 2;
    else idx = 3;
    groups[idx].items.push(e);
  }
  groups[4].items.reverse(); // most recent past exam first
  return groups.filter((g) => g.items.length);
}

function renderExamCard(exam) {
  const subject = subjectById(exam.subjectId);
  const d = daysUntil(exam.date);
  const cd = countdownLabel(d);
  const type = EXAM_TYPES.find((t) => t.id === exam.type);
  const importance = IMPORTANCE_LEVELS.find((l) => l.id === exam.importance);
  const when = [
    fmtDate(exam.date, { weekday: 'short', day: 'numeric', month: 'short' }),
    exam.time,
    formatDuration(exam.duration),
  ].filter(Boolean).join(' · ');

  return h('article', { class: `exam ${d < 0 ? 'past' : urgency(exam)}`, vars: { '--c': subject.color } },
    h('div', { class: 'countdown' }, cd.big, cd.small && h('small', {}, cd.small)),
    h('div', { class: 'exam-main' },
      h('div', { class: 'exam-title' },
        h('span', { class: 'subject' }, subject.name),
        exam.title && [h('span', { class: 'sep' }, ' — '), exam.title]),
      h('div', { class: 'exam-meta' },
        h('span', {}, when),
        h('span', { class: 'badge' }, type ? type.label : 'Autre'),
        h('span', { class: `badge imp-${exam.importance}` }, importance.label)),
      exam.notes && h('div', { class: 'exam-notes' }, exam.notes)),
    h('div', { class: 'exam-side' },
      h('label', { class: 'check revised-toggle' + (exam.revised ? ' done' : '') },
        h('input', { type: 'checkbox', checked: exam.revised, onchange: () => toggleRevised(exam.id) }),
        exam.revised ? 'Révisé' : 'Révisions à finir'),
      h('button', { type: 'button', onclick: () => openExamDialog(exam.id) }, 'Modifier')));
}

function renderList() {
  const exams = filteredExams({ includePast: state.filters.showPast });
  if (!exams.length) {
    const hasAny = state.data.exams.length > 0;
    return h('div', { class: 'empty' },
      h('p', {}, hasAny ? 'Aucun DS ne correspond à ces filtres.' : 'Aucun DS enregistré pour le moment.'),
      !hasAny && h('button', { type: 'button', class: 'primary', onclick: () => openExamDialog(null) }, 'Ajouter mon premier DS'));
  }
  return h('div', {}, groupExams(exams).map((g) =>
    h('section', { class: 'group' },
      h('h2', {}, g.title, h('span', { class: 'count' }, `(${g.items.length})`)),
      h('div', { class: 'cards' }, g.items.map(renderExamCard)))));
}

/* ---------------------------------------------------------------- filters bar */

function renderFilters() {
  const f = state.filters;
  const fill = (id, opts) => { $(id).replaceChildren(...opts); };
  fill('flt-subject', [option('', 'Toutes les matières', !f.subject),
    ...state.data.subjects.map((s) => option(s.id, s.name, f.subject === s.id))]);
  fill('flt-type', [option('', 'Tous les types', !f.type),
    ...EXAM_TYPES.map((t) => option(t.id, t.label, f.type === t.id))]);
  fill('flt-importance', [option('', 'Toute importance', !f.importance),
    ...IMPORTANCE_LEVELS.slice(1).map((l) => option(String(l.id), `${l.label} et plus`, f.importance === String(l.id)))]);
  fill('flt-revision', [option('', 'Toutes les révisions', !f.revision),
    option('todo', 'À réviser', f.revision === 'todo'),
    option('done', 'Révisés', f.revision === 'done')]);
  $('flt-past').checked = f.showPast;
  $('flt-past-wrap').hidden = state.view !== 'list';
  for (const tab of document.querySelectorAll('.tabs button')) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === state.view));
  }
}

/* ---------------------------------------------------------------- main render */

function render() {
  renderStatus();
  renderSummary();
  renderFilters();
  const view = $('view');
  view.replaceChildren(state.view === 'calendar' && typeof renderCalendar === 'function'
    ? renderCalendar()
    : renderList());
}

/* --------------------------------------------------------------- exam dialog */

function fillExamFormOptions() {
  $('f-type').replaceChildren(...EXAM_TYPES.map((t) => option(t.id, t.label)));
  $('f-importance').replaceChildren(...IMPORTANCE_LEVELS.map((l) =>
    h('label', {},
      h('input', { type: 'radio', name: 'importance', value: String(l.id) }),
      h('span', {}, l.label))));
  $('duration-presets').replaceChildren(...DURATION_PRESETS.map((m) =>
    h('button', {
      type: 'button',
      data: { min: m },
      onclick: () => { $('f-duration').value = m; syncDurationChips(); },
    }, formatDuration(m))));
}

function syncDurationChips() {
  const val = Number($('f-duration').value);
  for (const b of $('duration-presets').children) b.classList.toggle('on', Number(b.dataset.min) === val);
}

function fillSubjectSelect(selectedId) {
  const subjects = state.data.subjects;
  const opts = subjects.map((s) => option(s.id, s.name, s.id === selectedId));
  if (selectedId && !subjects.some((s) => s.id === selectedId)) opts.unshift(option('', 'Sans matière', true));
  if (!subjects.length) opts.push(option('', '— ajoute une matière —', true));
  $('f-subject').replaceChildren(...opts);
}

function openExamDialog(id, presetDate) {
  const exam = id ? state.data.exams.find((e) => e.id === id) : null;
  state.editingId = exam ? exam.id : null;
  $('exam-dialog-title').textContent = exam ? 'Modifier le DS' : 'Nouveau DS';
  $('btn-delete').hidden = !exam;
  $('form-error').hidden = true;

  const lastSubject = state.filters.subject || (state.data.subjects[0] && state.data.subjects[0].id) || '';
  fillSubjectSelect(exam ? exam.subjectId : lastSubject);
  $('f-type').value = exam ? exam.type : 'dst';
  $('f-date').value = exam ? exam.date : (presetDate || '');
  $('f-time').value = exam ? exam.time : '';
  $('f-duration').value = exam && exam.duration ? exam.duration : '';
  const importance = String(exam ? exam.importance : 2);
  for (const r of document.querySelectorAll('#f-importance input')) r.checked = r.value === importance;
  $('f-revised').checked = exam ? exam.revised : false;
  $('f-title').value = exam ? exam.title : '';
  $('f-notes').value = exam ? exam.notes : '';
  syncDurationChips();
  $('exam-dialog').showModal();
  if (!exam) $(presetDate ? 'f-subject' : 'f-date').focus();
}

function submitExamForm(event) {
  event.preventDefault();
  const error = (msg) => {
    $('form-error').textContent = msg;
    $('form-error').hidden = false;
  };
  const subjectId = $('f-subject').value;
  const date = $('f-date').value;
  const duration = $('f-duration').value === '' ? 0 : Number($('f-duration').value);
  if (!state.data.subjects.length) return error("Ajoute d'abord une matière (bouton « Gérer… »).");
  if (!subjectId) return error('Choisis une matière.');
  if (!date) return error('Choisis une date.');
  if (!Number.isFinite(duration) || duration < 0 || duration > 1440) return error('La durée doit être comprise entre 0 et 1440 minutes.');

  const checked = document.querySelector('#f-importance input:checked');
  const fields = {
    title: $('f-title').value.trim(),
    subjectId,
    type: $('f-type').value,
    date,
    time: $('f-time').value,
    duration: Math.round(duration),
    importance: checked ? Number(checked.value) : 2,
    revised: $('f-revised').checked,
    notes: $('f-notes').value.trim(),
  };
  commit((data) => {
    const existing = state.editingId && data.exams.find((e) => e.id === state.editingId);
    if (existing) Object.assign(existing, fields);
    else data.exams.push({ id: newId(), ...fields });
  });
  $('exam-dialog').close();
  toast(state.editingId ? 'DS modifié.' : 'DS ajouté.');
}

function deleteEditedExam() {
  if (!state.editingId) return;
  if (!confirm('Supprimer ce DS ?')) return;
  const id = state.editingId;
  commit((data) => { data.exams = data.exams.filter((e) => e.id !== id); });
  $('exam-dialog').close();
  toast('DS supprimé.');
}

/* ----------------------------------------------------------- subjects dialog */

function renderSubjectsManager() {
  const list = $('subjects-list');
  list.replaceChildren(...state.data.subjects.map((s) => {
    const used = state.data.exams.filter((e) => e.subjectId === s.id).length;
    return h('div', { class: 'subject-row' },
      h('input', {
        type: 'color', value: s.color, 'aria-label': `Couleur de ${s.name}`,
        onchange: (ev) => commit((data) => { data.subjects.find((x) => x.id === s.id).color = ev.target.value; }),
      }),
      h('input', {
        type: 'text', value: s.name, maxLength: 80, 'aria-label': 'Nom de la matière',
        onchange: (ev) => {
          const name = ev.target.value.trim();
          if (!name) { ev.target.value = s.name; return; }
          commit((data) => { data.subjects.find((x) => x.id === s.id).name = name; });
        },
      }),
      h('span', { class: 'n' }, plural(used, 'DS', 'DS')),
      h('button', {
        type: 'button', class: 'danger', 'aria-label': `Supprimer ${s.name}`,
        onclick: () => {
          const msg = used
            ? `Supprimer « ${s.name} » ? Ses ${used} DS resteront enregistrés, marqués « Sans matière ».`
            : `Supprimer « ${s.name} » ?`;
          if (!confirm(msg)) return;
          commit((data) => { data.subjects = data.subjects.filter((x) => x.id !== s.id); });
          if (state.filters.subject === s.id) { state.filters.subject = ''; savePrefs(); render(); }
          renderSubjectsManager();
        },
      }, '✕'));
  }));
}

function openSubjectsDialog() {
  renderSubjectsManager();
  $('subjects-dialog').showModal();
}

function closeSubjectsDialog() {
  $('subjects-dialog').close();
  // The exam form may be open underneath: refresh its subject list, keeping the current choice.
  if ($('exam-dialog').open) fillSubjectSelect($('f-subject').value);
}

function addSubject(event) {
  event.preventDefault();
  const input = $('subject-new-name');
  const name = input.value.trim();
  if (!name) return;
  commit((data) => {
    data.subjects.push({ id: newId(), name, color: SUBJECT_COLORS[data.subjects.length % SUBJECT_COLORS.length] });
  });
  input.value = '';
  renderSubjectsManager();
}

/* ----------------------------------------------------------- data file dialog */

function openFileDialog() {
  const current = $('file-current');
  current.textContent = state.file === 'none'
    ? 'Aucun fichier lié : tes DS sont stockés dans ce navigateur.'
    : `Fichier lié : ${FileLink.name}`;
  $('btn-file-unlink').hidden = state.file === 'none';
  $('file-dialog').showModal();
}

function isAbort(e) {
  return e && e.name === 'AbortError';
}

async function linkExistingFile() {
  try {
    const { handle, data, lastModified } = await FileLink.pickExisting();
    if (data && state.data.exams.length && !sameContent(data, state.data)
      && !confirm(`Le contenu de « ${handle.name} » remplacera les ${state.data.exams.length} DS actuellement dans ce navigateur. Continuer ?`)) {
      return;
    }
    await FileLink.attach(handle, lastModified);
    state.file = 'ready';
    hideBanner();
    if (data) adoptData(data);
    else { scheduleFileWrite(); render(); } // empty file: seed it with the current data
    setSave('saved');
    $('file-dialog').close();
    toast(data ? `« ${handle.name} » chargé.` : `« ${handle.name} » lié, données actuelles enregistrées.`);
  } catch (e) {
    if (!isAbort(e)) showBanner(e.message || String(e), 'err');
  }
}

async function linkNewFile() {
  try {
    await FileLink.pickNew(state.data);
    state.file = 'ready';
    hideBanner();
    setSave('saved');
    render();
    $('file-dialog').close();
    toast(`« ${FileLink.name} » créé.`);
  } catch (e) {
    if (!isAbort(e)) showBanner(e.message || String(e), 'err');
  }
}

async function unlinkFile() {
  if (!confirm('Délier le fichier ? Tes DS restent dans ce navigateur et dans le fichier, mais ne seront plus synchronisés.')) return;
  await FileLink.unlink();
  state.file = 'none';
  hideBanner();
  render();
  $('file-dialog').close();
}

async function reconnectFile() {
  try {
    const data = await FileLink.grantAndRead();
    state.file = 'ready';
    hideBanner();
    if (data) adoptData(data);
    else { scheduleFileWrite(); render(); }
    setSave('saved');
    toast(`« ${FileLink.name} » reconnecté.`);
  } catch (e) {
    if (!isAbort(e)) showBanner(e.message || String(e), 'err');
  }
}

/** After switching back to the tab: pick up changes made elsewhere (git pull, other PC…). */
async function checkFileFreshness() {
  if (state.file !== 'ready' || writePending || writeInFlight) return;
  if (!(await FileLink.changedOnDisk())) return;
  try {
    const data = await FileLink.read();
    if (data && !sameContent(data, state.data)) {
      adoptData(data);
      toast('Fichier modifié ailleurs : données rechargées.');
    }
  } catch (e) {
    showBanner(`Impossible de relire « ${FileLink.name} » : ${e.message}`, 'err');
  }
}

/* -------------------------------------------------------------- import/export */

async function importFromInput(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const data = await parseImportedFile(file);
    if (state.data.exams.length && !sameContent(data, state.data)
      && !confirm(`Importer « ${file.name} » remplacera les ${state.data.exams.length} DS actuels. Continuer ?`)) {
      return;
    }
    replaceData(data.subjects.length || data.exams.length ? data : { ...data, subjects: defaultData().subjects });
    toast(`${plural(data.exams.length, 'DS importé', 'DS importés')}.`);
  } catch (e) {
    showBanner(e.message || String(e), 'err');
  }
}

/* --------------------------------------------------------------------- init */

function bindEvents() {
  $('btn-new').addEventListener('click', () => openExamDialog(null));
  $('exam-form').addEventListener('submit', submitExamForm);
  $('btn-cancel').addEventListener('click', () => $('exam-dialog').close());
  $('btn-delete').addEventListener('click', deleteEditedExam);
  $('f-duration').addEventListener('input', syncDurationChips);
  $('btn-manage-subjects').addEventListener('click', openSubjectsDialog);
  $('subject-add').addEventListener('submit', addSubject);
  $('btn-subjects-close').addEventListener('click', closeSubjectsDialog);
  $('subjects-dialog').addEventListener('close', () => {
    if ($('exam-dialog').open) fillSubjectSelect($('f-subject').value);
  });

  $('btn-file').addEventListener('click', openFileDialog);
  $('btn-file-open').addEventListener('click', linkExistingFile);
  $('btn-file-create').addEventListener('click', linkNewFile);
  $('btn-file-unlink').addEventListener('click', unlinkFile);
  $('btn-file-close').addEventListener('click', () => $('file-dialog').close());

  $('btn-export').addEventListener('click', () => exportToDownload(state.data));
  $('btn-import').addEventListener('click', () => $('import-input').click());
  $('import-input').addEventListener('change', importFromInput);

  for (const tab of document.querySelectorAll('.tabs button')) {
    tab.addEventListener('click', () => { state.view = tab.dataset.view; savePrefs(); render(); });
  }
  const bindFilter = (id, key) => $(id).addEventListener('change', (ev) => {
    state.filters[key] = ev.target.value;
    savePrefs();
    render();
  });
  bindFilter('flt-subject', 'subject');
  bindFilter('flt-type', 'type');
  bindFilter('flt-importance', 'importance');
  bindFilter('flt-revision', 'revision');
  $('flt-past').addEventListener('change', (ev) => { state.filters.showPast = ev.target.checked; savePrefs(); render(); });

  window.addEventListener('focus', checkFileFreshness);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkFileFreshness(); });
  window.addEventListener('beforeunload', (ev) => {
    if (writePending || writeInFlight) ev.preventDefault();
  });
}

async function init() {
  state.data = Local.loadData() || defaultData();
  const prefs = Local.loadPrefs();
  if (prefs.view === 'calendar' || prefs.view === 'list') state.view = prefs.view;
  if (prefs.filters && typeof prefs.filters === 'object') Object.assign(state.filters, prefs.filters);

  fillExamFormOptions();
  bindEvents();
  $('btn-file').hidden = !FileLink.supported;
  render();

  state.file = await FileLink.restore();
  if (state.file === 'ready') {
    try {
      const data = await FileLink.read();
      if (data) { state.data = data; Local.saveData(data); }
      else scheduleFileWrite();
    } catch (e) {
      state.file = 'none';
      showBanner(`Fichier « ${FileLink.name} » illisible : ${e.message}`, 'err');
    }
  } else if (state.file === 'needs-permission') {
    showBanner(`Ton fichier de données « ${FileLink.name} » doit être reconnecté (une confirmation du navigateur est nécessaire).`, 'warn',
      { label: 'Reconnecter le fichier', run: reconnectFile });
  }
  render();
}

init();
