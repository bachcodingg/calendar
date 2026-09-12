import { db, readSettings, readCapacity, readOverrides, newId, nowIso, logActivity } from './db.js';
import { todayIso, computeAll, whatIf } from './engine.js';

/* --------------------------------------------------------------------------
   Reading
   -------------------------------------------------------------------------- */
const selCourses = db.prepare(`
  SELECT id, name, credits, assessment, date_state AS dateState, exam_date AS examDate,
         estimated_date AS estimatedDate, subject_area AS subjectArea,
         prep_estimate_hours AS prepEstimateHours, position, created_at AS createdAt, updated_at AS updatedAt
    FROM courses ORDER BY position, created_at`);

const selTopics = db.prepare('SELECT id, course_id AS courseId, name, done, position FROM topics ORDER BY position, rowid');
const selDeliverables = db.prepare(`
  SELECT id, course_id AS courseId, title, kind, due_date AS dueDate, est_hours AS estHours,
         submitted, position FROM deliverables ORDER BY position, rowid`);
const selMinutes = db.prepare(`
  SELECT course_id AS courseId, deliverable_id AS deliverableId, SUM(minutes) AS minutes
    FROM sessions GROUP BY course_id, deliverable_id`);

export function snapshot(today = todayIso()) {
  const courses = selCourses.all();
  const byId = new Map(courses.map(c => [c.id, { ...c, topics: [], deliverables: [], loggedMinutes: { exam: 0, total: 0, byDeliverable: {} } }]));

  for (const t of selTopics.all()) byId.get(t.courseId)?.topics.push({ id: t.id, name: t.name, done: !!t.done, position: t.position });
  for (const d of selDeliverables.all()) {
    byId.get(d.courseId)?.deliverables.push({
      id: d.id, title: d.title, kind: d.kind, dueDate: d.dueDate,
      estHours: d.estHours, submitted: !!d.submitted, position: d.position
    });
  }
  for (const m of selMinutes.all()) {
    const c = byId.get(m.courseId);
    if (!c) continue;
    c.loggedMinutes.total += m.minutes;
    if (m.deliverableId) c.loggedMinutes.byDeliverable[m.deliverableId] = m.minutes;
    else c.loggedMinutes.exam += m.minutes;
  }

  return {
    today,
    courses: [...byId.values()],
    settings: readSettings(),
    capacity: readCapacity(),
    overrides: readOverrides()
  };
}

export const state = (today) => computeAll(snapshot(today));
export const project = (courseId, date, mode, today) => whatIf(snapshot(today), courseId, date, mode);

/* --------------------------------------------------------------------------
   Validation
   -------------------------------------------------------------------------- */
export class ApiError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}
const bad = (msg, field) => { throw new ApiError(400, msg, field); };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanDate(v, field, { allowNull = true } = {}) {
  if (v === null || v === undefined || v === '') {
    if (allowNull) return null;
    bad(`${field} is required`, field);
  }
  const s = String(v).trim();
  if (!DATE_RE.test(s)) bad(`${field} must be a date in YYYY-MM-DD form`, field);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) bad(`${field} is not a real date`, field);
  return s;
}
export function cleanNumber(v, field, { min = 0, max = 1000, fallback = null } = {}) {
  if (v === undefined || v === null || v === '') {
    if (fallback !== null) return fallback;
    bad(`${field} is required`, field);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) bad(`${field} must be a number`, field);
  return Math.min(max, Math.max(min, n));
}
export function cleanText(v, field, { max = 200, required = true, fallback = '' } = {}) {
  const s = (v === undefined || v === null) ? '' : String(v).trim();
  if (!s) {
    if (required) bad(`${field} cannot be empty`, field);
    return fallback;
  }
  if (s.length > max) bad(`${field} is longer than ${max} characters`, field);
  return s;
}

const DATE_STATES = ['confirmed', 'tbd', 'none'];
const KINDS = ['assignment', 'exercise', 'project', 'report', 'presentation', 'portfolio'];

