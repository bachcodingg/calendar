/** Dialogs: the course editor, the set-date flow, study-time logging, overrides. */

import { api, store } from './api.js';
import {
  esc, attr, fmtLong, fmtShort, hrs, round1, icon, riskChip, openSheet, closeSheet,
  refreshSheet, toast, confirmDialog, localToday
} from './ui.js';

const KINDS = ['assignment', 'exercise', 'project', 'report', 'presentation', 'portfolio'];
const ASSESSMENTS = ['Exam', 'Oral exam', 'Exercises / Coursework', 'Coursework', 'Project', 'Portfolio'];

const courseById = id => store.state.courses.find(c => c.id === id);

/* ==========================================================================
   The set-date flow — a TBD exam becoming a real one
   ========================================================================== */
export function openSetDate(courseId, { render }) {
  const c = courseById(courseId);
  if (!c) return;
  let mode = 'confirmed';
  let date = c.estimatedDate || '';
  let impact = null;
  let pending = 0;

  const body = () => `
    <header><h2>${esc(c.name)}</h2>${riskChip(c.risk)}
      <button class="btn ghost sm" type="button" data-close aria-label="Close">✕</button></header>
    <div class="sbody">
      <div class="field">
        <label>Date state</label>
        <div class="seg" role="group" aria-label="How firm is this date">
          <button type="button" data-mode="confirmed" aria-pressed="${mode === 'confirmed'}">Announced — confirm it</button>
          <button type="button" data-mode="expected" aria-pressed="${mode === 'expected'}">Expected only</button>
        </div>
      </div>

      <div class="field">
        <label for="sd-date">${mode === 'confirmed' ? 'Exam date' : 'Expected exam date'}</label>
        <input id="sd-date" type="date" value="${attr(date)}" min="${localToday()}">
        <span class="hint">${mode === 'confirmed'
          ? 'Confirming switches on the countdown, calendar entry, reminders, milestones, risk and workload.'
          : 'An expected date is planned against provisionally and labelled as an estimate. No reminders and no milestones are created until it is confirmed.'}</span>
      </div>

      <div id="sd-impact">${impactPanel(impact, pending, c, mode)}</div>
    </div>
    <footer>
      <button class="btn pri" type="button" data-save ${date ? '' : 'disabled'}>${mode === 'confirmed' ? 'Confirm exam date' : 'Save expected date'}</button>
      <button class="btn" type="button" data-close>Cancel</button>
      ${c.estimatedDate || c.examDate ? `<button class="btn danger sp" type="button" data-clear>Back to TBD</button>` : ''}
    </footer>`;

  const preview = async () => {
    if (!date) { impact = null; paint(); return; }
    pending++;
    paint();
    const mine = pending;
    try {
      const r = await api.whatIf(courseId, date, mode);
      if (mine !== pending) return;
      impact = r.impact;
    } catch (e) {
      impact = null;
      if (mine === pending) toast(e.message, { error: true });
    } finally {
      if (mine === pending) { pending = 0; paint(); }
    }
  };

  const paint = () => refreshSheet(body(), wire);

  function wire(sheet) {
    sheet.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheet));
    sheet.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.mode; paint(); preview();
    }));
    const input = sheet.querySelector('#sd-date');
    input?.addEventListener('change', () => { date = input.value; paint(); preview(); });
    sheet.querySelector('[data-save]')?.addEventListener('click', async () => {
      try {
        const r = await api.setDate(courseId, date, mode);
        closeSheet();
        render();
        const live = store.state.courses.find(x => x.id === courseId);
        toast(mode === 'confirmed'
          ? `${c.name} confirmed for ${fmtLong(r.date)} — ${live.daysUntil} days out. ${
              live.deficitHours > 0.5 ? `Short ${hrs(live.deficitHours)}.` : 'The plan covers it.'} ${r.impact?.remindersCreated ?? 0} reminders created.`
          : `${c.name}: planning provisionally against ${fmtLong(r.date)}. No reminders until it is confirmed.`,
          { ms: 7000 });
      } catch (e) { toast(e.message, { error: true }); }
    });
    sheet.querySelector('[data-clear]')?.addEventListener('click', async () => {
      try { await api.clearDate(courseId); closeSheet(); render(); toast(`${c.name} is back to TBD — countdown and reminders removed.`); }
      catch (e) { toast(e.message, { error: true }); }
    });
  }

  openSheet(body(), { label: `Set a date for ${c.name}`, onMount(sheet) { wire(sheet); sheet.querySelector('#sd-date')?.focus(); } });
  if (date) preview();
}

