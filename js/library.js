// library.js — Guide (chapters), Exercises, and Pictures pages.
import * as content from './content.js';
import { render as renderMd, titleOf, placeholders, slug } from './md.js';
import { $, $$, esc, plural, say, fill, FAMILY } from './ui.js';

/* ---------- shared data ---------- */

async function guideFiles() {
  return (await content.listFiles()).filter(f => f.kind === 'guide' || f.name.endsWith('.md'));
}

let exCache = null;
async function exercises() {
  const list = await content.getJSON('exercises.json');
  if (!list) return null;
  if (!exCache || exCache.list !== list) exCache = { list, byId: new Map(list.map(e => [e.id, e])) };
  return exCache;
}
async function progressionTitles() {
  const lv = await content.getJSON('levels.json');
  return new Map((lv?.progressions || []).map(p => [p.id, p.title]));
}

const chapterNo = name => (name.match(/^(\d\d)-/) || [])[1] || '';
const sourceLabel = s => {
  const ch = (s.file || '').match(/^ch_(\d+)_/);
  const pages = String(s.pages || '');
  return `${ch ? `Ch. ${ch[1]}, ` : ''}${/[-–,]/.test(pages) ? 'pp.' : 'p.'} ${pages.replace(/-/g, '–')}`;
};

function emptyContent() {
  return `<div class="panel"><h2 style="margin-top:0">The book content isn’t on this phone yet</h2>
    <p>It lives in your Google Sheet. Go to Sync and either upload the content files (first time only) or tap <strong>Get latest from Sheet</strong>.</p>
    <a class="btn primary wide" href="#/sync">Go to Sync</a></div>`;
}

