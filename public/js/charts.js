/** Charts. One scale per drawing, theme tokens for every colour, hover on everything. */

import { esc, fmtShort, hrs, parseDate, dayDiff, isoDate, addDays, MONTHS, round1 } from './ui.js';

/* ==========================================================================
   Weekly workload — assigned study hours against available capacity
   ========================================================================== */
export function weeklyChart(weeks, { id = 'wkchart' } = {}) {
  if (!weeks.length) return `<div class="empty">Nothing scheduled yet — no course has both a date and outstanding hours.</div>`;

  const W = Math.max(560, weeks.length * 62), H = 214;
  const PL = 40, PR = 14, PT = 20, PB = 48;
  const iw = W - PL - PR, ih = H - PT - PB;
  const maxV = Math.max(...weeks.map(w => Math.max(w.capacity, w.assigned)), 1);
  const bw = iw / weeks.length;
  const y = v => PT + ih - (v / maxV) * ih;
  const ticks = [0, Math.round(maxV / 2), Math.ceil(maxV)].filter((v, i, a) => a.indexOf(v) === i);

  const bars = weeks.map((w, i) => {
    const x = PL + i * bw + bw * 0.16;
    const bWidth = bw * 0.68;
    const capH = Math.max(0, ih - (y(w.capacity) - PT));
    const useH = Math.max(0, ih - (y(w.assigned) - PT));
    const hasExam = w.events.some(e => e.type === 'exam' || e.type === 'expected');
    return `<g data-week="${i}">
      <rect x="${x}" y="${y(w.capacity)}" width="${bWidth}" height="${capH}" rx="3" fill="var(--surface-3)" stroke="var(--line-2)" stroke-width="1"/>
      <rect x="${x}" y="${y(w.assigned)}" width="${bWidth}" height="${useH}" rx="3" fill="var(--accent)"/>
      ${hasExam ? `<rect x="${x}" y="${PT - 11}" width="${bWidth}" height="4" rx="2" fill="var(--crit)"/>` : ''}
      <rect x="${PL + i * bw}" y="${PT - 14}" width="${bw}" height="${ih + 14}" fill="transparent"/>
    </g>`;
  }).join('');

  const labels = weeks.map((w, i) => {
    const cx = PL + i * bw + bw / 2;
    const d = parseDate(w.start);
    const exam = w.events.find(e => e.type === 'exam' || e.type === 'expected');
    return `<text x="${cx}" y="${H - PB + 18}" text-anchor="middle" font-size="10" font-family="var(--mono)" fill="var(--muted-ink)">${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}</text>
      ${exam ? `<text x="${cx}" y="${H - PB + 32}" text-anchor="middle" font-size="9.5" font-family="var(--mono)" fill="var(--crit-ink)">${esc(exam.title.split(' ')[0])}</text>` : ''}`;
  }).join('');

  return `<div class="chartwrap" id="${id}">
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
         aria-label="Study hours assigned per week against available capacity" style="max-width:100%;display:block">
      ${ticks.map(t => `<line x1="${PL}" x2="${W - PR}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/>
        <text x="${PL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="10" font-family="var(--mono)" fill="var(--muted-ink)">${t}</text>`).join('')}
      <line x1="${PL}" x2="${W - PR}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)" stroke-width="1"/>
      <text x="${PL - 8}" y="${PT - 6}" text-anchor="end" font-size="9" font-family="var(--mono)" fill="var(--muted-ink)">h</text>
      ${bars}
      ${labels}
    </svg>
    <div class="chart-tip" id="${id}-tip" hidden></div>
  </div>`;
}

export function bindWeeklyChart(containerId, weeks, planItems) {
  const wrap = document.getElementById(containerId);
  const tip = document.getElementById(`${containerId}-tip`);
  if (!wrap || !tip) return;
  const byKey = Object.fromEntries(planItems.map(i => [i.key, i]));

  const move = e => {
    const g = e.target.closest('g[data-week]');
    if (!g) { tip.hidden = true; return; }
    const w = weeks[+g.dataset.week];
    if (!w) { tip.hidden = true; return; }
    const rows = Object.entries(w.parts).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => `<span class="tr"><span>${esc((byKey[k]?.courseName || '').slice(0, 22))}</span><span>${hrs(v)}</span></span>`).join('');
    const exams = w.events.filter(e => e.type !== 'deadline')
      .map(e => `<span class="tr" style="color:var(--crit-ink)"><span>${esc(e.title.slice(0, 22))}</span><span>${e.type === 'expected' ? 'est.' : 'exam'}</span></span>`).join('');
    const due = w.events.filter(e => e.type === 'deadline')
      .map(e => `<span class="tr" style="color:var(--warn-ink)"><span>${esc(e.title.split(' — ')[0].slice(0, 22))}</span><span>due</span></span>`).join('');

    tip.innerHTML = `<b>Week of ${fmtShort(w.start)}</b>
      <span class="tr"><span>Assigned</span><span>${hrs(w.assigned)}</span></span>
      <span class="tr"><span>Capacity</span><span>${hrs(w.capacity)}</span></span>
      ${rows ? `<span class="rule"></span>${rows}` : ''}
      ${exams || due ? `<span class="rule"></span>${exams}${due}` : ''}`;
    tip.hidden = false;
    const r = wrap.getBoundingClientRect();
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(4, Math.min(r.width - tw - 4, e.clientX - r.left + 14))}px`;
    tip.style.top = `${Math.max(4, e.clientY - r.top - 8)}px`;
  };

  wrap.addEventListener('mousemove', move);
  wrap.addEventListener('mouseleave', () => { tip.hidden = true; });
}