function impactPanel(impact, pending, course, mode) {
  if (pending) return `<div class="alert info">${icon('alert', 'ico')}<span class="txt"><b>Working it out…</b><p>Recalculating the plan against this date.</p></span></div>`;
  if (!impact) {
    return `<div class="alert info">${icon('alert', 'ico')}<span class="txt"><b>Exam date TBD</b>
      <p>${hrs(course.prepRemainingHours)} of preparation is outstanding and not yet in the study plan. Pick a date to see whether it fits.</p></span></div>`;
  }
  const c = impact.course;
  const short = c.deficitHours > 0.5;
  const level = short ? (c.risk.key === 'crit' ? 'crit' : 'high') : 'low';

  return `
    <div class="alert ${level}">
      ${icon(short ? 'warn' : 'check', 'ico')}
      <span class="txt">
        <b>${esc(c.risk.label)}${mode === 'expected' ? ' · based on an expected date' : ''}</b>
        <p class="mono" style="font-size:12px">Exam ${fmtShort(c.date)} · ${c.daysUntil} days out · preparation remaining <strong>${hrs(c.prepRemainingHours)}</strong> · available study time <strong>${hrs(c.availableHours)}</strong></p>
        <p>${short
          ? `You need roughly <strong>${hrs(c.deficitHours)}</strong> more study time than the plan can find before this exam. Free up capacity, cut the estimate, or start earlier.`
          : `The plan finds enough time for this exam alongside everything else.`}</p>
        ${c.risk.reasons.length ? `<p class="mono" style="font-size:11px">${c.risk.reasons.map(r => `· ${esc(r)}`).join('<br>')}</p>` : ''}
      </span>
    </div>

    <div class="preview">
      <strong>Saving this would:</strong><br>
      · ${mode === 'confirmed' ? `create ${impact.remindersCreated} reminder${impact.remindersCreated === 1 ? '' : 's'} and ${impact.milestonesCreated} preparation milestone${impact.milestonesCreated === 1 ? '' : 's'}` : 'create no reminders and no milestones — it is only an estimate'}<br>
      · ${impact.cluster ? `place it inside a ${impact.cluster.exams.length}-exam period, ${fmtShort(impact.cluster.from)} – ${fmtShort(impact.cluster.to)}` : 'leave it clear of every other exam period'}<br>
      · ${impact.conflicts.length ? impact.conflicts.map(k => `<span style="color:var(--crit-ink)">${esc(k.title)}: ${esc(k.detail)}</span>`).join('<br>· ') : 'introduce no clashes'}<br>
      ${impact.knockOn.length ? `· move ${impact.knockOn.length} other course${impact.knockOn.length === 1 ? '' : 's'}: ${impact.knockOn.slice(0, 3).map(k => `${esc(k.name)} ${k.from} → ${k.to}`).join(', ')}<br>` : ''}
      · change the overall shortfall from ${impact.totals.before.deficitHours} h to ${impact.totals.after.deficitHours} h
    </div>`;
}

/* ==========================================================================
   Course editor
   ========================================================================== */
let draft = null;

export function openCourseEditor(courseId, { render }) {
  const live = courseId ? courseById(courseId) : null;
  if (courseId && !live) return;

  draft = live ? {
    id: live.id, name: live.name, credits: live.credits, assessment: live.assessment,
    dateState: live.dateState, examDate: live.examDate, estimatedDate: live.estimatedDate,
    subjectArea: live.subjectArea || '', prepEstimateHours: live.prepEstimateHours, isNew: false
  } : {
    id: null, name: '', credits: 5, assessment: 'Exam', dateState: 'tbd',
    examDate: null, estimatedDate: null, subjectArea: '', prepEstimateHours: 10, isNew: true
  };

  paintEditor(render);
}