function tabs(current) {
  const t = [['guide', 'Chapters'], ['exercises', 'Exercises'], ['pictures', 'Pictures']];
  return `<nav class="seg" aria-label="Guide sections">${t.map(([r, label]) =>
    `<a href="#/${r}"${r === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}

/* ---------- pictures inside pages ---------- */

const slot = (exerciseId, f) =>
  `<span class="fig-slot" data-ex="${esc(exerciseId)}" data-cap="${esc(f.figure)}" data-page="${esc(f.page)}"></span>`;

/** Turn every .fig-slot in root into a picture, a "Show picture" button, or the book reference. */
export async function hydrateFigures(root) {
  const slots = $$('.fig-slot', root);
  if (!slots.length) return;
  const { links, saved } = await content.imageIndex();
  for (const el of slots) {
    const { ex, cap, page } = el.dataset;
    const row = links.get(content.imageKey(ex, cap));
    const link = row?.drive_link || '';
    const id = content.fileId(link);
    const fig = document.createElement('figure');
    fig.className = 'fig';
    const ref = `See “${cap}” illustration, p. ${page}`;
    if (id && saved.has(id)) {
      fig.innerHTML = `<img alt="${esc(cap)}" loading="lazy"><figcaption>${esc(cap)}, p. ${esc(page)}</figcaption>`;
      content.loadImage(link, { fetchIfMissing: false }).then(src => { if (src) fig.querySelector('img').src = src; });
    } else if (id) {
      fig.innerHTML = `<div class="fig-empty"><span>${esc(ref)}</span><button class="btn" type="button">Show picture</button></div>`;
      fig.querySelector('button').onclick = async e => {
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Loading…';
        try {
          const src = await content.loadImage(link);
          fig.innerHTML = `<img alt="${esc(cap)}" src="${src}"><figcaption>${esc(cap)}, p. ${esc(page)}</figcaption>`;
        } catch (err) { b.disabled = false; b.textContent = 'Try again'; fig.querySelector('span').textContent = `${ref}. ${err.message}`; }
      };
    } else {
      fig.innerHTML = `<div class="fig-empty"><span>${esc(ref)}</span><a href="#/pictures?q=${encodeURIComponent(cap)}">Add picture</a></div>`;
    }
    el.replaceWith(fig);
  }
}

/* ---------- Chapters ---------- */

export const guideIndex = {
  title: 'Guide',
  nav: 'guide',
  async render() {
    const files = await guideFiles();
    if (!files.length) return `<h1>Guide</h1>${tabs('guide')}${emptyContent()}`;
    const rows = await Promise.all(files.map(async f => {
      const text = await content.getText(f.name);
      return { name: f.name, no: chapterNo(f.name), title: titleOf(text, f.name), sections: renderMd(text).toc.filter(t => t.level === 2).length };
    }));
    return `<h1>Guide</h1>${tabs('guide')}
      <ul class="rows">${rows.map(r => `<li><a class="row" href="#/guide/${encodeURIComponent(r.name)}">
        <span class="row-num">${esc(r.no)}</span>
        <span class="row-main"><span class="row-title">${esc(r.title)}</span>
        <span class="row-sub">${r.sections ? plural(r.sections, 'section') : esc(r.name)}</span></span></a></li>`).join('')}</ul>`;
  },
};

const SAFETY = `<aside class="safety" role="note"><strong>Information only, not a diagnosis.</strong>
  The book says its injury chapters are for information, to see a medical professional, and to follow your doctor or therapist when they say something different (pp. 67, 195, 263, 290).</aside>`;

export const guidePage = {
  title: 'Guide',
  nav: 'guide',
  async render([name, anchor]) {
    const file = decodeURIComponent(name || '');
    const text = await content.getText(file);
    if (text == null) return `<h1>Not found</h1><p>${esc(file)} isn’t on this phone.</p><a class="btn" href="#/guide">All chapters</a>`;
    const body = text.replace(/^#\s+.+\n/, ''); // the title becomes the page heading
    const { html, toc } = renderMd(body);
    const files = await guideFiles();
    const i = files.findIndex(f => f.name === file);
    const prev = files[i - 1], next = files[i + 1];
    const health = /health|injur/i.test(file);
    this._anchor = anchor;
    return `<a class="back" href="#/guide">Chapters</a>
      <h1>${esc(titleOf(text, file))}</h1>
      ${health ? SAFETY : ''}
      ${toc.length > 3 ? `<details class="toc"><summary>On this page</summary><ul>${toc.map(t =>
        `<li class="toc-${t.level}"><a href="#/guide/${encodeURIComponent(file)}/${t.id}">${t.text}</a></li>`).join('')}</ul></details>` : ''}
      <article class="prose">${html}</article>
      ${health ? SAFETY : ''}
      <nav class="pager">${prev ? `<a class="btn" href="#/guide/${encodeURIComponent(prev.name)}">Previous chapter</a>` : '<span></span>'}
        ${next ? `<a class="btn" href="#/guide/${encodeURIComponent(next.name)}">Next chapter</a>` : ''}</nav>`;
  },
  bind(root) {
    hydrateFigures(root);
    if (this._anchor) {
      const el = document.getElementById(this._anchor);
      if (el) requestAnimationFrame(() => el.scrollIntoView());
    }
  },
  keepScroll: true,
};

/* ---------- Exercises ---------- */

function query() {
  const q = (location.hash.split('?')[1] || '');
  return Object.fromEntries(new URLSearchParams(q));
}
function setQuery(route, params) {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  history.replaceState(null, '', `#/${route}${s ? '?' + s : ''}`);
}

export const exerciseList = {
  title: 'Exercises',
  nav: 'guide',
  async render() {
    const ex = await exercises();
    if (!ex) return `<h1>Exercises</h1>${tabs('exercises')}${emptyContent()}`;
    const q = query();
    const fams = Object.keys(FAMILY).filter(f => ex.list.some(e => e.family === f));
    return `<h1>Exercises</h1>${tabs('exercises')}
      <label class="sr" for="ex-q">Search exercises</label>
      <input id="ex-q" type="search" placeholder="Search ${ex.list.length} exercises" value="${esc(q.q || '')}" autocomplete="off">
      <div class="chips" role="group" aria-label="Family">
        <button type="button" data-f="" aria-pressed="${!q.f}">All</button>
        ${fams.map(f => `<button type="button" data-f="${f}" aria-pressed="${q.f === f}">${esc(FAMILY[f])}</button>`).join('')}
      </div>
      <p class="dim small" id="ex-count" aria-live="polite"></p>
      <div id="ex-list"></div>`;
  },
  async bind(root) {
    const ex = await exercises();
    if (!ex) return;
    const titles = await progressionTitles();
    let fam = query().f || '';
    const input = $('#ex-q', root);

    const draw = () => {
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = ex.list.filter(e => (!fam || e.family === fam) &&
        words.every(w => `${e.name} ${e.chart_label || ''} ${e.id} ${(e.equipment || []).join(' ')}`.toLowerCase().includes(w)));
      // Group by progression line; moves not on a line go last within their family.
      const groups = new Map();
      for (const e of hits) {
        const g = e.progression ? `p:${e.progression}` : `f:${e.family}`;
        if (!groups.has(g)) groups.set(g, { title: e.progression ? (titles.get(e.progression) || e.progression.replace(/-/g, ' ')) : `${FAMILY[e.family] || e.family}: other moves`, items: [], loose: !e.progression });
        groups.get(g).items.push(e);
      }
      const sorted = [...groups.values()].sort((a, b) => a.loose - b.loose);
      $('#ex-count', root).textContent = `${plural(hits.length, 'exercise')}${words.length || fam ? ' match' + (hits.length === 1 ? 'es' : '') : ''}`;
      $('#ex-list', root).innerHTML = sorted.map(g => `<section class="ladder"><h2>${esc(g.title)}</h2><ul class="rows">${
        g.items.sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || (a.step ?? 99) - (b.step ?? 99) || a.name.localeCompare(b.name)).map(e => `
        <li><a class="row" href="#/exercise/${encodeURIComponent(e.id)}">
          <span class="row-num" aria-label="${e.level ? 'Level ' + e.level : 'No level'}">${e.level ?? '–'}</span>
          <span class="row-main"><span class="row-title">${esc(e.name)}</span>
          <span class="row-sub">${[e.measure ? esc(e.measure.replace('_', ' ')) : '', e.off_chart ? 'off the chart' : '', e.status.startsWith('partial') ? 'partly in the book' : ''].filter(Boolean).join(', ')}</span></span></a></li>`).join('')
      }</ul></section>`).join('') || '<p>No exercises match. Try fewer words.</p>';
    };

    let t;
    input.oninput = () => { clearTimeout(t); t = setTimeout(() => { setQuery('exercises', { q: input.value, f: fam }); draw(); }, 150); };
    $$('.chips button', root).forEach(b => b.onclick = () => {
      fam = b.dataset.f;
      $$('.chips button', root).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      setQuery('exercises', { q: input.value, f: fam });
      draw();
    });
    draw();
  },
};

const GENERIC_MOVE_UP = `The book gives no exact number for this step. Use its general test: move up when your <strong>last set beats your first set by 2 or more</strong> reps or seconds (pp. 117–118, 121). Untrained beginners first build to 15–20 reps; holds use the sweet-spot table (p. 95).`;

export const exerciseDetail = {
  title: 'Exercise',
  nav: 'guide',
  async render([rawId]) {
    const ex = await exercises();
    if (!ex) return `<h1>Exercise</h1>${emptyContent()}`;
    const id = decodeURIComponent(rawId || '');
    const e = ex.byId.get(id);
    if (!e) return `<a class="back" href="#/exercises">Exercises</a><h1>Not found</h1><p>No exercise with the id ${esc(id)}.</p>`;
    const titles = await progressionTitles();
    this.title = e.name;

    const link = x => {
      const o = ex.byId.get(x);
      return o ? `<li><a class="row" href="#/exercise/${encodeURIComponent(o.id)}"><span class="row-num">${o.level ?? '–'}</span>
        <span class="row-main"><span class="row-title">${esc(o.name)}</span></span></a></li>` : `<li class="dim">${esc(x)}</li>`;
    };
    const list = (title, items) => items?.length ? `<h2>${title}</h2><ul class="bullets">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
    const g = e.guidance || {};
    const dose = [['Sets', g.sets], ['Reps', g.reps], ['Hold', g.hold_seconds != null ? `${g.hold_seconds} s` : null], ['Rest', g.rest], ['Tempo', g.tempo]].filter(([, v]) => v != null && v !== '');
    const line = e.progression ? (titles.get(e.progression) || e.progression) : null;
    const fam = FAMILY[e.family];
    const where = [e.level != null ? `Level ${e.level}` : 'No chart level', line,
      line && fam && line.toLowerCase().startsWith(fam.toLowerCase().slice(0, 5)) ? null : fam].filter(Boolean);
    // Exercise ids mentioned in the book notes become links to that exercise.
    const linkIds = text => esc(text).replace(/\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b/g, w => {
      const o = ex.byId.get(w);
      return o ? `<a href="#/exercise/${encodeURIComponent(w)}">${esc(o.name)}${o.level != null ? ` (L${o.level})` : ''}</a>` : w;
    });
    const moveUp = e.advance_when
      ? `<p>${linkIds(e.advance_when)}</p>${/NOT IN BOOK/.test(e.advance_when) ? `<p class="dim small">${GENERIC_MOVE_UP}</p>` : ''}`
      : `<p>${GENERIC_MOVE_UP}</p>`;

    return `<a class="back" href="#/exercises${e.family ? '?f=' + e.family : ''}">Exercises</a>
      <div class="ex-head"><span class="ex-level">${e.level ?? '–'}</span>
        <div><h1>${esc(e.name)}</h1><p class="dim">${where.map(esc).join(', ')}${e.off_chart ? '. Taught in the text, not on the chart' : ''}</p></div></div>

      ${e.iron_cross_prereq ? `<aside class="safety" role="note"><strong>Prerequisite work for the iron cross.</strong> This is one of the gray chart cells the book recommends before iron cross and one-arm chin-up training (pp. 155, 447).</aside>` : ''}

      <section class="panel"><h2 style="margin-top:0">Move up when</h2>
        ${moveUp}
        ${e.measure ? `<p class="dim small">Measured in ${esc(e.measure.replace('_', ' '))}.</p>` : ''}</section>

      ${dose.length ? `<h2>Dose</h2><dl class="facts">${dose.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${list('How to do it', e.cues)}
      ${list('Common mistakes', e.mistakes)}
      ${e.warmup_use ? `<h2>In a warm-up</h2><p>${linkIds(e.warmup_use)}</p>` : ''}
      ${e.routine_use?.length ? list('In a routine', e.routine_use) : ''}
      ${e.prerequisites?.length ? `<h2>Before this</h2><ul class="rows">${e.prerequisites.map(link).join('')}</ul>` : ''}
      ${e.next?.length ? `<h2>Next step</h2><ul class="rows">${e.next.map(link).join('')}</ul>` : ''}
      ${e.same_as?.length ? `<h2>Same move, listed elsewhere</h2><ul class="rows">${e.same_as.map(link).join('')}</ul>` : ''}
      ${e.equipment?.length ? `<h2>Equipment</h2><p>${e.equipment.map(esc).join(', ')}</p>` : ''}
      ${e.figures?.length ? `<h2>Pictures</h2>${e.figures.map(f => slot(e.id, f)).join('')}` : ''}
      ${e.figures_note ? `<p class="dim small">${esc(e.figures_note)}</p>` : ''}
      ${e.note || e.status.startsWith('partial') ? `<h2>Notes</h2>${e.note ? `<p>${linkIds(e.note)}</p>` : ''}${e.status.startsWith('partial') ? `<p class="dim">${esc(e.status)}</p>` : ''}` : ''}
      <h2>In the book</h2><p class="dim">${(e.source_pages || []).map(sourceLabel).filter((v, i, a) => a.indexOf(v) === i).map(esc).join('; ')}</p>`;
  },
  bind(root) { hydrateFigures(root); },
};

/* ---------- Pictures ---------- */

/** Every picture the book content refers to, one entry per distinct illustration. */
async function allPictures() {
  const ex = await exercises();
  const groups = new Map();
  const add = (exerciseId, figure, page, ownerName) => {
    const gid = `${slug(figure)}-p${page}`;
    if (!groups.has(gid)) groups.set(gid, { gid, caption: figure, page, slots: [], owners: [] });
    const g = groups.get(gid);
    if (!g.slots.some(s => s.exercise_id === exerciseId)) {
      g.slots.push({ exercise_id: exerciseId, figure, page });
      g.owners.push({ id: exerciseId, name: ownerName, isExercise: !!ex?.byId.has(exerciseId) });
    }
  };
  for (const e of ex?.list || []) for (const f of e.figures || []) add(e.id, f.figure, f.page, e.name);
  // Pictures that belong to no exercise (charts, diagrams) — only in the guide files.
  for (const f of await guideFiles()) {
    for (const p of placeholders(await content.getText(f.name))) {
      if (!ex?.byId.has(p.id)) add(p.id, p.caption, p.page, 'Book picture');
    }
  }
  return [...groups.values()].sort((a, b) => a.page - b.page || a.caption.localeCompare(b.caption));
}

export const pictures = {
  title: 'Pictures',
  nav: 'guide',
  async render() {
    const ex = await exercises();
    if (!ex) return `<h1>Pictures</h1>${tabs('pictures')}${emptyContent()}`;
    const q = query();
    return `<h1>Pictures</h1>${tabs('pictures')}
      <p>Each picture stays private in your Google Drive. Paste its Drive link once; the app fetches it through your Apps Script and can keep a copy on this phone.</p>
      <section class="panel" aria-labelledby="h-pics">
        <h2 id="h-pics" style="margin-top:0">On this phone</h2>
        <p id="pic-summary" class="dim"></p>
        <div class="bar" id="pic-bar" hidden><i></i></div>
        <button class="btn primary wide" id="pic-all" type="button">Save linked pictures on this phone</button>
        <p class="msg" id="pic-msg" role="status"></p>
      </section>
      <label class="sr" for="pic-q">Search pictures</label>
      <input id="pic-q" type="search" placeholder="Search captions or page numbers" value="${esc(q.q || '')}" autocomplete="off">
      <div class="chips" role="group" aria-label="Show">
        <button type="button" data-s="" aria-pressed="${!q.s}">All</button>
        <button type="button" data-s="missing" aria-pressed="${q.s === 'missing'}">Needs a link</button>
        <button type="button" data-s="linked" aria-pressed="${q.s === 'linked'}">Linked</button>
      </div>
      <p class="dim small" id="pic-count" aria-live="polite"></p>
      <ul class="pics" id="pic-list"></ul>`;
  },
  async bind(root) {
    const all = await allPictures();
    let { links, saved } = await content.imageIndex();
    let show = query().s || '';
    const input = $('#pic-q', root);
    const linkOf = g => g.slots.map(s => links.get(content.imageKey(s.exercise_id, s.figure))?.drive_link).find(Boolean) || '';

    const summary = () => {
      const linked = all.filter(g => linkOf(g)).length;
      const kept = all.filter(g => saved.has(content.fileId(linkOf(g)))).length;
      $('#pic-summary', root).textContent = `${plural(all.length, 'picture')}: ${linked} linked, ${kept} saved on this phone.`;
    };

    const item = g => {
      const link = linkOf(g);
      const owners = g.owners.map(o => o.isExercise ? `<a href="#/exercise/${encodeURIComponent(o.id)}">${esc(o.name)}</a>` : esc(o.name));
      return `<li><details data-gid="${esc(g.gid)}">
        <summary><span class="pic-state" data-on="${!!link}" aria-label="${link ? 'Linked' : 'Needs a link'}"></span>
          <span class="row-main"><span class="row-title">${esc(g.caption)}</span><span class="row-sub">p. ${g.page}, ${owners.length > 2 ? plural(owners.length, 'step') : owners.join(', ')}</span></span></summary>
        <div class="pic-body">
          ${owners.length > 2 ? `<p class="small">Used by ${owners.join(', ')}.</p>` : ''}
          <label for="l-${esc(g.gid)}">Google Drive link</label>
          <div class="field-row"><input id="l-${esc(g.gid)}" type="url" inputmode="url" value="${esc(link)}" placeholder="https://drive.google.com/file/d/…" spellcheck="false" autocapitalize="off">
            <button class="btn primary" type="button" data-act="save">Save</button></div>
          <div class="pic-preview"></div>
          <p class="msg" role="status"></p>
        </div></details></li>`;
    };

    const draw = () => {
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = all.filter(g => (!show || (show === 'linked') === !!linkOf(g)) &&
        words.every(w => `${g.caption} p${g.page} ${g.page} ${g.owners.map(o => o.name).join(' ')}`.toLowerCase().includes(w)));
      $('#pic-count', root).textContent = plural(hits.length, 'picture');
      const shown = hits.slice(0, 120);
      $('#pic-list', root).innerHTML = shown.map(item).join('') + (hits.length > shown.length ? `<li class="dim small">${hits.length - shown.length} more. Search to narrow the list.</li>` : '');
      summary();
    };

    $('#pic-list', root).addEventListener('toggle', async e => {
      const d = e.target;
      if (!d.open || d.tagName !== 'DETAILS') return;
      const g = all.find(x => x.gid === d.dataset.gid), link = linkOf(g), prev = $('.pic-preview', d);
      if (!link || prev.dataset.done) return;
      prev.dataset.done = '1';
      prev.innerHTML = `<button class="btn" type="button">Show picture</button>`;
      const show = async () => {
        prev.textContent = 'Loading…';
        try { prev.innerHTML = `<img alt="${esc(g.caption)}" src="${await content.loadImage(link)}">`; ({ links, saved } = await content.imageIndex()); summary(); }
        catch (err) { prev.innerHTML = ''; say($('.msg', d), err.message, false); prev.dataset.done = ''; }
      };
      if (saved.has(content.fileId(link))) show(); else $('button', prev).onclick = show;
    }, true);

    $('#pic-list', root).addEventListener('click', async e => {
      const b = e.target.closest('button[data-act="save"]');
      if (!b) return;
      const d = b.closest('details'), g = all.find(x => x.gid === d.dataset.gid), msg = $('.msg', d);
      const value = $('input', d).value;
      b.disabled = true; say(msg, 'Saving to your Sheet…');
      try {
        await content.setImageLink(g.slots, value);
        ({ links, saved } = await content.imageIndex());
        say(msg, value.trim() ? `Saved for ${plural(g.slots.length, 'step')}.` : 'Link removed.', true);
        $('.pic-state', d).dataset.on = String(!!value.trim());
        const prev = $('.pic-preview', d); prev.innerHTML = ''; prev.dataset.done = '';
        summary();
      } catch (err) { say(msg, err.message, false); }
      b.disabled = false;
    });

    $('#pic-all', root).onclick = async e => {
      const b = e.currentTarget, msg = $('#pic-msg', root), bar = $('#pic-bar', root);
      b.disabled = true; say(msg, '');
      try {
        const r = await content.saveAllImages(p => { fill(bar, p.done, p.total); say(msg, p.total ? `Saving ${p.done} of ${p.total}…` : 'Nothing new to save.'); });
        ({ links, saved } = await content.imageIndex());
        say(msg, `Saved ${plural(r.saved, 'picture')}${r.already ? `, ${r.already} already here` : ''}.${r.failed.length ? ` ${r.failed.length} couldn’t be read; check those links.` : ''}`, !r.failed.length);
        summary();
      } catch (err) { say(msg, err.message + ' Saved pictures are kept; tap again to continue.', false); }
      bar.hidden = true; b.disabled = false;
    };

    let t;
    input.oninput = () => { clearTimeout(t); t = setTimeout(() => { setQuery('pictures', { q: input.value, s: show }); draw(); }, 150); };
    $$('.chips button', root).forEach(btn => btn.onclick = () => {
      show = btn.dataset.s;
      $$('.chips button', root).forEach(x => x.setAttribute('aria-pressed', String(x === btn)));
      setQuery('pictures', { q: input.value, s: show });
      draw();
    });
    draw();
  },
};
