/** The six main views. Each returns HTML; `mount` wires up anything interactive. */

import {
  esc, attr, fmtLong, fmtShort, fmtDay, hrs, pct, round1, icon, riskChip, dateChip, meter,
  sevClass, colourFor, parseDate, isoDate, addDays, dayDiff, weekStartOf, MONTHS, WEEKDAYS
} from './ui.js';
import { weeklyChart, bindWeeklyChart, densityStrip, streakStrip } from './charts.js';

const alertBox = (level, title, body) => `
  <div class="alert ${level}">
    ${icon(level === 'low' ? 'check' : level === 'crit' || level === 'high' ? 'warn' : 'alert', 'ico')}
    <span class="txt"><b>${title}</b>${body}</span>
  </div>`;

/* ==========================================================================
   Dashboard
   ========================================================================== */
function dashboard(model) {
  const t = model.totals;
  const alerts = [];

  for (const cl of model.clusters.filter(c => c.dense)) {
    alerts.push(alertBox(cl.pressure > 1 ? 'crit' : 'high', 'High-density exam period', `
      <p>${cl.exams.length} exams between <strong>${fmtLong(cl.from)}</strong> and <strong>${fmtLong(cl.to)}</strong> — ${cl.span} days.
      They need <strong class="mono">${hrs(cl.load)}</strong> of preparation against <strong class="mono">${hrs(cl.capacity)}</strong> of capacity before the last one${
        cl.pressure > 1 ? `, roughly <strong class="mono">${hrs(cl.load - cl.capacity)}</strong> more than you have.` : '.'
      }${cl.provisional ? ' One of these dates is an estimate, not confirmed.' : ''}</p>
      <p class="mono" style="font-size:11.5px">${cl.exams.map(e => `${fmtShort(e.date)} ${esc(e.name)}${e.firm ? '' : ' (est.)'}`).join('  ·  ')}</p>`));
  }
  for (const k of model.conflicts.slice(0, 4)) {
    alerts.push(alertBox(k.level, esc(k.title), `<p>${esc(k.detail)}</p>`));
  }
  if (!alerts.length) {
    alerts.push(alertBox('low', 'No clashes detected',
      `<p>No exams sit close enough together to compete for the same weeks, and nothing dated is short of study time.</p>`));
  }

  const worstLabel = { low: 'On track', mod: 'Moderate', high: 'High risk', crit: 'Critical' }[model.worstRisk];

  return `
  <div class="kpis">
    <div class="kpi"><span class="lab">Credits this term</span><b>${t.credits}</b><span class="note">ECTS across ${t.courses} courses</span></div>
    <div class="kpi"><span class="lab">Exam dates</span><b>${t.confirmed}<span class="unit">/${t.examCount}</span></b><span class="note">${t.unscheduled} still TBD · ${t.noExam} coursework-only</span></div>
    <div class="kpi"><span class="lab">Work remaining</span><b>${Math.round(t.remainingHours)}<span class="unit"> h</span></b><span class="note">${t.weeklyCapacity} h/week of capacity${t.unplannedHours > 0.5 ? ` · ${Math.round(t.unplannedHours)} h waiting on a date` : ''}</span></div>
    <div class="kpi"><span class="lab">Shortfall</span><b style="color:${t.deficitHours > 0.5 ? 'var(--crit-ink)' : 'var(--good-ink)'}">${t.deficitHours > 0.5 ? t.deficitHours : 0}<span class="unit"> h</span></b><span class="note">${t.deficitHours > 0.5 ? 'More than the plan can find before the deadlines' : 'Everything dated fits inside your capacity'}</span></div>
    <div class="kpi"><span class="lab">Logged so far</span><b>${Math.round(t.loggedHours)}<span class="unit"> h</span></b><span class="note">Overall risk: ${worstLabel}</span></div>
  </div>

  <div class="alerts">${alerts.join('')}</div>

  <div class="module">
    <header><h2>Today</h2>
      <span class="sub">${fmtDay(model.today)} · ${t.todayAssigned} of ${t.todayCapacity} h planned</span></header>
    <div class="body flush">
      <div class="todaylist">
        ${model.todayPlan.length ? model.todayPlan.map(row => `
          <div class="todayrow">
            <span class="alloc">${row.hours}<span style="font-size:11px;color:var(--ink-3)">h</span></span>
            <span class="what">
              <b>${esc(row.label)}</b>
              <span>${row.dueDate ? `${row.firm ? 'due' : 'expected'} ${fmtShort(row.dueDate)}` : ''}</span>
            </span>
            <span class="qa">
              <button class="btn xs" type="button" data-act="log" data-course="${attr(row.courseId)}" data-deliverable="${attr(row.deliverableId || '')}" data-minutes="30">+30m</button>
              <button class="btn xs" type="button" data-act="log" data-course="${attr(row.courseId)}" data-deliverable="${attr(row.deliverableId || '')}" data-minutes="60">+1h</button>
              <button class="btn xs" type="button" data-act="log" data-course="${attr(row.courseId)}" data-deliverable="${attr(row.deliverableId || '')}" data-minutes="${Math.round(row.hours * 60)}">+${row.hours}h</button>
              <button class="btn xs pri" type="button" data-act="timer" data-course="${attr(row.courseId)}" data-deliverable="${attr(row.deliverableId || '')}" data-label="${attr(row.label)}">Start timer</button>
            </span>
          </div>`).join('')
        : `<div class="empty">Nothing to study today — no dated course has outstanding hours.</div>`}
      </div>
    </div>
  </div>

  <div class="module">
    <header><h2>Exam density</h2><span class="sub">Shaded bands are chains of exams within ${model.settings.clusterWindow} days of each other</span></header>
    <div class="body">${densityStrip(model)}</div>
  </div>

  <div class="cols">
    <div class="colstack">
      <div class="module">
        <header><h2>Countdown</h2><span class="sub">${model.upcomingExams.length} scheduled ahead</span></header>
        <div class="body flush"><div class="readouts">
          ${model.upcomingExams.length
            ? model.upcomingExams.map(readout).join('')
            : `<div class="empty">No exam has a date yet. Set one and the whole deck comes alive.</div>`}
        </div></div>
      </div>

      <div class="module">
        <header><h2>Weekly workload</h2><span class="sub">Hours the plan assigns against hours you have</span></header>
        <div class="body">${weeklyChart(model.weeks.slice(0, 14))}</div>
        <div class="legend">
          <span><i style="background:var(--accent)"></i>Assigned study hours</span>
          <span><i style="background:var(--surface-3);border:1px solid var(--line-2)"></i>Unused capacity</span>
          <span><i style="background:var(--crit)"></i>Exam that week</span>
        </div>
      </div>
    </div>

    <div class="colstack">
      <div class="module">
        <header><h2>Awaiting a date</h2><span class="sub">${model.awaitingDate.length} item${model.awaitingDate.length === 1 ? '' : 's'}</span></header>
        <div class="body">
          ${model.awaitingDate.length ? `
            <div class="tbdgrid">${model.awaitingDate.map(awaitingCard).join('')}</div>
            <p class="hint" style="margin-top:12px">Nothing is counted down, reminded, or risk-scored from a TBD date. The moment you enter one, the countdown, calendar entries, reminders, milestones, risk and workload all recalculate.</p>`
            : `<div class="empty">Every exam and hand-in has a date.</div>`}
        </div>
      </div>

      <div class="module">
        <header><h2>Risk board</h2></header>
        <div class="body flush"><div class="tblwrap"><table>
          <thead><tr><th>Course</th><th>Date</th><th class="n r">Left</th><th class="n r">Planned</th><th>Status</th></tr></thead>
          <tbody>${[...model.courses].sort((a, b) => (b.risk.score ?? -1) - (a.risk.score ?? -1)).map(riskRow).join('')}</tbody>
        </table></div></div>
      </div>
    </div>
  </div>`;
}