/* ==========================================================================
   Exam density — a timeline with the chains shaded
   ========================================================================== */
export function densityStrip(model) {
  const T = parseDate(model.today);
  const pins = model.courses
    .filter(c => c.schedule.date)
    .map(c => ({ ...c, d: parseDate(c.schedule.date) }))
    .sort((a, b) => a.d - b.d);

  if (!pins.length) {
    return `<div class="empty">No exam dates yet — the density view fills in as you confirm them.</div>`;
  }

  const start = new Date(Math.min(T.getTime(), pins[0].d.getTime()));
  const end = addDays(pins.at(-1).d, 10);
  const span = Math.max(1, dayDiff(start, end));
  const x = d => (dayDiff(start, d) / span) * 100;

  const months = [];
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur <= end) {
    if (cur >= start) months.push(new Date(cur));
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }

  return `<div class="strip">
    ${months.map(m => `<span class="mtick" style="left:${x(m)}%"></span>
      <span class="mth" style="left:calc(${x(m)}% + 5px)">${MONTHS[m.getUTCMonth()].slice(0, 3)}</span>`).join('')}
    <span class="axis"></span>
    ${model.clusters.map(cl => {
      const a = x(parseDate(cl.from)), b = x(parseDate(cl.to));
      return `<span class="band ${cl.pressure > 1 ? 'crit' : ''}" style="left:${a}%;width:${Math.max(1.5, b - a)}%"
        title="${cl.exams.length} exams in ${cl.span} days — ${cl.load} h of preparation against ${cl.capacity} h of capacity"></span>`;
    }).join('')}
    <span class="now" style="left:${x(T)}%" title="Today"></span>
    ${pins.map((p, i) => `<span class="pin ${p.schedule.firm ? '' : 'prov'}" style="left:${x(p.d)}%"></span>
      <span class="lbl" style="left:${x(p.d)}%;top:${58 + (i % 2) * 15}px">${fmtShort(p.schedule.date)} · ${esc(p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name)}</span>`).join('')}
  </div>
  <div class="legend" style="padding:4px 0 0">
    <span><i style="background:var(--ink)"></i>Confirmed exam</span>
    <span><i style="background:repeating-linear-gradient(90deg,var(--ink-3) 0 2px,transparent 2px 4px)"></i>Expected date</span>
    <span><i style="background:color-mix(in srgb,var(--serious) 30%,transparent);border:1px solid var(--serious)"></i>Exam chain</span>
    <span><i style="background:var(--accent)"></i>Today</span>
  </div>`;
}

/* ==========================================================================
   Study streak — hours logged per day
   ========================================================================== */
export function streakStrip(histogram) {
  if (!histogram?.length) return '';
  const level = mins => mins === 0 ? 0 : mins < 45 ? 1 : mins < 90 ? 2 : mins < 180 ? 3 : 4;
  return `<div class="streak" role="img" aria-label="Hours studied per day over the last ${histogram.length} days">
    ${histogram.map(d => `<i data-l="${level(d.minutes)}" title="${fmtShort(d.date)} — ${round1(d.minutes / 60)} h"></i>`).join('')}
  </div>`;
}
