// progress.js — the Progress tab: charts of your logged sets, and the progression ladders.
import * as db from './storage.js';
import * as log from './log.js';
import * as lv from './levels.js';
import * as sync from './sync.js';
import * as content from './content.js';
import { draw } from './charts.js';
import { $, $$, esc, plural, say, FAMILY } from './ui.js';

const tabs = current => `<nav class="seg" aria-label="Progress sections">
  <a href="#/progress"${current === 'charts' ? ' aria-current="page"' : ''}>Charts</a>
  <a href="#/ladders"${current === 'ladders' ? ' aria-current="page"' : ''}>Ladders</a></nav>`;

const dayDate = d => { const [y, m, dd] = String(d).split('-').map(Number); return new Date(y, m - 1, dd); };
const short = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const query = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
const setQuery = (route, params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  history.replaceState(null, '', `#/${route}${s ? '?' + s : ''}`);
};

async function exNames() {
  const list = await content.getJSON('exercises.json').catch(() => null);
  return new Map((list || []).map(e => [e.id, e]));
}
const nameOf = (id, ex) => (String(id).startsWith('custom:') ? String(id).slice(7) : ex.get(id)?.name || id);

/** Every live set grouped by exercise → workouts (oldest first). */
async function workoutsByExercise() {
  const [sets, sessions] = await Promise.all([db.all('sets'), db.all('sessions')]);
  const ses = new Map(sessions.filter(s => !s.deleted).map(s => [s.id, s]));
  const by = new Map();
  for (const s of sets) {
    if (s.deleted || !ses.has(s.session_id)) continue;
    if (!by.has(s.exercise_id)) by.set(s.exercise_id, new Map());
    const m = by.get(s.exercise_id);
    if (!m.has(s.session_id)) m.set(s.session_id, { session: ses.get(s.session_id), sets: [] });
    m.get(s.session_id).sets.push(s);
  }
  const out = new Map();
  for (const [ex, m] of by) {
    out.set(ex, [...m.values()].map(w => ({ ...w, sets: w.sets.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) }))
      .sort((a, b) => String(a.session.date).localeCompare(String(b.session.date)) || String(a.session.started_at || '').localeCompare(String(b.session.started_at || ''))));
  }
  return out;
}

/* ---------- Charts ---------- */

const RANGES = [['28', '4 weeks'], ['90', '3 months'], ['', 'All']];