function paintEditor(render) {
  const d = draft;
  const live = d.id ? courseById(d.id) : null;
  const isExam = d.dateState !== 'none';
  const areas = [...new Set(store.state.courses.map(c => c.subjectArea).filter(Boolean))];

  const html = `
    <header><h2>${d.isNew ? 'New course' : esc(d.name || 'Course')}</h2>
      ${live ? riskChip(live.risk) : ''}
      <button class="btn ghost sm" type="button" data-close aria-label="Close">✕</button></header>
    <div class="sbody">
      <div class="grid2">
        <div class="field" style="grid-column:1/-1"><label for="e-name">Course name</label>
          <input id="e-name" type="text" value="${attr(d.name)}" data-f="name" placeholder="e.g. Differential Calculus"></div>
        <div class="field"><label for="e-cred">Credits (ECTS)</label>
          <input id="e-cred" type="number" min="0" max="60" step="0.5" value="${d.credits}" data-f="credits"></div>
        <div class="field"><label for="e-assess">Assessment type</label>
          <select id="e-assess" data-f="assessment">${ASSESSMENTS.map(a => `<option ${a === d.assessment ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
        <div class="field"><label for="e-area">Subject area</label>
          <input id="e-area" type="text" list="arealist" value="${attr(d.subjectArea)}" data-f="subjectArea" placeholder="e.g. Mathematics">
          <datalist id="arealist">${areas.map(a => `<option value="${attr(a)}"></option>`).join('')}</datalist></div>
      </div>

      <fieldset>
        <legend>Exam date</legend>
        <div class="seg" role="group" aria-label="Date state">
          <button type="button" data-state="confirmed" aria-pressed="${d.dateState === 'confirmed'}">Confirmed date</button>
          <button type="button" data-state="tbd" aria-pressed="${d.dateState === 'tbd'}">TBD</button>
          <button type="button" data-state="none" aria-pressed="${d.dateState === 'none'}">No exam</button>
        </div>
        ${d.dateState === 'confirmed' ? `
          <div class="field"><label for="e-date">Date</label>
            <input id="e-date" type="date" value="${attr(d.examDate || '')}" data-f="examDate"></div>
          <p class="hint">${d.examDate
            ? `Counting down, on the calendar, reminders at ${store.state.settings.examReminders.join(', ')} days out, milestones generated, risk and workload included.`
            : 'Pick a date to switch on the countdown and reminders.'}</p>
        ` : d.dateState === 'tbd' ? `
          <p class="hint"><strong>Exam date TBD.</strong> No countdown is shown and no reminders are created. You may add an expected date — it is planned against provisionally and clearly marked as an estimate, but never reminded on.</p>
          <div class="field"><label for="e-est">Expected date (optional)</label>
            <input id="e-est" type="date" value="${attr(d.estimatedDate || '')}" data-f="estimatedDate" min="${localToday()}"></div>
          ${live ? `<button class="btn pri sm" type="button" data-act="set-date" data-id="${attr(d.id)}" style="align-self:flex-start">Announced? Set the real date →</button>` : ''}
        ` : `
          <p class="hint"><strong>No exam.</strong> Nothing counts down. This course is managed entirely through its assignments, exercises, projects and coursework deadlines below.</p>
        `}
      </fieldset>

      ${isExam ? `
      <fieldset>
        <legend>Preparation</legend>
        <div class="grid2">
          <div class="field"><label for="e-prep">Estimated preparation (hours)</label>
            <input id="e-prep" type="number" min="0" max="500" step="0.5" value="${d.prepEstimateHours}" data-f="prepEstimateHours"></div>
          <div class="field"><label>Completed — from the study ledger</label>
            <div class="mono" style="padding:7px 0;font-size:18px;font-weight:600">${live ? hrs(live.prepDoneHours) : '0 h'}</div>
            <span class="hint">Logged time only. Use the timer or log an entry.</span></div>
          <div class="field"><label>Remaining</label>
            <div class="mono" style="padding:7px 0;font-size:18px;font-weight:600">${live ? hrs(live.prepRemainingHours) : hrs(d.prepEstimateHours)}</div></div>
        </div>
        ${live && live.schedule.date ? `
          <div class="alert ${live.deficitHours > 0.5 ? (live.risk.key === 'crit' ? 'crit' : 'high') : 'low'}" style="align-items:center">
            ${icon(live.deficitHours > 0.5 ? 'warn' : 'check', 'ico')}
            <span class="txt"><b>${esc(live.risk.label)}</b>
              <p class="mono" style="font-size:12px">${live.daysUntil} days out · remaining <strong>${hrs(live.prepRemainingHours)}</strong> · available <strong>${hrs(live.availableHours)}</strong>${
                live.deficitHours > 0.5 ? ` · short <strong>${hrs(live.deficitHours)}</strong>` : ''}</p>
              ${live.risk.reasons.length ? `<p class="mono" style="font-size:11px">${live.risk.reasons.map(r => `· ${esc(r)}`).join('<br>')}</p>` : ''}
            </span></div>` : ''}

        ${live ? `<div class="btnrow">
          <span class="eyebrow">Log study time</span>
          ${[30, 60, 90, 120].map(m => `<button class="btn xs" type="button" data-act="log" data-course="${attr(d.id)}" data-minutes="${m}">+${m < 60 ? `${m}m` : `${m / 60}h`}</button>`).join('')}
        </div>` : ''}

        <div>
          <div class="eyebrow" style="margin-bottom:7px">Topics</div>
          <div class="topiclist">
            ${live && live.topics.length ? live.topics.map(t => `<div class="topic ${t.done ? 'done' : ''}">
              <input type="checkbox" id="tp-${attr(t.id)}" ${t.done ? 'checked' : ''} data-topic="${attr(t.id)}" aria-label="Mark ${attr(t.name)} covered">
              <input type="text" value="${attr(t.name)}" data-topicname="${attr(t.id)}" aria-label="Topic name">
              <button class="btn ghost xs" type="button" data-topicdel="${attr(t.id)}" aria-label="Remove topic">✕</button></div>`).join('')
              : `<div class="topic" style="color:var(--ink-3);font-size:12.5px">${live ? 'No topics yet.' : 'Save the course, then add topics.'}</div>`}
          </div>
          ${live ? `<button class="btn sm" type="button" data-topicadd style="margin-top:8px">+ Add topic</button>` : ''}
        </div>
      </fieldset>` : ''}

      ${live ? `
      <fieldset>
        <legend>Assignments, exercises &amp; coursework</legend>
        <div class="dlist">
          <div class="drow">
            <span class="dhead">Done</span><span class="dhead">Title</span>
            <span class="dhead hideSm">Type</span><span class="dhead hideSm">Due (blank = TBD)</span>
            <span class="dhead hideSm">Hours</span><span></span>
          </div>
          ${live.deliverables.map(x => `<div class="drow">
            <input type="checkbox" ${x.submitted ? 'checked' : ''} data-dsub="${attr(x.id)}" aria-label="Mark ${attr(x.title)} submitted">
            <input type="text" value="${attr(x.title)}" data-dtitle="${attr(x.id)}" aria-label="Title">
            <select class="hideSm" data-dkind="${attr(x.id)}" aria-label="Type">${KINDS.map(k => `<option ${k === x.kind ? 'selected' : ''}>${k}</option>`).join('')}</select>
            <input class="hideSm" type="date" value="${attr(x.dueDate || '')}" data-ddue="${attr(x.id)}" aria-label="Due date">
            <input class="hideSm" type="number" min="0" step="0.5" value="${x.estHours}" data-dhours="${attr(x.id)}" aria-label="Estimated hours">
            <button class="btn ghost xs" type="button" data-ddel="${attr(x.id)}" aria-label="Remove">✕</button>
          </div>`).join('')}
        </div>
        <div class="btnrow"><button class="btn sm" type="button" data-dadd>+ Add item</button></div>
        ${live.deliverables.some(x => !x.dueDate && !x.submitted)
          ? `<p class="hint">Items with no date show as <strong>deadline TBD</strong> — no countdown, no reminders — until you set one.</p>` : ''}
      </fieldset>` : `<p class="hint">Save the course first, then add its coursework.</p>`}
    </div>
    <footer>
      <button class="btn pri" type="button" data-save>${d.isNew ? 'Create course' : 'Save changes'}</button>
      <button class="btn" type="button" data-close>Close</button>
      ${d.isNew ? '' : `<button class="btn danger sp" type="button" data-delete>Delete course</button>`}
    </footer>`;

  const wire = sheet => wireEditor(sheet, render);
  if (document.querySelector('#sheetHost .sheet')) refreshSheet(html, wire);
  else openSheet(html, { label: d.isNew ? 'New course' : `Edit ${d.name}`, onMount(sheet) { wire(sheet); if (d.isNew) sheet.querySelector('#e-name')?.focus(); } });
}

function wireEditor(sheet, render) {
  const redraw = () => paintEditor(render);
  const run = async (fn, after) => {
    try { await fn(); render({ keepSheet: true }); after?.(); redraw(); }
    catch (e) { toast(e.message, { error: true }); }
  };

  sheet.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheet));

  sheet.querySelectorAll('[data-f]').forEach(el => {
    el.addEventListener('input', () => {
      const k = el.dataset.f;
      draft[k] = (k === 'credits' || k === 'prepEstimateHours') ? Number(el.value) : (el.value || (k.endsWith('Date') ? null : ''));
    });
    if (el.type === 'date') el.addEventListener('change', redraw);
  });

  sheet.querySelectorAll('[data-state]').forEach(b => b.addEventListener('click', () => {
    draft.dateState = b.dataset.state;
    if (draft.dateState !== 'confirmed') draft.examDate = null;
    if (draft.dateState !== 'tbd') draft.estimatedDate = null;
    if (draft.dateState === 'none' && draft.assessment === 'Exam') draft.assessment = 'Exercises / Coursework';
    redraw();
  }));

  sheet.querySelector('[data-save]')?.addEventListener('click', async () => {
    const payload = {
      name: draft.name, credits: draft.credits, assessment: draft.assessment,
      subjectArea: draft.subjectArea, prepEstimateHours: draft.prepEstimateHours,
      dateState: draft.dateState, examDate: draft.examDate, estimatedDate: draft.estimatedDate
    };
    try {
      if (draft.isNew) {
        const r = await api.createCourse(payload);
        draft.id = r.id; draft.isNew = false;
        render({ keepSheet: true });
        toast(`${draft.name} added.`);
        redraw();
      } else {
        await api.updateCourse(draft.id, payload);
        render({ keepSheet: true });
        toast(`${draft.name} saved.`);
        closeSheet();
      }
    } catch (e) { toast(e.message, { error: true }); }
  });

  sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Delete ${draft.name}?`, danger: true, confirmLabel: 'Delete course',
      body: 'Its topics, coursework and logged study time go with it. You can undo this from the study log.'
    });
    if (!ok) { paintEditor(render); return; }
    try {
      const r = await api.deleteCourse(draft.id);
      closeSheet(); render();
      const entry = store.activity.find(a => a.undoable);
      toast(`${r.removed} removed.`, { ms: 7000, action: entry ? { label: 'Undo', run: async () => { await api.undo(entry.id); render(); toast('Restored.'); } } : undefined });
    } catch (e) { toast(e.message, { error: true }); }
  });

  /* topics */
  sheet.querySelector('[data-topicadd]')?.addEventListener('click', () => run(() => api.addTopic(draft.id, 'New topic')));
  sheet.querySelectorAll('[data-topic]').forEach(el => el.addEventListener('change', () =>
    run(() => api.updateTopic(el.dataset.topic, { done: el.checked }))));
  sheet.querySelectorAll('[data-topicname]').forEach(el => el.addEventListener('change', () =>
    run(() => api.updateTopic(el.dataset.topicname, { name: el.value }))));
  sheet.querySelectorAll('[data-topicdel]').forEach(el => el.addEventListener('click', () =>
    run(() => api.deleteTopic(el.dataset.topicdel))));

  /* deliverables */
  sheet.querySelector('[data-dadd]')?.addEventListener('click', () =>
    run(() => api.addDeliverable(draft.id, { title: 'New item', kind: 'assignment', estHours: 4 })));
  sheet.querySelectorAll('[data-dsub]').forEach(el => el.addEventListener('change', () =>
    run(() => api.updateDeliverable(el.dataset.dsub, { submitted: el.checked }))));
  sheet.querySelectorAll('[data-dtitle]').forEach(el => el.addEventListener('change', () =>
    run(() => api.updateDeliverable(el.dataset.dtitle, { title: el.value }))));
  sheet.querySelectorAll('[data-dkind]').forEach(el => el.addEventListener('change', () =>
    run(() => api.updateDeliverable(el.dataset.dkind, { kind: el.value }))));
  sheet.querySelectorAll('[data-ddue]').forEach(el => el.addEventListener('change', () =>
    run(() => api.updateDeliverable(el.dataset.ddue, { dueDate: el.value || null }))));
  sheet.querySelectorAll('[data-dhours]').forEach(el => el.addEventListener('change', () =>
    run(() => api.updateDeliverable(el.dataset.dhours, { estHours: Number(el.value) }))));
  sheet.querySelectorAll('[data-ddel]').forEach(el => el.addEventListener('click', () =>
    run(() => api.deleteDeliverable(el.dataset.ddel))));
}

