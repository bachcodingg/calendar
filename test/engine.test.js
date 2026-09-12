import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAll, whatIf, buildPlan, scheduleOf, parseDate, dayDiff } from '../server/engine.js';

const SETTINGS = {
  semester: 'Test term', reserveShare: 0.25, clusterWindow: 14, clusterMin: 3, tightGap: 2,
  examReminders: [30, 14, 7, 3, 1], workReminders: [7, 3, 1], dayStartHour: 18
};
const CAPACITY = [3, 3, 3, 3, 2, 4, 3];
const TODAY = '2026-09-12';

const course = (over = {}) => ({
  id: 'x', name: 'Course', credits: 3, assessment: 'Exam', dateState: 'tbd',
  examDate: null, estimatedDate: null, subjectArea: null, prepEstimateHours: 20,
  topics: [], deliverables: [], loggedMinutes: { exam: 0, total: 0, byDeliverable: {} }, ...over
});

const snap = (courses, extra = {}) => ({
  today: TODAY, courses, settings: SETTINGS, capacity: CAPACITY, overrides: [], ...extra
});

/* ---------------------------------------------------------------- date states */

test('a confirmed exam gets a countdown, reminders and milestones', () => {
  const m = computeAll(snap([course({ dateState: 'confirmed', examDate: '2026-10-07' })]));
  const c = m.courses[0];
  assert.equal(c.daysUntil, 25);
  assert.equal(c.schedule.firm, true);
  // 30 days out already fell on 7 September, so four of the five are still ahead
  assert.deepEqual(m.events.filter(e => e.type === 'reminder').map(e => e.offset), [14, 7, 3, 1]);
  assert.ok(m.events.some(e => e.type === 'milestone'));
  assert.ok(m.events.some(e => e.type === 'exam'));
});

test('a TBD exam has no countdown, no reminders, no calendar pin and no risk score', () => {
  const m = computeAll(snap([course({ dateState: 'tbd' })]));
  const c = m.courses[0];
  assert.equal(c.daysUntil, null);
  assert.equal(c.schedule.date, null);
  assert.equal(c.risk.score, null);
  assert.equal(c.risk.label, 'Unscheduled');
  assert.equal(m.events.length, 0);
  assert.equal(c.deficitHours, 0, 'unscheduled hours are not a shortfall');
  assert.equal(m.totals.unplannedHours, 20, 'they are reported as waiting on a date');
});

test('an expected date plans provisionally but still creates no reminders', () => {
  const m = computeAll(snap([course({ dateState: 'tbd', estimatedDate: '2026-11-15' })]));
  const c = m.courses[0];
  assert.equal(c.schedule.firm, false);
  assert.equal(c.daysUntil, 64);
  assert.ok(c.availableHours > 0, 'it is in the study plan');
  assert.equal(m.events.filter(e => e.type === 'reminder').length, 0);
  assert.equal(m.events.filter(e => e.type === 'milestone').length, 0);
  assert.equal(m.events.find(e => e.type === 'expected')?.date, '2026-11-15');
  assert.match(c.risk.reasons.join(' '), /not yet confirmed/);
});

test('a no-exam course never counts down and is driven by its deliverables', () => {
  const m = computeAll(snap([course({
    dateState: 'none', assessment: 'Coursework', prepEstimateHours: 0,
    deliverables: [{ id: 'd1', title: 'Report', kind: 'report', dueDate: '2026-10-30', estHours: 10, submitted: false }]
  })]));
  const c = m.courses[0];
  assert.equal(c.isExam, false);
  assert.equal(c.daysUntil, null);
  assert.equal(m.events.filter(e => e.type === 'exam' || e.type === 'expected').length, 0);
  assert.equal(m.events.filter(e => e.type === 'deadline').length, 1);
  assert.equal(m.events.filter(e => e.type === 'reminder').length, 3);
  assert.equal(c.deliverables[0].remainingHours, 10);
});

test('a deliverable with no due date is the coursework TBD: no event, no reminder', () => {
  const m = computeAll(snap([course({
    dateState: 'none', prepEstimateHours: 0,
    deliverables: [{ id: 'd1', title: 'Final report', kind: 'report', dueDate: null, estHours: 18, submitted: false }]
  })]));
  assert.equal(m.events.length, 0);
  assert.equal(m.courses[0].deliverables[0].dateState, 'tbd');
  assert.equal(m.courses[0].deliverables[0].deficitHours, 0);
  assert.equal(m.totals.unplannedHours, 18);
  assert.equal(m.awaitingDate.length, 1);
});

/* ---------------------------------------------------------------- study ledger */

