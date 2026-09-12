/** Router, event delegation, the study timer and the command palette. */

import { api, store, onState } from './api.js';
import {
  esc, attr, icon, toast, clock, round1, hrs, fmtLong, localToday,
  openSheet, closeSheet, sheetIsOpen, confirmDialog, WEEKDAYS
} from './ui.js';
import { VIEWS, mountView, calendarCursor } from './views.js';
import { openCourseEditor, openSetDate, openSetDeadline, openLogDialog, openOverride } from './editor.js';

/* ---------------------------------------------------------------- state ---- */
let view = location.hash.replace('#', '') || 'dash';
if (!VIEWS[view]) view = 'dash';
let extra = { sessions: [], histogram: [], activity: [] };
let timer = null;           // { courseId, deliverableId, label, startedAt }
let tickHandle = null;

const main = () => document.getElementById('main');

/* ---------------------------------------------------------------- render --- */
function renderRail() {
  const m = store.state;
  document.getElementById('rail').innerHTML = `
    <div class="eyebrow">Control</div>
    ${Object.entries(VIEWS).map(([id, v]) => {
      const tally = m ? v.tally(m) : '';
      return `<button class="navb" type="button" data-nav="${id}" ${view === id ? 'aria-current="page"' : ''}>
        ${icon(v.icon)}<span>${v.label}</span>${tally !== '' ? `<span class="tally">${tally}</span>` : ''}</button>`;
    }).join('')}
    <div class="railfoot">
      <button class="btn sm pri" type="button" data-act="log-dialog">Log study time</button>
      <div class="statusbar"><span class="led ${store.busy ? 'busy' : store.connected ? '' : 'off'}"></span>${
        store.busy ? 'Saving…' : store.connected ? 'Connected' : 'Offline'}</div>
    </div>`;
}

function renderClock() {
  const m = store.state;
  if (!m) return;
  const next = m.upcomingExams[0];
  const d = new Date(`${m.today}T00:00:00Z`);
  document.getElementById('clock').innerHTML = `
    <div class="cell"><b>${d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]}</b><span>Today</span></div>
    <div class="cell"><b>${next ? `${next.daysUntil} d` : '—'}</b><span>${next ? `to ${next.name.length > 16 ? next.name.slice(0, 15) + '…' : next.name}` : 'No exam set'}</span></div>
    <div class="cell"><b>${m.totals.confirmed}/${m.totals.examCount}</b><span>Dates confirmed</span></div>`;
  document.getElementById('semLabel').textContent = m.settings.semester;
}

function timerBar() {
  if (!timer) return '';
  const mins = (Date.now() - timer.startedAt) / 60000;
  return `<div class="timer" id="timerBar">
    ${icon('log', 'ic')}
    <span class="face" id="timerFace">${clock(mins)}</span>
    <span class="who"><b>${esc(timer.label)}</b><span>Timer running</span></span>
    <button class="btn pri sm" type="button" data-act="timer-stop">Stop &amp; log</button>
    <button class="btn sm" type="button" data-act="timer-cancel">Discard</button>
  </div>`;
}

function render(opts = {}) {
  const m = store.state;
  renderRail();
  renderClock();
  if (!m) return;
  main().innerHTML = `<section class="view">${timerBar()}${VIEWS[view].render(m, extra)}</section>`;
  mountView(view, m);
  if (!opts.keepSheet && opts.closeSheet) closeSheet();
}

/** Reload the model from the server, then redraw. */
async function refresh(opts = {}) {
  try {
    await api.load();
    if (VIEWS[view].needsSessions) await loadExtras();
    render(opts);
  } catch (e) {
    toast(e.message, { error: true });
    renderRail();
  }
}

async function loadExtras() {
  const r = await api.sessions({ limit: 60, days: 56 });
  extra = { sessions: r.sessions, histogram: r.histogram, activity: store.activity };
}

/** Handed to dialogs: redraw from whatever the last mutation already returned. */
function redraw(opts = {}) {
  if (VIEWS[view].needsSessions) { loadExtras().then(() => render(opts)); return; }
  extra.activity = store.activity;
  render(opts);
}

