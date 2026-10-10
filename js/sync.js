// sync.js — talks to your Apps Script (/exec URL) and runs the outbox.
// The /exec URL and secret phrase live only in this phone's `device` store.

import * as db from './storage.js';

const BATCH = 25;               // records per appendLogs call
const TIMEOUT_MS = 45000;       // Apps Script can be slow to wake up
const AUTO_EVERY_MS = 60000;    // retry waiting records once a minute while online

export class SyncError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

/* ---------- device config (never synced) ---------- */

export async function getConfig() {
  const [url, secret] = await Promise.all([
    db.getValue('device', 'exec_url', ''),
    db.getValue('device', 'secret', ''),
  ]);
  return { url, secret };
}

export function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch { return 'That isn’t a web address. Copy the Web app URL from Apps Script → Deploy.'; }
  if (u.protocol !== 'https:') return 'The address must start with https://';
  if (!/^script\.google(usercontent)?\.com$/.test(u.hostname)) return 'The address should be on script.google.com.';
  if (!/\/exec$/.test(u.pathname)) return u.pathname.endsWith('/dev')
    ? 'This is the /dev test address. Use the one that ends in /exec.'
    : 'The address must end in /exec.';
  return '';
}

export async function saveConfig(url, secret) {
  await db.batch([
    { store: 'device', put: { key: 'exec_url', value: url.trim(), updated_at: new Date().toISOString() } },
    { store: 'device', put: { key: 'secret', value: secret, updated_at: new Date().toISOString() } },
  ]);
  emit({});
}

export async function forgetDevice() {
  await db.clear('device');
  await db.del('checkpoints', 'sync');
  emit({ state: 'setup' });
}

/* ---------- one request ---------- */

export async function call(action, params = {}, cfg) {
  const { url, secret } = cfg || await getConfig();
  if (!url || !secret) throw new SyncError('setup', 'Sync isn’t set up yet.');
  if (!navigator.onLine) throw new SyncError('offline', 'This phone is offline.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    // text/plain + JSON body = a "simple" request, so the browser sends no CORS preflight.
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...params, action, secret }),
      signal: ctrl.signal,
      cache: 'no-store',
      redirect: 'follow',
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new SyncError('timeout', 'The Sheet took too long to answer. Try again.');
    throw new SyncError(navigator.onLine ? 'network' : 'offline',
      navigator.onLine ? 'Couldn’t reach your Apps Script. Check the /exec URL.' : 'This phone is offline.');
  } finally { clearTimeout(timer); }

  let body;
  try { body = await res.json(); }
  catch { throw new SyncError('server', 'Apps Script sent back something that isn’t data. Is the deployment set to “Anyone”?'); }
  if (!body.ok) {
    if (/unauthori[sz]ed/i.test(body.error || '')) throw new SyncError('unauthorized', 'Your Sheet rejected the secret phrase.');
    throw new SyncError('server', body.error || 'Apps Script reported an error.');
  }
  return body;
}

export async function ping(cfg) { return call('ping', {}, cfg); }

/* ---------- outbox ---------- */

/**
 * Save records on the phone AND queue them for the Sheet, in one step.
 * items: [{ kind: 'session' | 'set', record }]
 */
export async function queue(items) {
  const now = new Date().toISOString();
  const ops = [];
  for (const { kind, record } of items) {
    if (!record.id) throw new Error('Every record needs an id.');
    const rec = { created_at: now, ...record, updated_at: now };
    ops.push({ store: kind === 'session' ? 'sessions' : 'sets', put: rec });
    // v = a unique version stamp, so a confirmation for an older copy never removes a newer edit
    ops.push({ store: 'outbox', put: { id: `${kind}:${rec.id}`, kind, record: rec, queued_at: now, v: db.newId('v'), attempts: 0 } });
  }
  await db.batch(ops);
  await refresh();
  syncSoon();
}

export async function waiting() {
  const [items, dirty] = await Promise.all([db.all('outbox'), db.getValue('checkpoints', 'settings.dirty', [])]);
  const settings = (dirty || []).length;
  return {
    total: items.length + settings,
    sets: items.filter(i => i.kind === 'set').length,
    sessions: items.filter(i => i.kind === 'session').length,
    settings, // ladder marks, units, etc. not yet in the Sheet
  };
}

