/**
 * Seed the semester.
 *
 * Runs automatically on first start (when the courses table is empty) and can
 * be re-run with `npm run seed` to wipe back to these defaults.
 *
 * Completed preparation is NOT a stored number here — it is the sum of the
 * study sessions below, so the ledger and the dashboard can never disagree.
 */
import { db, migrate, writeCapacity, writeSettings, DEFAULT_CAPACITY, DEFAULT_SETTINGS, nowIso, logActivity } from './db.js';

const COURSES = [
  {
    id: 'c01', name: 'Integral Calculus', credits: 3, assessment: 'Exam',
    dateState: 'confirmed', examDate: '2026-10-07', subjectArea: 'Mathematics', prep: 24,
    topics: [
      ['Antiderivatives', true], ['Definite integrals', true], ['Integration by parts', false],
      ['Partial fractions', false], ['Improper integrals', false], ['Area & volume applications', false]
    ]
  },
  {
    id: 'c02', name: 'Functional Programming', credits: 3, assessment: 'Exam',
    dateState: 'confirmed', examDate: '2026-10-08', subjectArea: 'Computer Science', prep: 20,
    topics: [
      ['Higher-order functions', true], ['Recursion & induction', true], ['Algebraic data types', false],
      ['Type classes', false], ['Lazy evaluation', false], ['Monads', false]
    ]
  },
  {
    id: 'c03', name: 'Matrix Algebra', credits: 5, assessment: 'Exam',
    dateState: 'confirmed', examDate: '2026-10-21', subjectArea: 'Mathematics', prep: 34,
    topics: [
      ['Gaussian elimination', true], ['Vector spaces', true], ['Linear maps', false], ['Determinants', false],
      ['Eigenvalues & eigenvectors', false], ['Diagonalisation', false], ['Orthogonality & least squares', false]
    ]
  },
  {
    id: 'c04', name: 'Statistic II', credits: 3, assessment: 'Exam',
    dateState: 'confirmed', examDate: '2026-11-02', subjectArea: 'Mathematics', prep: 22,
    topics: [
      ['Point estimators', false], ['Confidence intervals', false], ['Hypothesis testing', false],
      ['ANOVA', false], ['Linear regression', false], ['Nonparametric tests', false]
    ]
  },
  {
    id: 'c05', name: 'Differential Calculus', credits: 3, assessment: 'Exam',
    dateState: 'tbd', subjectArea: 'Mathematics', prep: 20,
    topics: [
      ['Limits', true], ['Derivatives', false], ['Applications of derivatives', false],
      ['Optimization', false], ['Related rates', false], ['Curve analysis', false]
    ]
  },
  {
    id: 'c06', name: 'Fundamental of AI', credits: 6, assessment: 'Exam',
    dateState: 'confirmed', examDate: '2026-12-22', subjectArea: 'Computer Science', prep: 40,
    topics: [
      ['Search & heuristics', false], ['Knowledge representation', false], ['Probabilistic reasoning', false],
      ['Machine learning basics', false], ['Neural networks', false], ['Ethics & AI safety', false]
    ]
  },
  {
    id: 'c07', name: 'Computer Networks II', credits: 3, assessment: 'Exam',
    dateState: 'tbd', subjectArea: 'Computer Science', prep: 24,
    topics: [
      ['Routing protocols', false], ['TCP congestion control', false], ['Network security', false],
      ['QoS & traffic shaping', false], ['Software-defined networking', false], ['Wireless & mobile', false]
    ]
  },
  {
    id: 'c08', name: 'Managing Digital Transformation', credits: 6, assessment: 'Exercises / Coursework',
    dateState: 'none', subjectArea: 'Digital Business', prep: 0, topics: [],
    deliverables: [
      ['d08a', 'Case study analysis', 'assignment', '2026-10-16', 10],
      ['d08b', 'Group presentation', 'presentation', '2026-11-13', 8],
      ['d08c', 'Final portfolio', 'portfolio', '2026-12-18', 14]
    ]
  },
  {
    id: 'c09', name: 'User-Centric Engineering', credits: 6, assessment: 'Exercises / Coursework',
    dateState: 'none', subjectArea: 'Digital Business', prep: 0, topics: [],
    deliverables: [
      ['d09a', 'Personas & journey map', 'exercise', '2026-10-09', 6],
      ['d09b', 'Prototype v1', 'project', '2026-10-30', 12],
      ['d09c', 'Usability test report', 'report', '2026-11-27', 10],
      ['d09d', 'Final design hand-in', 'project', '2027-01-15', 12]
    ]
  },
  {
    id: 'c10', name: 'Impact and Benefits of Digitalization', credits: 6, assessment: 'Coursework',
    dateState: 'none', subjectArea: 'Digital Business', prep: 0, topics: [],
    deliverables: [
      ['d10a', 'Literature review', 'report', '2026-11-06', 8],
      // deadline not announced yet — the coursework equivalent of a TBD exam
      ['d10b', 'Final report', 'report', null, 18]
    ]
  }
];