/* ==========================================================================
   Set a coursework deadline
   ========================================================================== */
export function openSetDeadline(deliverableId, title, { render }) {
  openSheet(`
    <header><h2>${esc(title)}</h2><button class="btn ghost sm" type="button" data-close aria-label="Close">✕</button></header>
    <div class="sbody">
      <p class="hint">A hand-in with no date behaves like a TBD exam: no countdown, no reminders, and its hours sit outside the study plan. Entering a deadline puts it straight back in.</p>
      <div class="field"><label for="dl-date">Deadline</label><input id="dl-date" type="date" min="${localToday()}"></div>
    </div>
    <footer>
      <button class="btn pri" type="button" data-save>Set deadline</button>
      <button class="btn" type="button" data-close>Cancel</button>
    </footer>`, {
    label: `Set a deadline for ${title}`,
    onMount(sheet) {
      const input = sheet.querySelector('#dl-date');
      input.focus();
      sheet.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheet));
      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        if (!input.value) { toast('Pick a date first.', { error: true }); return; }
        try {
          await api.updateDeliverable(deliverableId, { dueDate: input.value });
          closeSheet(); render();
          toast(`“${title}” due ${fmtLong(input.value)} — reminders at ${store.state.settings.workReminders.join(', ')} days out.`, { ms: 6000 });
        } catch (e) { toast(e.message, { error: true }); }
      });
    }
  });
}

