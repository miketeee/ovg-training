// log.js — workouts (sessions) and sets: saving, editing, history, and "move up" hints.
// Every change goes through sync.queue → saved on the phone first, then sent to the Sheet.

import * as db from './storage.js';
import * as sync from './sync.js';
import { today } from './ui.js';

const live = r => r && !r.deleted;
const byTime = (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''));

/* ---------- the workout in progress (a resume point on this phone) ---------- */

export async function activeId() {
  const id = await db.getValue('checkpoints', 'workout.active', null);
  if (!id) return null;
  const s = await db.get('sessions', id);
  return live(s) ? id : null;
}
export const setActive = id => db.setValue('checkpoints', 'workout.active', id);
export const finish = () => db.del('checkpoints', 'workout.active');

export async function start() {
  const now = new Date().toISOString();
  const rec = { id: db.newId('ses'), date: today(), started_at: now, plan_id: null, notes: '' };
  await sync.queue([{ kind: 'session', record: rec }]);
  await setActive(rec.id);
  return rec.id;
}

/* ---------- reading ---------- */

export async function session(id) {
  const s = await db.get('sessions', id);
  return live(s) ? s : null;
}

export async function sessions() {
  return (await db.all('sessions')).filter(live)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.started_at || '').localeCompare(String(a.started_at || '')));
}

export async function setsOf(sessionId) {
  return (await db.byIndex('sets', 'session_id', sessionId)).filter(live).sort(byTime);
}

/** Sets of one workout grouped by exercise, in the order exercises were started. */
export function blocks(sets) {
  const m = new Map();
  for (const s of sets) {
    if (!m.has(s.exercise_id)) m.set(s.exercise_id, []);
    m.get(s.exercise_id).push(s);
  }
  return [...m.entries()].map(([exercise_id, list]) => ({ exercise_id, sets: list }));
}

/**
 * Earlier workouts with this exercise, newest first: [{ session, sets }]
 * (skips the workout given in `exceptSession`).
 */
export async function history(exerciseId, exceptSession, limit = 5) {
  const all = (await db.all('sets')).filter(s => live(s) && s.exercise_id === exerciseId && s.session_id !== exceptSession);
  const bySession = new Map();
  for (const s of all) {
    if (!bySession.has(s.session_id)) bySession.set(s.session_id, []);
    bySession.get(s.session_id).push(s);
  }
  const out = [];
  for (const [sid, list] of bySession) {
    const ses = await db.get('sessions', sid);
    if (live(ses)) out.push({ session: ses, sets: list.sort(byTime) });
  }
  return out.sort((a, b) => String(b.session.date).localeCompare(String(a.session.date)) ||
    String(b.session.started_at || '').localeCompare(String(a.session.started_at || ''))).slice(0, limit);
}

/** Exercise ids used most recently (for the quick-pick list). */
export async function recentExercises(limit = 12) {
  const sets = (await db.all('sets')).filter(live).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const seen = [];
  for (const s of sets) { if (!seen.includes(s.exercise_id)) seen.push(s.exercise_id); if (seen.length >= limit) break; }
  return seen;
}

/* ---------- writing ---------- */

export async function saveSet(rec) {
  await sync.queue([{ kind: 'set', record: rec }]);
}
export async function deleteSet(rec) {
  await sync.queue([{ kind: 'set', record: { ...rec, deleted: true } }]);
}
export async function saveSessionNotes(ses, notes) {
  await sync.queue([{ kind: 'session', record: { ...ses, notes } }]);
}
/** Delete a whole workout and every set in it. */
export async function deleteSession(ses) {
  const sets = await setsOf(ses.id);
  await sync.queue([{ kind: 'session', record: { ...ses, deleted: true } },
    ...sets.map(s => ({ kind: 'set', record: { ...s, deleted: true } }))]);
  if ((await db.getValue('checkpoints', 'workout.active', null)) === ses.id) await finish();
}

export function newSet(sessionId, exerciseId, setIndex, fields) {
  return {
    id: db.newId('set'), session_id: sessionId, exercise_id: exerciseId, set_index: setIndex,
    measure: fields.measure, reps: null, hold_seconds: null, effort: null, effort_scale: fields.effort_scale || 'rpe',
    rest_seconds: null, added_weight: null, band_assist: null, unit: fields.unit || 'lb', notes: null,
    ...fields,
  };
}

/* ---------- reading a set ---------- */

/** The number that matters for a set: reps, or seconds held. */
export function amount(s) {
  return s.measure === 'reps' ? Number(s.reps) : Number(s.hold_seconds);
}

export function amountText(s) {
  if (s.measure === 'reps') return `${s.reps ?? '–'} ${Number(s.reps) === 1 ? 'rep' : 'reps'}`;
  if (s.measure === 'minutes') { const m = Number(s.hold_seconds) / 60; return `${+m.toFixed(2)} min`; }
  return `${s.hold_seconds ?? '–'} s`;
}

export function effortText(s) {
  if (s.effort == null || s.effort === '') return '';
  return s.effort_scale === 'rir' ? `${s.effort} in reserve` : `RPE ${s.effort}`;
}

/** Turn an exercise's `measure` into the logging measure. */
export function measureFor(exMeasure) {
  if (exMeasure === 'reps') return 'reps';
  if (exMeasure === 'minutes') return 'minutes';
  if (exMeasure === 'seconds' || exMeasure === 'hold_seconds') return 'seconds';
  return 'reps';
}

/* ---------- hints from the book ---------- */

/**
 * Hints for one exercise in one workout.
 * - Last set to failure (pp. 117–118): last set beats the first by 2+ → move up;
 *   next time use first + (difference − 1) on every set (5-5-7 → 6-6-6, 5-5-8 → 7-7-7;
 *   holds 15-15-15-18 → 17 s).
 * - RPE red flag (pp. 192–194): fewer reps than last time with every set at RPE 10
 *   → overreaching; the fix is a deload, not more volume.
 */
export function hints(sets, previous) {
  const out = [];
  const same = sets.filter(s => s.measure === sets[0]?.measure);
  if (same.length >= 2) {
    const first = amount(same[0]), last = amount(same[same.length - 1]);
    const diff = last - first;
    if (Number.isFinite(diff) && diff >= 2) {
      const reps = same[0].measure === 'reps';
      const next = first + diff - 1;
      out.push({
        kind: 'up',
        text: `Your last set beat your first by ${diff} ${reps ? 'reps' : 'seconds'}. By the book’s last-set-to-failure rule, move up: next time try ${next} ${reps ? 'reps' : 'seconds'} on every set (pp. 117–118).`,
      });
    }
  }
  const prev = previous?.[0]?.sets?.filter(s => s.measure === sets[0]?.measure) || [];
  const allTen = list => list.length && list.every(s => s.effort_scale !== 'rir' && Number(s.effort) === 10);
  if (same.length && prev.length && allTen(same) && allTen(prev)) {
    const total = l => l.reduce((n, s) => n + (amount(s) || 0), 0);
    if (total(same) < total(prev)) out.push({
      kind: 'warn',
      text: 'Fewer reps than last time with every set at RPE 10. The book calls this a red flag for overreaching: the fix is a deload, not more volume (pp. 192–194).',
    });
  }
  return out;
}

/* ---------- logging settings (sync to the Sheet's Settings tab) ---------- */

export const DEFAULTS = { units: 'lb', effort_scale: 'rpe' };

export async function settings() {
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    const v = await db.getValue('settings', k, null);
    if (v != null && v !== '') out[k] = v;
  }
  return out;
}

export async function saveSetting(key, value) {
  await sync.saveSetting(key, value);
}
