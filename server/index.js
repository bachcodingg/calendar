import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, migrate, readSettings, writeSettings, readCapacity, writeCapacity, readOverrides, readActivity, DB_PATH } from './db.js';
import { ensureSeeded, wipe, seed } from './seed.js';
import * as repo from './repo.js';
import { ApiError } from './repo.js';
import { todayIso } from './engine.js';
import { buildIcs } from './ics.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4173;

migrate();
const seeded = ensureSeeded();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

/* request log, quiet but useful */
app.use((req, res, next) => {
  const t = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      console.log(`${res.statusCode} ${req.method.padEnd(6)} ${req.path} ${ms.toFixed(1)}ms`);
    }
  });
  next();
});

const api = express.Router();

/** Wrap a handler so thrown ApiErrors become clean JSON. */
const h = fn => (req, res, next) => { try { fn(req, res); } catch (e) { next(e); } };

/** Every mutation answers with the freshly recomputed model, so one round trip
 *  is enough for the client to redraw the entire deck. */
const withState = (res, extra = {}, status = 200) =>
  res.status(status).json({ ok: true, ...extra, state: repo.state(), activity: readActivity(12) });

const dayParam = req => (req.query.today ? String(req.query.today) : todayIso());

/* ---------- read ---------- */
api.get('/health', h((req, res) => res.json({
  ok: true, service: 'semester-control-deck', version: '2.0.0',
  database: DB_PATH, today: todayIso(), uptimeSeconds: Math.round(process.uptime())
})));

api.get('/state', h((req, res) => res.json({
  ok: true, state: repo.state(dayParam(req)), activity: readActivity(12)
})));

api.get('/courses', h((req, res) => res.json({ ok: true, courses: repo.state().courses })));

api.get('/courses/:id', h((req, res) => {
  const model = repo.state();
  const course = model.courses.find(c => c.id === req.params.id);
  if (!course) throw new ApiError(404, 'No course with that id');
  res.json({
    ok: true, course,
    events: model.events.filter(e => e.courseId === course.id),
    sessions: repo.listSessions({ courseId: course.id, limit: 50 })
  });
}));

api.get('/plan', h((req, res) => {
  const model = repo.state(dayParam(req));
  res.json({ ok: true, plan: model.plan, weeks: model.weeks, todayPlan: model.todayPlan, totals: model.totals });
}));

api.get('/analytics', h((req, res) => {
  const m = repo.state(dayParam(req));
  res.json({ ok: true, clusters: m.clusters, conflicts: m.conflicts, areas: m.areas, totals: m.totals, worstRisk: m.worstRisk });
}));

api.get('/activity', h((req, res) => res.json({ ok: true, activity: readActivity(Number(req.query.limit) || 40) })));

/* ---------- courses ---------- */
api.post('/courses', h((req, res) => {
  const id = repo.createCourse(req.body || {});
  withState(res, { id }, 201);
}));

api.patch('/courses/:id', h((req, res) => {
  repo.updateCourse(req.params.id, req.body || {});
  withState(res, { id: req.params.id });
}));

api.delete('/courses/:id', h((req, res) => {
  const name = repo.deleteCourse(req.params.id);
  withState(res, { removed: name });
}));

/* ---------- the TBD → confirmed transition ---------- */
api.post('/courses/:id/date', h((req, res) => {
  const mode = req.body?.mode === 'expected' ? 'expected' : 'confirmed';
  // validate before the engine ever sees it, then report the consequences
  const wanted = repo.cleanDate(req.body?.date, 'date', { allowNull: false });
  repo.getCourse(req.params.id);
  const impact = repo.project(req.params.id, wanted, mode);
  const date = repo.setExamDate(req.params.id, wanted, mode);
  withState(res, { date, mode, impact });
}));

api.delete('/courses/:id/date', h((req, res) => {
  repo.clearExamDate(req.params.id);
  withState(res, { id: req.params.id });
}));

/** What a date would do — nothing is written. */
api.post('/whatif', h((req, res) => {
  const { courseId, date, mode } = req.body || {};
  if (!courseId || !date) throw new ApiError(400, 'courseId and date are both required');
  const impact = repo.project(courseId, repo.cleanDate(date, 'date', { allowNull: false }), mode === 'expected' ? 'expected' : 'confirmed');
  if (!impact) throw new ApiError(404, 'No course with that id');
  res.json({ ok: true, impact });
}));

/* ---------- topics ---------- */
api.post('/courses/:id/topics', h((req, res) => {
  const id = repo.addTopic(req.params.id, req.body || {});
  withState(res, { id }, 201);
}));
api.patch('/topics/:id', h((req, res) => { repo.updateTopic(req.params.id, req.body || {}); withState(res); }));
api.delete('/topics/:id', h((req, res) => { repo.deleteTopic(req.params.id); withState(res); }));

/* ---------- deliverables: assignments, exercises, projects, coursework ---------- */
api.post('/courses/:id/deliverables', h((req, res) => {
  const id = repo.addDeliverable(req.params.id, req.body || {});
  withState(res, { id }, 201);
}));
api.patch('/deliverables/:id', h((req, res) => { repo.updateDeliverable(req.params.id, req.body || {}); withState(res, { id: req.params.id }); }));
api.delete('/deliverables/:id', h((req, res) => {
  const title = repo.deleteDeliverable(req.params.id);
  withState(res, { removed: title });
}));