test('preparation completed comes from logged sessions, not a stored number', () => {
  const m = computeAll(snap([course({
    dateState: 'confirmed', examDate: '2026-10-07', prepEstimateHours: 20,
    loggedMinutes: { exam: 330, total: 330, byDeliverable: {} }
  })]));
  assert.equal(m.courses[0].prepDoneHours, 5.5);
  assert.equal(m.courses[0].prepRemainingHours, 14.5);
  assert.equal(m.totals.loggedHours, 5.5);
});

test('logging time against a deliverable reduces that deliverable, not the exam prep', () => {
  const m = computeAll(snap([course({
    dateState: 'none', prepEstimateHours: 0,
    deliverables: [{ id: 'd1', title: 'Report', kind: 'report', dueDate: '2026-10-30', estHours: 10, submitted: false }],
    loggedMinutes: { exam: 0, total: 240, byDeliverable: { d1: 240 } }
  })]));
  assert.equal(m.courses[0].deliverables[0].loggedHours, 4);
  assert.equal(m.courses[0].deliverables[0].remainingHours, 6);
  assert.equal(m.courses[0].prepDoneHours, 0);
});

/* ---------------------------------------------------------------- the planner */

test('the reserve rule keeps a later exam fed while a nearer one is bearing down', () => {
  const courses = [
    course({ id: 'near', name: 'Near', dateState: 'confirmed', examDate: '2026-09-20', prepEstimateHours: 40 }),
    course({ id: 'far', name: 'Far', dateState: 'confirmed', examDate: '2026-11-20', prepEstimateHours: 40 })
  ];
  // the reserve changes WHEN the far exam is studied, not how much in total,
  // so measure the hours it receives during the near exam's run-up
  const duringRunUp = plan => plan.days
    .filter(d => d.iso < '2026-09-20')
    .reduce((s, d) => s + (d.parts['e:far'] || 0), 0);

  const withReserve = buildPlan({ ...snap(courses), overrideMap: {}, settings: SETTINGS });
  const noReserve = buildPlan({ ...snap(courses), overrideMap: {}, settings: { ...SETTINGS, reserveShare: 0 } });

  assert.ok(duringRunUp(withReserve) > 0, 'the far exam gets hours even while the near one is bearing down');
  assert.ok(
    duringRunUp(withReserve) > duringRunUp(noReserve),
    'a bigger reserve shifts run-up hours towards the later exam'
  );
  assert.ok(
    withReserve.alloc['e:near'] < noReserve.alloc['e:near'],
    'and it costs the nearer exam some of its own preparation'
  );
});

test('nobody is allocated more hours than they still need', () => {
  const m = computeAll(snap([
    course({ id: 'a', dateState: 'confirmed', examDate: '2026-12-20', prepEstimateHours: 4 })
  ]));
  assert.equal(m.courses[0].availableHours, 4);
  assert.equal(m.courses[0].deficitHours, 0);
});

test('a capacity override removes that day from the plan', () => {
  const base = computeAll(snap([course({ dateState: 'confirmed', examDate: '2026-09-20', prepEstimateHours: 100 })]));
  const blocked = computeAll(snap(
    [course({ dateState: 'confirmed', examDate: '2026-09-20', prepEstimateHours: 100 })],
    { overrides: [{ date: '2026-09-14', hours: 0, reason: 'Away' }] }
  ));
  assert.equal(blocked.plan.days.find(d => d.date === '2026-09-14').capacity, 0);
  assert.ok(blocked.courses[0].availableHours < base.courses[0].availableHours);
});

/* ---------------------------------------------------------------- clustering */

test('exams that chain within the window become one high-density period', () => {
  const m = computeAll(snap([
    course({ id: 'a', name: 'Integral', dateState: 'confirmed', examDate: '2026-10-07' }),
    course({ id: 'b', name: 'Functional', dateState: 'confirmed', examDate: '2026-10-08' }),
    course({ id: 'c', name: 'Matrix', dateState: 'confirmed', examDate: '2026-10-21' }),
    course({ id: 'd', name: 'Statistic II', dateState: 'confirmed', examDate: '2026-11-02' }),
    course({ id: 'e', name: 'AI', dateState: 'confirmed', examDate: '2026-12-22' })
  ]));
  assert.equal(m.clusters.length, 1, 'December is far enough away to stand alone');
  const cl = m.clusters[0];
  assert.equal(cl.exams.length, 4);
  assert.equal(cl.from, '2026-10-07');
  assert.equal(cl.to, '2026-11-02');
  assert.equal(cl.dense, true);
});

test('two exams a day apart are flagged as a tight turnaround', () => {
  const m = computeAll(snap([
    course({ id: 'a', name: 'Integral', dateState: 'confirmed', examDate: '2026-10-07' }),
    course({ id: 'b', name: 'Functional', dateState: 'confirmed', examDate: '2026-10-08' })
  ]));
  const k = m.conflicts.find(x => x.kind === 'tight');
  assert.ok(k, 'a tight turnaround is reported');
  assert.deepEqual(k.courseIds.sort(), ['a', 'b']);
});