export const getCourse = id => {
  const row = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'No course with that id');
  return row;
};
export const getDeliverable = id => {
  const row = db.prepare('SELECT * FROM deliverables WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'No deliverable with that id');
  return row;
};

/* --------------------------------------------------------------------------
   Courses
   -------------------------------------------------------------------------- */
export function createCourse(body) {
  const name = cleanText(body.name, 'name');
  const dateState = DATE_STATES.includes(body.dateState) ? body.dateState : 'tbd';
  const examDate = dateState === 'confirmed' ? cleanDate(body.examDate, 'examDate', { allowNull: false }) : null;
  const estimatedDate = dateState === 'tbd' ? cleanDate(body.estimatedDate, 'estimatedDate') : null;
  const id = newId('c_');
  const at = nowIso();
  const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM courses').get().p) + 1;

  db.prepare(`INSERT INTO courses
    (id, name, credits, assessment, date_state, exam_date, estimated_date, subject_area, prep_estimate_hours, position, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, name,
    cleanNumber(body.credits, 'credits', { max: 60, fallback: 0 }),
    cleanText(body.assessment, 'assessment', { required: false, fallback: 'Exam', max: 60 }),
    dateState, examDate, estimatedDate,
    cleanText(body.subjectArea, 'subjectArea', { required: false, fallback: null, max: 80 }) || null,
    cleanNumber(body.prepEstimateHours, 'prepEstimateHours', { max: 500, fallback: 0 }),
    pos, at, at
  );

  for (const [i, t] of (Array.isArray(body.topics) ? body.topics : []).entries()) {
    addTopic(id, typeof t === 'string' ? { name: t } : t, i);
  }
  logActivity({ kind: 'course.create', summary: `Added ${name}`, entity: 'course', entityId: id, undo: { op: 'course.delete', id } });
  return id;
}

const COURSE_FIELDS = {
  name: (v) => ['name', cleanText(v, 'name')],
  credits: (v) => ['credits', cleanNumber(v, 'credits', { max: 60 })],
  assessment: (v) => ['assessment', cleanText(v, 'assessment', { max: 60 })],
  subjectArea: (v) => ['subject_area', cleanText(v, 'subjectArea', { required: false, fallback: null, max: 80 }) || null],
  prepEstimateHours: (v) => ['prep_estimate_hours', cleanNumber(v, 'prepEstimateHours', { max: 500 })]
};

export function updateCourse(id, body) {
  const before = getCourse(id);
  const sets = [], vals = [];

  for (const [key, fn] of Object.entries(COURSE_FIELDS)) {
    if (!(key in body)) continue;
    const [col, val] = fn(body[key]);
    sets.push(`${col} = ?`); vals.push(val);
  }

  // the date state is a transition, not a plain field — validate the triple together
  if ('dateState' in body || 'examDate' in body || 'estimatedDate' in body) {
    const dateState = 'dateState' in body ? body.dateState : before.date_state;
    if (!DATE_STATES.includes(dateState)) bad('dateState must be confirmed, tbd or none', 'dateState');

    let examDate = null, estimatedDate = null;
    if (dateState === 'confirmed') {
      examDate = cleanDate('examDate' in body ? body.examDate : before.exam_date, 'examDate', { allowNull: false });
    } else if (dateState === 'tbd') {
      estimatedDate = cleanDate('estimatedDate' in body ? body.estimatedDate : before.estimated_date, 'estimatedDate');
    }
    sets.push('date_state = ?', 'exam_date = ?', 'estimated_date = ?');
    vals.push(dateState, examDate, estimatedDate);
  }

  if (!sets.length) return before.id;
  sets.push('updated_at = ?'); vals.push(nowIso(), id);
  db.prepare(`UPDATE courses SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  logActivity({
    kind: 'course.update', summary: `Updated ${before.name}`, entity: 'course', entityId: id,
    undo: { op: 'course.restore', id, row: before }
  });
  return id;
}

export function deleteCourse(id) {
  const row = getCourse(id);
  const topics = db.prepare('SELECT * FROM topics WHERE course_id = ?').all(id);
  const deliverables = db.prepare('SELECT * FROM deliverables WHERE course_id = ?').all(id);
  const sessions = db.prepare('SELECT * FROM sessions WHERE course_id = ?').all(id);
  db.prepare('DELETE FROM courses WHERE id = ?').run(id);
  logActivity({
    kind: 'course.delete', summary: `Removed ${row.name}`, entity: 'course', entityId: id,
    undo: { op: 'course.restoreDeep', row, topics, deliverables, sessions }
  });
  return row.name;
}

/** The TBD → confirmed transition. Everything downstream keys off this. */
export function setExamDate(id, date, mode = 'confirmed') {
  const row = getCourse(id);
  if (row.date_state === 'none') throw new ApiError(409, `${row.name} is marked as having no exam — switch it to TBD first`);
  const clean = cleanDate(date, 'date', { allowNull: false });

  if (mode === 'expected') {
    db.prepare('UPDATE courses SET date_state = ?, exam_date = NULL, estimated_date = ?, updated_at = ? WHERE id = ?')
      .run('tbd', clean, nowIso(), id);
  } else {
    db.prepare('UPDATE courses SET date_state = ?, exam_date = ?, estimated_date = NULL, updated_at = ? WHERE id = ?')
      .run('confirmed', clean, nowIso(), id);
  }
  logActivity({
    kind: mode === 'expected' ? 'date.expected' : 'date.confirm',
    summary: mode === 'expected'
      ? `${row.name}: planning provisionally against ${clean}`
      : `${row.name}: exam date confirmed for ${clean}`,
    entity: 'course', entityId: id,
    undo: { op: 'course.restore', id, row }
  });
  return clean;
}

export function clearExamDate(id) {
  const row = getCourse(id);
  db.prepare('UPDATE courses SET date_state = ?, exam_date = NULL, estimated_date = NULL, updated_at = ? WHERE id = ?')
    .run('tbd', nowIso(), id);
  logActivity({
    kind: 'date.clear', summary: `${row.name}: back to TBD`, entity: 'course', entityId: id,
    undo: { op: 'course.restore', id, row }
  });
}

/* --------------------------------------------------------------------------
   Topics
   -------------------------------------------------------------------------- */
export function addTopic(courseId, body, position) {
  getCourse(courseId);
  const id = newId('t_');
  const pos = position ?? (db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM topics WHERE course_id = ?').get(courseId).p) + 1;
  db.prepare('INSERT INTO topics (id, course_id, name, done, position) VALUES (?,?,?,?,?)')
    .run(id, courseId, cleanText(body.name, 'name', { max: 120 }), body.done ? 1 : 0, pos);
  return id;
}
export function updateTopic(id, body) {
  const row = db.prepare('SELECT * FROM topics WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'No topic with that id');
  db.prepare('UPDATE topics SET name = ?, done = ? WHERE id = ?').run(
    'name' in body ? cleanText(body.name, 'name', { max: 120 }) : row.name,
    'done' in body ? (body.done ? 1 : 0) : row.done,
    id
  );
  return id;
}
export function deleteTopic(id) {
  const row = db.prepare('SELECT * FROM topics WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'No topic with that id');
  db.prepare('DELETE FROM topics WHERE id = ?').run(id);
}

/* --------------------------------------------------------------------------
   Deliverables — assignments, exercises, projects, coursework
   -------------------------------------------------------------------------- */
export function addDeliverable(courseId, body) {
  const course = getCourse(courseId);
  const id = newId('d_');
  const at = nowIso();
  const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM deliverables WHERE course_id = ?').get(courseId).p) + 1;
  const title = cleanText(body.title, 'title', { max: 140 });
  db.prepare(`INSERT INTO deliverables (id, course_id, title, kind, due_date, est_hours, submitted, position, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id, courseId, title,
    KINDS.includes(body.kind) ? body.kind : 'assignment',
    cleanDate(body.dueDate, 'dueDate'),
    cleanNumber(body.estHours, 'estHours', { max: 300, fallback: 0 }),
    body.submitted ? 1 : 0, pos, at, at
  );
  logActivity({
    kind: 'deliverable.create', summary: `${course.name}: added “${title}”`, entity: 'deliverable', entityId: id,
    undo: { op: 'deliverable.delete', id }
  });
  return id;
}

export function updateDeliverable(id, body) {
  const before = getDeliverable(id);
  const course = getCourse(before.course_id);
  const sets = [], vals = [];
  if ('title' in body) { sets.push('title = ?'); vals.push(cleanText(body.title, 'title', { max: 140 })); }
  if ('kind' in body) { sets.push('kind = ?'); vals.push(KINDS.includes(body.kind) ? body.kind : 'assignment'); }
  if ('dueDate' in body) { sets.push('due_date = ?'); vals.push(cleanDate(body.dueDate, 'dueDate')); }
  if ('estHours' in body) { sets.push('est_hours = ?'); vals.push(cleanNumber(body.estHours, 'estHours', { max: 300 })); }
  if ('submitted' in body) { sets.push('submitted = ?'); vals.push(body.submitted ? 1 : 0); }
  if (!sets.length) return id;
  sets.push('updated_at = ?'); vals.push(nowIso(), id);
  db.prepare(`UPDATE deliverables SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  const what = 'dueDate' in body
    ? (body.dueDate ? `deadline set to ${body.dueDate}` : 'deadline cleared to TBD')
    : 'submitted' in body ? (body.submitted ? 'marked submitted' : 'reopened')
    : 'updated';
  logActivity({
    kind: 'deliverable.update', summary: `${course.name} · “${before.title}” ${what}`,
    entity: 'deliverable', entityId: id, undo: { op: 'deliverable.restore', id, row: before }
  });
  return id;
}

export function deleteDeliverable(id) {
  const row = getDeliverable(id);
  const course = getCourse(row.course_id);
  const sessions = db.prepare('SELECT * FROM sessions WHERE deliverable_id = ?').all(id);
  db.prepare('DELETE FROM deliverables WHERE id = ?').run(id);
  logActivity({
    kind: 'deliverable.delete', summary: `${course.name}: removed “${row.title}”`,
    entity: 'deliverable', entityId: id, undo: { op: 'deliverable.restoreDeep', row, sessions }
  });
  return row.title;
}

/* --------------------------------------------------------------------------
   Study sessions — the ledger that "preparation completed" is derived from
   -------------------------------------------------------------------------- */
export function logSession(body) {
  const course = getCourse(cleanText(body.courseId, 'courseId'));
  let deliverableId = null;
  if (body.deliverableId) {
    const d = getDeliverable(body.deliverableId);
    if (d.course_id !== course.id) bad('That deliverable belongs to a different course', 'deliverableId');
    deliverableId = d.id;
  }
  const minutes = Math.round(cleanNumber(body.minutes, 'minutes', { min: 1, max: 24 * 60, fallback: null }));
  const onDate = cleanDate(body.date ?? todayIso(), 'date', { allowNull: false });
  const id = newId('s_');
  db.prepare('INSERT INTO sessions (id, course_id, deliverable_id, on_date, minutes, note, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, course.id, deliverableId, onDate, minutes,
      cleanText(body.note, 'note', { required: false, fallback: null, max: 300 }) || null, nowIso());

  const h = Math.round((minutes / 60) * 10) / 10;
  logActivity({
    kind: 'session.log', summary: `Logged ${h} h on ${course.name}${deliverableId ? ' · coursework' : ''}`,
    entity: 'session', entityId: id, undo: { op: 'session.delete', id }
  });
  return id;
}

export function deleteSession(id) {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'No study session with that id');
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  const course = db.prepare('SELECT name FROM courses WHERE id = ?').get(row.course_id);
  logActivity({
    kind: 'session.delete', summary: `Removed a ${Math.round(row.minutes / 6) / 10} h session on ${course?.name ?? 'a course'}`,
    entity: 'session', entityId: id, undo: { op: 'session.restore', row }
  });
}

export function listSessions({ from, to, courseId, limit = 100 } = {}) {
  const where = [], vals = [];
  if (from) { where.push('s.on_date >= ?'); vals.push(cleanDate(from, 'from', { allowNull: false })); }
  if (to) { where.push('s.on_date <= ?'); vals.push(cleanDate(to, 'to', { allowNull: false })); }
  if (courseId) { where.push('s.course_id = ?'); vals.push(courseId); }
  vals.push(Math.min(500, Math.max(1, Number(limit) || 100)));
  return db.prepare(`
    SELECT s.id, s.course_id AS courseId, c.name AS courseName, s.deliverable_id AS deliverableId,
           d.title AS deliverableTitle, s.on_date AS date, s.minutes, s.note, s.created_at AS createdAt
      FROM sessions s
      JOIN courses c ON c.id = s.course_id
      LEFT JOIN deliverables d ON d.id = s.deliverable_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY s.on_date DESC, s.created_at DESC
     LIMIT ?`).all(...vals);
}

/** Hours logged per day, for the streak strip. */
export function sessionHistogram(days = 56, today = todayIso()) {
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - days + 1);
  const rows = db.prepare(`SELECT on_date AS date, SUM(minutes) AS minutes FROM sessions
                           WHERE on_date >= ? AND on_date <= ? GROUP BY on_date`)
    .all(from.toISOString().slice(0, 10), today);
  const map = Object.fromEntries(rows.map(r => [r.date, r.minutes]));
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d, minutes: map[d] || 0 });
  }
  return out;
}

/* --------------------------------------------------------------------------
   Capacity — the weekly pattern and per-day overrides
   -------------------------------------------------------------------------- */
export function setOverride(body) {
  const date = cleanDate(body.date, 'date', { allowNull: false });
  const hours = cleanNumber(body.hours, 'hours', { min: 0, max: 16, fallback: null });
  const reason = cleanText(body.reason, 'reason', { required: false, fallback: null, max: 80 }) || null;
  const before = db.prepare('SELECT * FROM capacity_overrides WHERE on_date = ?').get(date) || null;
  db.prepare(`INSERT INTO capacity_overrides (on_date, hours, reason) VALUES (?,?,?)
              ON CONFLICT(on_date) DO UPDATE SET hours = excluded.hours, reason = excluded.reason`)
    .run(date, hours, reason);
  logActivity({
    kind: 'capacity.override',
    summary: hours === 0 ? `${date} blocked out${reason ? ` — ${reason}` : ''}` : `${date} set to ${hours} h${reason ? ` — ${reason}` : ''}`,
    entity: 'override', entityId: date,
    undo: before ? { op: 'override.restore', row: before } : { op: 'override.delete', date }
  });
  return { date, hours, reason };
}

export function deleteOverride(date) {
  const clean = cleanDate(date, 'date', { allowNull: false });
  const before = db.prepare('SELECT * FROM capacity_overrides WHERE on_date = ?').get(clean);
  if (!before) throw new ApiError(404, 'No override on that date');
  db.prepare('DELETE FROM capacity_overrides WHERE on_date = ?').run(clean);
  logActivity({
    kind: 'capacity.override.clear', summary: `${clean} back to the normal weekly pattern`,
    entity: 'override', entityId: clean, undo: { op: 'override.restore', row: before }
  });
}

/* --------------------------------------------------------------------------
   Undo
   -------------------------------------------------------------------------- */
const insertRow = (table, row) => {
  const cols = Object.keys(row);
  db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map(k => row[k]));
};

