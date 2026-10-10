// workout.js — the Today tab: start a workout, log sets, edit or delete them, see history.
import * as log from './log.js';
import * as content from './content.js';
import { $, $$, esc, plural, say } from './ui.js';

/* ---------- exercise names ---------- */

let exIndex = null;
async function exMap() {
  const list = await content.getJSON('exercises.json').catch(() => null);
  if (!exIndex || exIndex.list !== list) exIndex = { list: list || [], byId: new Map((list || []).map(e => [e.id, e])) };
  return exIndex;
}
const CUSTOM = 'custom:';
function exName(id, ex) {
  if (String(id).startsWith(CUSTOM)) return String(id).slice(CUSTOM.length);
  return ex.byId.get(id)?.name || id;
}

const dayTitle = d => {
  const [y, m, dd] = String(d).split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};
const clock = iso => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
const dayNum = d => Number(String(d).split('-')[2]) || '';
const monthShort = d => { const [y, m] = String(d).split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' }); };

function setLine(s) {
  const bits = [log.amountText(s), log.effortText(s)];
  if (s.added_weight) bits.push(`+${s.added_weight} ${s.unit || ''}`.trim());
  if (s.band_assist) bits.push(`band: ${s.band_assist}`);
  return bits.filter(Boolean).join(', ');
}
const summaryOf = sets => {
  if (!sets.length) return '';
  const unit = sets[0].measure === 'reps' ? (sets.every(s => Number(s.reps) === 1) ? 'rep' : 'reps') : sets[0].measure === 'minutes' ? 'min' : 's';
  return sets.map(s => (s.measure === 'minutes' ? +(Number(s.hold_seconds) / 60).toFixed(2) : log.amount(s))).join(', ') + ' ' + unit;
};

/* ---------- Today ---------- */

export const today = {
  title: 'Today',
  nav: 'today',
  async render() {
    const [activeId, sessions, ex, prefs] = await Promise.all([log.activeId(), log.sessions(), exMap(), log.settings()]);
    const active = activeId ? sessions.find(s => s.id === activeId) : null;
    let activeCard = '';
    if (active) {
      const sets = await log.setsOf(active.id);
      activeCard = `<section class="panel now">
        <h2 style="margin-top:0">Workout in progress</h2>
        <p class="dim">Started ${esc(clock(active.started_at))}. ${plural(log.blocks(sets).length, 'exercise')}, ${plural(sets.length, 'set')}.</p>
        <a class="btn primary wide" href="#/workout/${encodeURIComponent(active.id)}">Continue workout</a></section>`;
    }
    const recent = sessions.filter(s => s.id !== activeId).slice(0, 30);
    const rows = await Promise.all(recent.map(async s => {
      const sets = await log.setsOf(s.id);
      const names = log.blocks(sets).map(b => exName(b.exercise_id, ex));
      return `<li><a class="row" href="#/workout/${encodeURIComponent(s.id)}">
        <span class="row-num date-num" aria-hidden="true">${esc(dayNum(s.date))}<small>${esc(monthShort(s.date))}</small></span>
        <span class="row-main"><span class="row-title">${esc(dayTitle(s.date))}</span>
        <span class="row-sub">${sets.length ? `${plural(sets.length, 'set')}: ${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ` and ${names.length - 3} more` : ''}` : 'No sets'}</span></span></a></li>`;
    }));
    return `<h1>Today</h1>
      ${activeCard || `<button class="btn primary wide big" id="start" type="button">Start a workout</button>
        <p class="dim small" style="margin-top:8px">Works with no signal. Sets wait on this phone and go to your Sheet when you’re back online.</p>`}
      <h2>Past workouts</h2>
      ${rows.length ? `<ul class="rows">${rows.join('')}</ul>` : '<p class="dim">Nothing logged yet. Your workouts will be listed here.</p>'}
      <h2>Logging settings</h2>
      <div class="panel">
        <span class="label-text" id="u-l">Weight units</span>
        <div class="seg" role="group" aria-labelledby="u-l">
          ${['lb', 'kg'].map(u => `<button type="button" data-set="units" data-v="${u}" aria-pressed="${prefs.units === u}">${u}</button>`).join('')}</div>
        <span class="label-text" id="e-l">Effort scale</span>
        <div class="seg" role="group" aria-labelledby="e-l">
          <button type="button" data-set="effort_scale" data-v="rpe" aria-pressed="${prefs.effort_scale === 'rpe'}">RPE 0–10</button>
          <button type="button" data-set="effort_scale" data-v="rir" aria-pressed="${prefs.effort_scale === 'rir'}">Reps in reserve</button></div>
        <p class="dim small">RPE is the book’s scale: 0 is rest, 10 is max effort (p. 192). Reps in reserve is NOT IN BOOK; it’s offered as an extra.</p>
        <p class="msg" id="set-msg" role="status"></p>
      </div>`;
  },
  bind(root) {
    const start = $('#start', root);
    if (start) start.onclick = async () => {
      start.disabled = true;
      const id = await log.start();
      location.hash = `#/workout/${encodeURIComponent(id)}/add`;
    };
    $$('[data-set]', root).forEach(b => b.onclick = async () => {
      const sent = await log.saveSetting(b.dataset.set, b.dataset.v);
      $$(`[data-set="${b.dataset.set}"]`, root).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      say($('#set-msg', root), sent ? 'Saved. New sets use this.' : 'Saved on this phone. New sets use this; it goes to your Sheet when you’re back online.', true);
    });
  },
};

/* ---------- Workout ---------- */

function setForm({ measure, amountValue, effort, scale, unit, set, more }) {
  const label = measure === 'reps' ? 'Reps' : measure === 'minutes' ? 'Minutes' : 'Seconds held';
  const max = scale === 'rir' ? 5 : 10;
  return `<form class="setform" novalidate data-set-id="${esc(set?.id || '')}">
    <div class="seg" role="group" aria-label="Measure">
      ${[['reps', 'Reps'], ['seconds', 'Seconds'], ['minutes', 'Minutes']].map(([m, t]) =>
        `<button type="button" data-m="${m}" aria-pressed="${measure === m}">${t}</button>`).join('')}
    </div>
    <label for="sf-amt" id="sf-label">${label}</label>
    <div class="stepper">
      <button type="button" data-step="-1" aria-label="Less">−</button>
      <input id="sf-amt" type="number" inputmode="${measure === 'minutes' ? 'decimal' : 'numeric'}" min="0" step="${measure === 'minutes' ? '0.25' : '1'}" value="${esc(amountValue ?? '')}">
      <button type="button" data-step="1" aria-label="More">+</button>
    </div>
    <fieldset class="effort"><legend>${scale === 'rir' ? 'Reps in reserve (not in book)' : 'Effort, RPE 0–10 (optional)'}</legend>
      <div class="effort-row">${Array.from({ length: max + 1 }, (_, i) =>
        `<button type="button" data-e="${i}" aria-pressed="${Number(effort) === i && effort !== null && effort !== ''}">${i}</button>`).join('')}</div>
    </fieldset>
    <details class="more"${more ? ' open' : ''}><summary>Weight, band, rest, notes</summary>
      <label for="sf-w">Added weight (${esc(unit)})</label><input id="sf-w" type="number" inputmode="decimal" min="0" value="${esc(set?.added_weight ?? '')}">
      <label for="sf-b">Band assist</label><input id="sf-b" type="text" placeholder="e.g. red band" value="${esc(set?.band_assist ?? '')}">
      <label for="sf-r">Rest before this set (seconds)</label><input id="sf-r" type="number" inputmode="numeric" min="0" value="${esc(set?.rest_seconds ?? '')}">
      <label for="sf-n">Notes</label><input id="sf-n" type="text" value="${esc(set?.notes ?? '')}">
    </details>
    <div class="actions">
      <button class="btn primary" type="submit">${set ? 'Save changes' : 'Save set'}</button>
      <button class="btn quiet" type="button" data-act="cancel">Cancel</button>
    </div>
    ${set ? '<div class="actions"><button class="btn danger" type="button" data-act="delete">Delete set</button></div>' : ''}
    <p class="msg" role="status"></p>
  </form>`;
}

export const workout = {
  title: 'Workout',
  nav: 'today',
  async render(args) {
    const [rawId, sub] = args;
    const id = decodeURIComponent(rawId || '');
    const ses = await log.session(id);
    if (!ses) return `<a class="back" href="#/today">Today</a><h1>Workout not found</h1><p>It may have been deleted.</p>`;
    this.state = { id, sub, ses };
    if (sub === 'add') return renderPicker(ses);
    return renderWorkout(ses, this);
  },
  async bind(root) {
    if (this.state?.sub === 'add') return bindPicker(root, this.state.ses);
    if (this.state?.ses) return bindWorkout(root, this.state.ses, this);
  },
};

async function renderWorkout(ses, page) {
  const [sets, ex, activeId] = await Promise.all([log.setsOf(ses.id), exMap(), log.activeId()]);
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const adding = q.get('ex');
  const bl = log.blocks(sets);
  if (adding && !bl.some(b => b.exercise_id === adding)) bl.push({ exercise_id: adding, sets: [] });
  page.blocks = bl;
  const isActive = activeId === ses.id;

  const parts = await Promise.all(bl.map(async b => {
    const e = ex.byId.get(b.exercise_id);
    const prev = await log.history(b.exercise_id, ses.id, 1);
    const hints = log.hints(b.sets, prev);
    const last = prev[0];
    return `<section class="block" data-ex="${esc(b.exercise_id)}">
      <header class="block-head">
        <span class="row-num">${e?.level ?? '–'}</span>
        <div class="row-main"><h2>${e ? `<a href="#/exercise/${encodeURIComponent(e.id)}">${esc(e.name)}</a>` : esc(exName(b.exercise_id, ex))}</h2>
        ${last ? `<span class="row-sub">Last time, ${esc(dayTitle(last.session.date))}: ${esc(summaryOf(last.sets))}</span>` : '<span class="row-sub">First time logging this</span>'}</div>
      </header>
      ${b.sets.length ? `<ol class="sets">${b.sets.map((s, i) => `<li><button type="button" class="set-row" data-edit="${esc(s.id)}">
        <span class="set-n">Set ${i + 1}</span><span class="set-v">${esc(setLine(s))}</span><span class="set-edit">Edit</span></button></li>`).join('')}</ol>` : ''}
      ${hints.map(h => `<p class="hint ${h.kind}">${esc(h.text)}</p>`).join('')}
      ${e?.advance_when && !/NOT IN BOOK/.test(e.advance_when) ? `<details class="more"><summary>When to move to the next step</summary><p class="small">${esc(e.advance_when)}</p></details>` : ''}
      <div class="form-slot"></div>
      <button class="btn wide" type="button" data-add="${esc(b.exercise_id)}">Add set</button>
    </section>`;
  }));

  return `<a class="back" href="#/today">Today</a>
    <h1>${esc(dayTitle(ses.date))}</h1>
    <p class="dim">${isActive ? 'In progress. ' : ''}Started ${esc(clock(ses.started_at))}. ${plural(sets.length, 'set')}.</p>
    ${parts.join('') || '<p class="dim">No exercises yet.</p>'}
    <a class="btn primary wide big" href="#/workout/${encodeURIComponent(ses.id)}/add">Add exercise</a>
    <label for="w-notes">Workout notes</label>
    <textarea id="w-notes" rows="3" placeholder="How it went, anything to remember">${esc(ses.notes || '')}</textarea>
    <p class="msg" id="w-msg" role="status"></p>
    <div class="actions">
      ${isActive ? '<button class="btn primary" id="w-finish" type="button">Finish workout</button>'
        : '<button class="btn" id="w-resume" type="button">Make this the current workout</button>'}
      <button class="btn danger" id="w-delete" type="button">Delete workout</button>
    </div>`;
}

async function bindWorkout(root, ses, page) {
  const prefs = await log.settings();
  const ex = await exMap();

  const closeForms = () => $$('.form-slot', root).forEach(s => { s.innerHTML = ''; });
  const showAdd = on => $$('[data-add]', root).forEach(b => { b.hidden = !on; });

  async function openForm(block, exerciseId, set) {
    closeForms(); showAdd(true);
    const b = page.blocks.find(x => x.exercise_id === exerciseId) || { sets: [] };
    const lastHere = b.sets[b.sets.length - 1];
    const prev = (await log.history(exerciseId, ses.id, 1))[0]?.sets?.[0];
    const template = set || lastHere || prev;
    const e = ex.byId.get(exerciseId);
    const measure = template?.measure || log.measureFor(e?.measure);
    const amountValue = template ? (measure === 'reps' ? template.reps : measure === 'minutes' ? +(Number(template.hold_seconds) / 60).toFixed(2) : template.hold_seconds) : '';
    const scale = set?.effort_scale || prefs.effort_scale;
    const slot = $('.form-slot', block);
    slot.innerHTML = setForm({ measure, amountValue, effort: set ? set.effort : null, scale, unit: set?.unit || prefs.units, set,
      more: !!(set && (set.added_weight || set.band_assist || set.rest_seconds || set.notes)) });
    $(`[data-add]`, block).hidden = true;
    bindForm(slot.firstElementChild, { exerciseId, set, scale, unit: set?.unit || prefs.units, nextIndex: b.sets.length + 1 });
    slot.scrollIntoView({ block: 'nearest' });
    if (!set) $('#sf-amt', slot).focus({ preventScroll: true });
  }

  function bindForm(form, { exerciseId, set, scale, unit, nextIndex }) {
    let measure = $('[data-m][aria-pressed="true"]', form).dataset.m;
    let effort = set && set.effort !== '' && set.effort != null ? Number(set.effort) : null;
    const amt = $('#sf-amt', form), msg = $('.msg', form);

    $$('[data-m]', form).forEach(b => b.onclick = () => {
      measure = b.dataset.m;
      $$('[data-m]', form).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      $('#sf-label', form).textContent = measure === 'reps' ? 'Reps' : measure === 'minutes' ? 'Minutes' : 'Seconds held';
      amt.step = measure === 'minutes' ? '0.25' : '1';
      amt.inputMode = measure === 'minutes' ? 'decimal' : 'numeric';
    });
    $$('[data-step]', form).forEach(b => b.onclick = () => {
      const step = (measure === 'minutes' ? 0.25 : 1) * Number(b.dataset.step);
      amt.value = String(Math.max(0, +((Number(amt.value) || 0) + step).toFixed(2)));
    });
    $$('[data-e]', form).forEach(b => b.onclick = () => {
      const v = Number(b.dataset.e);
      effort = effort === v ? null : v; // tap again to clear
      $$('[data-e]', form).forEach(x => x.setAttribute('aria-pressed', String(effort !== null && Number(x.dataset.e) === effort)));
    });
    $('[data-act="cancel"]', form).onclick = () => { closeForms(); showAdd(true); };

    const del = $('[data-act="delete"]', form);
    let armed = false;
    if (del) del.onclick = async () => {
      if (!armed) { armed = true; del.textContent = 'Tap again to delete'; return; }
      await log.deleteSet(set);
      redraw();
    };

    form.onsubmit = async e => {
      e.preventDefault();
      const n = Number(amt.value);
      if (amt.value === '' || !Number.isFinite(n) || n < 0) return say(msg, measure === 'reps' ? 'Enter how many reps.' : 'Enter how long you held it.', false);
      if (measure === 'reps' && !Number.isInteger(n)) return say(msg, 'Reps must be a whole number.', false);
      const num = id => { const v = $(id, form).value.trim(); return v === '' ? null : Number(v); };
      const text = id => $(id, form).value.trim() || null;
      const fields = {
        measure,
        reps: measure === 'reps' ? n : null,
        hold_seconds: measure === 'reps' ? null : Math.round(measure === 'minutes' ? n * 60 : n),
        effort, effort_scale: scale,
        added_weight: num('#sf-w'), band_assist: text('#sf-b'), rest_seconds: num('#sf-r'), notes: text('#sf-n'), unit,
      };
      const rec = set ? { ...set, ...fields } : log.newSet(ses.id, exerciseId, nextIndex, fields);
      await log.saveSet(rec);
      page.focusEx = exerciseId;
      redraw();
    };
  }

  async function redraw() {
    history.replaceState(null, '', `#/workout/${encodeURIComponent(ses.id)}`);
    const fresh = await log.session(ses.id);
    root.innerHTML = await renderWorkout(fresh, page);
    await bindWorkout(root, fresh, page);
    if (page.focusEx) {
      const blk = $$('.block', root).find(b => b.dataset.ex === page.focusEx);
      if (blk) blk.scrollIntoView({ block: 'center' });
      page.focusEx = null;
    }
  }

  root.onclick = ev => { // one handler per view (replaced on every redraw)
    const add = ev.target.closest('[data-add]');
    const edit = ev.target.closest('[data-edit]');
    if (add && root.contains(add)) openForm(add.closest('.block'), add.dataset.add, null);
    if (edit && root.contains(edit)) {
      const block = edit.closest('.block');
      const b = page.blocks.find(x => x.exercise_id === block.dataset.ex);
      openForm(block, block.dataset.ex, b.sets.find(s => s.id === edit.dataset.edit));
    }
  };

  // An exercise just picked: open its form straight away.
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const picked = q.get('ex');
  if (picked) {
    const blk = $$('.block', root).find(b => b.dataset.ex === picked);
    if (blk) openForm(blk, picked, null);
  }

  const notes = $('#w-notes', root);
  notes.onchange = async () => {
    await log.saveSessionNotes(await log.session(ses.id), notes.value.trim());
    say($('#w-msg', root), 'Notes saved.', true);
  };

  const fin = $('#w-finish', root);
  if (fin) fin.onclick = async () => {
    if (notes.value.trim() !== (ses.notes || '')) await log.saveSessionNotes(await log.session(ses.id), notes.value.trim());
    await log.finish();
    location.hash = '#/today';
  };
  const res = $('#w-resume', root);
  if (res) res.onclick = async () => { await log.setActive(ses.id); redraw(); };

  let armed = false;
  $('#w-delete', root).onclick = async e => {
    if (!armed) {
      armed = true; e.currentTarget.textContent = 'Tap again to delete';
      say($('#w-msg', root), 'This deletes the workout and all its sets, on this phone and in your Sheet.');
      return;
    }
    await log.deleteSession(await log.session(ses.id));
    location.hash = '#/today';
  };

  return () => { root.onclick = null; };
}

/* ---------- picking an exercise ---------- */

async function renderPicker(ses) {
  const ex = await exMap();
  const recent = (await log.recentExercises()).filter(id => ex.byId.has(id) || id.startsWith(CUSTOM));
  const row = id => {
    const e = ex.byId.get(id);
    return `<li><a class="row" href="#/workout/${encodeURIComponent(ses.id)}?ex=${encodeURIComponent(id)}">
      <span class="row-num">${e?.level ?? '–'}</span><span class="row-main"><span class="row-title">${esc(exName(id, ex))}</span>
      ${e?.measure ? `<span class="row-sub">${esc(e.measure.replace('_', ' '))}</span>` : ''}</span></a></li>`;
  };
  return `<a class="back" href="#/workout/${encodeURIComponent(ses.id)}">Workout</a>
    <h1>Add exercise</h1>
    <label class="sr" for="pk-q">Search exercises</label>
    <input id="pk-q" type="search" placeholder="${ex.list.length ? `Search ${ex.list.length} exercises` : 'Type an exercise name'}" autocomplete="off">
    ${ex.list.length ? '' : '<p class="dim small">The exercise library isn’t on this phone yet (Sync → Get latest from Sheet). You can still log any move by name.</p>'}
    <div id="pk-results"></div>
    ${recent.length ? `<section id="pk-recent"><h2>Recent</h2><ul class="rows">${recent.map(row).join('')}</ul></section>` : ''}
    <h2>Not in the list?</h2>
    <form id="pk-custom" class="field-row" novalidate>
      <label class="sr" for="pk-name">Exercise name</label>
      <input id="pk-name" type="text" placeholder="e.g. deadlift" autocomplete="off">
      <button class="btn" type="submit">Log it</button>
    </form>
    <p class="dim small">Some routines in the book use moves it never teaches (A6). Log those by name.</p>`;
}

function bindPicker(root, ses) {
  const input = $('#pk-q', root), out = $('#pk-results', root);
  let t;
  input.oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const ex = await exMap();
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      const recent = $('#pk-recent', root);
      if (recent) recent.hidden = !!words.length;
      if (!words.length) { out.innerHTML = ''; return; }
      const hits = ex.list.filter(e => words.every(w => `${e.name} ${e.chart_label || ''} ${e.id}`.toLowerCase().includes(w)))
        .sort((a, b) => (a.level ?? 99) - (b.level ?? 99)).slice(0, 40);
      out.innerHTML = hits.length ? `<ul class="rows">${hits.map(e => `<li><a class="row" href="#/workout/${encodeURIComponent(ses.id)}?ex=${encodeURIComponent(e.id)}">
        <span class="row-num">${e.level ?? '–'}</span><span class="row-main"><span class="row-title">${esc(e.name)}</span>
        ${e.measure ? `<span class="row-sub">${esc(e.measure.replace('_', ' '))}</span>` : ''}</span></a></li>`).join('')}</ul>`
        : '<p class="dim">No match. Use “Not in the list?” below.</p>';
    }, 120);
  };
  input.focus({ preventScroll: true });
  $('#pk-custom', root).onsubmit = e => {
    e.preventDefault();
    const name = $('#pk-name', root).value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    location.hash = `#/workout/${encodeURIComponent(ses.id)}?ex=${encodeURIComponent(CUSTOM + name)}`;
  };
}