function readout(c) {
  const shortfallFraction = c.prepEstimateHours > 0 ? c.deficitHours / c.prepEstimateHours : 0;
  return `<div class="readout ${sevClass(c.risk)}">
    <div class="cd"><b>${c.daysUntil}</b><span>${c.daysUntil === 1 ? 'day' : 'days'}${c.schedule.firm ? '' : ' est.'}</span></div>
    <div class="meta">
      <div class="ttl"><b>${esc(c.name)}</b>${c.schedule.firm ? '' : `<span class="chip tbd"><span class="g"></span>Not confirmed</span>`}${c.subjectArea ? `<span class="chip plain">${esc(c.subjectArea)}</span>` : ''}</div>
      <div class="facts">
        <span>${fmtLong(c.schedule.date)}</span>
        <span>${c.credits} ECTS</span>
        <span>${hrs(c.prepDoneHours)} / ${hrs(c.prepEstimateHours)} prepared</span>
        ${c.deficitHours > 0.5
          ? `<span style="color:var(--crit-ink)">short ${hrs(c.deficitHours)}</span>`
          : `<span style="color:var(--good-ink)">plan covers it</span>`}
      </div>
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
        ${meter(c.prepFraction, shortfallFraction)}
        <span class="mono" style="font-size:11px;color:var(--ink-3)">${c.topicCount ? `${c.topicsDone}/${c.topicCount} topics` : pct(c.prepFraction)}</span>
      </div>
    </div>
    <div class="right">
      ${riskChip(c.risk)}
      <span style="display:flex;gap:5px">
        <button class="btn xs" type="button" data-act="log" data-course="${attr(c.id)}" data-minutes="60">+1h</button>
        <button class="btn sm" type="button" data-act="edit-course" data-id="${attr(c.id)}">Open</button>
      </span>
    </div>
  </div>`;
}