async function go(next) {
  if (!VIEWS[next]) return;
  view = next;
  history.replaceState(null, '', `#${next}`);
  if (VIEWS[view].needsSessions) { try { await loadExtras(); } catch {} }
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ---------------------------------------------------------------- timer ---- */
function startTimer(courseId, deliverableId, label) {
  if (timer) { toast('A timer is already running — stop it first.', { error: true }); return; }
  timer = { courseId, deliverableId: deliverableId || null, label: label || 'Study session', startedAt: Date.now() };
  render();
  tickHandle = setInterval(() => {
    const face = document.getElementById('timerFace');
    if (face && timer) face.textContent = clock((Date.now() - timer.startedAt) / 60000);
  }, 1000);
  toast(`Timer started on ${timer.label}.`);
}

async function stopTimer(save = true) {
  if (!timer) return;
  const minutes = Math.max(1, Math.round((Date.now() - timer.startedAt) / 60000));
  const t = timer;
  timer = null;
  clearInterval(tickHandle);
  if (!save) { render(); toast('Timer discarded — nothing logged.'); return; }
  try {
    await api.logSession({ courseId: t.courseId, deliverableId: t.deliverableId, minutes, date: localToday(), note: 'Timed session' });
    redraw();
    const c = store.state.courses.find(x => x.id === t.courseId);
    toast(`${round1(minutes / 60)} h logged on ${c?.name ?? 'that course'}. ${c ? `${hrs(c.prepRemainingHours)} of preparation left.` : ''}`);
  } catch (e) { toast(e.message, { error: true }); render(); }
}

/* ------------------------------------------------------------- palette ---- */
function commands() {
  const m = store.state;
  const list = Object.entries(VIEWS).map(([id, v]) => ({ label: `Go to ${v.label}`, group: 'Navigate', run: () => go(id) }));
  list.push({ label: 'Add a course', group: 'Create', run: () => openCourseEditor(null, { render: redraw }) });
  list.push({ label: 'Log study time', group: 'Study', run: () => openLogDialog({ render: redraw }) });
  if (timer) list.push({ label: 'Stop the timer and log it', group: 'Study', run: () => stopTimer(true) });

  for (const c of m.courses.filter(x => x.isExam && x.dateState === 'tbd')) {
    list.push({ label: `Set the exam date for ${c.name}`, group: 'TBD', run: () => openSetDate(c.id, { render: redraw }) });
  }
  for (const c of m.courses) {
    list.push({ label: `Open ${c.name}`, group: 'Courses', run: () => openCourseEditor(c.id, { render: redraw }) });
    if (c.isExam) list.push({ label: `Start a timer on ${c.name}`, group: 'Study', run: () => startTimer(c.id, null, `${c.name} — exam prep`) });
  }
  list.push({ label: 'Block out a day', group: 'Capacity', run: () => openOverride(localToday(), { render: redraw }) });
  list.push({ label: 'Copy the calendar feed URL', group: 'Calendar', run: subscribe });
  list.push({ label: 'Export everything as JSON', group: 'Data', run: exportData });
  list.push({ label: 'Switch theme', group: 'View', run: toggleTheme });
  return list;
}

function openPalette() {
  const all = commands();
  let shown = all.slice(0, 40);
  let index = 0;

  const host = document.getElementById('paletteHost');
  host.innerHTML = `<div class="palette"><div class="palbox">
      <input id="palInput" type="search" placeholder="Type a command…" autocomplete="off" aria-label="Command">
      <div class="palist" id="palList" role="listbox"></div>
    </div></div>`;

  const input = host.querySelector('#palInput');
  const listEl = host.querySelector('#palList');

  const paint = () => {
    listEl.innerHTML = shown.map((c, i) => `<button class="pal" type="button" role="option" data-i="${i}" aria-selected="${i === index}">
      <span>${esc(c.label)}</span><span class="k">${esc(c.group)}</span></button>`).join('')
      || `<div class="empty">Nothing matches.</div>`;
    listEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };

  const filter = () => {
    const q = input.value.trim().toLowerCase();
    shown = (q ? all.filter(c => (c.label + ' ' + c.group).toLowerCase().includes(q)) : all).slice(0, 40);
    index = 0;
    paint();
  };

  const close = () => { host.innerHTML = ''; document.removeEventListener('keydown', onKey, true); };
  const pick = i => { const c = shown[i]; close(); c?.run(); };

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(shown.length - 1, index + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(0, index - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(index); }
  }

  input.addEventListener('input', filter);
  listEl.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) pick(+b.dataset.i); });
  host.querySelector('.palette').addEventListener('mousedown', e => { if (e.target.classList.contains('palette')) close(); });
  document.addEventListener('keydown', onKey, true);
  paint();
  input.focus();
}

/* ------------------------------------------------------------ utilities ---- */
function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme === 'dark' ||
    (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('scd.theme', root.dataset.theme); } catch {}
}

async function subscribe() {
  const url = `${location.origin}/calendar.ics`;
  try { await navigator.clipboard.writeText(url); toast(`Feed URL copied — add it as a calendar subscription: ${url}`, { ms: 8000 }); }
  catch { toast(`Subscribe to: ${url}`, { ms: 9000 }); }
}

