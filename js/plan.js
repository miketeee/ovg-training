// plan.js — the Plan tab: pick one of the book's routines for your level and fill it
// with your own next ladder steps. Every choice is shown with its reason and page.
import * as content from './content.js';
import * as lv from './levels.js';
import * as log from './log.js';
import * as sync from './sync.js';
import * as db from './storage.js';
import { $, $$, esc, plural, say, FAMILY } from './ui.js';

const PLAN_KEY = 'plan.current';      // synced setting (JSON)
const INPUT_KEY = 'plan.inputs';      // synced setting (JSON)
export const plannedKey = sid => `workout.planned.${sid}`; // checkpoint: the planned items of a started workout

/* ---------- the book's routines, sorted into the tiers the routines themselves name ---------- */

export const TIERS = [
  { id: 'untrained', label: 'Untrained beginner', levels: 'Levels 1–4', range: [0, 4] },
  { id: 'trained', label: 'Trained beginner', levels: 'Levels 5–6', range: [5, 6] },
  { id: 'intermediate', label: 'Intermediate', levels: 'Levels 7–9', range: [7, 9] },
  { id: 'advanced', label: 'Advanced', levels: 'Levels 10–13', range: [10, 13] },
];

function tierOf(levelText) {
  const t = String(levelText || '').toLowerCase();
  if (t.startsWith('beginner-intermediate')) return null; // sport layouts, not a routine
  if (t.includes('untrained')) return 'untrained';
  if (t.includes('trained beginner')) return 'trained';
  if (t.startsWith('beginner')) return 'untrained';      // "beginner (about Level 3-4)", Ch. 9 strength section
  if (t.includes('intermediate')) return 'intermediate'; // includes "intermediate-advanced"
  if (t.includes('advanced')) return 'advanced';
  return null;
}
function focusOf(p) {
  const s = `${p.id} ${p.name}`.toLowerCase();
  if (/static|isometric|straight-arm/.test(s)) return 'static';
  if (/dynamic/.test(s)) return 'dynamic';
  return 'both';
}
function daysRange(d) {
  if (d == null) return null;
  const m = String(d).match(/(\d+)(?:\s*-\s*(\d+))?/);
  return m ? [Number(m[1]), Number(m[2] || m[1])] : null;
}
const PHASES = new Set(['warmup', 'skill', 'strength', 'cooldown']);

/** Routines the generator can use: the ones the book writes out exercise by exercise. */
export function routines(programs) {
  return programs.filter(p => (p.session_structure || []).some(s => (s.items || []).length))
    .map(p => ({ p, tier: tierOf(p.level), focus: focusOf(p), days: daysRange(p.days_per_week) }))
    .filter(r => r.tier);
}

/** Best matches first: same tier, then days that fit, then focus. */
export function rank(list, { tier, days, focus }, gearGaps = () => 0) {
  // Days that fit count most, then routines that need less gear you don't have, then focus.
  const score = r => (r.days && days >= r.days[0] && days <= r.days[1] ? 4 : 0) - Math.min(3, gearGaps(r)) + (focus === 'any' || r.focus === focus || r.focus === 'both' ? 1 : 0);
  return list.filter(r => r.tier === tier).sort((a, b) => score(b) - score(a));
}

/** The site's suggestion (NOT IN BOOK): the lower of your Pushing and Pulling levels. */
export function suggestTier(fam) {
  const lvls = ['push', 'pull'].map(f => fam[f]?.level).filter(n => n != null);
  if (!lvls.length) return { tier: 'untrained', level: null };
  const level = Math.min(...lvls);
  const t = TIERS.find(x => level >= x.range[0] && level <= x.range[1]) || (level > 13 ? TIERS[3] : TIERS[0]);
  return { tier: t.id, level };
}

