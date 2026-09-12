/**
 * The planning engine.
 *
 * Pure functions over a plain snapshot of the database — no I/O, no dates
 * read from the clock — so the same code answers `/api/state`, the what-if
 * endpoint, and the test suite.
 *
 * The three date states are load-bearing throughout:
 *   confirmed — a real date: countdown, reminders, milestones, risk, plan
 *   tbd       — no date: never counted down, never reminded on; an optional
 *               expected date is planned against provisionally and labelled
 *   none      — no exam at all: managed purely through its deliverables
 */

export const DAY = 86400000;
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/* ---------- dates: UTC throughout so day arithmetic is exact ---------- */
export const parseDate = s => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (Number.isNaN(d.getTime())) return null;
  // Date.UTC rolls 30 February forward into March — reject rather than accept
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return d;
};
export const isoDate = d => d ? d.toISOString().slice(0, 10) : null;
export const addDays = (d, n) => new Date(d.getTime() + n * DAY);
export const dayDiff = (a, b) => Math.round((b - a) / DAY);
export const weekdayMon = d => (d.getUTCDay() + 6) % 7;          // Monday = 0
export const weekStart = d => addDays(d, -weekdayMon(d));
export const todayIso = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};
export const fmtLong = s => {
  const d = parseDate(s);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '—';
};
export const fmtShort = s => {
  const d = parseDate(s);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}` : '—';
};

const round1 = n => Math.round(n * 10) / 10;
const hoursLabel = n => `${round1(n)} h`;

/* ---------- risk bands ---------- */
export const BANDS = [
  { key: 'low', label: 'On track', max: 20 },
  { key: 'mod', label: 'Moderate', max: 40 },
  { key: 'high', label: 'High risk', max: 65 },
  { key: 'crit', label: 'Critical', max: Infinity }
];
export const RANK = { low: 0, mod: 1, high: 2, crit: 3 };
const bandFor = score => BANDS.find(b => score < b.max);

/** Hours under a shortfall/coverage threshold that are treated as rounding noise. */
const EPS = 0.5;

/* ---------- per-course derived basics ---------- */
export function scheduleOf(course) {
  if (course.dateState === 'confirmed' && course.examDate) return { date: course.examDate, firm: true };
  if (course.dateState === 'tbd' && course.estimatedDate) return { date: course.estimatedDate, firm: false };
  return { date: null, firm: false };
}

/** Preparation actually done, from the study-session ledger. */
const prepDone = c => (c.loggedMinutes?.exam || 0) / 60;
const prepRemaining = c => Math.max(0, (c.prepEstimateHours || 0) - prepDone(c));
const workDone = (c, d) => (c.loggedMinutes?.byDeliverable?.[d.id] || 0) / 60;
const workRemaining = (c, d) => d.submitted ? 0 : Math.max(0, (d.estHours || 0) - workDone(c, d));

/** Hours available on one calendar day: an override wins over the weekly pattern. */
export function capacityOn(date, capacity, overrideMap) {
  const key = isoDate(date);
  if (overrideMap && Object.prototype.hasOwnProperty.call(overrideMap, key)) return Math.max(0, overrideMap[key]);
  return Math.max(0, capacity[weekdayMon(date)] || 0);
}

/**
 * Day-by-day allocation of study capacity.
 *
 * Each day's hours are split by required rate — hours still needed divided by
 * days still available — so whatever is most behind gets the most. On top of
 * that sits the reserve rule: while anything else is still open, the nearest
 * deadline may not take more than (1 - reserveShare) of a day. That is what
 * keeps a later exam accruing hours while an earlier one is bearing down.
 */
export function buildPlan(snapshot) {
  const { courses, settings, capacity, overrideMap, today } = snapshot;
  const T = parseDate(today);
  const items = [];

  for (const c of courses) {
    const sch = scheduleOf(c);
    if (sch.date) {
      const need = prepRemaining(c);
      const due = parseDate(sch.date);
      if (need > 0 && due && dayDiff(T, due) >= 0) {
        items.push({
          key: `e:${c.id}`, kind: 'exam', courseId: c.id, courseName: c.name,
          label: c.name, need, due, last: addDays(due, -1), firm: sch.firm
        });
      }
    }
    for (const d of c.deliverables || []) {
      const due = parseDate(d.dueDate);
      const need = workRemaining(c, d);
      if (due && !d.submitted && need > 0 && dayDiff(T, due) >= 0) {
        items.push({
          key: `w:${c.id}:${d.id}`, kind: 'work', courseId: c.id, courseName: c.name,
          deliverableId: d.id, label: `${c.name} · ${d.title}`, title: d.title,
          need, due, last: due, firm: true
        });
      }
    }
  }

  const alloc = Object.fromEntries(items.map(i => [i.key, 0]));
  const open = items.map(i => ({ ...i, left: i.need }));
  const horizon = items.reduce((m, i) => Math.max(m, dayDiff(T, i.last)), 0);
  const days = [];
  const reserve = Math.max(0, Math.min(0.6, settings.reserveShare ?? 0.25));

  for (let n = 0; n <= horizon; n++) {
    const date = addDays(T, n);
    const cap = capacityOn(date, capacity, overrideMap);
    const parts = {};
    const active = open.filter(i => i.left > 1e-6 && dayDiff(date, i.last) >= 0);

    if (cap > 0 && active.length) {
      for (const i of active) i.rate = i.left / Math.max(1, dayDiff(date, i.last) + 1);
      active.sort((a, b) => a.last - b.last || b.rate - a.rate);

      const totalRate = active.reduce((s, i) => s + i.rate, 0);
      const share = {};
      for (const i of active) share[i.key] = totalRate > 0 ? cap * (i.rate / totalRate) : cap / active.length;

      if (active.length > 1 && reserve > 0) {
        const first = active[0];
        const ceiling = cap * (1 - reserve);
        if (share[first.key] > ceiling) {
          const spill = share[first.key] - ceiling;
          share[first.key] = ceiling;
          const rest = active.slice(1);
          const restRate = rest.reduce((s, i) => s + i.rate, 0);
          for (const i of rest) share[i.key] += restRate > 0 ? spill * (i.rate / restRate) : spill / rest.length;
        }
      }

      // nobody may be given more than they still need; hand the remainder on
      let spare = 0;
      for (const i of active) {
        const give = Math.min(share[i.key], i.left);
        spare += share[i.key] - give;
        share[i.key] = give;
      }
      for (const i of active) {
        if (spare <= 1e-6) break;
        const room = i.left - share[i.key];
        const give = Math.min(room, spare);
        share[i.key] += give;
        spare -= give;
      }

      for (const i of active) {
        const g = share[i.key];
        if (g > 1e-6) { i.left -= g; alloc[i.key] += g; parts[i.key] = g; }
      }
    }

    days.push({ date, iso: isoDate(date), capacity: cap, parts, total: Object.values(parts).reduce((a, b) => a + b, 0) });
  }

  return { items, alloc, days, horizon };
}

/** Chains of exams close enough together to compete for the same weeks. */
export function findClusters(exams, settings, capacity, overrideMap, today) {
  const T = parseDate(today);
  const window = settings.clusterWindow ?? 14;
  const dated = exams.filter(e => e.schedule.date)
    .sort((a, b) => parseDate(a.schedule.date) - parseDate(b.schedule.date));

  const chains = [];
  let current = [];
  for (const e of dated) {
    if (!current.length) { current = [e]; continue; }
    const gap = dayDiff(parseDate(current.at(-1).schedule.date), parseDate(e.schedule.date));
    if (gap <= window) current.push(e); else { chains.push(current); current = [e]; }
  }
  if (current.length) chains.push(current);

  return chains.filter(ch => ch.length >= 2).map(ch => {
    const from = parseDate(ch[0].schedule.date);
    const to = parseDate(ch.at(-1).schedule.date);
    const span = dayDiff(from, to) + 1;
    const load = ch.reduce((s, e) => s + e.prepRemaining, 0);
    let cap = 0;
    for (let d = new Date(Math.max(T, from.getTime() - 60 * DAY)); d <= to; d = addDays(d, 1)) {
      if (d >= T) cap += capacityOn(d, capacity, overrideMap);
    }
    return {
      exams: ch.map(e => ({ id: e.id, name: e.name, date: e.schedule.date, firm: e.schedule.firm })),
      examIds: ch.map(e => e.id),
      from: isoDate(from), to: isoDate(to), span,
      load: round1(load), capacity: round1(cap),
      dense: ch.length >= (settings.clusterMin ?? 3) || (span <= 4 && ch.length >= 2),
      provisional: ch.some(e => !e.schedule.firm),
      pressure: cap > 0 ? round1(load / cap) : 2
    };
  });
}

/** Preparation milestones, walked back from the exam date. */
export function milestonesFor(course, schedule, settings, capacity, today) {
  if (!schedule.date) return [];
  const exam = parseDate(schedule.date);
  const T = parseDate(today);
  const est = course.prepEstimateHours || 0;
  const avgDaily = capacity.reduce((a, b) => a + b, 0) / 7;
  const lead = Math.min(70, Math.max(14, Math.ceil((est / Math.max(0.4, avgDaily)) * 1.7)));
  const start = addDays(exam, -lead);
  const at = f => addDays(start, Math.round(lead * f));

  const phases = [
    [0.00, 'Start preparation'],
    [0.35, 'First pass through every topic'],
    [0.60, 'Past papers & problem sets'],
    [0.80, 'Close gaps on weakest topics'],
    [0.92, 'Full mock exam, timed']
  ].map(([f, title]) => ({ kind: 'phase', title, date: at(f) }));
  phases.push({ kind: 'phase', title: 'Final review — formulas & summaries', date: addDays(exam, -1) });

  const topics = course.topics || [];
  topics.forEach((t, i) => {
    const f = topics.length === 1 ? 0.3 : 0.08 + (0.5 * i) / Math.max(1, topics.length - 1);
    phases.push({ kind: 'topic', title: `Cover: ${t.name}`, date: at(f), done: !!t.done, topicId: t.id });
  });

  return phases
    .sort((a, b) => a.date - b.date)
    .map(m => ({ ...m, date: isoDate(m.date), past: m.date < T, leadDays: lead }));
}

/* ==========================================================================
   The whole picture
   ========================================================================== */
export function computeAll(snapshot) {
  const settings = snapshot.settings;
  const capacity = snapshot.capacity;
  const today = snapshot.today || todayIso();
  const overrideMap = Object.fromEntries((snapshot.overrides || []).map(o => [o.date, o.hours]));
  const T = parseDate(today);
  const avgDaily = capacity.reduce((a, b) => a + b, 0) / 7;

  const plan = buildPlan({ ...snapshot, today, overrideMap });
  const got = key => plan.alloc[key] || 0;

  /* ---- per course ---- */
  const courses = snapshot.courses.map(c => {
    const schedule = scheduleOf(c);
    const isExam = c.dateState !== 'none';
    const done = prepDone(c);
    const remaining = prepRemaining(c);
    const available = got(`e:${c.id}`);
    const deficit = schedule.date ? Math.max(0, remaining - available) : 0;
    const daysUntil = schedule.date ? dayDiff(T, parseDate(schedule.date)) : null;

    const topics = (c.topics || []).map(t => ({ ...t, done: !!t.done }));
    const topicsDone = topics.filter(t => t.done).length;
    const prepFraction = c.prepEstimateHours > 0
      ? Math.min(1, done / c.prepEstimateHours)
      : (topics.length ? topicsDone / topics.length : 0);

    let leadDays = null, pace = 0;
    if (schedule.date) {
      leadDays = Math.min(70, Math.max(14, Math.ceil(((c.prepEstimateHours || 0) / Math.max(0.4, avgDaily)) * 1.7)));
      const start = addDays(parseDate(schedule.date), -leadDays);
      const elapsed = Math.max(0, Math.min(1, dayDiff(start, T) / leadDays));
      pace = Math.max(0, elapsed - prepFraction);
    }

    const deliverables = (c.deliverables || []).map(d => {
      const logged = workDone(c, d);
      const left = workRemaining(c, d);
      const avail = got(`w:${c.id}:${d.id}`);
      const days = d.dueDate ? dayDiff(T, parseDate(d.dueDate)) : null;
      return {
        ...d,
        submitted: !!d.submitted,
        loggedHours: round1(logged),
        remainingHours: round1(left),
        availableHours: round1(avail),
        deficitHours: d.dueDate && !d.submitted ? round1(Math.max(0, left - avail)) : 0,
        daysUntil: days,
        overdue: !!(d.dueDate && !d.submitted && days < 0),
        dateState: d.dueDate ? 'confirmed' : 'tbd'
      };
    });

    const workRemainingTotal = deliverables.reduce((s, d) => s + d.remainingHours, 0);
    const workDeficit = deliverables.reduce((s, d) => s + d.deficitHours, 0);
    const workEstTotal = deliverables.reduce((s, d) => s + (d.estHours || 0), 0);
    const workLoggedTotal = deliverables.reduce((s, d) => s + d.loggedHours, 0);

    return {
      id: c.id, name: c.name, credits: c.credits, assessment: c.assessment,
      dateState: c.dateState, examDate: c.examDate, estimatedDate: c.estimatedDate,
      subjectArea: c.subjectArea, position: c.position,
      prepEstimateHours: c.prepEstimateHours,
      schedule, isExam, daysUntil, leadDays,
      prepDoneHours: round1(done),
      prepRemainingHours: round1(remaining),
      availableHours: round1(available),
      deficitHours: round1(deficit),
      coverage: remaining > 0 ? available / remaining : 1,
      prepFraction, pace, topics, topicsDone, topicCount: topics.length,
      deliverables,
      workRemainingTotal: round1(workRemainingTotal),
      workDeficit: round1(workDeficit),
      workEstTotal: round1(workEstTotal),
      workLoggedTotal: round1(workLoggedTotal),
      loggedMinutes: c.loggedMinutes?.total || 0
    };
  });

  const exams = courses.filter(c => c.isExam);
  const clusters = findClusters(
    exams.map(e => ({ ...e, prepRemaining: e.prepRemainingHours })),
    settings, capacity, overrideMap, today
  );

  /* ---- conflicts ---- */
  const conflicts = [];
  const dated = exams.filter(e => e.schedule.date)
    .sort((a, b) => parseDate(a.schedule.date) - parseDate(b.schedule.date));

  for (let i = 0; i < dated.length - 1; i++) {
    const a = dated[i], b = dated[i + 1];
    const gap = dayDiff(parseDate(a.schedule.date), parseDate(b.schedule.date));
    if (gap === 0) {
      conflicts.push({
        level: 'crit', kind: 'same-day', title: 'Two exams on the same day',
        detail: `${a.name} and ${b.name} both fall on ${fmtLong(a.schedule.date)}.`,
        courseIds: [a.id, b.id]
      });
    } else if (gap <= (settings.tightGap ?? 2)) {
      conflicts.push({
        level: 'high', kind: 'tight', title: 'Tight turnaround',
        detail: `${gap} day${gap === 1 ? '' : 's'} between ${a.name} (${fmtShort(a.schedule.date)}) and ${b.name} (${fmtShort(b.schedule.date)}) — the second exam gets almost no dedicated run-up.`,
        courseIds: [a.id, b.id]
      });
    }
  }
  const seen = new Set();
  for (const c of courses) {
    for (const d of c.deliverables) {
      if (d.submitted || !d.dueDate) continue;
      for (const e of dated) {
        if (e.id === c.id) continue;
        const gap = Math.abs(dayDiff(parseDate(d.dueDate), parseDate(e.schedule.date)));
        if (gap > 3) continue;
        const k = `${d.id}:${e.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        conflicts.push({
          level: 'mod', kind: 'deadline-clash', title: 'Deadline lands on an exam run-up',
          detail: `“${d.title}” (${c.name}) is due ${fmtShort(d.dueDate)}, ${gap === 0 ? 'the same day as' : `${gap} day${gap === 1 ? '' : 's'} from`} ${e.name}.`,
          courseIds: [c.id, e.id]
        });
      }
    }
  }

  /* ---- risk ---- */
  for (const c of courses) {
    if (!c.isExam) {
      let score = 0;
      const reasons = [];
      for (const d of c.deliverables) {
        if (d.overdue) { score += 45; reasons.push(`“${d.title}” is overdue`); }
        else if (d.deficitHours > EPS) {
          score += 20 + Math.min(35, d.deficitHours * 3);
          reasons.push(`“${d.title}” short by ${hoursLabel(d.deficitHours)}`);
        }
      }
      c.risk = { score: Math.round(score), ...bandFor(score), reasons };
      continue;
    }
    if (!c.schedule.date) {
      c.risk = { score: null, key: 'tbd', label: 'Unscheduled', reasons: [], unscheduled: true };
      continue;
    }
    let score = 0;
    const reasons = [];
    if (c.deficitHours > EPS) {
      score += (1 - c.coverage) * 120;
      reasons.push(`Study plan is ${hoursLabel(c.deficitHours)} short of the ${hoursLabel(c.prepRemainingHours)} still needed`);
    }
    if (c.pace > 0.02) {
      score += c.pace * 55;
      reasons.push(`${Math.round(c.pace * 100)}% behind the recommended pace for this exam window`);
    }
    const cluster = clusters.find(x => x.examIds.includes(c.id));
    if (cluster?.dense) {
      score += Math.min(22, 8 * (cluster.exams.length - 1));
      reasons.push(`Sits inside a ${cluster.exams.length}-exam period (${fmtShort(cluster.from)} – ${fmtShort(cluster.to)})`);
    }
    if (conflicts.some(k => k.courseIds.includes(c.id) && k.level !== 'mod')) {
      score += 13;
      reasons.push('Clashes with a neighbouring exam');
    }
    if (c.daysUntil !== null && c.daysUntil <= 7 && c.coverage < 1) score += 10;
    if (!c.schedule.firm) reasons.push('Based on your expected date — not yet confirmed');
    c.risk = { score: Math.round(score), ...bandFor(score), reasons, provisional: !c.schedule.firm };
  }

  /* ---- subject areas ---- */
  const areaMap = new Map();
  for (const c of courses) {
    const key = c.subjectArea || 'Ungrouped';
    if (!areaMap.has(key)) areaMap.set(key, []);
    areaMap.get(key).push(c);
  }
  const areas = [...areaMap.entries()].map(([name, list]) => {
    const credits = list.reduce((s, c) => s + c.credits, 0);
    const upcoming = list.filter(c => c.isExam && c.schedule.firm && c.daysUntil >= 0).length;
    const unscheduled = list.filter(c => c.isExam && !c.schedule.date).length;
    const remainingHours = list.reduce((s, c) => s + c.prepRemainingHours + c.workRemainingTotal, 0);
    const estHours = list.reduce((s, c) => s + (c.prepEstimateHours || 0) + c.workEstTotal, 0);
    const doneHours = list.reduce((s, c) => s + c.prepDoneHours + c.workLoggedTotal, 0);
    const worst = list.reduce((m, c) => (c.risk.score !== null && RANK[c.risk.key] > RANK[m]) ? c.risk.key : m, 'low');
    const next = list.filter(c => c.schedule.date && c.daysUntil >= 0).sort((a, b) => a.daysUntil - b.daysUntil)[0] || null;
    return {
      name, credits, upcoming, unscheduled,
      remainingHours: round1(remainingHours), estHours: round1(estHours), doneHours: round1(doneHours),
      prepFraction: estHours > 0 ? doneHours / estHours : 0,
      risk: worst, riskLabel: BANDS.find(b => b.key === worst).label,
      courseIds: list.map(c => c.id),
      next: next ? { id: next.id, name: next.name, date: next.schedule.date, daysUntil: next.daysUntil } : null
    };
  }).sort((a, b) => b.credits - a.credits);

  /* ---- events: exams, expected exams, deadlines, milestones, reminders ---- */
  const events = [];
  for (const c of courses) {
    if (c.schedule.date) {
      events.push({
        date: c.schedule.date, type: c.schedule.firm ? 'exam' : 'expected',
        title: c.name, courseId: c.id,
        note: c.schedule.firm ? 'Exam' : 'Expected exam — not confirmed, no reminders'
      });
      // reminders and milestones exist ONLY for confirmed dates
      if (c.schedule.firm) {
        for (const off of settings.examReminders || []) {
          const d = addDays(parseDate(c.schedule.date), -off);
          if (dayDiff(T, d) >= 0) {
            events.push({ date: isoDate(d), type: 'reminder', title: `${c.name} — T‑minus ${off}d`, courseId: c.id, note: `${off} days to ${c.name}`, offset: off });
          }
        }
        for (const m of milestonesFor(c, c.schedule, settings, capacity, today)) {
          if (dayDiff(T, parseDate(m.date)) >= -30) {
            events.push({ date: m.date, type: 'milestone', title: `${c.name}: ${m.title}`, courseId: c.id, note: m.title, milestoneKind: m.kind, done: m.done });
          }
        }
      }
    }
    for (const d of c.deliverables) {
      if (!d.dueDate) continue;
      events.push({ date: d.dueDate, type: 'deadline', title: `${d.title} — ${c.name}`, courseId: c.id, deliverableId: d.id, note: d.submitted ? 'Submitted' : 'Due', done: d.submitted });
      if (d.submitted) continue;
      for (const off of settings.workReminders || []) {
        const dd = addDays(parseDate(d.dueDate), -off);
        if (dayDiff(T, dd) >= 0) {
          events.push({ date: isoDate(dd), type: 'reminder', title: `${d.title} — ${off}d left`, courseId: c.id, deliverableId: d.id, note: `${off} days to hand-in`, offset: off });
        }
      }
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  /* ---- weekly workload ---- */
  const weeks = [];
  const lastDay = plan.days.length ? plan.days.at(-1).date : T;
  let cursor = weekStart(T);
  for (let w = 0; w < 30 && cursor <= lastDay; w++) {
    const end = addDays(cursor, 6);
    const rows = plan.days.filter(d => d.date >= cursor && d.date <= end);
    const parts = {};
    let total = 0, cap = 0;
    for (const d of rows) {
      cap += d.capacity;
      for (const [k, v] of Object.entries(d.parts)) { parts[k] = (parts[k] || 0) + v; total += v; }
    }
    const weekEvents = events.filter(e => e.date >= isoDate(cursor) && e.date <= isoDate(end)
      && ['exam', 'expected', 'deadline'].includes(e.type));
    weeks.push({
      start: isoDate(cursor), end: isoDate(end),
      assigned: round1(total), capacity: round1(cap),
      parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round1(v)])),
      events: weekEvents
    });
    cursor = addDays(cursor, 7);
  }

  /* ---- today's marching orders ---- */
  const todayRow = plan.days[0];
  const itemByKey = Object.fromEntries(plan.items.map(i => [i.key, i]));
  const todayPlan = todayRow ? Object.entries(todayRow.parts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, hours]) => {
      const it = itemByKey[key];
      return {
        key, hours: round1(hours), courseId: it.courseId, courseName: it.courseName,
        deliverableId: it.deliverableId || null,
        label: it.kind === 'exam' ? `${it.courseName} — exam prep` : `${it.courseName} — ${it.title}`,
        dueDate: isoDate(it.due), firm: it.firm
      };
    }) : [];

  /* ---- totals ---- */
  const totals = {
    credits: round1(courses.reduce((s, c) => s + c.credits, 0)),
    courses: courses.length,
    examCount: exams.length,
    confirmed: exams.filter(e => e.dateState === 'confirmed').length,
    unscheduled: exams.filter(e => e.dateState === 'tbd').length,
    noExam: courses.filter(c => !c.isExam).length,
    remainingHours: round1(courses.reduce((s, c) => s + c.prepRemainingHours + c.workRemainingTotal, 0)),
    deficitHours: round1(courses.reduce((s, c) => s + c.deficitHours + c.workDeficit, 0)),
    unplannedHours: round1(courses.reduce((s, c) =>
      s + (c.isExam && !c.schedule.date ? c.prepRemainingHours : 0)
        + c.deliverables.filter(d => !d.dueDate && !d.submitted).reduce((a, d) => a + d.remainingHours, 0), 0)),
    loggedHours: round1(courses.reduce((s, c) => s + c.prepDoneHours + c.workLoggedTotal, 0)),
    weeklyCapacity: round1(capacity.reduce((a, b) => a + b, 0)),
    todayCapacity: todayRow ? round1(todayRow.capacity) : 0,
    todayAssigned: todayRow ? round1(todayRow.total) : 0
  };

  const worstRisk = courses.reduce((m, c) => (c.risk.score !== null && RANK[c.risk.key] > RANK[m]) ? c.risk.key : m, 'low');

  const upcomingExams = exams.filter(e => e.schedule.date && e.daysUntil >= 0)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  const awaitingDate = courses.filter(c =>
    (c.isExam && c.dateState === 'tbd') || c.deliverables.some(d => !d.dueDate && !d.submitted));

  return {
    today, settings, capacity,
    overrides: snapshot.overrides || [],
    courses, exams, upcomingExams, awaitingDate,
    clusters, conflicts, areas, events, weeks, totals, worstRisk,
    todayPlan,
    plan: {
      horizonDays: plan.days.length,
      items: plan.items.map(i => ({
        key: i.key, kind: i.kind, courseId: i.courseId, courseName: i.courseName,
        deliverableId: i.deliverableId || null, label: i.label,
        needHours: round1(i.need), allocatedHours: round1(plan.alloc[i.key] || 0),
        dueDate: isoDate(i.due), firm: i.firm
      })),
      days: plan.days.map(d => ({
        date: d.iso, capacity: round1(d.capacity), assigned: round1(d.total),
        parts: Object.fromEntries(Object.entries(d.parts).map(([k, v]) => [k, round1(v)]))
      }))
    }
  };
}