function exportData() {
  const a = document.createElement('a');
  a.href = '/api/export';
  a.download = `semester-${localToday()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const ok = await confirmDialog({
        title: 'Replace everything with this file?', danger: true, confirmLabel: 'Import',
        body: `This replaces the current semester with <strong>${(payload.courses || []).length} courses</strong> from <em>${esc(file.name)}</em>.`
      });
      if (!ok) return;
      await api.importData(payload);
      redraw();
      toast('Imported.');
    } catch (e) { toast(e.message || 'That file could not be read as an export.', { error: true }); }
  });
  input.click();
}

/* ------------------------------------------------------- event delegation -- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-nav], [data-act]');
  if (!el) return;

  if (el.dataset.nav) { go(el.dataset.nav); return; }
  const act = el.dataset.act;

  try {
    switch (act) {
      case 'edit-course': openCourseEditor(el.dataset.id, { render: redraw }); break;
      case 'new-course': openCourseEditor(null, { render: redraw }); break;
      case 'set-date': openSetDate(el.dataset.id, { render: redraw }); break;
      case 'set-deadline': openSetDeadline(el.dataset.id, el.dataset.title, { render: redraw }); break;
      case 'clear-date':
        await api.clearDate(el.dataset.id); redraw(); toast('Back to TBD — countdown and reminders removed.'); break;

      case 'log': {
        const minutes = Number(el.dataset.minutes);
        await api.logSession({
          courseId: el.dataset.course,
          deliverableId: el.dataset.deliverable || null,
          minutes, date: localToday()
        });
        redraw();
        const c = store.state.courses.find(x => x.id === el.dataset.course);
        const entry = store.activity.find(a => a.undoable && a.kind === 'session.log');
        toast(`${round1(minutes / 60)} h logged on ${c?.name ?? ''}.`, {
          action: entry ? { label: 'Undo', run: async () => { await api.undo(entry.id); redraw(); toast('Removed.'); } } : undefined
        });
        break;
      }
      case 'log-dialog': openLogDialog({ render: redraw }); break;
      case 'del-session':
        await api.deleteSession(el.dataset.id); redraw(); toast('Session removed.'); break;

      case 'timer': startTimer(el.dataset.course, el.dataset.deliverable, el.dataset.label); break;
      case 'timer-stop': stopTimer(true); break;
      case 'timer-cancel': stopTimer(false); break;

      case 'cal': {
        const step = Number(el.dataset.step);
        const m = store.state;
        const cur = calendarCursor();
        calendarCursor(step === 0
          ? new Date(`${m.today.slice(0, 8)}01T00:00:00Z`)
          : new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + step, 1)));
        render();
        break;
      }
      case 'override': openOverride(el.dataset.date || localToday(), { render: redraw }); break;
      case 'del-override':
        await api.clearOverride(el.dataset.date); redraw(); toast('Override removed.'); break;

      case 'save-capacity': {
        const hours = WEEKDAYS.map((_, i) => Number(document.getElementById(`cap-${i}`).value));
        await api.setCapacity(hours);
        redraw();
        toast(`Capacity set to ${round1(hours.reduce((a, b) => a + b, 0))} h a week — the plan has been recalculated.`);
        break;
      }
      case 'save-settings': {
        const patch = {};
        document.querySelectorAll('[data-setting]').forEach(input => {
          const key = input.dataset.setting;
          if (input.dataset.list) patch[key] = input.value.split(',').map(x => parseInt(x.trim(), 10)).filter(n => n > 0).sort((a, b) => b - a);
          else if (input.dataset.text) patch[key] = input.value;
          else patch[key] = Number(input.value) * (input.dataset.scale ? Number(input.dataset.scale) : 1);
        });
        await api.updateSettings(patch);
        redraw();
        toast('Planner rules saved.');
        break;
      }
      case 'undo':
        await api.undo(Number(el.dataset.id)); redraw(); toast('Undone.'); break;

      case 'subscribe': subscribe(); break;
      case 'export': exportData(); break;
      case 'import': importData(); break;
      case 'reset': {
        const ok = await confirmDialog({
          title: 'Restore the semester defaults?', danger: true, confirmLabel: 'Restore defaults',
          body: 'Every course, deadline, topic and logged study session is replaced with the original semester data.'
        });
        if (!ok) return;
        await api.reset(); redraw(); toast('Semester defaults restored.');
        break;
      }
    }
  } catch (err) { toast(err.message, { error: true }); }
});

document.getElementById('themeBtn').addEventListener('click', toggleTheme);
document.getElementById('paletteBtn').addEventListener('click', openPalette);

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (sheetIsOpen() || document.querySelector('.palette')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (typing) return;
  const keys = { d: 'dash', c: 'courses', k: 'calendar', p: 'planner', a: 'areas', s: 'settings', g: 'log' };
  if (keys[e.key]) go(keys[e.key]);
  if (e.key === 'l') openLogDialog({ render: redraw });
  if (e.key === 'n') openCourseEditor(null, { render: redraw });
});

window.addEventListener('hashchange', () => {
  const next = location.hash.replace('#', '');
  if (VIEWS[next] && next !== view) go(next);
});

/* status LED follows request activity */
onState(() => { if (store.state) renderRail(); });

/* ---------------------------------------------------------------- boot ---- */
try {
  const saved = localStorage.getItem('scd.theme');
  if (saved) document.documentElement.dataset.theme = saved;
} catch {}

(async function boot() {
  try {
    await api.load();
    if (VIEWS[view].needsSessions) await loadExtras();
    render();
  } catch (e) {
    main().innerHTML = `<div class="module"><div class="body">
      <div class="alert crit">${icon('warn', 'ico')}<span class="txt"><b>Cannot reach the server</b>
        <p>${esc(e.message)}</p>
        <p class="mono" style="font-size:11.5px">Start it with <strong>npm start</strong> in the project folder, then reload this page.</p>
      </span></div></div></div>`;
    renderRail();
  }
})();