/* ---------- equipment ---------- */
// What you can tick. Everything else the book mentions (wall, floor, chair, box, block, table, stairs…)
// is treated as something any home has.
export const GEAR = [
  { id: 'rings', label: 'Rings' },
  { id: 'bar', label: 'Pull-up bar' },
  { id: 'pbars', label: 'Parallel bars or dip station' },
  { id: 'parallettes', label: 'Parallettes' },
  { id: 'abwheel', label: 'Ab wheel' },
  { id: 'pole', label: 'Vertical pole (for flags)' },
  { id: 'rope', label: 'Climbing rope' },
  { id: 'bands', label: 'Resistance bands or pulley' },
  { id: 'weights', label: 'Weights (vest, dumbbells)' },
];
const GEAR_WORDS = [
  [/\brings?\b/, 'rings'], [/parallel bars?|\brail\b|dip station/, 'pbars'], [/\bbar\b/, 'bar'], [/parallettes?/, 'parallettes'],
  [/ab wheel/, 'abwheel'], [/vertical pole|\bpole\b/, 'pole'], [/\brope\b/, 'rope'], [/bands?\b|pulleys?/, 'bands'],
  [/weight vest|dumbbell|light weights?|wrist roller/, 'weights'],
];
const gearOf = word => (GEAR_WORDS.find(([re]) => re.test(word)) || [])[1] || null; // null = household item

/**
 * Can you do this exercise with what you have?
 * Each equipment entry like "rings or bar" is met if any one option is available.
 * Returns { ok, missing: [labels] }.
 */