/**
 * What a date would do, without writing it.
 * Returns the course as it would be, plus everything that changes around it.
 */
export function whatIf(snapshot, courseId, date, mode = 'confirmed') {
  const before = computeAll(snapshot);
  const patched = {
    ...snapshot,
    courses: snapshot.courses.map(c => c.id !== courseId ? c : ({
      ...c,
      dateState: mode === 'confirmed' ? 'confirmed' : 'tbd',
      examDate: mode === 'confirmed' ? date : null,
      estimatedDate: mode === 'confirmed' ? null : date
    }))
  };
  const after = computeAll(patched);
  const b = before.courses.find(c => c.id === courseId);
  const a = after.courses.find(c => c.id === courseId);
  if (!a) return null;

  const newConflicts = after.conflicts.filter(k => k.courseIds.includes(courseId));
  const cluster = after.clusters.find(c => c.examIds.includes(courseId)) || null;
  const remindersCreated = after.events.filter(e => e.type === 'reminder' && e.courseId === courseId).length;
  const milestonesCreated = after.events.filter(e => e.type === 'milestone' && e.courseId === courseId).length;

  const knockOn = after.courses
    .filter(c => c.id !== courseId && c.risk.score !== null)
    .map(c => {
      const was = before.courses.find(x => x.id === c.id);
      return {
        id: c.id, name: c.name,
        from: was?.risk.key, to: c.risk.key,
        deficitBefore: was?.deficitHours ?? 0, deficitAfter: c.deficitHours
      };
    })
    .filter(c => c.from !== c.to || Math.abs(c.deficitAfter - c.deficitBefore) > EPS);

  return {
    course: {
      id: a.id, name: a.name, date, mode,
      daysUntil: a.daysUntil,
      prepRemainingHours: a.prepRemainingHours,
      availableHours: a.availableHours,
      deficitHours: a.deficitHours,
      risk: a.risk,
      riskBefore: b?.risk ?? null
    },
    remindersCreated, milestonesCreated,
    conflicts: newConflicts,
    cluster,
    knockOn,
    totals: { before: before.totals, after: after.totals }
  };
}