test('two exams on the same day are a critical conflict', () => {
  const m = computeAll(snap([
    course({ id: 'a', name: 'A', dateState: 'confirmed', examDate: '2026-10-07' }),
    course({ id: 'b', name: 'B', dateState: 'confirmed', examDate: '2026-10-07' })
  ]));
  assert.equal(m.conflicts.find(x => x.kind === 'same-day')?.level, 'crit');
});

/* ---------------------------------------------------------------- grouping */

test('subject areas aggregate credits and take the worst member risk', () => {
  const m = computeAll(snap([
    course({ id: 'a', name: 'Integral Calculus', credits: 3, subjectArea: 'Mathematics', dateState: 'confirmed', examDate: '2026-10-07', prepEstimateHours: 24 }),
    course({ id: 'b', name: 'Differential Calculus', credits: 3, subjectArea: 'Mathematics', dateState: 'tbd', prepEstimateHours: 20 }),
    course({ id: 'c', name: 'Matrix Algebra', credits: 5, subjectArea: 'Mathematics', dateState: 'confirmed', examDate: '2026-10-21', prepEstimateHours: 34 }),
    course({ id: 'd', name: 'Statistic II', credits: 3, subjectArea: 'Mathematics', dateState: 'confirmed', examDate: '2026-11-02', prepEstimateHours: 22 })
  ]));
  const maths = m.areas.find(a => a.name === 'Mathematics');
  assert.equal(maths.credits, 14);
  assert.equal(maths.upcoming, 3, 'the TBD exam is not counted as upcoming');
  assert.equal(maths.unscheduled, 1);
  assert.equal(maths.courseIds.length, 4, 'every course is still individually addressable');
});

/* ---------------------------------------------------------------- what-if */

test('what-if reports the consequences of a date without writing it', () => {
  const s = snap([
    course({ id: 'dc', name: 'Differential Calculus', dateState: 'tbd', prepEstimateHours: 20, loggedMinutes: { exam: 240, total: 240, byDeliverable: {} } }),
    course({ id: 'ic', name: 'Integral Calculus', dateState: 'confirmed', examDate: '2026-10-07', prepEstimateHours: 24 })
  ]);
  const before = computeAll(s);
  const impact = whatIf(s, 'dc', '2026-11-15');

  assert.equal(impact.course.daysUntil, 64);
  assert.equal(impact.course.prepRemainingHours, 16);
  assert.equal(impact.remindersCreated, 5);
  assert.ok(impact.milestonesCreated > 0);
  assert.equal(before.courses.find(c => c.id === 'dc').risk.label, 'Unscheduled', 'the snapshot is untouched');
  assert.notEqual(impact.course.risk.label, 'Unscheduled');
});

test('what-if surfaces the knock-on effect on other courses', () => {
  const s = snap([
    course({ id: 'dc', name: 'Differential', dateState: 'tbd', prepEstimateHours: 60 }),
    course({ id: 'ma', name: 'Matrix', dateState: 'confirmed', examDate: '2026-09-30', prepEstimateHours: 60 })
  ]);
  const impact = whatIf(s, 'dc', '2026-09-28');
  assert.ok(impact.knockOn.length >= 1, 'squeezing a date in changes another course');
});

/* ---------------------------------------------------------------- misc */

test('scheduleOf honours the three states', () => {
  assert.deepEqual(scheduleOf({ dateState: 'confirmed', examDate: '2026-10-07' }), { date: '2026-10-07', firm: true });
  assert.deepEqual(scheduleOf({ dateState: 'tbd', estimatedDate: '2026-10-07' }), { date: '2026-10-07', firm: false });
  assert.deepEqual(scheduleOf({ dateState: 'tbd', estimatedDate: null }), { date: null, firm: false });
  assert.deepEqual(scheduleOf({ dateState: 'none', examDate: '2026-10-07' }), { date: null, firm: false });
});

test('date helpers are timezone-proof', () => {
  assert.equal(dayDiff(parseDate('2026-10-24'), parseDate('2026-10-26')), 2, 'spans a DST change');
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('not a date'), null);
});

test('an exam in the past is dropped from the plan but still listed', () => {
  const m = computeAll(snap([course({ dateState: 'confirmed', examDate: '2026-09-01', prepEstimateHours: 20 })]));
  assert.equal(m.courses[0].daysUntil, -11);
  assert.equal(m.upcomingExams.length, 0);
  assert.equal(m.courses[0].availableHours, 0);
});
