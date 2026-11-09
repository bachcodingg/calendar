# Semester Control Deck

An exam and coursework planner. Each course has one of three date states, a study planner splits your available hours across courses, and a ledger records the study time you actually logged.

- **confirmed**: a real exam date, with a countdown, reminders, milestones and risk
- **tbd**: no date yet. It is never counted down. An optional expected date is used for provisional planning and is labelled as such
- **none**: no exam at all. The course is managed through its deliverables only

## Tech stack

- Node.js 22.5+ (uses the built-in `node:sqlite`, so no database server is needed)
- Express 4
- Plain HTML, CSS and JavaScript frontend in `public/`

## Run locally

```bash
npm install
npm run dev      # restarts on file changes
# or
npm start
```

Then open http://localhost:4173.

On first start the database is created in `data/deck.db` and seeded with a sample semester.

| Command        | What it does                                   |
|----------------|------------------------------------------------|
| `npm start`    | Start the server                               |
| `npm run dev`  | Start the server and restart on file changes   |
| `npm run seed` | Reset the database to the sample semester      |
| `npm test`     | Run the planning engine tests                  |

### Environment variables

| Variable  | Default        | Purpose                  |
|-----------|----------------|--------------------------|
| `PORT`    | `4173`         | HTTP port                |
| `DECK_DB` | `data/deck.db` | Path to the SQLite file  |

## Endpoints

- `GET /api/state`: the full planner state used by the UI
- `GET /api/plan`, `GET /api/analytics`, `GET /api/activity`
- `/api/courses`, `/api/topics`, `/api/deliverables`, `/api/sessions`, `/api/capacity`, `/api/settings`: CRUD
- `POST /api/whatif`: preview a date change without saving it
- `GET /calendar.ics`: a subscribable calendar feed of exams and milestones

## Project layout

```
server/
  index.js    Express app and API routes
  engine.js   Planning engine (pure functions, no I/O)
  db.js       SQLite schema and migrations
  repo.js     Data access
  ics.js      Calendar feed
  seed.js     Sample semester
public/       Frontend
test/         Engine tests (node --test)
```