async function flush(cfg) {
  // Sessions before sets, oldest first, so a set never arrives before its workout.
  const items = (await db.all('outbox'))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'session' ? -1 : 1) || a.queued_at.localeCompare(b.queued_at));
  const total = items.length;
  let sent = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    emit({ state: 'sending', done: sent, total });
    let res;
    try {
      res = await call('upsertLogs', {
      sessions: chunk.filter(c => c.kind === 'session').map(c => c.record),
      sets: chunk.filter(c => c.kind === 'set').map(c => c.record),
      }, cfg);
    } catch (e) {
      if (/Unknown action: upsertLogs/.test(e.message)) throw new SyncError('outdated',
        'Your Apps Script is the old version. Paste the new Code.gs, then Deploy → Manage deployments → Edit → Version: New version → Deploy.');
      throw e;
    }
    // accepted = new, updated = edit saved, skipped = the Sheet already has this (or a newer) version.
    // All three mean the record is safe to remove from the outbox.
    const ids = t => [...(t.accepted || []), ...(t.updated || []), ...(t.skipped || [])];
    const onServer = new Set(ids(res.sessions).map(id => 'session:' + id).concat(ids(res.sets).map(id => 'set:' + id)));
    // Remove what the Sheet confirmed — unless it was edited again while this request was out
    // (same outbox id, new version stamp v). That newer version stays and goes in the next batch.
    sent += await db.delIfUnchanged('outbox', 'v',
      chunk.filter(c => onServer.has(c.id)).map(c => ({ key: c.id, value: c.v })));
    const retry = chunk.filter(c => !onServer.has(c.id));
    for (const c of retry) {
      const cur = await db.get('outbox', c.id);
      if (cur && cur.v === c.v) await db.put('outbox', { ...cur, attempts: (cur.attempts || 0) + 1 });
    }
    await saveCheckpoint({ last_flush: new Date().toISOString() });
  }
  return { sent, total };
}

/* ---------- pull (other phones / the Sheet → this phone) ---------- */

