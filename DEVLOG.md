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

---

## 2026-09-18 — Calendar view and end-to-end checks

**Calendar.** `js/calendar.js` renders a Monday-first month grid (5 or 6 rows as needed), one chip
per exam coloured by subject, prefixed with ✓ when revised. At most 3 chips per day, then "+n
autres". Clicking a day opens the form with that date pre-filled. The calendar shows past exams too
(the "show past" toggle only applies to the list) but respects the other filters.

**The linked-file flow, tested without the OS file picker.** Native pickers can't be driven from a
test, but the origin-private file system hands out the same `FileSystemFileHandle` objects, so the
`FileLink` code was exercised against one: an empty file reads as "no data yet"; the handle is stored
in IndexedDB; a change is autosaved and the status shows the file name; our own write does not count
as an external change; an outside edit is detected and reloaded on focus; a corrupt JSON file and a
file from a newer data version each give a readable error. **What is still unverified:** the real
`showOpenFilePicker` / `showSaveFilePicker` dialogs and the browser's "re-grant access" prompt on
a later visit — those need a human click.

**Also checked:** no horizontal overflow at 375 px wide; no console errors.

**Next ideas** (not started): installable/offline PWA, `.ics` export for the calendar, per-exam
coefficient, a "revision checklist" per exam.

---

## 2026-09-20 — TD Tracker, part 1: reading a timetable

**The idea.** Import the school timetable (ADE, exported as iCalendar) and tell the user which TD to
prepare *before* the class: the day before and the day itself. Example: on Wednesday, "prepare the
maths TD" because the next maths TD is Thursday 11:00. A second top-level page, next to the DS
tracker, will show it; this entry is only the logic underneath.

**Why a file import and not a live link.** The app is static and public, so it has no server and
cannot log in to ADE; browsers also block cross-site requests to it. ADE's export dialog gives an
`.ics` file for any date range (and a "generate URL" option that would hit the same wall). So the
user exports once for the whole semester and imports the file. The file is parsed in the browser.

**`js/ics.js`** is a deliberately small iCalendar reader: unfolds wrapped lines, handles `Z`
(UTC → local), `TZID` / floating times (taken as local), all-day events, escaped commas, and
skips cancelled events. It keeps uid, title, start, end and location and **drops the description**,
which on a timetable is mostly teacher names.

**`js/schedule.js`** holds the pure logic:
- `classifyEvent` guesses `ds / td / tp / cm / other` from the title (real titles from the author's
  timetable: `Mathématiques TD 01`, `1- Electrostatique_TD1`, `Partie I : Signaux pour les systèmes
  _TD1`, `DS Classe, Heritage et polymorphisme_TP1`). `DS` wins over the session type, so an exam
  held in a lab slot is not mistaken for a TP. Word-boundary checks keep `Autopsy` or `Adstra` from
  matching.
- `courseLabel` strips the `TD 01` suffix and a leading `1-` to get the course name.
- Subject matching: an alias chosen by the user wins, otherwise a name containment guess
  ("Mécanique" ↔ "Mécanique cinématique"). Courses that match nothing stay visible under their own
  name until the user links them.
- `isPrepNow`: not prepared, class not over, and within N days (default 1 = the day before and the
  day itself). A TD whose class already ended today drops out.
- `mergeSchedule` replaces only the days covered by the new file, so the timetable can be imported
  in chunks and a corrected week overwrites the old one. "Prepared" flags survive a re-import even
  if ADE hands out different UIDs, by falling back to title + start time.

**Data model bumped to v2** (`schedule`, `aliases`, `tdDone`, `settings`). A v1 file loads fine and
gets empty defaults; a v2 file is refused by an older build rather than silently stripped.

**Testing.** Run in a real browser against an `.ics` built to mimic the author's week (CRLF, folded
line, `TZID`, all-day, cancelled, escaped commas): classification of 16 titles, label extraction,
parsing, the prepare-now window at several clock times (including Wednesday 12:30, once the
mechanics TD is over), re-import without duplicates, partial re-import, sanitising hostile input.
Caveat: no real ADE export was available, so the parser is written to the iCalendar spec and to
what ADE's export dialog advertises, not verified against an actual ADE file yet.

**Known limitation.** "The day before" is literal: a Monday TD shows up on Sunday, not Friday. The
lead time is configurable (up to 3 days) for that reason.

**Next.** The TD Tracker page and the DS / TD switch in the header.

---

## 2026-09-20 — TD Tracker, part 2: the page

**Two pages, one header.** "DS Tracker" and "TD Tracker" are now the two buttons at the top; the
choice is remembered. Export/Import and the linked file cover both pages, since they are the same
JSON.

**TD page (`js/td.js`).** Summary tiles (how many to prepare now and which subjects, upcoming TD,
how far the imported timetable goes — it turns red when it ends in fewer than 3 days, as a nudge to
import the next chunk), then the list: **À préparer maintenant** first, in red for today and amber
for tomorrow, then the usual Today / This week / Next week / Later buckets (the DS page's
`groupExams` got a `dayOf` parameter so both pages share it). Ticking "TD à préparer" moves the
TD out of the top group. A TD whose class is over drops to "Passés".

**Course → subject mapping.** ADE course names rarely match the subject list (`Mathématiques`,
`Electrostatique`, `Partie I : Signaux…`). Unmatched ones stay visible under their own name with an
"Associer une matière" link; the "Matières des cours" dialog lets the user pick a subject, or
create one from the course name in one step. After an import the app says how many courses are
still unlinked.

**Browser-tested with a fake clock.** Pretending it is Wednesday 09:00 and importing an
ADE-shaped `.ics`: the tile reads "Mécanique (aujourd'hui) · Signaux (aujourd'hui) · Mathématiques
(demain)", exactly the behaviour asked for. Also checked: switching pages, importing, ticking
(persisted to local storage), "same day only" mode, creating a subject from the mapping dialog,
"show past", a non-iCalendar file giving a readable error, no console errors.

**A small trap worth writing down.** During testing the page kept running the *previous* `app.js`
because the browser had cached it — after a refactor that spans several files, a stale script
looks exactly like a logic bug. Hard-reload before debugging.

**Still unverified.** A real ADE export: only ADE-shaped test data was used. If a real file's titles
don't contain "TD" the way the author's timetable does, the keyword rule in `classifyEvent` is the
single place to adapt.

**Ideas, not started:** import the DS that appear in the timetable automatically (they are already
detected as kind `ds`), a per-TD note, an installable/offline version.

---

## 2026-09-20 — Import in short windows, not per semester

The author's timetable is only reliable one or two weeks ahead and changes often, so exporting the
whole semester makes no sense. The import logic already handled this (a new file replaces only the
days it covers, older and later days stay, "prepared" ticks survive), so only the onboarding text
changed: it now suggests exporting the current and next week and re-importing when ADE moves.
The "planning imported until" tile already turns red under 3 days, which fits this weekly rhythm.