function awaitingCard(c) {
  const openWork = c.deliverables.filter(d => !d.dueDate && !d.submitted);
  return `<div class="tbdcard">
    <div class="hd"><b>${esc(c.name)}</b><span class="chip plain">${c.credits} ECTS</span></div>
    ${c.isExam ? `
      <div class="state">Exam date: <strong>${c.estimatedDate ? `expected ${fmtLong(c.estimatedDate)}` : 'TBD'}</strong></div>
      <div class="setrow">
        <button class="btn pri sm" type="button" data-act="set-date" data-id="${attr(c.id)}">Set exam date</button>
        ${c.estimatedDate ? `<button class="btn sm" type="button" data-act="clear-date" data-id="${attr(c.id)}">Clear estimate</button>` : ''}
      </div>
      <div class="mono" style="font-size:11px;color:var(--ink-3)">${hrs(c.prepRemainingHours)} of preparation outstanding${
        c.estimatedDate ? ' · planned provisionally against the expected date' : ' · not yet in the study plan'}</div>
    ` : ''}
    ${openWork.length ? `
      <div class="state" style="border-top:1px solid var(--line);padding-top:9px">Deadline not announced:</div>
      ${openWork.map(w => `<div class="setrow">
        <span class="mono" style="font-size:11.5px;flex:1 1 110px">${esc(w.title)}</span>
        <button class="btn sm" type="button" data-act="set-deadline" data-id="${attr(w.id)}" data-title="${attr(w.title)}">Set deadline</button>
      </div>`).join('')}` : ''}
  </div>`;
}

function riskRow(c) {
  const left = c.prepRemainingHours + c.workRemainingTotal;
  const planned = c.availableHours + c.deliverables.reduce((s, d) => s + d.availableHours, 0);
  const dateCell = c.dateState === 'none'
    ? `<span style="color:var(--ink-3)">Coursework</span>`
    : c.dateState === 'tbd'
      ? `<span style="color:var(--ink-3)">${c.estimatedDate ? `est. ${fmtShort(c.estimatedDate)}` : 'TBD'}</span>`
      : fmtShort(c.examDate);
  return `<tr>
    <td><button class="am nm" type="button" data-act="edit-course" data-id="${attr(c.id)}"><span class="cname">${esc(c.name)}</span></button>
      ${c.subjectArea ? `<div class="mono" style="font-size:10.5px;color:var(--ink-3)">${esc(c.subjectArea)}</div>` : ''}</td>
    <td class="n">${dateCell}</td>
    <td class="n r">${left > 0 ? hrs(left) : '—'}</td>
    <td class="n r" style="color:${left - planned > 0.5 ? 'var(--crit-ink)' : 'var(--ink-2)'}">${left > 0 ? hrs(planned) : '—'}</td>
    <td>${riskChip(c.risk)}</td>
  </tr>`;
}

/* ==========================================================================
   Courses
   ========================================================================== */
function courses(model) {
  const t = model.totals;
  return `
  <div class="module">
    <header>
      <h2>Courses</h2>
      <span class="sub">${t.credits} ECTS · ${t.confirmed} confirmed · ${t.unscheduled} TBD · ${t.noExam} without an exam</span>
    </header>
    <div class="body flush">${model.courses.map(courseRow).join('')}</div>
  </div>
  <div class="btnrow">
    <button class="btn pri" type="button" data-act="new-course">+ Add course</button>
    <button class="btn" type="button" data-act="export">Export JSON</button>
    <button class="btn" type="button" data-act="import">Import JSON</button>
    <button class="btn danger" type="button" data-act="reset">Restore semester defaults</button>
  </div>
  <p class="hint">Coursework items on the three project courses are starter examples — edit, re-date or delete them.</p>`;
}

