// content.js — the book content (guide + data files) and pictures.
// Content lives in your Google Sheet and is copied to this phone for offline use.
// It is never part of the website's files on GitHub.

import * as db from './storage.js';
import { call, SyncError } from './sync.js';

const CHUNK = 40000;              // characters per putContent call (Sheet cell limit is 50,000)
export const DATA_FILES = ['exercises.json', 'methods.json', 'programs.json', 'levels.json'];

export const kindOf = name => (name.endsWith('.json') ? 'data' : 'guide');

/* ---------- reading what's on the phone ---------- */

/** All files on the phone, without their text: [{ name, kind, upload_id, updated_at, size }] */
export async function listFiles() {
  return (await db.all('content'))
    .map(({ data, ...meta }) => ({ ...meta, size: data ? data.length : 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getText(name) {
  const row = await db.get('content', name);
  return row ? row.data : null;
}

const jsonCache = new Map();
export async function getJSON(name) {
  if (jsonCache.has(name)) return jsonCache.get(name);
  const text = await getText(name);
  if (text == null) return null;
  const val = JSON.parse(text);
  jsonCache.set(name, val);
  return val;
}

async function saveLocal(rec) {
  jsonCache.delete(rec.name);
  await db.put('content', rec);
}

/* ---------- download (Sheet → phone) ---------- */

/**
 * Get every file that is new or changed in the Sheet, plus the picture links.
 * Files already current (same upload_id) are skipped, so a stopped download resumes where it left off.
 * onProgress({ done, total, name })
 */
export async function downloadChanged(onProgress = () => {}) {
  const manifest = await call('getContent');
  await mergeImageLinks(manifest.images || []);
  const pendingUp = new Set(((await uploadState())?.files || []).filter(f => !f.complete).map(f => f.name));
  const local = new Map((await listFiles()).map(f => [f.name, f]));
  const todo = (manifest.files || []).filter(f => !pendingUp.has(f.name) && local.get(f.name)?.upload_id !== f.upload_id);
  let done = 0;
  onProgress({ done, total: todo.length });
  for (const f of todo) {
    onProgress({ done, total: todo.length, name: f.name });
    const r = await call('getContent', { name: f.name });
    if (kindOf(f.name) === 'data') JSON.parse(r.data); // refuse to store a broken data file
    await saveLocal({ name: f.name, kind: r.kind || kindOf(f.name), upload_id: r.upload_id, updated_at: r.updated_at, data: r.data });
    onProgress({ done: ++done, total: todo.length, name: f.name });
  }
  await db.setValue('checkpoints', 'content.last_check', new Date().toISOString());
  return { checked: (manifest.files || []).length, downloaded: done };
}

/* ---------- upload (phone → Sheet), resumable ---------- */

/** Split text into chunks without cutting an emoji (surrogate pair) in half. */
export function chunk(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + CHUNK, text.length);
    const c = text.charCodeAt(end - 1);
    if (end < text.length && c >= 0xd800 && c <= 0xdbff) end--;
    out.push(text.slice(i, end));
    i = end;
  }
  return out.length ? out : [''];
}

/** Check chosen files before anything is saved. Returns { ok: [{name,text}], problems: [string] } */
export function checkFiles(files) {
  const ok = [], problems = [];
  for (const f of files) {
    if (!/\.(md|json)$/i.test(f.name)) { problems.push(`${f.name}: only .md and .json files can be added.`); continue; }
    if (/\.json$/i.test(f.name) && !DATA_FILES.includes(f.name)) { problems.push(`${f.name}: the data files are ${DATA_FILES.join(', ')}.`); continue; }
    if (f.name === 'PROGRESS.md') { problems.push('PROGRESS.md is a build note, not book content. Skipped.'); continue; }
    if (/\.json$/i.test(f.name)) { try { JSON.parse(f.text); } catch (e) { problems.push(`${f.name}: not valid JSON (${e.message}).`); continue; } }
    ok.push(f);
  }
  return { ok, problems };
}

export async function uploadState() {
  return db.getValue('checkpoints', 'content.upload', null);
}

/**
 * Save files on this phone, then start sending them to the Sheet.
 * files: [{ name, text }] (already checked)
 */
export async function startUpload(files) {
  const now = new Date().toISOString();
  const plan = { started_at: now, files: [] };
  const ops = [];
  for (const f of files) {
    const upload_id = db.newId('up');
    const parts = chunk(f.text);
    plan.files.push({ name: f.name, kind: kindOf(f.name), upload_id, total: parts.length, sent: [], complete: false });
    ops.push({ store: 'content', put: { name: f.name, kind: kindOf(f.name), upload_id, updated_at: now, data: f.text } });
  }
  ops.push({ store: 'checkpoints', put: { key: 'content.upload', value: plan, updated_at: now } });
  files.forEach(f => jsonCache.delete(f.name));
  await db.batch(ops);
}

/**
 * Send every chunk not yet confirmed. Safe to call again after a stop: it picks up where it left off.
 * onProgress({ done, total, name })
 */
export async function resumeUpload(onProgress = () => {}) {
  const plan = await uploadState();
  if (!plan) return { sent: 0 };
  const total = plan.files.reduce((n, f) => n + f.total, 0);
  let done = plan.files.reduce((n, f) => n + f.sent.length, 0);
  onProgress({ done, total });
  for (const f of plan.files) {
    if (f.complete) continue;
    const rec = await db.get('content', f.name);
    if (!rec || rec.upload_id !== f.upload_id) throw new SyncError('error', `${f.name} changed on this phone during the upload. Choose the files again.`);
    const parts = chunk(rec.data);
    for (let i = 0; i < parts.length; i++) {
      if (f.sent.includes(i)) continue;
      onProgress({ done, total, name: f.name });
      const r = await call('putContent', { name: f.name, kind: f.kind, upload_id: f.upload_id, chunk_index: i, total_chunks: parts.length, data: parts[i] });
      f.sent.push(i);
      if (r.complete) f.complete = true;
      await db.setValue('checkpoints', 'content.upload', plan); // checkpoint after every chunk
      onProgress({ done: ++done, total, name: f.name });
    }
    f.complete = true;
    await db.setValue('checkpoints', 'content.upload', plan);
  }
  await db.del('checkpoints', 'content.upload');
  return { sent: done, files: plan.files.length };
}

export async function cancelUpload() { await db.del('checkpoints', 'content.upload'); }

/* ---------- pictures ---------- */
// images store:
//   link rows  { key: 'exercise_id|figure', exercise_id, figure, page, drive_link, updated_at }
//   file rows  { key: 'file:<driveFileId>', mime, name, base64, saved_at }

export const imageKey = (exerciseId, figure) => `${exerciseId}|${figure}`;
export function fileId(link) {
  // Same rule as fileIdFromLink_ in Code.gs: /d/<id>, ?id=<id>, or a bare id (20+ characters)
  const t = String(link || '').trim();
  const m = t.match(/\/d\/([\w-]{20,})/) || t.match(/[?&]id=([\w-]{20,})/);
  return m ? m[1] : /^[\w-]{20,}$/.test(t) ? t : null;
}

async function mergeImageLinks(rows) {
  const ops = [];
  for (const r of rows) {
    if (!r.exercise_id || !r.figure) continue;
    ops.push({ store: 'images', put: { key: imageKey(r.exercise_id, r.figure), exercise_id: r.exercise_id, figure: r.figure, page: r.page, drive_link: r.drive_link || '', updated_at: r.updated_at } });
  }
  if (ops.length) await db.batch(ops);
}

/** Map of key → link row, plus a set of Drive file ids saved on this phone. */
export async function imageIndex() {
  const rows = await db.all('images');
  const links = new Map(), saved = new Set();
  for (const r of rows) {
    if (r.key.startsWith('file:')) saved.add(r.key.slice(5));
    else links.set(r.key, r);
  }
  return { links, saved };
}

/** Save one Drive link for several figure slots (one picture can serve several steps). */
export async function setImageLink(slots, driveLink) {
  const link = driveLink.trim();
  if (link && !fileId(link)) throw new SyncError('error', 'That doesn’t look like a Google Drive file link. In Drive, tap ⋮ → Share → Copy link.');
  const ops = [];
  for (const s of slots) {
    await call('setImageLink', { exercise_id: s.exercise_id, figure: s.figure, page: s.page, drive_link: link });
    ops.push({ store: 'images', put: { key: imageKey(s.exercise_id, s.figure), exercise_id: s.exercise_id, figure: s.figure, page: s.page, drive_link: link, updated_at: new Date().toISOString() } });
  }
  await db.batch(ops);
}

/** A picture as a data: URL — from this phone if saved, otherwise fetched once through your Apps Script. */
export async function loadImage(driveLink, { fetchIfMissing = true } = {}) {
  const id = fileId(driveLink);
  if (!id) return null;
  const hit = await db.get('images', 'file:' + id);
  if (hit) return `data:${hit.mime};base64,${hit.base64}`;
  if (!fetchIfMissing) return null;
  const r = await call('getImage', { drive_link: driveLink });
  await db.put('images', { key: 'file:' + id, mime: r.mime, name: r.name, base64: r.base64, saved_at: new Date().toISOString() });
  return `data:${r.mime};base64,${r.base64}`;
}

/**
 * Save every linked picture on this phone. Already-saved pictures are skipped,
 * so stopping and starting again picks up where it left off.
 */
export async function saveAllImages(onProgress = () => {}) {
  const { links, saved } = await imageIndex();
  const want = [...new Set([...links.values()].map(r => r.drive_link).filter(fileId))];
  const todo = want.filter(l => !saved.has(fileId(l)));
  let done = 0, failed = [];
  onProgress({ done, total: todo.length });
  for (const link of todo) {
    try { await loadImage(link); }
    catch (e) { if (e.kind === 'offline' || e.kind === 'unauthorized' || e.kind === 'setup') throw e; failed.push(link); }
    onProgress({ done: ++done, total: todo.length });
  }
  return { saved: done - failed.length, failed, already: want.length - todo.length };
}
