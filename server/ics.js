/**
 * iCalendar feed — subscribe to the semester from Google Calendar, Outlook or
 * Apple Calendar.
 *
 * The three date states carry through: confirmed exams get an event with real
 * alarms, expected dates get an event flagged TENTATIVE with no alarms, and a
 * TBD with no expected date produces nothing at all.
 */
import { fmtLong } from './engine.js';

const fold = line => {
  // RFC 5545: lines longer than 75 octets are folded with a leading space
  const out = [];
  let s = line;
  while (s.length > 73) { out.push(s.slice(0, 73)); s = ' ' + s.slice(73); }
  out.push(s);
  return out.join('\r\n');
};

const escapeText = s => String(s ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

const compact = d => String(d).replace(/-/g, '');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function nextDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildIcs(model, { origin = 'semester-control-deck' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Semester Control Deck//${escapeText(model.settings.semester)}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(model.settings.semester)}`,
    'X-WR-TIMEZONE:UTC',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H'
  ];

  const push = ({ uid, date, summary, description, tentative, alarms = [], categories }) => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}@${origin}`);
    lines.push(`DTSTAMP:${stamp()}`);
    lines.push(`DTSTART;VALUE=DATE:${compact(date)}`);
    lines.push(`DTEND;VALUE=DATE:${compact(nextDay(date))}`);
    lines.push(fold(`SUMMARY:${escapeText(summary)}`));
    if (description) lines.push(fold(`DESCRIPTION:${escapeText(description)}`));
    if (categories) lines.push(`CATEGORIES:${escapeText(categories)}`);
    lines.push(`STATUS:${tentative ? 'TENTATIVE' : 'CONFIRMED'}`);
    lines.push('TRANSP:TRANSPARENT');
    for (const days of alarms) {
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`TRIGGER:-P${days}D`);
      lines.push(fold(`DESCRIPTION:${escapeText(`${days} days to ${summary}`)}`));
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  };

  for (const c of model.courses) {
    if (c.schedule.date) {
      const firm = c.schedule.firm;
      const detail = [
        `${c.credits} ECTS · ${c.assessment}`,
        firm ? `Confirmed for ${fmtLong(c.schedule.date)}` : `EXPECTED date only — not yet announced`,
        `Preparation: ${c.prepDoneHours} h done of ${c.prepEstimateHours} h`,
        c.deficitHours > 0.5 ? `Short ${c.deficitHours} h against the study plan` : `The study plan covers the remaining hours`,
        `Risk: ${c.risk.label}`
      ].join('\n');
      push({
        uid: `exam-${c.id}`, date: c.schedule.date,
        summary: firm ? `EXAM · ${c.name}` : `Expected exam · ${c.name}`,
        description: detail, tentative: !firm,
        categories: firm ? 'EXAM' : 'EXAM,TENTATIVE',
        alarms: firm ? (model.settings.examReminders || []) : []
      });
    }
    for (const d of c.deliverables) {
      if (!d.dueDate) continue;                       // deadline TBD → no event
      push({
        uid: `deliverable-${d.id}`, date: d.dueDate,
        summary: `${d.submitted ? '✓ ' : 'DUE · '}${d.title} — ${c.name}`,
        description: `${d.kind} · ${d.estHours} h estimated · ${d.loggedHours} h logged${d.submitted ? '\nSubmitted' : ''}`,
        tentative: false, categories: 'DEADLINE',
        alarms: d.submitted ? [] : (model.settings.workReminders || [])
      });
    }
  }

  // milestones only exist for confirmed exams, so they are safe to publish
  for (const e of model.events.filter(x => x.type === 'milestone' && x.milestoneKind === 'phase')) {
    push({
      uid: `milestone-${e.courseId}-${e.date}-${e.note.slice(0, 12).replace(/\W/g, '')}`,
      date: e.date, summary: `Prep · ${e.title}`, description: 'Preparation milestone',
      tentative: false, categories: 'MILESTONE'
    });
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