function courseRow(c) {
  const bits = [`${c.credits} ECTS`, esc(c.assessment)];
  if (c.isExam) {
    bits.push(c.prepEstimateHours ? `${hrs(c.prepDoneHours)} / ${hrs(c.prepEstimateHours)} prep` : 'no prep estimate');
    if (c.topicCount) bits.push(`${c.topicsDone}/${c.topicCount} topics`);
    if (c.daysUntil !== null && c.daysUntil >= 0) bits.push(`${c.daysUntil} days out`);
  } else {
    const submitted = c.deliverables.filter(d => d.submitted).length;
    bits.push(`${submitted}/${c.deliverables.length} submitted`);
    if (c.workRemainingTotal) bits.push(`${hrs(c.workRemainingTotal)} of work left`);
    const next = c.deliverables.filter(d => !d.submitted && d.dueDate).sort((a, b) => a.daysUntil - b.daysUntil)[0];
    if (next) bits.push(`next: ${esc(next.title)} ${fmtShort(next.dueDate)}`);
  }
  return `<div class="crow">
    <div class="l">
      <div class="t"><b>${esc(c.name)}</b>${dateChip(c)}${c.subjectArea ? `<span class="chip plain">${esc(c.subjectArea)}</span>` : ''}</div>
      <div class="d">${bits.map(b => `<span>${b}</span>`).join('')}</div>
    </div>
    <div class="r">
      ${riskChip(c.risk)}
      <button class="btn xs" type="button" data-act="log" data-course="${attr(c.id)}" data-minutes="60">+1h</button>
      <button class="btn sm" type="button" data-act="edit-course" data-id="${attr(c.id)}">Edit</button>
    </div>
  </div>`;
}

/* ==========================================================================
   Calendar
   ========================================================================== */
let calCursor = null;
export function calendarCursor(next) {
  if (next !== undefined) calCursor = next;
  return calCursor;
}

function calendar(model) {
  if (!calCursor) {
    const first = model.upcomingExams[0];
    const base = parseDate(first ? first.schedule.date : model.today);
    calCursor = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  }
  const monthStart = new Date(Date.UTC(calCursor.getUTCFullYear(), calCursor.getUTCMonth(), 1));
  const gridStart = weekStartOf(monthStart);
  const hoursByDay = Object.fromEntries(model.plan.days.map(d => [d.date, d.assigned]));
  const overrides = Object.fromEntries(model.overrides.map(o => [o.date, o]));
  const order = { exam: 0, expected: 1, deadline: 2, milestone: 3, reminder: 4 };

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const key = isoDate(d);
    const out = d.getUTCMonth() !== monthStart.getUTCMonth();
    const isToday = key === model.today;
    const ov = overrides[key];
    const events = model.events.filter(e => e.date === key).sort((a, b) => order[a.type] - order[b.type]);
    const h = hoursByDay[key] || 0;
    const glyph = { exam: '◆', expected: '◇', deadline: '▲', milestone: '•', reminder: '›' };

    cells.push(`<div class="cell ${out ? 'out' : ''} ${isToday ? 'today' : ''} ${ov?.hours === 0 ? 'blocked' : ''}">
      <span class="dn">${d.getUTCDate()}
        ${isToday ? '<span class="chip accent" style="font-size:8.5px;padding:0 5px">Today</span>' : ''}
        ${ov ? `<span class="chip tbd" style="font-size:8.5px;padding:0 5px" title="${attr(ov.reason || 'Capacity override')}">${ov.hours}h</span>` : ''}
        ${h > 0.05 ? `<span class="hrs mono">${round1(h)}h</span>` : ''}</span>
      ${events.slice(0, 4).map(e => `<button class="ev ${e.type}" type="button" data-act="edit-course" data-id="${attr(e.courseId)}"
        title="${attr(`${e.note} — ${e.title}`)}">${glyph[e.type]} ${esc(e.title)}</button>`).join('')}
      ${events.length > 4 ? `<span class="mono" style="font-size:9.5px;color:var(--ink-3)">+${events.length - 4} more</span>` : ''}
      <button class="cellbtn" type="button" data-act="override" data-date="${key}" title="Adjust study hours for this day">± h</button>
    </div>`);
  }

  const fixed = model.events
    .filter(e => ['exam', 'expected', 'deadline'].includes(e.type))
    .filter(e => { const d = parseDate(e.date); return d.getUTCMonth() === monthStart.getUTCMonth() && d.getUTCFullYear() === monthStart.getUTCFullYear(); });

  return `
  <div class="module">
    <header>
      <h2>${MONTHS[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}</h2>
      <div class="acts">
        <button class="btn sm" type="button" data-act="cal" data-step="-1" aria-label="Previous month">←</button>
        <button class="btn sm" type="button" data-act="cal" data-step="0">Today</button>
        <button class="btn sm" type="button" data-act="cal" data-step="1" aria-label="Next month">→</button>
        <a class="btn sm" href="/calendar.ics" download="semester.ics">Download .ics</a>
        <button class="btn sm" type="button" data-act="subscribe">Subscribe</button>
      </div>
    </header>
    <div class="body flush">
      <div class="calhead">${WEEKDAYS.map(d => `<div>${d}</div>`).join('')}</div>
      <div class="cal">${cells.join('')}</div>
    </div>
    <div class="legend">
      <span><i style="background:var(--crit)"></i>Exam</span>
      <span><i style="background:var(--ink-3)"></i>Expected exam — no reminders</span>
      <span><i style="background:var(--warn)"></i>Hand-in due</span>
      <span><i style="background:var(--accent)"></i>Preparation milestone</span>
      <span><i style="background:var(--line-2)"></i>Reminder</span>
      <span class="mono" style="color:var(--ink-3)">Corner figure = study hours the plan assigns that day</span>
    </div>
  </div>

  <div class="module">
    <header><h2>Fixed points this month</h2></header>
    <div class="body flush">${fixed.length ? `<div class="tblwrap"><table>
      <thead><tr><th>Date</th><th>What</th><th>Type</th><th></th></tr></thead>
      <tbody>${fixed.map(e => `<tr>
        <td class="n">${fmtLong(e.date)}</td>
        <td>${esc(e.title)}</td>
        <td><span class="chip ${e.type === 'exam' ? 'crit' : e.type === 'expected' ? 'tbd' : 'mod'}"><span class="g"></span>${
          e.type === 'exam' ? 'Exam' : e.type === 'expected' ? 'Expected' : 'Due'}</span></td>
        <td class="r"><button class="btn sm" type="button" data-act="edit-course" data-id="${attr(e.courseId)}">Open</button></td>
      </tr>`).join('')}</tbody></table></div>` : `<div class="empty">Nothing fixed in this month.</div>`}</div>
  </div>`;
}