/** The study ledger behind the "preparation completed" figures. */
const SESSIONS = [
  ['c01', null, '2026-09-01', 90, 'Chapter 1 — antiderivatives'],
  ['c01', null, '2026-09-04', 120, 'Integration by parts drills'],
  ['c01', null, '2026-09-08', 90, 'Partial fractions'],
  ['c01', null, '2026-09-11', 60, 'Review sheet'],
  ['c02', null, '2026-09-02', 90, 'Higher-order functions'],
  ['c02', null, '2026-09-05', 120, 'Recursion exercises'],
  ['c02', null, '2026-09-09', 90, 'Induction proofs'],
  ['c03', null, '2026-09-01', 120, 'Gaussian elimination'],
  ['c03', null, '2026-09-03', 120, 'Vector spaces'],
  ['c03', null, '2026-09-07', 120, 'Linear maps, first pass'],
  ['c03', null, '2026-09-10', 120, 'Determinants'],
  ['c04', null, '2026-09-06', 120, 'Estimators — first read'],
  ['c05', null, '2026-09-02', 120, 'Limits'],
  ['c05', null, '2026-09-09', 120, 'Derivative rules'],
  ['c06', null, '2026-09-05', 90, 'Search — intro lecture notes'],
  ['c06', null, '2026-09-10', 90, 'Heuristics'],
  ['c08', 'd08a', '2026-09-08', 120, 'Case study — background reading'],
  ['c09', 'd09a', '2026-09-03', 90, 'Stakeholder interviews'],
  ['c09', 'd09a', '2026-09-07', 90, 'Persona drafts']
];

export function isEmpty() {
  return db.prepare('SELECT COUNT(*) AS n FROM courses').get().n === 0;
}

export function wipe() {
  db.exec('BEGIN');
  try {
    for (const t of ['sessions', 'deliverables', 'topics', 'courses', 'capacity_overrides', 'capacity', 'settings', 'activity']) {
      db.exec(`DELETE FROM ${t}`);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function seed() {
  const at = nowIso();
  db.exec('BEGIN');
  try {
    const insCourse = db.prepare(`INSERT INTO courses
      (id, name, credits, assessment, date_state, exam_date, estimated_date, subject_area, prep_estimate_hours, position, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insTopic = db.prepare('INSERT INTO topics (id, course_id, name, done, position) VALUES (?,?,?,?,?)');
    const insDeliv = db.prepare(`INSERT INTO deliverables (id, course_id, title, kind, due_date, est_hours, submitted, position, created_at, updated_at)
                                 VALUES (?,?,?,?,?,?,0,?,?,?)`);
    const insSession = db.prepare('INSERT INTO sessions (id, course_id, deliverable_id, on_date, minutes, note, created_at) VALUES (?,?,?,?,?,?,?)');

    COURSES.forEach((c, i) => {
      insCourse.run(c.id, c.name, c.credits, c.assessment, c.dateState,
        c.examDate ?? null, c.estimatedDate ?? null, c.subjectArea ?? null, c.prep ?? 0, i, at, at);
      (c.topics || []).forEach(([name, done], j) => insTopic.run(`${c.id}_t${j + 1}`, c.id, name, done ? 1 : 0, j));
      (c.deliverables || []).forEach(([id, title, kind, due, est], j) =>
        insDeliv.run(id, c.id, title, kind, due, est, j, at, at));
    });

    SESSIONS.forEach(([courseId, deliverableId, date, minutes, note], i) =>
      insSession.run(`s_seed${String(i + 1).padStart(2, '0')}`, courseId, deliverableId, date, minutes, note, at));

    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  writeCapacity(DEFAULT_CAPACITY);
  writeSettings(DEFAULT_SETTINGS);
  logActivity({ kind: 'seed', summary: `Semester loaded — ${COURSES.length} courses, ${SESSIONS.length} study sessions` });
  return { courses: COURSES.length, sessions: SESSIONS.length };
}

export function ensureSeeded() {
  migrate();
  if (isEmpty()) return seed();
  return null;
}

/* run directly: node server/seed.js [--force] */
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  migrate();
  const force = process.argv.includes('--force');
  if (!isEmpty() && !force) {
    console.log('Database already has courses. Re-run with --force to wipe and reseed.');
    process.exit(0);
  }
  if (force) wipe();
  const r = seed();
  console.log(`Seeded ${r.courses} courses and ${r.sessions} study sessions.`);
}