export function undo(activityId) {
  const row = db.prepare('SELECT * FROM activity WHERE id = ?').get(activityId);
  if (!row) throw new ApiError(404, 'No such activity entry');
  if (!row.undo) throw new ApiError(409, 'That entry cannot be undone');
  const u = JSON.parse(row.undo);

  switch (u.op) {
    case 'course.delete': db.prepare('DELETE FROM courses WHERE id = ?').run(u.id); break;
    case 'course.restore': insertRow('courses', u.row); break;
    case 'course.restoreDeep':
      insertRow('courses', u.row);
      for (const t of u.topics) insertRow('topics', t);
      for (const d of u.deliverables) insertRow('deliverables', d);
      for (const s of u.sessions) insertRow('sessions', s);
      break;
    case 'deliverable.delete': db.prepare('DELETE FROM deliverables WHERE id = ?').run(u.id); break;
    case 'deliverable.restore': insertRow('deliverables', u.row); break;
    case 'deliverable.restoreDeep':
      insertRow('deliverables', u.row);
      for (const s of u.sessions) insertRow('sessions', s);
      break;
    case 'session.delete': db.prepare('DELETE FROM sessions WHERE id = ?').run(u.id); break;
    case 'session.restore': insertRow('sessions', u.row); break;
    case 'override.delete': db.prepare('DELETE FROM capacity_overrides WHERE on_date = ?').run(u.date); break;
    case 'override.restore': insertRow('capacity_overrides', u.row); break;
    default: throw new ApiError(409, 'That entry cannot be undone');
  }

  db.prepare('UPDATE activity SET undo = NULL, summary = ? WHERE id = ?').run(`${row.summary} (undone)`, activityId);
  logActivity({ kind: 'undo', summary: `Undid: ${row.summary}` });
  return row.summary;
}
