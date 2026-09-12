/**
 * Thin API client.
 *
 * Every mutating endpoint answers with the freshly recomputed model, so the
 * client never recalculates anything the server already knows — it just redraws.
 */

const listeners = new Set();
export const onState = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export const store = {
  state: null,      // the computed model from /api/state
  activity: [],
  connected: false,
  busy: 0
};

function publish() { for (const fn of listeners) fn(store); }

export class ApiFailure extends Error {
  constructor(message, status, field) { super(message); this.status = status; this.field = field; }
}

async function request(method, path, body) {
  store.busy++;
  publish();
  try {
    const res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch { throw new ApiFailure('The server sent something this page could not read.', res.status); }

    if (!res.ok || payload.ok === false) {
      throw new ApiFailure(payload.error || `Request failed (${res.status})`, res.status, payload.field);
    }

    // any response carrying a fresh model updates the store
    if (payload.state) {
      store.state = payload.state;
      store.connected = true;
    }
    if (payload.activity) store.activity = payload.activity;
    return payload;
  } catch (e) {
    if (e instanceof ApiFailure) throw e;
    store.connected = false;
    throw new ApiFailure('Cannot reach the server. Is it still running?', 0);
  } finally {
    store.busy--;
    publish();
  }
}

export const api = {
  /* read */
  load: () => request('GET', '/state'),
  health: () => request('GET', '/health'),
  sessions: (q = {}) => request('GET', '/sessions?' + new URLSearchParams(q)),
  activity: (limit = 40) => request('GET', `/activity?limit=${limit}`),

  /* courses */
  createCourse: body => request('POST', '/courses', body),
  updateCourse: (id, body) => request('PATCH', `/courses/${id}`, body),
  deleteCourse: id => request('DELETE', `/courses/${id}`),

  /* the TBD → confirmed transition */
  setDate: (id, date, mode = 'confirmed') => request('POST', `/courses/${id}/date`, { date, mode }),
  clearDate: id => request('DELETE', `/courses/${id}/date`),
  whatIf: (courseId, date, mode = 'confirmed') => request('POST', '/whatif', { courseId, date, mode }),

  /* topics */
  addTopic: (courseId, name) => request('POST', `/courses/${courseId}/topics`, { name }),
  updateTopic: (id, body) => request('PATCH', `/topics/${id}`, body),
  deleteTopic: id => request('DELETE', `/topics/${id}`),

  /* deliverables */
  addDeliverable: (courseId, body) => request('POST', `/courses/${courseId}/deliverables`, body),
  updateDeliverable: (id, body) => request('PATCH', `/deliverables/${id}`, body),
  deleteDeliverable: id => request('DELETE', `/deliverables/${id}`),

  /* study time */
  logSession: body => request('POST', '/sessions', body),
  deleteSession: id => request('DELETE', `/sessions/${id}`),

  /* capacity */
  setCapacity: capacity => request('PUT', '/capacity', { capacity }),
  setOverride: body => request('PUT', '/capacity/overrides', body),
  clearOverride: date => request('DELETE', `/capacity/overrides/${date}`),

  /* settings + housekeeping */
  updateSettings: patch => request('PATCH', '/settings', patch),
  undo: id => request('POST', `/activity/${id}/undo`),
  reset: () => request('POST', '/reset'),
  importData: payload => request('POST', '/import', payload)
};

export const notifyStateChanged = publish;