/* ==========================================================================
   Study plan
   ========================================================================== */
function planner(model) {
  const colour = colourFor([...new Set(model.plan.items.map(i => i.courseId))]);
  const byKey = Object.fromEntries(model.plan.items.map(i => [i.key, i]));
  const weeks = model.weeks.filter(w => w.assigned > 0.05 || w.events.length).slice(0, 18);

  return `
  <div class="module">
    <header><h2>How the plan splits your weeks</h2>
      <span class="sub">${model.totals.weeklyCapacity} h/week · ${pct(model.settings.reserveShare)} of every day reserved for work further out</span></header>
    <div class="body">
      <p class="hint" style="margin-bottom:14px">Each day's hours go to whatever has the highest required rate — hours still needed divided by days still available. While anything else is open, the nearest deadline never takes more than ${pct(1 - model.settings.reserveShare)} of a day, so later exams keep accruing preparation while an earlier one bears down. Only courses with a date are in the plan; a TBD exam joins the moment you enter one.</p>
      <div style="display:flex;flex-direction:column;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:8px;overflow:hidden">
        ${weeks.length ? weeks.map(w => weekRow(w, byKey, colour)).join('')
          : `<div class="empty" style="background:var(--surface)">Nothing scheduled — no course has both a date and outstanding hours.</div>`}
      </div>
    </div>
  </div>

  <div class="module">
    <header><h2>Preparation milestones</h2><span class="sub">Generated backwards from each confirmed exam date</span></header>
    <div class="body flush">
      ${model.exams.filter(e => e.schedule.date).sort((a, b) => a.daysUntil - b.daysUntil).map(c => milestoneBlock(c, model)).join('')
        || `<div class="empty">No exam dates yet.</div>`}
    </div>
  </div>`;
}

