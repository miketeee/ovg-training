// app.js — router, header status, and the pages built so far.
import * as db from './storage.js';
import * as sync from './sync.js';
import * as content from './content.js';
import * as library from './library.js';
import * as workouts from './workout.js';
import * as progress from './progress.js';
import { $, esc, plural, today, ago, kb, say, fill } from './ui.js';

export const APP_VERSION = '5.0.0'; // keep in step with VERSION in sw.js

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
  today: workouts.today,           // #/today
  workout: workouts.workout,       // #/workout/<id>[?ex=<exercise id>]  and  #/workout/<id>/add
  guide: library.guideIndex,       // #/guide            and #/guide/<file>[/<section>]
  exercises: library.exerciseList, // #/exercises[?f=family&q=words]
  exercise: library.exerciseDetail,// #/exercise/<id>
  pictures: library.pictures,      // #/pictures[?q=words&s=missing|linked]
  progress: progress.progressPage, // #/progress[?ex=<exercise id>&r=28|90|]
  ladders: progress.laddersPage,   // #/ladders
  ladder: progress.ladderPage,     // #/ladder/<progression id>
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

  <h2>Book content</h2>
  <section class="panel" aria-labelledby="h-content">
    <p id="c-summary">Checking…</p>
    <div class="bar" id="c-bar" hidden><i></i></div>
    <p class="msg" id="c-msg" role="status"></p>
    <div class="actions">
      <button class="btn primary" id="c-get" type="button" ${setUp ? '' : 'disabled'}>Get latest from Sheet</button>
      <button class="btn wide" id="c-resume" type="button" style="flex-basis:100%" hidden>Resume upload</button>
    </div>
    <details class="more" id="c-upload-box">
      <summary id="h-content">Upload content files to your Sheet</summary>
      <p class="small">Do this once, ideally from a computer, with the content files (the guide <code>.md</code> files and the four <code>.json</code> files). They go to your Sheet and onto this device. Other devices then tap <strong>Get latest from Sheet</strong>. Never put these files on GitHub.</p>
      <label class="btn wide filepick" for="c-files">Choose files</label>
      <input id="c-files" type="file" multiple accept=".md,.json,text/markdown,application/json" class="sr">
      <p class="small" id="c-chosen" aria-live="polite"></p>
      <button class="btn primary wide" id="c-send" type="button" hidden>Upload</button>
    </details>
  </section>

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
  const show = say;

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
      show(msg, (r.schema || 1) < 2
        ? 'Connected and saved, but your Apps Script is the old version. Paste the new Code.gs, then Deploy → Manage deployments → Edit → Version: New version → Deploy.'
        : `Connected. Saved on this phone. Your Sheet has ${plural((r.tabs || []).length, 'tab')}.`, (r.schema || 1) >= 2);
      $('#forget', root).disabled = false;
      $('#c-get', root).disabled = false;
      sync.clearError();
      sync.syncNow({ full: true });
    } catch (err) {
      const extra = err.kind === 'unauthorized' ? ' Check for typos, then compare it with the SECRET script property.' : '';
      show(msg, err.message + extra + ' Nothing was saved.', false);
    }
  };

  off.push(bindContent(root));

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

/* ---------- Book content (on the Sync page) ---------- */