export function fits(ex, have) {
  if (!ex || !have) return { ok: true, missing: [] };
  const missing = [];
  for (const entry of ex.equipment || []) {
    if (/optional/.test(entry)) continue;
    const options = String(entry).toLowerCase().split(/\s+or\s+|\//).map(gearOf);
    if (options.some(g => g === null || have.has(g))) continue;
    missing.push(entry);
  }
  return { ok: !missing.length, missing };
}

/* ---------- hard prerequisites the book insists on (99-gaps E) ---------- */
const HARD = {
  'ring-pullups-oac-one-arm-chin-up-eccentric': { text: 'Before one-arm chin-up eccentrics the book wants: +50% bodyweight pull-up, 15 strict pull-ups to the chest, full back lever, rings tuck planche and a 20 s one-arm hang (p. 431).', needs: ['back-lever-full-back-lever'] },
  'rings-kip-back-kip-to-cross': { text: 'Kip to cross needs a solid 5 s iron cross hold first (pp. 557–558).', needs: ['iron-cross-iron-cross-hold'], complete: true },
  'rings-press-handstand-chair-press': { text: 'Chair handstand work needs a 30 s handstand and a press first (p. 361).' },
  'handstand-one-arm-handstand': { text: 'One-arm handstand work needs a consistent 60 s freestanding handstand first (p. 331).' },
};
// `complete: true` = the whole rule maps to ladder steps, so the note hides once they're passed.
// Otherwise part of the rule can't be told from your marks, so the note always shows.

/* ---------- building a plan ---------- */

function doseText(it) {
  const bits = [];
  if (it.sets != null) bits.push(`${it.sets} sets`);
  if (it.reps != null) bits.push(`${String(it.reps).replace('->', ' → ')} reps`);
  if (it.hold_seconds != null) bits.push(`${it.hold_seconds} s holds`);
  if (it.rest) bits.push(`rest ${it.rest}`);
  if (it.tempo) bits.push(`tempo ${it.tempo}`);
  if (it.dose) bits.push(it.dose);
  return bits.join(', ');
}

/**
 * Fill one routine with your exercises.
 * Rule (the site's, using the book's ladders): if you've marked steps on that exercise's ladder,
 * the slot uses your next unpassed step on it; otherwise it keeps the book's pick.
 */
export function build(r, { byId, levels, passedSet, have = null }) {
  const progs = new Map((levels.progressions || []).map(p => [p.id, p]));
  const icp = levels.iron_cross_prereqs;
  const icMissing = (icp?.exercise_ids || []).filter(id => !passedSet.has(id));
  const days = [];
  const structure = r.p.session_structure.filter(s => (s.items || []).length);
  const singleSession = structure.every(s => PHASES.has(s.part));
  const groups = singleSession ? [{ name: 'Workout', parts: structure }] : structure.map(s => ({ name: s.part, parts: [s] }));

  for (const g of groups) {
    const items = [], seen = new Set();
    for (const part of g.parts) {
      for (const it of part.items) {
        const book = it.exercise_id ? byId.get(it.exercise_id) : null;
        let ex = book, note = '';
        if (book?.progression && progs.has(book.progression)) {
          const st = lv.standing(progs.get(book.progression), passedSet);
          if (st.top && st.current && st.current.exercise_id !== book.id) {
            const cur = byId.get(st.current.exercise_id);
            if (cur) { ex = cur; note = `Book: ${book.name} (L${book.level ?? '–'}). Your next step on this ladder is ${cur.name}.`; }
          } else if (st.top && !st.current) note = 'You’ve passed the whole ladder; the book’s pick is kept.';
        }
        let gearNote = '', gearWarn = '';
        if (ex && have && !fits(ex, have).ok) {
          // 1) the book's own pick, if the ladder step needed gear you lack; 2) the book's listed alternatives.
          const tries = [...(ex !== book && book ? [book] : []), ...(it.alt_ids || []).map(a => byId.get(a)).filter(Boolean)];
          const swap = tries.find(t => fits(t, have).ok);
          const need = fits(ex, have).missing.join(', ');
          if (swap) { gearNote = `${ex.name} needs ${need}, which isn’t in your equipment. Using ${swap.name} (the book’s ${swap === book ? 'pick' : 'listed alternative'}).`; ex = swap; note = ''; }
          else gearWarn = `Needs ${need}, which isn’t in your equipment, and the book lists no alternative for this slot. Skip it or pick another exercise.`;
        }
        const id = ex ? ex.id : null;
        const key = id || `name:${it.name}`;
        const twins = ex?.same_as || [];
        if (seen.has(key) || twins.some(t => seen.has(t))) continue; // same exercise listed twice (A5)
        seen.add(key);
        const warn = [];
        const missing = (ex?.prerequisites || []).filter(p => !passedSet.has(p)).map(p => byId.get(p)?.name || p);
        const hard = HARD[id];
        if (hard && !(hard.needs && hard.complete && hard.needs.every(n => passedSet.has(n)))) warn.push(hard.text);
        if ((ex?.progression === 'iron-cross' || /^iron-cross-/.test(id || '')) && icMissing.length) warn.push(`Iron cross work needs all the gray-cell prerequisites first, plus a 30 s rings-turned-out support (p. 447). ${icMissing.length} of ${icp.exercise_ids.length} not marked passed.`);
        items.push({
          part: part.part, exercise_id: id, name: ex ? ex.name : it.name, level: ex?.level ?? null,
          dose: doseText(it), alts: (it.alt_ids || []).filter(a => a !== id).map(a => byId.get(a)?.name).filter(Boolean),
          note: [note, gearNote, it.note].filter(Boolean).join(' '), warn: [...warn, gearWarn].filter(Boolean).join(' '),
          no_gear: !!gearWarn, family: ex?.family || null,
          after: missing.length ? `Comes after ${missing.join(', ')} (not marked passed).` : '',
          untaught: !it.exercise_id, // A6: the book uses it but never teaches it
        });
      }
      if (part.note) items.push({ part: part.part, info: part.note });
    }
    days.push({ name: g.name, items });
  }

  const schedule = r.p.schedule ? Object.entries(r.p.schedule).map(([d, w]) => `${d}: ${w}`)
    : r.p.schedule_options ? r.p.schedule_options : null;
  return {
    program_id: r.p.id, program_name: r.p.name, level: r.p.level, split: r.p.split, days_per_week: r.p.days_per_week,
    source_pages: r.p.source_pages || [], notes: r.p.notes || (r.p.note ? [r.p.note] : []),
    substitutions: (r.p.substitutions || []).map(s => s.name), schedule,
    has_warmup: structure.some(s => s.part === 'warmup'),
    days, built_at: new Date().toISOString(),
  };
}

/* ---------- storage ---------- */

async function getJSONSetting(key) {
  const v = await db.getValue('settings', key, null);
  if (!v) return null;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
}
export const currentPlan = () => getJSONSetting(PLAN_KEY);

async function startFromPlan(plan, dayIndex) {
  const sid = await log.start();
  const day = plan.days[dayIndex];
  const items = day.items.filter(i => !i.info).map(i => ({
    exercise_id: i.exercise_id || `custom:${i.name}`, name: i.name, dose: i.dose, level: i.level,
  }));
  await db.setValue('checkpoints', plannedKey(sid), { program_id: plan.program_id, day: day.name, items });
  // Record which plan day this workout came from.
  const ses = await log.session(sid);
  await sync.queue([{ kind: 'session', record: { ...ses, plan_id: `${plan.program_id}|${day.name}` } }]);
  return sid;
}

/* ---------- page ---------- */

const pageList = sp => sp.map(s => {
  const ch = (s.file || '').match(/^ch_(\d+)_/);
  return `${ch ? `Ch. ${ch[1]}, ` : ''}p. ${String(s.pages).replace(/-/g, '–')}`;
}).join('; ');

export const planPage = {
  title: 'Plan',
  nav: 'plan',
  async render(args) {
    const [programs, d] = await Promise.all([content.getJSON('programs.json'), lv.data()]);
    if (!programs || !d) return `<h1>Plan</h1><div class="panel"><p>The plan is built from the book content. Go to Sync and tap <strong>Get latest from Sheet</strong>.</p><a class="btn primary wide" href="#/sync">Go to Sync</a></div>`;
    const passedSet = await lv.passed();
    const fam = lv.familyLevels(d.levels, passedSet);
    const plan = await currentPlan();
    const editing = args[0] === 'edit' || !plan;
    this.state = { programs, d, passedSet, fam, plan };
    if (!editing) return renderPlan(plan);

    const saved = (await getJSONSetting(INPUT_KEY)) || {};
    const sug = suggestTier(fam);
    const inputs = { tier: saved.tier || sug.tier, days: saved.days || 3, focus: saved.focus || 'any', program: saved.program || '',
      equipment: Array.isArray(saved.equipment) ? saved.equipment : GEAR.map(g => g.id) }; // first time: assume you have everything
    this.state.inputs = inputs;
    const famLine = Object.keys(FAMILY).filter(f => fam[f]).map(f => `${FAMILY[f]} ${fam[f].level}`).join(', ');
    return `${plan ? `<a class="back" href="#/plan">Your plan</a>` : ''}
      <h1>Build a plan</h1>
      <p class="dim">The plan is one of the book’s own routines for your level, with each exercise moved to your next step on its ladder.</p>
      <div class="panel">
        <span class="label-text" id="t-l">Your level</span>
        <div class="choice" role="radiogroup" aria-labelledby="t-l">
          ${TIERS.map(t => `<button type="button" role="radio" data-tier="${t.id}" aria-checked="${inputs.tier === t.id}"><b>${t.label}</b><span>${t.levels}</span></button>`).join('')}
        </div>
        <p class="dim small">${sug.level != null
          ? `Suggested: ${esc(TIERS.find(t => t.id === sug.tier).label)}, from the lower of your Pushing and Pulling levels (${sug.level}). This suggestion is the site’s, NOT IN BOOK. Your ladders: ${esc(famLine)}.`
          : 'Mark your passed steps under Progress → Ladders and the site can suggest a level. Until then it starts at untrained beginner.'}</p>
        <span class="label-text" id="d-l">Days a week</span>
        <div class="seg" role="group" aria-labelledby="d-l">${[2, 3, 4, 5].map(n => `<button type="button" data-days="${n}" aria-pressed="${inputs.days === n}">${n}</button>`).join('')}</div>
        <span class="label-text" id="f-l">Focus</span>
        <div class="seg" role="group" aria-labelledby="f-l">
          ${[['any', 'Either'], ['static', 'Holds and skills'], ['dynamic', 'Reps and strength']].map(([v, t]) => `<button type="button" data-focus="${v}" aria-pressed="${inputs.focus === v}">${t}</button>`).join('')}</div>
        <fieldset class="gear"><legend class="label-text">Equipment you have</legend>
          ${GEAR.map(g => `<label class="check"><input type="checkbox" data-gear="${g.id}"${inputs.equipment.includes(g.id) ? ' checked' : ''}><span>${esc(g.label)}</span></label>`).join('')}
          <p class="dim small">A wall, the floor, a chair, a box or a block count as things every home has. Exercises that need gear you don’t tick are swapped for the book’s own alternative when it lists one; otherwise they’re flagged.</p>
        </fieldset>
      </div>
      <h2>Routines for this level</h2>
      <div id="pl-list"></div>
      <button class="btn primary wide big" id="pl-build" type="button">Build my plan</button>
      <p class="msg" id="pl-msg" role="status"></p>`;
  },
  bind(root) {
    const st = this.state;
    if (!st) return;
    if (!st.inputs) return bindPlan(root, st);

    const all = routines(st.programs);
    const haveSet = () => new Set(st.inputs.equipment);
    // Slots in a routine you can't fill with your gear, even after the book's alternatives.
    const gaps = r => build(r, { byId: st.d.byId, levels: st.d.levels, passedSet: st.passedSet, have: haveSet() })
      .days.reduce((n, d) => n + d.items.filter(i => i.no_gear).length, 0);
    const drawList = () => {
      const gapCache = new Map(all.map(r => [r.p.id, gaps(r)]));
      const list = rank(all, st.inputs, r => gapCache.get(r.p.id));
      if (!list.some(r => r.p.id === st.inputs.program)) st.inputs.program = list[0]?.p.id || '';
      $('#pl-list', root).innerHTML = list.length ? `<div class="choice" role="radiogroup" aria-label="Routine">${list.map(r => `
        <button type="button" role="radio" data-prog="${esc(r.p.id)}" aria-checked="${st.inputs.program === r.p.id}">
          <b>${esc(r.p.name)}</b>
          <span>${esc([r.p.days_per_week ? `${r.p.days_per_week} days a week` : '', r.p.split, pageList(r.p.source_pages || [])].filter(Boolean).join('. '))}</span>
          ${r.days && !(st.inputs.days >= r.days[0] && st.inputs.days <= r.days[1]) ? `<span class="warn-text">The book writes this for ${esc(r.p.days_per_week)} days a week.</span>` : ''}
          ${gapCache.get(r.p.id) ? `<span class="warn-text">${plural(gapCache.get(r.p.id), 'exercise')} need${gapCache.get(r.p.id) === 1 ? 's' : ''} gear you don’t have.</span>` : ''}
        </button>`).join('')}</div>` : '<p class="dim">The book writes out no routine for this level.</p>';
      $$('[data-prog]', root).forEach(b => b.onclick = () => {
        st.inputs.program = b.dataset.prog;
        $$('[data-prog]', root).forEach(x => x.setAttribute('aria-checked', String(x === b)));
      });
    };
    const pick = (attr, key, conv = v => v) => $$(`[data-${attr}]`, root).forEach(b => b.onclick = () => {
      st.inputs[key] = conv(b.dataset[attr]);
      $$(`[data-${attr}]`, root).forEach(x => x.setAttribute(x.getAttribute('role') === 'radio' ? 'aria-checked' : 'aria-pressed', String(x === b)));
      drawList();
    });
    pick('tier', 'tier'); pick('days', 'days', Number); pick('focus', 'focus');
    $$('[data-gear]', root).forEach(c => c.onchange = () => {
      st.inputs.equipment = $$('[data-gear]', root).filter(x => x.checked).map(x => x.dataset.gear);
      drawList();
    });
    drawList();

    $('#pl-build', root).onclick = async () => {
      const r = all.find(x => x.p.id === st.inputs.program);
      if (!r) return say($('#pl-msg', root), 'Pick a routine first.', false);
      const plan = build(r, { byId: st.d.byId, levels: st.d.levels, passedSet: st.passedSet, have: haveSet() });
      plan.inputs = { ...st.inputs };
      await sync.saveSetting(INPUT_KEY, JSON.stringify(st.inputs));
      await sync.saveSetting(PLAN_KEY, JSON.stringify(plan));
      if (location.hash === '#/plan') dispatchEvent(new HashChangeEvent('hashchange')); // same address: redraw
      else location.hash = '#/plan';
    };
  },
};

function renderPlan(plan) {
  const swaps = plan.days.reduce((n, d) => n + d.items.filter(i => i.note && i.note.startsWith('Book:')).length, 0);
  const all = plan.days.flatMap(d => d.items);
  const gearSwaps = all.filter(i => /isn’t in your equipment\. Using/.test(i.note || '')).length;
  const gearGaps = all.filter(i => i.no_gear).length;
  const kit = plan.inputs?.equipment ? GEAR.filter(g => plan.inputs.equipment.includes(g.id)).map(g => g.label) : null;
  return `<h1>Your plan</h1>
    <section class="panel">
      <h2 style="margin-top:0">${esc(plan.program_name)}</h2>
      <p class="dim">${esc([plan.level, plan.days_per_week ? `${plan.days_per_week} days a week` : '', plan.split].filter(Boolean).join('. '))}. From ${esc(pageList(plan.source_pages))}.</p>
      ${plan.schedule ? `<p class="small"><strong>Week:</strong> ${plan.schedule.map(esc).join('; ')}</p>` : ''}
      <p class="small">${swaps ? `${plural(swaps, 'exercise')} moved to your next ladder step.` : 'Every exercise is the book’s own pick (mark ladder steps to personalise it).'} Built ${esc(new Date(plan.built_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}.</p>
      ${kit ? `<p class="small"><strong>Equipment:</strong> ${kit.length ? esc(kit.join(', ')) : 'none ticked (floor, wall and household items only)'}.${gearSwaps ? ` ${plural(gearSwaps, 'exercise')} swapped to fit it.` : ''}${gearGaps ? ` <span class="warn-text">${plural(gearGaps, 'exercise')} still need${gearGaps === 1 ? 's' : ''} gear you don’t have.</span>` : ''}</p>` : ''}
    </section>
    ${plan.has_warmup ? '' : `<p class="small">Warm up first (Ch. 8): <a href="#/guide/02-exercises-warmup-mobility.md">warm-up and mobility</a>.</p>`}
    ${plan.days.map((d, i) => `<section class="plan-day">
      <h2>${esc(d.name === 'Workout' ? 'Each workout' : d.name)}</h2>
      <ol class="plan-items">${d.items.map(it => it.info ? `<li class="plan-info dim small">${esc(it.info)}</li>` : `<li>
        <span class="row-num">${it.level ?? '–'}</span>
        <div class="plan-main">
          ${it.exercise_id ? `<a class="row-title" href="#/exercise/${encodeURIComponent(it.exercise_id)}">${esc(it.name)}</a>` : `<span class="row-title">${esc(it.name)}</span>`}
          ${it.dose ? `<span class="plan-dose">${esc(it.dose)}</span>` : ''}
          ${it.alts.length ? `<span class="row-sub">Or: ${esc(it.alts.join(', '))}</span>` : ''}
          ${it.untaught ? '<span class="row-sub">The book uses this but doesn’t teach it (A6).</span>' : ''}
          ${it.note ? `<span class="row-sub">${esc(it.note)}</span>` : ''}
          ${it.after ? `<span class="row-sub">${esc(it.after)}</span>` : ''}
          ${it.warn ? `<span class="warn-text">${esc(it.warn)}</span>` : ''}
          ${it.no_gear && it.family ? `<a class="row-sub" href="#/exercises?f=${encodeURIComponent(it.family)}">Browse other ${esc((FAMILY[it.family] || it.family).toLowerCase())} exercises</a>` : ''}
        </div></li>`).join('')}</ol>
      <button class="btn primary wide" type="button" data-start="${i}">Start ${esc(d.name === 'Workout' ? 'this workout' : d.name)}</button>
    </section>`).join('')}
    ${plan.substitutions?.length ? `<details class="more"><summary>Swaps the book allows</summary><p class="small">${esc(plan.substitutions.join('; '))}.</p></details>` : ''}
    ${plan.notes?.length ? `<details class="more"><summary>Book notes on this routine</summary><ul class="bullets small">${plan.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></details>` : ''}
    <p class="dim small">Doses follow the book: “5 → 15” means build from 5 to 15 reps before moving on; “sweet-spot table” means pick holds from the table on p. 95. Where a step has no exact move-up number, the general rule applies (pp. 117–118).</p>
    <div class="actions"><a class="btn" href="#/plan/edit">Change plan</a></div>
    <p class="msg" id="pl-msg" role="status"></p>`;
}

function bindPlan(root, st) {
  $$('[data-start]', root).forEach(b => b.onclick = async () => {
    b.disabled = true;
    const active = await log.activeId();
    if (active) {
      say($('#pl-msg', root), 'Finish or delete the workout in progress first (Today tab).', false);
      b.disabled = false;
      return;
    }
    const sid = await startFromPlan(st.plan, Number(b.dataset.start));
    location.hash = `#/workout/${encodeURIComponent(sid)}`;
  });
}

/** For the workout page: planned items not logged yet. */
export async function plannedFor(sid, loggedIds) {
  const p = await db.getValue('checkpoints', plannedKey(sid), null);
  if (!p) return null;
  return { ...p, remaining: p.items.filter(i => !loggedIds.has(i.exercise_id)) };
}
