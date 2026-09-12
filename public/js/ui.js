/** Formatting, small components and the toast stack. */

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ---------- dates (UTC, to match the server) ---------- */
export const parseDate = s => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) ? d : null;
};
export const isoDate = d => d ? d.toISOString().slice(0, 10) : null;
export const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
export const dayDiff = (a, b) => Math.round((b - a) / 86400000);
export const weekStartOf = d => addDays(d, -((d.getUTCDay() + 6) % 7));
export const localToday = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};
export const fmtLong = s => { const d = parseDate(s); return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '—'; };
export const fmtShort = s => { const d = parseDate(s); return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}` : '—'; };
export const fmtDay = s => { const d = parseDate(s); return d ? `${WEEKDAYS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}` : '—'; };

/* ---------- numbers ---------- */
export const round1 = n => Math.round(n * 10) / 10;
export const hrs = n => `${round1(n)} h`;
export const pct = n => `${Math.round(n * 100)}%`;
export const clock = mins => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`;

/* ---------- html ---------- */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const attr = s => esc(s);

/* ---------- icons ---------- */
const PATHS = {
  dash: '<path d="M3 13h6V3H3zM13 21h8V11h-8zM13 7h8V3h-8zM3 21h6v-4H3z"/>',
  courses: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 4v16"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  planner: '<path d="M4 19V5M4 19h16"/><path d="M8 16V9M12 16v-4M16 16v-8"/>',
  areas: '<circle cx="8" cy="8" r="4"/><circle cx="16" cy="16" r="4"/><path d="M12 8h4M8 12v4"/>',
  log: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.6 1.6 0 008 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H2a2 2 0 110-4h.1A1.6 1.6 0 004.6 8a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V2a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H22a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
  warn: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>'
};
export const icon = (name, cls = 'ic') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;

/* ---------- shared fragments ---------- */
export function riskChip(risk) {
  if (!risk) return '';
  if (risk.key === 'tbd') return `<span class="chip tbd"><span class="g"></span>Date TBD</span>`;
  return `<span class="chip ${risk.key}"><span class="g"></span>${esc(risk.label)}${risk.provisional ? ' · est.' : ''}</span>`;
}

export function dateChip(course) {
  if (course.dateState === 'none') return `<span class="chip none">No exam</span>`;
  if (course.dateState === 'tbd') {
    return `<span class="chip tbd"><span class="g"></span>${course.estimatedDate ? `Expected ${fmtShort(course.estimatedDate)}` : 'Exam date TBD'}</span>`;
  }
  return `<span class="chip plain">${fmtLong(course.examDate)}</span>`;
}

export function meter(fraction, shortfallFraction = 0) {
  const a = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  const b = Math.round(Math.max(0, Math.min(1 - fraction, shortfallFraction)) * 100);
  return `<span class="meter" role="img" aria-label="${a}% prepared"><i style="width:${a}%"></i><i class="gap" style="width:${b}%"></i></span>`;
}

export const sevClass = risk =>
  risk?.key === 'crit' ? 'sev sev-crit' : risk?.key === 'high' ? 'sev sev-high' : risk?.key === 'mod' ? 'sev sev-mod' : 'sev';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--accent)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
export function colourFor(courseIds) {
  const map = {};
  courseIds.forEach((id, i) => map[id] = SERIES[i % SERIES.length]);
  return id => map[id] || 'var(--ink-3)';
}

/* ---------- toasts ---------- */
const host = () => document.getElementById('toasts');

export function toast(message, { error = false, ms = 4200, action } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' err' : ''}`;
  el.innerHTML = `<span class="tx">${esc(message)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { el.remove(); action.run(); });
    el.append(b);
  }
  host().append(el);
  const kill = setTimeout(() => el.remove(), ms);
  el.addEventListener('click', e => { if (e.target === el) { clearTimeout(kill); el.remove(); } });
  return el;
}

/* ---------- dialog scaffolding ---------- */
let closeCurrent = null;

export function openSheet(html, { onMount, label = 'Dialog' } = {}) {
  closeSheet();
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${attr(label)}">${html}</div>`;
  document.getElementById('sheetHost').append(scrim);
  document.body.style.overflow = 'hidden';

  const onKey = e => { if (e.key === 'Escape') closeSheet(); };
  scrim.addEventListener('mousedown', e => { if (e.target === scrim) closeSheet(); });
  document.addEventListener('keydown', onKey);

  closeCurrent = () => {
    document.removeEventListener('keydown', onKey);
    scrim.remove();
    document.body.style.overflow = '';
    closeCurrent = null;
  };
  onMount?.(scrim.querySelector('.sheet'));
  return scrim;
}

export function closeSheet() { closeCurrent?.(); }
export const sheetIsOpen = () => !!closeCurrent;

/** Replace a sheet's contents without losing the scroll position or focus. */
export function refreshSheet(html, onMount) {
  const sheet = document.querySelector('#sheetHost .sheet');
  if (!sheet) return;
  const activeId = document.activeElement?.id;
  const caret = (() => { try { return document.activeElement?.selectionStart ?? null; } catch { return null; } })();
  const scrollTop = sheet.closest('.scrim')?.scrollTop ?? 0;
  sheet.innerHTML = html;
  onMount?.(sheet);
  if (sheet.closest('.scrim')) sheet.closest('.scrim').scrollTop = scrollTop;
  if (activeId) {
    const back = document.getElementById(activeId);
    if (back) {
      back.focus();
      if (caret != null) { try { back.setSelectionRange(caret, caret); } catch {} }
    }
  }
}

export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    openSheet(`
      <header><h2>${esc(title)}</h2></header>
      <div class="sbody"><p>${body}</p></div>
      <footer>
        <button class="btn ${danger ? 'danger' : 'pri'}" type="button" data-yes>${esc(confirmLabel)}</button>
        <button class="btn" type="button" data-no>Cancel</button>
      </footer>`, {
      label: title,
      onMount(sheet) {
        sheet.querySelector('[data-yes]').focus();
        sheet.querySelector('[data-yes]').addEventListener('click', () => { closeSheet(); resolve(true); });
        sheet.querySelector('[data-no]').addEventListener('click', () => { closeSheet(); resolve(false); });
      }
    });
  });
}