function bindContent(root) {
  const msg = $('#c-msg', root), bar = $('#c-bar', root);
  let chosen = [];

  const summary = async () => {
    if (!root.isConnected) return;
    const [files, up, last] = await Promise.all([content.listFiles(), content.uploadState(), db.getValue('checkpoints', 'content.last_check')]);
    const size = files.reduce((n, f) => n + f.size, 0);
    const guides = files.filter(f => f.kind === 'guide').length, data = files.filter(f => f.kind === 'data').length;
    $('#c-summary', root).textContent = files.length
      ? `On this device: ${plural(guides, 'guide file')} and ${plural(data, 'data file')} (${kb(size)}). Last checked ${ago(last)}.`
      : 'Nothing on this device yet.';
    const resume = $('#c-resume', root);
    if (up) {
      const total = up.files.reduce((n, f) => n + f.total, 0), done = up.files.reduce((n, f) => n + f.sent.length, 0);
      resume.hidden = false;
      resume.textContent = `Resume upload (${done} of ${total} parts sent)`;
    } else resume.hidden = true;
  };
  summary();
  addEventListener('ovg:content', summary);

  const busy = on => ['#c-get', '#c-resume', '#c-send'].forEach(s => { $(s, root).disabled = on; });
  const progress = verb => p => {
    fill(bar, p.done, p.total);
    say(msg, p.total ? `${verb} ${p.done} of ${p.total}${p.name ? `: ${p.name}` : ''}` : 'Everything is already up to date.');
  };

  $('#c-get', root).onclick = async () => {
    busy(true);
    try {
      const r = await content.downloadChanged(progress('Downloading'));
      say(msg, r.checked ? (r.downloaded ? `Downloaded ${plural(r.downloaded, 'file')}. The rest were already current.` : `All ${r.checked} files are current.`)
        : 'Your Sheet has no content yet. Upload the files below.', !!r.checked);
      dispatchEvent(new Event('ovg:content'));
    } catch (err) { say(msg, err.message + (err.kind === 'offline' ? '' : ' Files already downloaded are kept; tap again to continue.'), false); }
    bar.hidden = true; busy(false);
  };

  const upload = async () => {
    busy(true);
    try {
      const r = await content.resumeUpload(progress('Uploading part'));
      say(msg, `Uploaded ${plural(r.files || 0, 'file')} to your Sheet.`, true);
      chosen = []; $('#c-chosen', root).textContent = ''; $('#c-send', root).hidden = true;
    } catch (err) { say(msg, err.message + ' Parts already sent are kept. Tap “Resume upload” to continue.', false); }
    bar.hidden = true; busy(false); summary(); dispatchEvent(new Event('ovg:content'));
  };
  $('#c-resume', root).onclick = upload;

  $('#c-files', root).onchange = async e => {
    const files = await Promise.all([...e.target.files].map(async f => ({ name: f.name, text: await f.text() })));
    const { ok, problems } = content.checkFiles(files);
    chosen = ok;
    const size = ok.reduce((n, f) => n + f.text.length, 0);
    $('#c-chosen', root).textContent = `${plural(ok.length, 'file')} ready (${kb(size)}).${problems.length ? ' ' + problems.join(' ') : ''}`;
    const send = $('#c-send', root);
    send.hidden = !ok.length;
    send.textContent = `Upload ${plural(ok.length, 'file')}`;
    e.target.value = '';
  };

  $('#c-send', root).onclick = async () => {
    if (!chosen.length) return;
    if (await content.uploadState()) await content.cancelUpload(); // a new choice replaces an unfinished upload
    await content.startUpload(chosen);
    upload();
  };

  return () => removeEventListener('ovg:content', summary);
}

/* ---------- router ---------- */

let cleanup = null;
let seq = 0;
async function route() {
  const my = ++seq;
  const [path, ] = location.hash.replace(/^#\/?/, '').split('?');
  const [name = 'today', ...args] = path.split('/').filter(Boolean);
  let page = routes[name] || routes.today;
  if (name === 'guide' && args.length) page = library.guidePage;
  const navName = page.nav || (routes[name] ? name : 'today');
  document.querySelectorAll('.nav a').forEach(a => {
    if (a.dataset.route === navName) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const view = $('#view');
  try {
    const html = await page.render(args);
    if (my !== seq) return; // a newer navigation started while this page loaded
    view.innerHTML = html;
    document.title = `${page.title} · OVG Training`;
    window.scrollTo(0, 0);
    const c = page.bind ? await page.bind(view) : null;
    cleanup = typeof c === 'function' ? c : null;
  } catch (err) {
    if (my !== seq) return;
    view.innerHTML = `<h1>Something went wrong</h1><p class="msg bad">${esc(err.message)}</p>
      <p class="dim">If this says storage is blocked, turn off private browsing for this site.</p>`;
  }
  view.focus({ preventScroll: true });
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
    let wantReload = false; // only reload when the person tapped Reload (not on the very first install)
    const offer = w => toast('A new version is ready.', 'Reload', () => { wantReload = true; w.postMessage('skip-waiting'); });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (wantReload && !reloading) { reloading = true; location.reload(); } });
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
  // Every full sync also fetches book content that changed in the Sheet.
  sync.onFullSync(async () => {
    const r = await content.downloadChanged();
    if (r.downloaded) dispatchEvent(new Event('ovg:content'));
  });
  await route();
  sync.startAuto();
  registerSW();
})();
