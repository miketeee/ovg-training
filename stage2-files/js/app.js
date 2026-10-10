// app.js — router, header status, and the pages built so far.
import * as db from './storage.js';
import * as sync from './sync.js';

export const APP_VERSION = '2.0.0'; // keep in step with VERSION in sw.js

const $ = (sel, root = document) => root.querySelector(sel);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function ago(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return plural(Math.round(s / 60), 'minute') + ' ago';
  if (s < 86400) return plural(Math.round(s / 3600), 'hour') + ' ago';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/* ---------- header chip + chalk line ---------- */

function chipText(st) {
  const n = st.waiting?.sets || st.waiting?.total || 0; // count sets; a lone workout still shows
  switch (st.state) {
    case 'setup': return 'Set up sync';
    case 'sending': return `Sending ${st.done || 0}/${st.total || 0}`;
    case 'pulling': return 'Syncing…';
    case 'offline': return n ? `Offline, ${n} waiting` : 'Offline';
    case 'waiting': return `${n} waiting`;
    case 'unauthorized': return 'Phrase rejected';
    case 'error': return n ? `Not sent, ${n} waiting` : 'Sync problem';
    case 'synced': return 'Synced';
    default: return 'Starting…';
  }
}

sync.onStatus(st => {
  const chip = $('#chip');
  if (!chip) return;
  chip.dataset.state = st.state;
  $('#chip-text').textContent = chipText(st);
  const line = $('#chalkline');
  const busy = st.state === 'sending' || st.state === 'pulling';
  line.hidden = !busy;
  $('#chalkline > i').style.width = st.state === 'sending' && st.total
    ? `${Math.round(100 * (st.done || 0) / st.total)}%` : busy ? '100%' : '0';
});

/* ---------- pages ---------- */

const comingSoon = (title, stage, text) => ({
  title,
  render: () => `<h1>${esc(title)}</h1>
    <div class="empty"><div class="stage">Arrives in Stage ${stage}</div><p class="dim">${esc(text)}</p></div>`,
});

const routes = {
  today: {
    title: 'Today',
    render: async () => {
      const [sessions, sets, cfg] = await Promise.all([db.count('sessions'), db.count('sets'), sync.getConfig()]);
      const setUp = cfg.url && cfg.secret;
      return `<h1>Today</h1>
        ${setUp ? '' : `<div class="panel"><h2 style="margin-top:0">Connect your Sheet first</h2>
          <p>Paste your Apps Script /exec URL and secret phrase so your training logs can reach your Google Sheet.</p>
          <a class="btn primary wide" href="#/sync">Set up sync</a></div>`}
        <div class="empty"><div class="stage">Logging arrives in Stage 4</div>
          <p class="dim">You’ll start a workout here and log each set. It works with no signal; sets wait on the phone until they can be sent.</p></div>
        <div class="panel"><dl class="facts">
          <dt>Workouts on this phone</dt><dd>${sessions}</dd>
          <dt>Sets on this phone</dt><dd>${sets}</dd></dl></div>`;
    },
  },
  guide: comingSoon('Guide', 3, 'The guide and the exercise library load from your Google Sheet once sync is set up, then stay on this phone for offline use.'),
  progress: comingSoon('Progress', 5, 'Charts of your sets over time, and where you stand on each progression ladder.'),
  plan: comingSoon('Plan', 6, 'A routine built from your levels and the book’s programming rules.'),
  sync: { title: 'Sync', render: renderSync, bind: bindSync },
};

/* ---------- Sync page ---------- */

async function renderSync() {
  const [cfg, cp, sessions, sets, persisted] = await Promise.all([
    sync.getConfig(), sync.getCheckpoint(), db.count('sessions'), db.count('sets'),
    navigator.storage?.persisted ? navigator.storage.persisted().catch(() => false) : false,
  ]);
  const setUp = !!(cfg.url && cfg.secret);
  return `<h1>Sync</h1>

  <section class="panel" aria-labelledby="h-waiting">
    <h2 id="h-waiting" class="dim small" style="margin:0 0 4px;font:600 16px/1.2 var(--body)">Waiting on this phone</h2>
    <div class="count" id="count" data-zero="true"><b id="count-n">0</b><span id="count-label">sets waiting to sync</span></div>
    <div class="bar" id="bar" hidden><i></i></div>
    <p class="dim small" id="sync-line"></p>
    <button class="btn primary wide" id="sync-now" type="button" ${setUp ? '' : 'disabled'}>Sync now</button>
    <p class="msg" id="sync-msg" role="status"></p>
  </section>

  <h2>Connection</h2>
  <form class="panel" id="cfg" autocomplete="off" novalidate>
    <label for="url">Apps Script /exec URL</label>
    <input id="url" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cfg.url)}" spellcheck="false" autocapitalize="off">
    <label for="secret">Secret phrase</label>
    <div class="field-row">
      <input id="secret" type="password" value="${esc(cfg.secret)}" spellcheck="false" autocapitalize="off" autocomplete="off">
      <button class="btn" id="reveal" type="button" aria-pressed="false">Show</button>
    </div>
    <span class="hint">Saved on this phone only. It’s sent only to your own Apps Script, with every request.</span>
    <div class="actions"><button class="btn primary" type="submit">Save and test</button></div>
    <p class="msg" id="cfg-msg" role="status"></p>
  </form>

  <h2>Try the outbox</h2>
  <div class="panel">
    <p>Adds a practice set to a workout called “Stage 2 test.” Try it in airplane mode: the count above goes up, then sends itself when you’re back online.</p>
    <button class="btn wide" id="test-set" type="button">Add a test set</button>
    <p class="msg" id="test-msg" role="status"></p>
  </div>

  <h2>This phone</h2>
  <div class="panel">
    <dl class="facts">
      <dt>Workouts stored</dt><dd id="f-sessions">${sessions}</dd>
      <dt>Sets stored</dt><dd id="f-sets">${sets}</dd>
      <dt>Last synced</dt><dd id="f-last">${esc(ago(cp.last_pull || cp.last_flush))}</dd>
      <dt>Storage kept safe</dt><dd>${persisted ? 'Yes' : 'Not guaranteed'}</dd>
      <dt>App version</dt><dd>${APP_VERSION}</dd>
    </dl>
    <div class="actions"><button class="btn danger" id="forget" type="button" ${setUp ? '' : 'disabled'}>Forget URL and phrase</button></div>
    <p class="msg" id="forget-msg" role="status"></p>
  </div>`;
}

function bindSync(root) {
  const show = (el, text, good) => { el.textContent = text; el.className = 'msg' + (good === true ? ' good' : good === false ? ' bad' : ''); };

  const off = [];
  const paint = st => {
    if (!root.isConnected) return;
    const w = st.waiting || { total: 0, sets: 0, sessions: 0 };
    const n = w.sets, extra = w.sessions;
    $('#count-n', root).textContent = n;
    $('#count', root).dataset.zero = String(n + extra === 0);
    $('#count-label', root).innerHTML = (n === 1 ? 'set' : 'sets') + ' waiting to sync' + (extra ? `<small>plus ${plural(extra, 'workout')}</small>` : '');
    if (!['sending', 'pulling'].includes(st.state)) {
      Promise.all([db.count('sessions'), db.count('sets'), sync.getCheckpoint()]).then(([a, b, cp]) => {
        if (!root.isConnected) return;
        $('#f-sessions', root).textContent = a; $('#f-sets', root).textContent = b;
        $('#f-last', root).textContent = ago(cp.last_pull || cp.last_flush);
      }).catch(() => {});
    }
    const bar = $('#bar', root);
    bar.hidden = st.state !== 'sending';
    if (st.state === 'sending') $('#bar > i', root).style.width = `${st.total ? Math.round(100 * st.done / st.total) : 0}%`;
    const line = {
      setup: 'Add your /exec URL and secret phrase below.',
      sending: `Sending ${st.done || 0} of ${st.total || 0}…`,
      pulling: 'Checking your Sheet for new logs…',
      offline: 'Offline. Everything waits here and sends itself when you’re back online.',
      waiting: 'These send automatically. Tap Sync now to send them right away.',
      synced: `Everything is in your Sheet. Last synced ${ago(st.last_sync)}.`,
      unauthorized: 'Fix the phrase under Connection, then tap Sync now. Waiting sets are safe on this phone.',
      error: 'The last try didn’t go through. Waiting sets are still safe on this phone.',
    }[st.state] || '';
    $('#sync-line', root).textContent = line;
    $('#sync-now', root).disabled = st.state === 'setup' || st.state === 'sending' || st.state === 'pulling';
    if ((st.state === 'error' || st.state === 'unauthorized') && st.message) show($('#sync-msg', root), st.message, false);
  };
  off.push(sync.onStatus(paint));

  $('#sync-now', root).onclick = async () => {
    show($('#sync-msg', root), '');
    sync.clearError();
    const st = await sync.syncNow({ full: true });
    if (st.state === 'synced') show($('#sync-msg', root), `Done. Sent ${st.sent || 0}, received ${st.received || 0}.`, true);
  };

  $('#reveal', root).onclick = e => {
    const input = $('#secret', root), on = input.type === 'password';
    input.type = on ? 'text' : 'password';
    e.currentTarget.textContent = on ? 'Hide' : 'Show';
    e.currentTarget.setAttribute('aria-pressed', String(on));
  };

  $('#cfg', root).onsubmit = async e => {
    e.preventDefault();
    const msg = $('#cfg-msg', root);
    const url = $('#url', root).value.trim(), secret = $('#secret', root).value;
    const bad = sync.checkUrl(url);
    if (bad) return show(msg, bad, false);
    if (!secret) return show(msg, 'Type your secret phrase.', false);
    if (secret !== secret.trim()) return show(msg, 'The phrase starts or ends with a space. Remove it unless it’s really part of your phrase.', false);
    show(msg, 'Testing…');
    try {
      const r = await sync.ping({ url, secret });
      await sync.saveConfig(url, secret);
      show(msg, `Connected. Saved on this phone. Your Sheet has ${plural((r.tabs || []).length, 'tab')}.`, true);
      $('#forget', root).disabled = false;
      sync.clearError();
      sync.syncNow({ full: true });
    } catch (err) {
      const extra = err.kind === 'unauthorized' ? ' Check for typos, then compare it with the SECRET script property.' : '';
      show(msg, err.message + extra + ' Nothing was saved.', false);
    }
  };

  $('#test-set', root).onclick = async () => {
    const msg = $('#test-msg', root);
    try {
      const d = today(), sid = `test-s2-${d}`;
      const existing = await db.get('sessions', sid);
      const sets = existing ? await db.byIndex('sets', 'session_id', sid) : [];
      const items = [];
      if (!existing) items.push({ kind: 'session', record: { id: sid, date: d, started_at: new Date().toISOString(), notes: 'Stage 2 test — safe to delete' } });
      items.push({ kind: 'set', record: {
        id: db.newId('set'), session_id: sid, exercise_id: 'pullups-bar-pull-ups', set_index: sets.length + 1,
        measure: 'reps', reps: 5, effort: 7, effort_scale: 'rpe', notes: 'Stage 2 test — safe to delete',
      } });
      await sync.queue(items);
      show(msg, `Added test set ${sets.length + 1}.${navigator.onLine ? '' : ' You’re offline, so it’s waiting.'}`, true);
    } catch (err) {
      show(msg, 'Couldn’t save on this phone: ' + err.message, false);
    }
  };

  let armed = false;
  $('#forget', root).onclick = async e => {
    const msg = $('#forget-msg', root);
    if (!armed) {
      armed = true;
      e.currentTarget.textContent = 'Tap again to forget';
      show(msg, 'Your logs stay on this phone and in your Sheet. You’ll need to paste the URL and phrase again to sync.');
      setTimeout(() => { if (armed && root.isConnected) { armed = false; e.target.textContent = 'Forget URL and phrase'; show(msg, ''); } }, 5000);
      return;
    }
    await sync.forgetDevice();
    route();
  };

  return () => off.forEach(f => f());
}

/* ---------- router ---------- */

let cleanup = null;
async function route() {
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'today';
  const page = routes[name] || routes.today;
  document.querySelectorAll('.nav a').forEach(a => {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${page.title} · OVG Training`;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const view = $('#view');
  try {
    view.innerHTML = await page.render();
    cleanup = page.bind ? page.bind(view) : null;
  } catch (err) {
    view.innerHTML = `<h1>Something went wrong</h1><p class="msg bad">${esc(err.message)}</p>
      <p class="dim">If this says storage is blocked, turn off private browsing for this site.</p>`;
  }
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/* ---------- toast + service worker updates ---------- */

function toast(text, btnText, onClick) {
  $('#toast-text').textContent = text;
  const b = $('#toast-btn');
  b.textContent = btnText;
  b.onclick = onClick;
  $('#toast').hidden = false;
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    const offer = w => toast('A new version is ready.', 'Reload', () => w.postMessage('skip-waiting'));
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  } catch { /* offline first load or unsupported: the app still works online */ }
}

/* ---------- start ---------- */

addEventListener('hashchange', route);
(async () => {
  try { await db.openDB(); }
  catch (err) {
    $('#view').innerHTML = `<h1>Storage is blocked</h1><p class="msg bad">${esc(err.message)}</p>
      <p>This app keeps your logs on the phone. Turn off private browsing for this site, then reload.</p>`;
    return;
  }
  db.askPersistent();
  await route();
  sync.startAuto();
  registerSW();
})();