/* ==========================================================================
   Log study time by hand
   ========================================================================== */
export function openLogDialog({ render, courseId = '' } = {}) {
  const courses = store.state.courses;
  openSheet(`
    <header><h2>Log study time</h2><button class="btn ghost sm" type="button" data-close aria-label="Close">✕</button></header>
    <div class="sbody">
      <div class="grid2">
        <div class="field" style="grid-column:1/-1"><label for="lg-course">Course</label>
          <select id="lg-course">${courses.map(c => `<option value="${attr(c.id)}" ${c.id === courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field" style="grid-column:1/-1"><label for="lg-deliv">Against</label>
          <select id="lg-deliv"></select></div>
        <div class="field"><label for="lg-date">Date</label><input id="lg-date" type="date" value="${localToday()}"></div>
        <div class="field"><label for="lg-mins">Minutes</label><input id="lg-mins" type="number" min="5" max="1440" step="5" value="60"></div>
        <div class="field" style="grid-column:1/-1"><label for="lg-note">Note (optional)</label>
          <input id="lg-note" type="text" placeholder="What did you work through?"></div>
      </div>
      <div class="btnrow">${[30, 60, 90, 120, 180].map(m => `<button class="btn xs" type="button" data-quick="${m}">${m < 60 ? `${m}m` : `${m / 60}h`}</button>`).join('')}</div>
    </div>
    <footer>
      <button class="btn pri" type="button" data-save>Log it</button>
      <button class="btn" type="button" data-close>Cancel</button>
    </footer>`, {
    label: 'Log study time',
    onMount(sheet) {
      const cSel = sheet.querySelector('#lg-course');
      const dSel = sheet.querySelector('#lg-deliv');
      const mins = sheet.querySelector('#lg-mins');

      const fillDeliverables = () => {
        const c = courses.find(x => x.id === cSel.value);
        const open = (c?.deliverables ?? []).filter(d => !d.submitted);
        dSel.innerHTML = `<option value="">Exam preparation</option>` +
          open.map(d => `<option value="${attr(d.id)}">${esc(d.title)}${d.dueDate ? ` — due ${fmtShort(d.dueDate)}` : ' — deadline TBD'}</option>`).join('');
        dSel.disabled = !c?.isExam && !open.length;
        if (!c?.isExam && open.length) dSel.selectedIndex = 1;
      };
      fillDeliverables();
      cSel.addEventListener('change', fillDeliverables);
      sheet.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => { mins.value = b.dataset.quick; }));
      sheet.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheet));

      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        try {
          await api.logSession({
            courseId: cSel.value,
            deliverableId: dSel.value || null,
            date: sheet.querySelector('#lg-date').value,
            minutes: Number(mins.value),
            note: sheet.querySelector('#lg-note').value
          });
          closeSheet(); render();
          const c = store.state.courses.find(x => x.id === cSel.value);
          toast(`${round1(Number(mins.value) / 60)} h logged. ${esc(c.name)}: ${hrs(c.prepRemainingHours)} of preparation left.`);
        } catch (e) { toast(e.message, { error: true }); }
      });
    }
  });
}

/* ==========================================================================
   Day capacity override
   ========================================================================== */
export function openOverride(date, { render }) {
  const existing = store.state.overrides.find(o => o.date === date);
  const weekdayHours = store.state.capacity[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
  openSheet(`
    <header><h2>Study hours on ${esc(fmtLong(date))}</h2><button class="btn ghost sm" type="button" data-close aria-label="Close">✕</button></header>
    <div class="sbody">
      <p class="hint">The weekly pattern gives this day <strong>${weekdayHours} h</strong>. An override replaces that for this date only — set it to 0 to block the day out completely, and the planner moves the work elsewhere.</p>
      <div class="grid2">
        <div class="field"><label for="ov-hours">Hours</label>
          <input id="ov-hours" type="number" min="0" max="16" step="0.5" value="${existing ? existing.hours : weekdayHours}"></div>
        <div class="field"><label for="ov-reason">Reason (optional)</label>
          <input id="ov-reason" type="text" value="${attr(existing?.reason || '')}" placeholder="Travelling, work shift, holiday…"></div>
      </div>
      <div class="btnrow">
        <button class="btn xs" type="button" data-set="0">Block the day</button>
        <button class="btn xs" type="button" data-set="${weekdayHours}">Back to normal</button>
        <button class="btn xs" type="button" data-set="8">Crunch day (8 h)</button>
      </div>
    </div>
    <footer>
      <button class="btn pri" type="button" data-save>Save</button>
      <button class="btn" type="button" data-close>Cancel</button>
      ${existing ? `<button class="btn danger sp" type="button" data-remove>Remove override</button>` : ''}
    </footer>`, {
    label: `Study hours on ${date}`,
    onMount(sheet) {
      const hoursEl = sheet.querySelector('#ov-hours');
      hoursEl.focus();
      sheet.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheet));
      sheet.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', () => { hoursEl.value = b.dataset.set; }));
      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        try {
          await api.setOverride({ date, hours: Number(hoursEl.value), reason: sheet.querySelector('#ov-reason').value });
          closeSheet(); render();
          toast(`${fmtLong(date)} set to ${hoursEl.value} h — the plan has been redistributed.`);
        } catch (e) { toast(e.message, { error: true }); }
      });
      sheet.querySelector('[data-remove]')?.addEventListener('click', async () => {
        try { await api.clearOverride(date); closeSheet(); render(); toast(`${fmtLong(date)} is back to the weekly pattern.`); }
        catch (e) { toast(e.message, { error: true }); }
      });
    }
  });
}
