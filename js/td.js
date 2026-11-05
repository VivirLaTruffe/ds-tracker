/* TD Tracker page. Uses globals from model.js, schedule.js and app.js at call time. */
'use strict';

const NO_SUBJECT_COLOR = '#6b7280';

function tdDayWord(d) {
  if (d === 0) return "aujourd'hui";
  if (d === 1) return 'demain';
  return `dans ${d} jours`;
}

function tdCountdown(item) {
  const d = daysUntil(item.day);
  const at = item.ev.start.slice(11, 16);
  if (d < 0) return { big: 'Passé', small: '' };
  if (d === 0) return { big: "Aujourd'hui", small: at };
  if (d === 1) return { big: 'Demain', small: at };
  return { big: `J-${d}`, small: at };
}

/** Ids of the TD cards whose note editor is open (kept across re-renders). */
const openTdNotes = new Set();

function saveTdNote(key, text) {
  commitQuiet((data) => {
    const value = text.trim().slice(0, 1000);
    if (value) data.tdNotes[key] = value;
    else delete data.tdNotes[key];
  });
}

function renderTdNote(item) {
  const note = state.data.tdNotes[item.key] || '';
  if (!openTdNotes.has(item.key)) {
    return h('button', {
      type: 'button',
      class: 'note-chip' + (note ? ' has-note' : ''),
      title: note ? 'Modifier la note' : 'Ajouter une note',
      onclick: () => { openTdNotes.add(item.key); render(); focusTdNote(item.key); },
    }, note ? note : '+ Note');
  }
  return h('textarea', {
    class: 'td-note',
    rows: 2,
    maxLength: 1000,
    placeholder: 'Exercices à faire, questions pour le prof…',
    value: note,
    data: { key: item.key },
    oninput: (ev) => saveTdNote(item.key, ev.target.value),
    onblur: () => { openTdNotes.delete(item.key); render(); },
  });
}

