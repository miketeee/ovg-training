// storage.js — everything this phone keeps, in IndexedDB.
// Nothing here is ever sent anywhere except by sync.js.

const DB_NAME = 'ovg';
const DB_VERSION = 1;

// store name → key field
export const STORES = {
  content: 'name',       // guide markdown + JSON files from the Sheet (Stage 3)
  images: 'key',         // cached illustrations, key = exercise_id|figure (Stage 3)
  sessions: 'id',        // workouts
  sets: 'id',            // sets inside workouts
  outbox: 'id',          // records waiting to be sent to the Sheet
  settings: 'key',       // settings that sync to the Sheet (units, effort scale…)
  checkpoints: 'key',    // resume points: last sync, upload progress…
  device: 'key',         // /exec URL + secret phrase — NEVER synced
};

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) { reject(new Error('This browser has no offline storage.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const os = db.createObjectStore(name, { keyPath });
        if (name === 'sets') os.createIndex('session_id', 'session_id');
        if (name === 'sessions') os.createIndex('date', 'date');
        if (name === 'outbox') os.createIndex('queued_at', 'queued_at');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close(); // let a newer tab upgrade
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Could not open storage.'));
    req.onblocked = () => reject(new Error('Storage is busy in another tab. Close other tabs of this site.'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage write cancelled.'));
  });
}
function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get(store, key) {
  const db = await openDB();
  return result(db.transaction(store).objectStore(store).get(key));
}
export async function all(store) {
  const db = await openDB();
  return result(db.transaction(store).objectStore(store).getAll());
}
export async function count(store) {
  const db = await openDB();
  return result(db.transaction(store).objectStore(store).count());
}
export async function byIndex(store, index, value) {
  const db = await openDB();
  return result(db.transaction(store).objectStore(store).index(index).getAll(value));
}
export async function put(store, value) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}
export async function del(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}
export async function clear(store) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return done(tx);
}

/**
 * Several writes that must all happen or none happen.
 * ops: [{ store, put: value } | { store, del: key }]
 */
export async function batch(ops) {
  const db = await openDB();
  const names = [...new Set(ops.map(o => o.store))];
  const tx = db.transaction(names, 'readwrite');
  for (const o of ops) {
    const os = tx.objectStore(o.store);
    if ('put' in o) os.put(o.put); else os.delete(o.del);
  }
  return done(tx);
}

/**
 * Delete records only if they haven't changed since we read them
 * (field `field` still equals the value we saw). Runs in one transaction.
 * items: [{ key, value }] — returns how many were deleted.
 */
export async function delIfUnchanged(store, field, items) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  let n = 0;
  for (const it of items) {
    const req = os.get(it.key);
    req.onsuccess = () => { if (req.result && req.result[field] === it.value) { os.delete(it.key); n++; } };
  }
  await done(tx);
  return n;
}

// Small key/value helpers
export async function getValue(store, key, fallback = null) {
  try { const row = await get(store, key); return row ? row.value : fallback; }
  catch { return fallback; }
}
export function setValue(store, key, value) {
  return put(store, { key, value, updated_at: new Date().toISOString() });
}

/** Unique id that never repeats, even across phones: <prefix>-<time>-<random> */
export function newId(prefix) {
  const rand = (self.crypto && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

/** Ask the browser not to clear our data when space runs low. */
export async function askPersistent() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* not supported */ }
  return false;
}
