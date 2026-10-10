// levels.js — which ladder steps you've passed, and your level in each family.
// Book rule (approved A2): a family's level = the highest chart level you've passed.
// Most "move up when" rules in the book are written in words, so you mark a step passed yourself.

import * as db from './storage.js';
import * as sync from './sync.js';
import * as content from './content.js';

const KEY = 'ladder.passed'; // synced setting: JSON list of exercise ids

export async function passed() {
  const raw = await db.getValue('settings', KEY, '[]');
  try { return new Set(Array.isArray(raw) ? raw : JSON.parse(raw || '[]')); } catch { return new Set(); }
}

export async function setPassed(exerciseId, on) {
  const s = await passed();
  if (on) s.add(exerciseId); else s.delete(exerciseId);
  const sent = await sync.saveSetting(KEY, JSON.stringify([...s].sort()));
  return { set: s, sent };
}

export async function data() {
  const [levels, exercises] = await Promise.all([content.getJSON('levels.json'), content.getJSON('exercises.json')]);
  if (!levels || !exercises) return null;
  return { levels, byId: new Map(exercises.map(e => [e.id, e])) };
}

/** Steps of one progression, lowest level first, with off-chart steps marked. */
export function steps(prog) {
  const main = (prog.steps || []).map(s => ({ ...s, off_chart: false }));
  const extra = (prog.off_chart_steps || []).map(s => ({ ...s, off_chart: true }));
  return [...main, ...extra].filter(s => s.exercise_id).sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.off_chart - b.off_chart);
}

/**
 * Where you stand on one progression:
 * top = highest passed step (or null), current = the first chart step above it you haven't passed.
 */
export function standing(prog, passedSet) {
  const list = steps(prog);
  const done = list.filter(s => passedSet.has(s.exercise_id));
  const topLevel = done.reduce((m, s) => Math.max(m, s.level ?? 0), 0);
  const top = done.find(s => (s.level ?? 0) === topLevel) || null;
  const current = list.find(s => !s.off_chart && !passedSet.has(s.exercise_id) && (s.level ?? 0) >= topLevel) || null;
  return { list, top, current, topLevel };
}

/** { family: { level, exercise_id } } from every progression in that family. */
export function familyLevels(levels, passedSet) {
  const out = {};
  for (const p of levels.progressions || []) {
    const { top } = standing(p, passedSet);
    if (!top) continue;
    const f = p.family;
    if (!out[f] || (top.level ?? 0) > out[f].level) out[f] = { level: top.level ?? 0, exercise_id: top.exercise_id, progression: p.id };
  }
  return out;
}