function focusTdNote(key) {
  const el = document.querySelector(`textarea.td-note[data-key="${CSS.escape(key)}"]`);
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

function toggleTdDone(key) {
  commit((data) => {
    if (data.tdDone[key]) delete data.tdDone[key];
    else data.tdDone[key] = true;
  });
}

/* ------------------------------------------------------------------ cards */

function renderTdCard(item, urgency) {
  const subject = item.subject;
  const name = subject ? subject.name : item.label;
  const d = daysUntil(item.day);
  const cd = tdCountdown(item);
  const when = [
    fmtDate(item.day, { weekday: 'short', day: 'numeric', month: 'short' }),
    `${item.ev.start.slice(11, 16)}${item.ev.end > item.ev.start ? '–' + item.ev.end.slice(11, 16) : ''}`,
    item.ev.location,
  ].filter(Boolean).join(' · ');

  return h('article', {
    class: `exam ${d < 0 || item.end <= new Date() ? 'past' : urgency}`,
    vars: { '--c': subject ? subject.color : NO_SUBJECT_COLOR },
  },
  h('div', { class: 'countdown' }, cd.big, cd.small && h('small', {}, cd.small)),
  h('div', { class: 'exam-main' },
    h('div', { class: 'exam-title' },
      h('span', { class: 'subject' }, name),
      item.suffix && [h('span', { class: 'sep' }, ' — '), item.suffix]),
    h('div', { class: 'exam-meta' },
      h('span', {}, when),
      !subject && h('button', { type: 'button', class: 'badge unassigned link', onclick: openMappingDialog }, 'Associer une matière')),
    renderTdNote(item)),
  h('div', { class: 'exam-side' },
    h('label', { class: 'check revised-toggle' + (item.done ? ' done' : '') },
      h('input', { type: 'checkbox', checked: item.done, onchange: () => toggleTdDone(item.key) }),
      item.done ? 'Préparé' : 'TD à préparer')));
}

function tdSection(title, items, mode) {
  return h('section', { class: 'group' + (mode === 'prep' ? ' prep' : '') },
    h('h2', {}, title, h('span', { class: 'count' }, `(${items.length})`)),
    h('div', { class: 'cards' }, items.map((item) => {
      let urgency = '';
      if (mode === 'prep') urgency = daysUntil(item.day) === 0 ? 'danger' : 'warn';
      return renderTdCard(item, urgency);
    })));
}

/* ------------------------------------------------------------------- page */

function renderTdOnboarding() {
  return h('div', { class: 'empty onboarding' },
    h('h2', {}, 'Récupère ton emploi du temps'),
    h('ol', {},
      h('li', {}, "Dans ADE, clique sur l'icône d'export (le calendrier avec une flèche, en bas à gauche)."),
      h('li', {}, 'Choisis la période (la semaine en cours et la suivante suffisent) et le format iCalendar, puis « Ok » : un fichier .ics est téléchargé.'),
      h('li', {}, 'Clique sur « Importer mon planning (.ics) » et choisis ce fichier.')),
    h('p', { class: 'small' },
      'Le fichier est lu dans ton navigateur, rien n\'est envoyé nulle part. Ré-importe-le quand ton planning change : seuls les jours du nouveau fichier sont remplacés, tes cases « préparé » restent. '
      + 'Tout calendrier au format .ics fonctionne. Les séances dont le titre contient « TD » sont reconnues comme des TD.'),
    h('button', { type: 'button', class: 'primary', onclick: () => $('td-ics-input').click() }, 'Importer mon planning (.ics)'));
}

function renderTdEmpty(items, lastDay) {
  if (!items.length) {
    return h('div', { class: 'empty' },
      h('p', {}, 'Aucun TD trouvé dans ton planning : je repère les séances dont le titre contient « TD ».'));
  }
  return h('div', { class: 'empty' },
    h('p', {}, `Aucun TD à venir dans ton planning (dernière séance : ${fmtDate(lastDay, { day: 'numeric', month: 'long' })}).`),
    h('button', { type: 'button', class: 'primary', onclick: () => $('td-ics-input').click() }, 'Importer un planning plus récent'));
}

function scheduleRange(events) {
  if (!events.length) return null;
  const days = events.map((e) => e.start.slice(0, 10));
  return { first: days.reduce((a, b) => (a < b ? a : b)), last: days.reduce((a, b) => (a > b ? a : b)) };
}

function renderTdToolbar(range) {
  $('td-lead').replaceChildren(...TD_LEAD_OPTIONS.map((o) => option(String(o.id), o.label, o.id === state.data.settings.tdLeadDays)));
  $('td-past').checked = state.tdShowPast;
  $('td-auto-ds').checked = state.data.settings.autoImportDs;
  const sch = state.data.schedule;
  const fmt = { day: 'numeric', month: 'short' };
  $('td-schedule-info').textContent = range
    ? `Planning du ${fmtDate(range.first, fmt)} au ${fmtDate(range.last, fmt)}`
      + ` (${plural(sch.events.length, 'séance', 'séances')}), importé le ${new Date(sch.importedAt).toLocaleDateString('fr-FR')}.`
    : 'Aucun planning importé.';
}

function renderTdSummary({ items, upcoming, prep, range }) {
  const now = new Date();
  const week = upcoming.filter((i) => daysUntil(i.day) <= 7);
  const shown = prep.slice(0, 3).map((i) => `${i.subject ? i.subject.name : i.label} (${tdDayWord(daysUntil(i.day))})`);
  const more = prep.length - shown.length;

  const tiles = [
    h('div', { class: 'tile' + (prep.length ? ' alert' : '') },
      h('div', { class: 'label' }, 'À préparer maintenant'),
      h('div', { class: 'value' }, prep.length),
      h('div', { class: 'sub list' }, prep.length ? shown.join(' · ') + (more > 0 ? ` · +${more}` : '') : 'Tu es à jour')),
    h('div', { class: 'tile' },
      h('div', { class: 'label' }, 'TD à venir'),
      h('div', { class: 'value' }, upcoming.length),
      h('div', { class: 'sub' }, `dont ${week.length} dans les 7 jours`)),
  ];
  const stale = range && daysUntil(range.last, toDateStr(now)) < 3;
  tiles.push(h('div', { class: 'tile' + (stale ? ' alert' : '') },
    h('div', { class: 'label' }, 'Planning importé jusqu\'au'),
    h('div', { class: 'value' }, range ? fmtDate(range.last, { day: 'numeric', month: 'short' }) : '—'),
    h('div', { class: 'sub' }, !range ? 'Rien d\'importé' : stale ? 'Pense à importer la suite' : `${plural(items.length, 'TD', 'TD')} au total`)));
  $('td-summary').replaceChildren(...tiles);
}

function renderTd() {
  const now = new Date();
  const lead = state.data.settings.tdLeadDays;
  const items = buildTdItems(state.data);
  const upcoming = items.filter((i) => i.end > now);
  const past = items.filter((i) => i.end <= now);
  const prep = upcoming.filter((i) => isPrepNow(i, lead, now));
  const later = upcoming.filter((i) => !prep.includes(i));
  const range = scheduleRange(state.data.schedule.events);

  renderTdToolbar(range);
  renderTdSummary({ items, upcoming, prep, range });

  let body;
  if (!range) {
    body = renderTdOnboarding();
  } else {
    const blocks = [];
    if (prep.length) blocks.push(tdSection('À préparer maintenant', prep, 'prep'));
    for (const g of groupExams(later, (i) => i.day)) blocks.push(tdSection(g.title, g.items));
    if (state.tdShowPast && past.length) blocks.push(tdSection('Passés', past.slice().reverse()));
    body = blocks.length ? h('div', {}, blocks) : renderTdEmpty(items, range.last);
  }
  $('td-view').replaceChildren(body);
}

/* ------------------------------------------------------- subject mapping */

function openMappingDialog() {
  hideBanner();
  renderMappingDialog();
  if (!$('mapping-dialog').open) $('mapping-dialog').showModal();
}

function renderMappingDialog() {
  const data = state.data;
  const labels = new Map();
  for (const item of buildTdItems(data)) {
    const key = normalizeText(item.label);
    if (!labels.has(key)) labels.set(key, { key, label: item.label, count: 0 });
    labels.get(key).count++;
  }
  const rows = [...labels.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  if (!rows.length) {
    $('mapping-list').replaceChildren(h('p', { class: 'muted' }, "Importe d'abord un planning : les cours qui ont des TD apparaîtront ici."));
    return;
  }

  $('mapping-list').replaceChildren(...rows.map((row) => {
    const auto = autoSubjectForLabel(row.label, data.subjects);
    const aliasId = data.aliases[row.key];
    const chosen = data.subjects.some((s) => s.id === aliasId) ? aliasId : '';
    const select = h('select', {
      'aria-label': `Matière pour ${row.label}`,
      onchange: (ev) => {
        const value = ev.target.value;
        commit((d) => {
          if (value === '') delete d.aliases[row.key];
          else if (value === '__new__') {
            const subject = { id: newId(), name: row.label.slice(0, 80), color: SUBJECT_COLORS[d.subjects.length % SUBJECT_COLORS.length] };
            d.subjects.push(subject);
            d.aliases[row.key] = subject.id;
          } else d.aliases[row.key] = value;
        });
        renderMappingDialog();
      },
    },
    option('', auto ? `Automatique (${auto.name})` : 'Non associée', chosen === ''),
    ...data.subjects.map((s) => option(s.id, s.name, chosen === s.id)),
    option('__new__', `+ Créer la matière « ${row.label} »`, false));
    return h('div', { class: 'mapping-row' },
      h('div', {}, h('strong', {}, row.label), h('div', { class: 'muted small' }, plural(row.count, 'TD', 'TD'))),
      select);
  }));
}

/* ------------------------------------------------------------ import + events */

function countUnassignedLabels(data) {
  const seen = new Set();
  for (const item of buildTdItems(data)) if (!item.subject) seen.add(normalizeText(item.label));
  return seen.size;
}

async function importIcsFile(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const events = parseICS(await file.text());
    if (!events.length) throw new Error('Aucune séance trouvée dans ce fichier.');
    let ds = { added: 0, updated: 0 };
    commit((data) => {
      mergeSchedule(data, events, file.name);
      ds = syncDsFromSchedule(data, events);
    });
    const tdCount = events.filter((e) => classifyEvent(e.title) === 'td').length;
    const parts = [`${plural(events.length, 'séance importée', 'séances importées')}, dont ${plural(tdCount, 'TD', 'TD')}`];
    if (ds.added) parts.push(`${plural(ds.added, 'DS ajouté', 'DS ajoutés')} au DS Tracker`);
    if (ds.updated) parts.push(`${plural(ds.updated, 'DS déplacé', 'DS déplacés')}`);
    toast(parts.join(' · ') + '.');
    const missing = countUnassignedLabels(state.data);
    if (missing) {
      showBanner(`${plural(missing, 'cours de TD n\'est associé', 'cours de TD ne sont associés')} à aucune matière.`, 'warn',
        { label: 'Associer les matières', run: openMappingDialog });
    } else {
      hideBanner();
    }
  } catch (e) {
    showBanner(e.message || String(e), 'err');
  }
}

function bindTdEvents() {
  $('btn-td-import').addEventListener('click', () => $('td-ics-input').click());
  $('td-ics-input').addEventListener('change', importIcsFile);
  $('btn-td-mapping').addEventListener('click', openMappingDialog);
  $('btn-mapping-close').addEventListener('click', () => $('mapping-dialog').close());
  $('td-lead').addEventListener('change', (ev) => {
    commit((data) => { data.settings.tdLeadDays = Number(ev.target.value); });
  });
  $('td-auto-ds').addEventListener('change', (ev) => {
    commit((data) => { data.settings.autoImportDs = ev.target.checked; });
    toast(ev.target.checked ? 'Les DS du planning seront ajoutés automatiquement.' : 'Import automatique des DS désactivé.');
  });
  $('td-past').addEventListener('change', (ev) => {
    state.tdShowPast = ev.target.checked;
    savePrefs();
    render();
  });
}
