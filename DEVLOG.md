# Devlog

Newest entry at the bottom. Every entry is written by the AI that did the work.

---

## 2026-09-18 — Project start: scope, stack, license

**The problem.** Exams (DS) pile up across many subjects and formats, and it is easy to lose track of
which ones are close and which ones are actually prepared. A spreadsheet works but is clumsy on
duration, importance and "have I finished revising?".

**Stack decision: static HTML/CSS/vanilla JS, no build step.** No Node on the target machine, nothing
to install, and the app can be opened from `index.html` or hosted on GitHub Pages as-is. A framework
would add tooling for a UI that is a form, a list and a calendar.

**Storage decision: the user picks where the JSON lives.** The repo is public and meant for anyone, so
nothing personal can be baked in and there is no backend. Instead the app uses the File System Access
API to link a `.json` file chosen by the user (autosave on change), with Import/Export as a fallback
for browsers that lack it, and `localStorage` as a safety net. The author keeps their own file in a
private git repo, which also handles syncing between two computers.

**License decision: PolyForm Noncommercial 1.0.0.** The goal is "free to use and modify, but no
resale and no commercial use". MIT/Apache/GPL all allow selling. CC BY-NC is written for content,
not software, and its own authors advise against it for code. PolyForm Noncommercial is drafted for
exactly this case. Trade-off: it is source-available, not OSI open source. The AI-authorship
disclosure lives in the README.

**Data model (v1).**
`{ version, subjects: [{id, name, color}], exams: [{id, title, subjectId, type, date, time, duration,
importance, revised, notes}] }` — versioned from day one so later changes can migrate old files.

**Next.** Data layer and pre-filled subject list, then the list UI.

---

## 2026-09-18 — Data layer and storage

**`js/model.js`** holds the constants (8 exam types, 4 importance levels, duration presets), the
pre-filled subject list, and `sanitizeData()`. Anything read from a file goes through it: bad fields
are repaired (unknown type → "Other", bad time → empty), unrecoverable entries are dropped, and a file
from a *newer* data version is refused rather than silently mangled. Treating imported JSON as
untrusted also matters later for the UI, which will only ever use `textContent`, never `innerHTML`.

**`js/storage.js`** has the three persistence layers. Worth noting:

- The `FileSystemFileHandle` is kept in IndexedDB so the next visit can re-link the file. Browsers
  require a click to re-grant write permission, so on reload the app will show a "reconnect" button
  instead of prompting out of nowhere.
- An *empty* file counts as "no data yet" so a freshly created `.json` can be linked directly.
- `changedOnDisk()` compares `lastModified`. This is for the two-computer workflow: after a
  `git pull` the file changed under the app, and it should reload instead of overwriting it on the
  next edit.

**Dates are `YYYY-MM-DD` strings in local time**, and day differences are computed through
`Date.UTC` so a daylight-saving change can never turn "in 3 days" into 2 or 4.

**Next.** The page itself: list view, exam form, subjects manager, filters.

---

## 2026-09-18 — List view, exam form, subjects, filters

**What works.** `index.html` + `styles.css` + `js/app.js`: exams grouped as *Today / This week / Next
week / Later / Past*, each with a countdown (`J-5`, `Demain`), subject colour bar, type and importance
badges, and a one-click "revision finished" checkbox right on the card. Summary tiles show the next
exam, how many are coming, and how many are still unrevised.

**Urgency rule.** An exam that is *not* fully revised is highlighted red when it is ≤ 2 days away, or
≤ 7 days away and importance is High/Critical; amber at ≤ 7 days (≤ 14 for High/Critical). A revised
exam never shouts. This is a heuristic, kept in one function (`urgency()`), easy to tune.

**"This week" means until Sunday, not "next 7 days".** Weeks start on Monday; an exam next Wednesday
is "Next week" even if it is only 5 days away. It matches how a timetable is actually read.

**Subjects are data, not code.** The pre-filled list is only a starting point; the manager dialog
edits names and colours and adds/removes subjects. Deleting a subject that exams still use keeps
those exams and shows them as "Sans matière" rather than destroying data.

**Security note.** The UI is built with a small `h()` helper that only ever creates text nodes, so a
hostile title inside an imported JSON file renders as plain text. Checked by saving an exam titled
`<img src=x onerror=…>`: nothing was injected.

**Manual test pass** (in a real browser, seeded with 6 exams): create with missing date → error;
duration preset highlighting; create; toggle revised; edit; delete; add/delete subject; orphan
exam label; no console errors.

**Not done yet.** Calendar tab (button exists but shows the list), linked-file flow untested in a
browser.