function clean(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = v === '' ? null : v;
  // Sheets turns "2026-10-10" into a date; bring it back to the phone's own day.
  if (out.date && String(out.date).includes('T')) {
    const d = new Date(out.date);
    if (!isNaN(d)) out.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (out.deleted === 'TRUE' || out.deleted === 'true') out.deleted = true;
  return out;
}

async function pull(cfg) {
  const cp = await getCheckpoint();
  emit({ state: 'pulling' });
  const res = await call('getLogs', cp.logs_since ? { since: cp.logs_since } : {}, cfg);
  const pending = new Set((await db.all('outbox')).map(i => i.id));
  const ops = [];
  for (const [kind, store, rows] of [['session', 'sessions', res.sessions], ['set', 'sets', res.sets]]) {
    for (const row of rows || []) {
      if (!row.id || pending.has(`${kind}:${row.id}`)) continue; // our unsent edit wins
      const incoming = clean(row);
      const mine = await db.get(store, incoming.id);
      if (mine && String(mine.updated_at || '') > String(incoming.updated_at || '')) continue; // ours is newer
      ops.push({ store, put: incoming });
    }
  }
  if (ops.length) await db.batch(ops);
  await saveCheckpoint({ logs_since: res.server_time, last_pull: new Date().toISOString() });
  return { received: ops.length };
}

/** Save a setting on this phone and send it to the Sheet (now, or at the next sync if offline). */
export async function saveSetting(key, value) {
  await db.setValue('settings', key, value);
  const dirty = new Set(await db.getValue('checkpoints', 'settings.dirty', []));
  dirty.add(key);
  await db.setValue('checkpoints', 'settings.dirty', [...dirty]);
  let sent = false;
  try { sent = await pushSettings(); } catch { /* sent at the next sync */ }
  await refresh();
  if (!sent) syncSoon();
  return sent; // true = already in the Sheet; false = waiting on this phone
}

/** Send settings changed on this phone. Returns true when nothing is left waiting. */
async function pushSettings(cfg) {
  const keys = await db.getValue('checkpoints', 'settings.dirty', []);
  if (!keys.length) return true;
  const settings = {};
  for (const k of keys) settings[k] = await db.getValue('settings', k, '');
  await call('setSettings', { settings }, cfg);
  // Keep any key that changed again while this request was out.
  const still = [];
  for (const k of await db.getValue('checkpoints', 'settings.dirty', [])) {
    if (!(k in settings) || (await db.getValue('settings', k, '')) !== settings[k]) still.push(k);
  }
  if (still.length) await db.setValue('checkpoints', 'settings.dirty', still);
  else await db.del('checkpoints', 'settings.dirty');
  return !still.length;
}

async function pullSettings(cfg) {
  const res = await call('getSettings', {}, cfg);
  const now = new Date().toISOString();
  const dirty = new Set(await db.getValue('checkpoints', 'settings.dirty', []));
  const ops = Object.entries(res.settings || {}).filter(([key]) => !dirty.has(key)) // unsent local change wins
    .map(([key, value]) => ({ store: 'settings', put: { key, value, updated_at: now } }));
  if (ops.length) await db.batch(ops);
}

/* ---------- checkpoints ---------- */

export async function getCheckpoint() {
  return (await db.getValue('checkpoints', 'sync', null)) || {};
}
async function saveCheckpoint(patch) {
  const cur = await getCheckpoint();
  await db.setValue('checkpoints', 'sync', { ...cur, ...patch });
}

/* ---------- status + running a sync ---------- */

const bus = new EventTarget();
let last = { state: 'idle' };
/** Listen for status changes. Returns a function that stops listening. */
export function onStatus(fn) {
  const h = e => fn(e.detail);
  bus.addEventListener('status', h);
  fn(last);
  return () => bus.removeEventListener('status', h);
}
function emit(patch) {
  last = { ...last, ...patch };
  bus.dispatchEvent(new CustomEvent('status', { detail: last }));
}

/** Recompute the resting status (no network). */
export async function refresh() {
  const [cfg, w, cp] = await Promise.all([getConfig(), waiting(), getCheckpoint()]);
  const busy = last.state === 'sending' || last.state === 'pulling';
  let state = busy ? last.state : 'synced';
  if (!cfg.url || !cfg.secret) state = 'setup';
  else if (!busy && (last.state === 'error' || last.state === 'unauthorized')) state = last.state;
  else if (!busy && !navigator.onLine) state = 'offline';
  else if (!busy && w.total) state = 'waiting';
  emit({ state, waiting: w, last_sync: cp.last_pull || cp.last_flush || null });
  return last;
}

const fullHooks = [];
/** Run extra work (e.g. downloading changed book content) at the end of every full sync. */
export function onFullSync(fn) { fullHooks.push(fn); }

let running = null;
/**
 * Send the outbox, then pull new logs. `full` also pulls settings.
 * Only one sync runs at a time; a second call joins the first.
 */
let again = null; // a sync asked for while one was running: run once more afterwards
export function syncNow({ full = false } = {}) {
  if (running) {
    // Records saved during a running sync would otherwise wait for the next trigger.
    again = { full: full || again?.full || false };
    return running.then(() => last);
  }
  running = (async () => {
    try {
      const cfg = await getConfig();
      if (cfg.url && cfg.secret && navigator.onLine) {
        const f = await flush(cfg);
        await pushSettings(cfg); // every sync sends changed settings (e.g. ladder marks made offline)
        const p = await pull(cfg);
        if (full) {
          await pullSettings(cfg); // after the push, so the pull can't undo a change made here
          for (const fn of fullHooks) { emit({ state: 'pulling' }); await fn(cfg); }
        }
        emit({ state: 'synced', message: '', sent: f.sent, received: p.received });
      }
    } catch (e) {
      const kind = e.kind || 'error';
      emit({ state: kind === 'unauthorized' ? 'unauthorized' : kind === 'offline' ? 'offline' : 'error', message: e.message });
    }
    try { await refresh(); } // keeps an error visible; otherwise settles on synced / waiting / offline
    finally { running = null; }
    if (again && last.state !== 'error' && last.state !== 'unauthorized' && last.state !== 'offline') {
      const next = again; again = null;
      return syncNow(next);
    }
    again = null;
    return last;
  })();
  return running;
}

let soonTimer = null;
function syncSoon() {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => syncNow(), 400);
}

/** Start background syncing: on launch, when back online, when the app is reopened, and every minute if records wait. */
export function startAuto() {
  addEventListener('online', () => { last.state = 'idle'; syncNow(); });
  addEventListener('offline', () => refresh());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(async () => {
    if (navigator.onLine && document.visibilityState === 'visible' && (await waiting()).total) syncNow();
  }, AUTO_EVERY_MS);
  refresh().then(() => syncNow({ full: true }));
}

/** Clear a stuck error so the next sync can try again. */
export function clearError() { if (last.state === 'error' || last.state === 'unauthorized') last.state = 'idle'; }
