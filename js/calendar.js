/* Month calendar view. Uses globals from model.js and app.js at call time. */
'use strict';

const MAX_CHIPS_PER_DAY = 3;
const DOW_LABELS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

function shiftMonth(delta) {
  const [y, m] = state.calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.calMonth = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  render();
}

function renderCalendar() {
  const [year, month] = state.calMonth.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const gridStart = new Date(year, month - 1, 1 - ((first.getDay() + 6) % 7)); // back up to Monday
  const weeks = Math.ceil(((first.getDay() + 6) % 7 + new Date(year, month, 0).getDate()) / 7);
  const today = todayStr();

  // Calendar shows past exams too; only the other filters apply.
  const byDate = new Map();
  for (const e of filteredExams({ includePast: true })) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }

  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const ds = toDateStr(day);
    const exams = byDate.get(ds) || [];
    const cls = ['cal-day'];
    if (day.getMonth() !== month - 1) cls.push('other');
    if (ds === today) cls.push('today');

    // Clicking an empty area of a day pre-fills a new exam; keyboard users have "+ Nouveau DS".
    cells.push(h('div', { class: cls.join(' '), title: 'Ajouter un DS ce jour', onclick: () => openExamDialog(null, ds) },
    h('span', { class: 'num' }, day.getDate()),
    exams.slice(0, MAX_CHIPS_PER_DAY).map((e) => {
      const subject = subjectById(e.subjectId);
      return h('button', {
        type: 'button',
        class: `chip ${e.revised ? 'revised' : 'unrevised'}`,
        vars: { '--c': subject.color },
        title: `${subject.name}${e.title ? ' — ' + e.title : ''}${e.revised ? ' (révisé)' : ' (à réviser)'}`,
        onclick: (ev) => { ev.stopPropagation(); openExamDialog(e.id); },
      }, `${e.revised ? '✓ ' : ''}${e.time ? e.time + ' ' : ''}${subject.name}`);
    }),
    exams.length > MAX_CHIPS_PER_DAY && h('span', { class: 'more' }, `+${exams.length - MAX_CHIPS_PER_DAY} autre${exams.length - MAX_CHIPS_PER_DAY > 1 ? 's' : ''}`)));
  }

  const title = first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return h('div', {},
    h('div', { class: 'cal-head' },
      h('button', { type: 'button', 'aria-label': 'Mois précédent', onclick: () => shiftMonth(-1) }, '‹'),
      h('h2', {}, title),
      h('button', { type: 'button', onclick: () => { state.calMonth = todayStr().slice(0, 7); render(); } }, "Aujourd'hui"),
      h('button', { type: 'button', 'aria-label': 'Mois suivant', onclick: () => shiftMonth(1) }, '›')),
    h('div', { class: 'cal-grid' },
      DOW_LABELS.map((d) => h('div', { class: 'cal-dow' }, d)),
      cells));
}