function weekRow(w, byKey, colour) {
  const entries = Object.entries(w.parts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(w.capacity, w.assigned, 1);
  return `<div class="wk">
    <div class="wl">
      <b>${fmtShort(w.start)}</b>
      <span>${w.assigned} of ${w.capacity} h</span>
      ${w.events.map(e => `<span class="chip ${e.type === 'exam' ? 'crit' : e.type === 'expected' ? 'tbd' : 'mod'}"><span class="g"></span>${
        e.type === 'deadline' ? 'Due' : 'Exam'}</span>`).join('')}
    </div>
    <div class="bars">
      ${entries.length ? entries.map(([k, v]) => {
        const it = byKey[k];
        if (!it) return '';
        return `<div class="bar">
          <span class="track"><i style="width:${(v / max) * 100}%;background:${colour(it.courseId)}"></i></span>
          <span class="lab">${hrs(v)} · ${esc(it.label.length > 40 ? it.label.slice(0, 39) + '…' : it.label)}${it.firm ? '' : ' (est.)'}</span>
        </div>`;
      }).join('') : `<div class="bar"><span class="track"></span><span class="lab" style="color:var(--ink-3)">Free week</span></div>`}
    </div>
  </div>`;
}

function milestoneBlock(c, model) {
  const ms = model.events
    .filter(e => e.type === 'milestone' && e.courseId === c.id)
    .filter(e => dayDiff(parseDate(model.today), parseDate(e.date)) >= -14);
  if (!ms.length && !c.schedule.firm) {
    return `<div style="padding:14px 16px;border-bottom:1px solid var(--line)">
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
        <h3>${esc(c.name)}</h3><span class="chip tbd"><span class="g"></span>Expected ${fmtShort(c.schedule.date)}</span>
      </div>
      <p class="hint" style="margin-top:6px">Milestones are generated once the date is confirmed — an estimate does not earn a schedule.</p>
    </div>`;
  }
  return `<div style="padding:14px 16px;border-bottom:1px solid var(--line)">
    <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:9px">
      <h3>${esc(c.name)}</h3>
      <span class="chip plain">${fmtLong(c.schedule.date)}</span>
      ${riskChip(c.risk)}
      <span class="mono" style="font-size:11px;color:var(--ink-3);margin-left:auto">${c.leadDays}-day recommended run-up</span>
    </div>
    <div class="tblwrap"><table><tbody>
      ${ms.map(m => {
        const past = m.date < model.today;
        return `<tr>
          <td class="n" style="width:96px;color:${past ? 'var(--ink-3)' : 'var(--ink-2)'}">${fmtShort(m.date)}</td>
          <td style="${past ? 'color:var(--ink-3)' : ''}">${m.milestoneKind === 'topic' ? '· ' : '◻ '}${esc(m.note)}</td>
          <td class="r" style="width:86px">${m.milestoneKind === 'topic'
            ? (m.done ? `<span class="chip low"><span class="g"></span>Done</span>`
              : past ? `<span class="chip mod"><span class="g"></span>Late</span>` : '')
            : ''}</td>
        </tr>`;
      }).join('')}
    </tbody></table></div>
  </div>`;
}

/* ==========================================================================
   Subject areas
   ========================================================================== */
function areas(model) {
  return `
  <div class="module">
    <header><h2>Subject areas</h2><span class="sub">Grouped by the “Subject area” field on each course</span></header>
    <div class="body">
      <p class="hint" style="margin-bottom:14px">Grouping is a lens, not a container — every course still stands on its own everywhere else on the deck. Integral Calculus, Differential Calculus, Matrix Algebra and Statistic II are grouped as <strong>Mathematics</strong> by default.</p>
      <div class="areas">${model.areas.map(a => areaCard(a, model)).join('')}</div>
    </div>
  </div>`;
}

function areaCard(area, model) {
  const members = area.courseIds.map(id => model.courses.find(c => c.id === id)).filter(Boolean);
  return `<div class="acard">
    <header><h3>${esc(area.name)}</h3>
      <span style="margin-left:auto">${riskChip({ key: area.risk, label: area.riskLabel })}</span></header>
    <div class="astats">
      <div class="astat"><b>${area.credits}</b><span>Total ECTS</span></div>
      <div class="astat"><b>${area.upcoming}${area.unscheduled ? `<span class="unit"> +${area.unscheduled} tbd</span>` : ''}</b><span>Upcoming exams</span></div>
      <div class="astat"><b>${Math.round(area.remainingHours)}<span class="unit"> h</span></b><span>Workload left</span></div>
      <div class="astat"><b>${pct(area.prepFraction)}</b><span>Preparation</span></div>
    </div>
    <div class="amembers">
      ${members.map(c => `<div class="am">
        <button class="nm" type="button" data-act="edit-course" data-id="${attr(c.id)}">${esc(c.name)}</button>
        <span style="display:flex;gap:7px;align-items:center;flex:none">
          <span class="mono" style="font-size:10.5px;color:var(--ink-3)">${
            c.dateState === 'none' ? 'coursework' : c.dateState === 'tbd' ? (c.estimatedDate ? `est ${fmtShort(c.estimatedDate)}` : 'TBD') : fmtShort(c.examDate)}</span>
          ${riskChip(c.risk)}
        </span></div>`).join('')}
      ${area.next ? `<div class="mono" style="font-size:11px;color:var(--ink-3);border-top:1px solid var(--line);padding-top:8px;margin-top:3px">Next up: ${esc(area.next.name)} in ${area.next.daysUntil} days</div>` : ''}
    </div>
  </div>`;
}

/* ==========================================================================
   Study log
   ========================================================================== */
function studyLog(model, extra) {
  const sessions = extra?.sessions ?? [];
  const histogram = extra?.histogram ?? [];
  const logged7 = histogram.slice(-7).reduce((s, d) => s + d.minutes, 0) / 60;
  const logged28 = histogram.slice(-28).reduce((s, d) => s + d.minutes, 0) / 60;
  let streak = 0;
  for (let i = histogram.length - 1; i >= 0; i--) { if (histogram[i].minutes > 0) streak++; else break; }

  return `
  <div class="kpis">
    <div class="kpi"><span class="lab">Logged, last 7 days</span><b>${round1(logged7)}<span class="unit"> h</span></b><span class="note">Target ${model.totals.weeklyCapacity} h/week</span></div>
    <div class="kpi"><span class="lab">Logged, last 28 days</span><b>${round1(logged28)}<span class="unit"> h</span></b><span class="note">${round1(logged28 / 4)} h/week average</span></div>
    <div class="kpi"><span class="lab">Current streak</span><b>${streak}<span class="unit"> d</span></b><span class="note">Consecutive days with study logged</span></div>
    <div class="kpi"><span class="lab">Total this semester</span><b>${Math.round(model.totals.loggedHours)}<span class="unit"> h</span></b><span class="note">Across every course</span></div>
  </div>

  <div class="module">
    <header><h2>Study rhythm</h2><span class="sub">Last ${histogram.length} days</span></header>
    <div class="body">
      ${streakStrip(histogram)}
      <div class="legend" style="padding:12px 0 0">
        <span><i style="background:var(--surface-3)"></i>Nothing</span>
        <span><i style="background:color-mix(in srgb,var(--accent) 28%,var(--surface-3))"></i>Under 45 min</span>
        <span><i style="background:color-mix(in srgb,var(--accent) 52%,var(--surface-3))"></i>Under 1½ h</span>
        <span><i style="background:color-mix(in srgb,var(--accent) 76%,var(--surface-3))"></i>Under 3 h</span>
        <span><i style="background:var(--accent)"></i>3 h or more</span>
      </div>
    </div>
  </div>

  <div class="module">
    <header><h2>Study ledger</h2>
      <div class="acts"><button class="btn pri sm" type="button" data-act="log-dialog">Log study time</button></div></header>
    <div class="body flush">
      ${sessions.length ? `<div class="tblwrap"><table>
        <thead><tr><th>Date</th><th>Course</th><th>Against</th><th class="n r">Time</th><th>Note</th><th></th></tr></thead>
        <tbody>${sessions.map(s => `<tr>
          <td class="n">${fmtShort(s.date)}</td>
          <td>${esc(s.courseName)}</td>
          <td class="mono" style="font-size:11.5px;color:var(--ink-3)">${s.deliverableTitle ? esc(s.deliverableTitle) : 'exam preparation'}</td>
          <td class="n r">${round1(s.minutes / 60)} h</td>
          <td style="color:var(--ink-2)">${esc(s.note || '')}</td>
          <td class="r"><button class="btn ghost xs" type="button" data-act="del-session" data-id="${attr(s.id)}" aria-label="Delete this session">✕</button></td>
        </tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">Nothing logged yet. Use the timer on the dashboard, or log time by hand.</div>`}
    </div>
  </div>

  <div class="module">
    <header><h2>Recent activity</h2><span class="sub">Most changes can be undone</span></header>
    <div class="body flush"><div class="feed">
      ${(extra?.activity ?? []).map(a => `<div class="act">
        <span class="when">${new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span class="what">${esc(a.summary)}</span>
        <span>${a.undoable ? `<button class="btn xs" type="button" data-act="undo" data-id="${a.id}">Undo</button>` : ''}</span>
      </div>`).join('') || `<div class="empty">Nothing yet.</div>`}
    </div></div>
  </div>`;
}

/* ==========================================================================
   Settings
   ========================================================================== */
function settings(model) {
  const s = model.settings;
  return `
  <div class="module">
    <header><h2>Study capacity</h2><span class="sub">${model.totals.weeklyCapacity} h per week</span></header>
    <div class="body" style="display:flex;flex-direction:column;gap:14px">
      <p class="hint">Hours of <em>exam preparation and coursework</em> available on each weekday — not lecture time. Every countdown, risk score and shortfall on the deck is measured against these numbers.</p>
      <div class="caps">${WEEKDAYS.map((d, i) => `<label class="cap"><span>${d}</span>
        <input type="number" min="0" max="16" step="0.5" value="${model.capacity[i]}" data-cap="${i}" id="cap-${i}"></label>`).join('')}</div>
      <div class="btnrow"><button class="btn pri sm" type="button" data-act="save-capacity">Save capacity</button>
        <span class="hint">Changes are applied to the whole plan.</span></div>
    </div>
  </div>

  <div class="module">
    <header><h2>Day overrides</h2>
      <div class="acts"><button class="btn sm" type="button" data-act="override">+ Add override</button></div></header>
    <div class="body" style="display:flex;flex-direction:column;gap:12px">
      <p class="hint">A holiday, a trip, a crunch weekend. An override replaces the weekly pattern for that one day — set it to 0 to block the day out entirely.</p>
      ${model.overrides.length ? `<div class="ovlist">${model.overrides.map(o => `<div class="ov">
        <span class="d">${fmtLong(o.date)}</span>
        <span class="mono">${o.hours} h</span>
        <span style="color:var(--ink-2);overflow:hidden;text-overflow:ellipsis">${esc(o.reason || '')}</span>
        <button class="btn ghost xs" type="button" data-act="del-override" data-date="${o.date}" aria-label="Remove override">✕</button>
      </div>`).join('')}</div>` : `<div class="empty">No overrides — every day follows the weekly pattern.</div>`}
    </div>
  </div>

  <div class="module">
    <header><h2>Planner rules</h2></header>
    <div class="body grid2">
      <div class="field"><label for="set-reserve">Reserved for later work (%)</label>
        <input id="set-reserve" type="number" min="0" max="60" step="5" value="${Math.round(s.reserveShare * 100)}" data-setting="reserveShare" data-scale="0.01">
        <span class="hint">Share of each day the nearest deadline may not take while other work is open.</span></div>
      <div class="field"><label for="set-window">Exam chain window (days)</label>
        <input id="set-window" type="number" min="2" max="45" value="${s.clusterWindow}" data-setting="clusterWindow">
        <span class="hint">Exams closer than this chain into one exam period.</span></div>
      <div class="field"><label for="set-min">Exams before “high density”</label>
        <input id="set-min" type="number" min="2" max="8" value="${s.clusterMin}" data-setting="clusterMin">
        <span class="hint">A chain this long raises the density alert.</span></div>
      <div class="field"><label for="set-tight">Tight-turnaround gap (days)</label>
        <input id="set-tight" type="number" min="0" max="7" value="${s.tightGap}" data-setting="tightGap">
        <span class="hint">Days between two exams that counts as a clash.</span></div>
      <div class="field"><label for="set-rem">Exam reminders (days before)</label>
        <input id="set-rem" type="text" value="${attr(s.examReminders.join(', '))}" data-setting="examReminders" data-list="1">
        <span class="hint">Created only for confirmed dates.</span></div>
      <div class="field"><label for="set-wrem">Hand-in reminders (days before)</label>
        <input id="set-wrem" type="text" value="${attr(s.workReminders.join(', '))}" data-setting="workReminders" data-list="1"></div>
      <div class="field"><label for="set-sem">Semester label</label>
        <input id="set-sem" type="text" value="${attr(s.semester)}" data-setting="semester" data-text="1"></div>
    </div>
    <div class="body" style="padding-top:0"><button class="btn pri sm" type="button" data-act="save-settings">Save rules</button></div>
  </div>

  <div class="module">
    <header><h2>Calendar feed</h2></header>
    <div class="body" style="display:flex;flex-direction:column;gap:12px">
      <p class="hint">Subscribe from Google Calendar, Outlook or Apple Calendar and the semester follows you around. Confirmed exams carry alarms at ${s.examReminders.join(', ')} days; expected dates publish as tentative with no alarms; a TBD with no expected date publishes nothing at all.</p>
      <div class="btnrow">
        <a class="btn" href="/calendar.ics" download="semester.ics">Download .ics</a>
        <button class="btn" type="button" data-act="subscribe">Copy feed URL</button>
      </div>
    </div>
  </div>`;
}

/* ========================================================================== */
export const VIEWS = {
  dash: { label: 'Dashboard', icon: 'dash', render: dashboard, tally: () => '' },
  courses: { label: 'Courses', icon: 'courses', render: courses, tally: m => m.totals.courses },
  calendar: { label: 'Calendar', icon: 'calendar', render: calendar, tally: m => m.upcomingExams.length },
  planner: { label: 'Study plan', icon: 'planner', render: planner, tally: m => `${Math.round(m.totals.remainingHours)}h` },
  areas: { label: 'Subject areas', icon: 'areas', render: areas, tally: m => m.areas.length },
  log: { label: 'Study log', icon: 'log', render: studyLog, tally: m => `${Math.round(m.totals.loggedHours)}h`, needsSessions: true },
  settings: { label: 'Settings', icon: 'settings', render: settings, tally: () => '' }
};

export function mountView(name, model) {
  if (name === 'dash') bindWeeklyChart('wkchart', model.weeks.slice(0, 14), model.plan.items);
}