export const progressPage = {
  title: 'Progress',
  nav: 'progress',
  async render() {
    const [byEx, ex] = await Promise.all([workoutsByExercise(), exNames()]);
    if (!byEx.size) return `<h1>Progress</h1>${tabs('charts')}
      <div class="panel"><h2 style="margin-top:0">No logged sets yet</h2>
      <p>Log a few workouts on Today and your charts appear here, one exercise at a time.</p>
      <a class="btn primary wide" href="#/today">Go to Today</a></div>`;
    // most recently trained first
    const ids = [...byEx.keys()].sort((a, b) => {
      const la = byEx.get(a).at(-1).session.date, lb = byEx.get(b).at(-1).session.date;
      return String(lb).localeCompare(String(la));
    });
    const q = query();
    const pick = ids.includes(q.ex) ? q.ex : ids[0];
    this.state = { byEx, ex, pick, range: q.r ?? '90' };
    return `<h1>Progress</h1>${tabs('charts')}
      <label for="pg-ex">Exercise</label>
      <select id="pg-ex">${ids.map(id => `<option value="${esc(id)}"${id === pick ? ' selected' : ''}>${esc(nameOf(id, ex))} (${plural(byEx.get(id).length, 'workout')})</option>`).join('')}</select>
      <div class="chips" role="group" aria-label="Time range" style="margin-top:12px">
        ${RANGES.map(([v, t]) => `<button type="button" data-r="${v}" aria-pressed="${(q.r ?? '90') === v}">${t}</button>`).join('')}
      </div>
      <div id="pg-body"></div>`;
  },
  bind(root) {
    if (!this.state) return;
    const st = this.state;
    const paint = () => {
      setQuery('progress', { ex: st.pick, r: st.range });
      renderCharts($('#pg-body', root), st);
    };
    $('#pg-ex', root).onchange = e => { st.pick = e.target.value; paint(); };
    $$('[data-r]', root).forEach(b => b.onclick = () => {
      st.range = b.dataset.r;
      $$('[data-r]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      paint();
    });
    paint();
    const onResize = () => renderCharts($('#pg-body', root), st);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  },
};

function renderCharts(host, st) {
  const all = st.byEx.get(st.pick) || [];
  const cutoff = st.range ? Date.now() - Number(st.range) * 86400000 : -Infinity;
  // Chart one measure: the one most of this exercise's sets use.
  const count = {};
  all.forEach(w => w.sets.forEach(s => { count[s.measure] = (count[s.measure] || 0) + 1; }));
  const measure = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || 'reps';
  const reps = measure === 'reps';
  const unit = reps ? 'reps' : 's';
  const works = all.filter(w => +dayDate(w.session.date) >= cutoff)
    .map(w => ({ ...w, sets: w.sets.filter(s => s.measure === measure) })).filter(w => w.sets.length);
  const skipped = all.reduce((n, w) => n + w.sets.filter(s => s.measure !== measure).length, 0);

  if (!works.length) {
    host.innerHTML = `<p class="dim" style="margin-top:16px">No ${esc(nameOf(st.pick, st.ex))} sets in this time range. Try “All”.</p>`;
    return;
  }
  const rows = works.map(w => {
    const vals = w.sets.map(log.amount).filter(Number.isFinite);
    const eff = w.sets.filter(s => s.effort_scale !== 'rir' && s.effort != null && s.effort !== '').map(s => Number(s.effort));
    const weight = w.sets.map(s => Number(s.added_weight) || 0);
    return {
      date: dayDate(w.session.date), id: w.session.id,
      list: vals.join(', '), best: Math.max(...vals), total: vals.reduce((a, b) => a + b, 0),
      effort: eff.length ? +(eff.reduce((a, b) => a + b, 0) / eff.length).toFixed(1) : null,
      weight: Math.max(...weight) ? `+${Math.max(...weight)} ${w.sets.find(s => s.added_weight)?.unit || ''}`.trim() : '',
    };
  });
  const first = rows[0], last = rows[rows.length - 1];
  const change = last.best - first.best;
  const summary = rows.length === 1
    ? `One workout so far. Best set: ${last.best} ${unit}.`
    : `${plural(rows.length, 'workout')} since ${short(first.date)}. Best set went from ${first.best} to ${last.best} ${unit}${change ? ` (${change > 0 ? '+' : ''}${change})` : ''}.`;
  const hasEffort = rows.some(r => r.effort != null);

  host.innerHTML = `<p class="pg-summary">${esc(summary)}</p>
    ${skipped ? `<p class="dim small">${plural(skipped, 'set')} logged in other units aren’t charted here.</p>` : ''}
    <section class="chart-card"><h2>Best set per workout</h2><p class="dim small">${reps ? 'Most reps' : 'Longest hold'} in any one set. Tap the chart to read a workout.</p><div class="chart" id="c-best"></div></section>
    <section class="chart-card"><h2>Total per workout</h2><p class="dim small">All sets added together (${reps ? 'reps' : 'seconds'}).</p><div class="chart" id="c-total"></div></section>
    ${hasEffort ? `<section class="chart-card"><h2>Average effort</h2><p class="dim small">Mean RPE of the sets you rated, 0–10. Reps dropping while effort sits at 10 is the book’s overreaching red flag (pp. 192–194).</p><div class="chart" id="c-eff"></div></section>` : ''}
    <details class="more"><summary>Show as a table</summary>
      <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Sets</th><th>Best</th><th>Total</th>${hasEffort ? '<th>RPE</th>' : ''}</tr></thead>
      <tbody>${rows.slice().reverse().map(r => `<tr><td><a href="#/workout/${encodeURIComponent(r.id)}">${esc(short(r.date))}</a></td><td>${esc(r.list)}${r.weight ? ` <span class="dim">${esc(r.weight)}</span>` : ''}</td><td>${r.best}</td><td>${r.total}</td>${hasEffort ? `<td>${r.effort ?? '–'}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    </details>`;

  const pts = key => rows.map(r => ({ date: r.date, y: r[key], text: `Sets: ${r.list}${r.weight ? ` (${r.weight})` : ''}${r.effort != null ? `. RPE ${r.effort}` : ''}` }));
  draw($('#c-best', host), { kind: 'line', points: pts('best'), unit, label: `Best set per workout, ${rows.length} workouts` });
  draw($('#c-total', host), { kind: 'column', points: pts('total'), unit, label: `Total per workout` });
  if (hasEffort) draw($('#c-eff', host), { kind: 'line', points: rows.filter(r => r.effort != null).map(r => ({ date: r.date, y: r.effort, text: `Sets: ${r.list}` })), yMin: 0, yMax: 10, unit: '', label: 'Average effort' });
}

/* ---------- Ladders ---------- */

function bestOf(works) {
  if (!works?.length) return null;
  let best = null;
  for (const w of works) for (const s of w.sets) {
    const v = log.amount(s);
    if (Number.isFinite(v) && (!best || v > best.v || (v === best.v && s.measure === best.s.measure))) best = { v, s, date: w.session.date };
  }
  return best;
}

export const laddersPage = {
  title: 'Ladders',
  nav: 'progress',
  async render() {
    const d = await lv.data();
    if (!d) return `<h1>Ladders</h1>${tabs('ladders')}<div class="panel"><p>The ladders come from the book content. Go to Sync and tap <strong>Get latest from Sheet</strong>.</p><a class="btn primary wide" href="#/sync">Go to Sync</a></div>`;
    const passedSet = await lv.passed();
    const fam = lv.familyLevels(d.levels, passedSet);
    const byFam = new Map();
    for (const p of d.levels.progressions) { if (!byFam.has(p.family)) byFam.set(p.family, []); byFam.get(p.family).push(p); }
    const tiers = d.levels.tiers || [];
    const tierOf = n => tiers.find(t => n >= t.levels[0] && n <= t.levels[1])?.tier || '';
    const icp = d.levels.iron_cross_prereqs;
    const icDone = (icp?.exercise_ids || []).filter(id => passedSet.has(id)).length;

    return `<h1>Ladders</h1>${tabs('ladders')}
      <p class="dim">Mark each step you can do with solid technique. Your level in a family is the highest step you’ve passed. The book rates exercises, not whole families, so this rule is the site’s, approved by you (A2).</p>
      <section class="levels" aria-label="Your levels">
        ${Object.keys(FAMILY).filter(f => byFam.has(f)).map(f => `<div class="lvl"><span class="lvl-n">${fam[f]?.level || '–'}</span>
          <span class="lvl-t">${esc(FAMILY[f])}</span><span class="lvl-s">${fam[f] ? esc(tierOf(fam[f].level)) : 'not started'}</span></div>`).join('')}
      </section>
      ${icp ? `<details class="more"><summary>Iron cross prerequisites: ${icDone} of ${icp.exercise_ids.length} passed</summary>
        <p class="small">${esc(icp.rule)}</p>
        <ul class="rows">${icp.exercise_ids.map(id => { const e = d.byId.get(id); return `<li><a class="row" href="#/exercise/${encodeURIComponent(id)}">
          <span class="row-num">${e?.level ?? '–'}</span><span class="row-main"><span class="row-title">${esc(e?.name || id)}</span>
          <span class="row-sub">${passedSet.has(id) ? 'Passed' : 'Not yet'}</span></span></a></li>`; }).join('')}</ul></details>` : ''}
      ${[...byFam.entries()].sort((a, b) => Object.keys(FAMILY).indexOf(a[0]) - Object.keys(FAMILY).indexOf(b[0])).map(([f, ps]) => `
        <h2>${esc(FAMILY[f] || f)}</h2>
        <ul class="rows">${ps.map(p => {
          const s = lv.standing(p, passedSet);
          const cur = s.current ? d.byId.get(s.current.exercise_id) : null;
          return `<li><a class="row" href="#/ladder/${encodeURIComponent(p.id)}">
            <span class="row-num">${s.topLevel || '–'}</span>
            <span class="row-main"><span class="row-title">${esc(p.title)}</span>
            <span class="row-sub">${cur ? `Next: ${esc(cur.name)} (L${cur.level})` : s.top ? 'Top of this ladder' : `${plural(s.list.length, 'step')}`}</span></span></a></li>`;
        }).join('')}</ul>`).join('')}`;
  },
};

export const ladderPage = {
  title: 'Ladder',
  nav: 'progress',
  async render([rawId]) {
    const d = await lv.data();
    if (!d) return laddersPage.render();
    const id = decodeURIComponent(rawId || '');
    const p = d.levels.progressions.find(x => x.id === id);
    if (!p) return `<a class="back" href="#/ladders">Ladders</a><h1>Not found</h1>`;
    this.title = p.title;
    const [passedSet, byEx] = await Promise.all([lv.passed(), workoutsByExercise()]);
    const s = lv.standing(p, passedSet);
    const icp = new Set(d.levels.iron_cross_prereqs?.exercise_ids || []);
    this.state = { p };
    return `<a class="back" href="#/ladders">Ladders</a>
      <h1>${esc(p.title)}</h1>
      <p class="dim">${esc(FAMILY[p.family] || p.family)}. Chart ${p.chart}, column ${p.column} (p. ${p.chart_page}); the steps are taught from p. ${p.section_page}.</p>
      ${p.note ? `<p class="small">${esc(p.note)}</p>` : ''}
      <ol class="ladder-steps">${s.list.slice().reverse().map(st => {
        const e = d.byId.get(st.exercise_id);
        const on = passedSet.has(st.exercise_id);
        const isCur = s.current && s.current.exercise_id === st.exercise_id;
        const best = bestOf(byEx.get(st.exercise_id));
        return `<li class="step${on ? ' passed' : ''}${isCur ? ' current' : ''}">
          <span class="row-num">${st.level ?? '–'}</span>
          <div class="step-main">
            <a class="row-title" href="#/exercise/${encodeURIComponent(st.exercise_id)}">${esc(e?.name || st.label || st.exercise_id)}</a>
            <span class="row-sub">${[isCur ? 'Your next step' : '', st.off_chart ? 'Off the chart (text only)' : '', icp.has(st.exercise_id) ? 'Iron cross prerequisite' : '',
              best ? `Best: ${esc(log.amountText(best.s))}, ${esc(short(dayDate(best.date)))}` : ''].filter(Boolean).join('. ')}</span>
          </div>
          <button class="btn pass" type="button" data-pass="${esc(st.exercise_id)}" aria-pressed="${on}">${on ? 'Passed' : 'Mark passed'}</button>
        </li>`;
      }).join('')}</ol>
      <p class="msg" id="ld-msg" role="status"></p>`;
  },
  bind(root) {
    $$('[data-pass]', root).forEach(b => b.onclick = async () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.disabled = true;
      const { sent } = await lv.setPassed(b.dataset.pass, on);
      const html = await this.render([encodeURIComponent(this.state.p.id)]);
      const y = scrollY;
      root.innerHTML = html;
      this.bind(root);
      scrollTo(0, y);
      const why = sync.settingError();
      say($('#ld-msg', root), `${on ? 'Marked passed' : 'Unmarked'}. ${sent ? 'Saved to your Sheet.'
        : why && navigator.onLine ? `Saved on this phone, but the Sheet didn’t take it: ${why} It will retry.`
        : 'Saved on this phone; it goes to your Sheet when you’re back online.'}`, sent || !why);
    });
  },
};