/* ---------- study time ---------- */
api.get('/sessions', h((req, res) => res.json({
  ok: true,
  sessions: repo.listSessions(req.query),
  histogram: repo.sessionHistogram(Number(req.query.days) || 56, dayParam(req))
})));

api.post('/sessions', h((req, res) => {
  const id = repo.logSession(req.body || {});
  withState(res, { id }, 201);
}));

api.delete('/sessions/:id', h((req, res) => { repo.deleteSession(req.params.id); withState(res); }));

/* ---------- capacity ---------- */
api.get('/capacity', h((req, res) => res.json({ ok: true, capacity: readCapacity(), overrides: readOverrides() })));

api.put('/capacity', h((req, res) => {
  const hours = req.body?.capacity;
  if (!Array.isArray(hours) || hours.length !== 7) throw new ApiError(400, 'capacity must be an array of seven numbers, Monday first');
  writeCapacity(hours);
  withState(res, { capacity: readCapacity() });
}));

api.put('/capacity/overrides', h((req, res) => {
  const row = repo.setOverride(req.body || {});
  withState(res, { override: row });
}));

api.delete('/capacity/overrides/:date', h((req, res) => {
  repo.deleteOverride(req.params.date);
  withState(res);
}));

/* ---------- settings ---------- */
api.get('/settings', h((req, res) => res.json({ ok: true, settings: readSettings() })));
api.patch('/settings', h((req, res) => { writeSettings(req.body || {}); withState(res, { settings: readSettings() }); }));

/* ---------- undo, reset, import/export ---------- */
api.post('/activity/:id/undo', h((req, res) => {
  const what = repo.undo(Number(req.params.id));
  withState(res, { undone: what });
}));

api.post('/reset', h((req, res) => {
  wipe();
  const r = seed();
  withState(res, { reseeded: r });
}));

api.get('/export', h((req, res) => {
  const payload = {
    exportedAt: new Date().toISOString(),
    settings: readSettings(),
    capacity: readCapacity(),
    overrides: readOverrides(),
    courses: db.prepare('SELECT * FROM courses ORDER BY position').all(),
    topics: db.prepare('SELECT * FROM topics').all(),
    deliverables: db.prepare('SELECT * FROM deliverables').all(),
    sessions: db.prepare('SELECT * FROM sessions').all()
  };
  res.setHeader('Content-Disposition', `attachment; filename="semester-${todayIso()}.json"`);
  res.json(payload);
}));

api.post('/import', h((req, res) => {
  const p = req.body;
  if (!p || !Array.isArray(p.courses)) throw new ApiError(400, 'Expected an export payload with a courses array');
  wipe();
  db.exec('BEGIN');
  try {
    const ins = (table, rows) => {
      for (const row of rows || []) {
        const cols = Object.keys(row);
        db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
          .run(...cols.map(k => row[k]));
      }
    };
    ins('courses', p.courses);
    ins('topics', p.topics);
    ins('deliverables', p.deliverables);
    ins('sessions', p.sessions);
    ins('capacity_overrides', p.overrides?.map(o => ({ on_date: o.date, hours: o.hours, reason: o.reason ?? null })));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw new ApiError(400, `Import failed: ${e.message}`); }
  if (Array.isArray(p.capacity)) writeCapacity(p.capacity);
  if (p.settings) writeSettings(p.settings);
  withState(res, { imported: p.courses.length });
}));

app.use('/api', api);

/* ---------- subscribable calendar feed ---------- */
app.get('/calendar.ics', (req, res, next) => {
  try {
    const model = repo.state(req.query.today ? String(req.query.today) : todayIso());
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="semester.ics"');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(buildIcs(model, { origin: req.get('host') || 'semester-control-deck' }));
  } catch (e) { next(e); }
});

/* ---------- frontend ---------- */
app.use(express.static(resolve(ROOT, 'public'), { extensions: ['html'], maxAge: '1h' }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(resolve(ROOT, 'public', 'index.html'));
});

/* ---------- errors ---------- */
app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found', path: req.path }));
app.use((err, req, res, _next) => {
  const status = err instanceof ApiError ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ ok: false, error: err.message || 'Something went wrong', field: err.field });
});

const server = app.listen(PORT, () => {
  console.log('');
  console.log('  Semester Control Deck');
  console.log(`  ▸ app       http://localhost:${PORT}`);
  console.log(`  ▸ api       http://localhost:${PORT}/api/state`);
  console.log(`  ▸ calendar  http://localhost:${PORT}/calendar.ics`);
  console.log(`  ▸ database  ${DB_PATH}`);
  if (seeded) console.log(`  ▸ seeded    ${seeded.courses} courses, ${seeded.sessions} study sessions`);
  console.log('');
});

const shutdown = () => { server.close(() => { try { db.close(); } catch {} process.exit(0); }); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { app, server };
