/**
 * OVG Training — Google Apps Script back end (Stage 1, + upsertLogs in Stage 4, + safe settings in 5.0.2)
 *
 * Deploy as a Web app:  Execute as: Me   |   Who has access: Anyone
 * Every request must be a POST with Content-Type: text/plain and a JSON body:
 *   { "action": "<name>", "secret": "<your secret phrase>", ...params }
 * The secret phrase lives ONLY in Script Properties (key: SECRET) and on your phone.
 *
 * Actions: ping, getContent, putContent, getLogs, appendLogs, upsertLogs,
 *          getSettings, setSettings, setImageLink, getImage
 */

// ---------- configuration ----------
var SCHEMA_VERSION = 4;           // 2 = upsertLogs; 3 = settings locked + de-duplicated; 4 = setSettings reads values back
var MAX_CELL = 45000;            // Sheets cell limit is 50,000 chars; stay under it
var MAX_IMAGE_BYTES = 8 * 1024 * 1024;

var TABS = {
  Content:   ['name', 'kind', 'upload_id', 'chunk_index', 'total_chunks', 'data', 'updated_at'],
  Exercises: ['id', 'json', 'updated_at'],
  Methods:   ['id', 'json', 'updated_at'],
  Programs:  ['id', 'json', 'updated_at'],
  Levels:    ['id', 'json', 'updated_at'],
  Images:    ['key', 'exercise_id', 'figure', 'page', 'drive_link', 'updated_at'],
  Sessions:  ['id', 'date', 'started_at', 'plan_id', 'notes', 'created_at', 'updated_at', 'deleted'],
  Sets:      ['id', 'session_id', 'exercise_id', 'set_index', 'measure', 'reps', 'hold_seconds',
              'effort', 'effort_scale', 'rest_seconds', 'added_weight', 'band_assist', 'unit',
              'notes', 'created_at', 'updated_at', 'deleted'],
  Settings:  ['key', 'value', 'updated_at']
};

// JSON content files that also get exploded one-record-per-row into their own tab
var DATA_TABS = { 'exercises.json': 'Exercises', 'methods.json': 'Methods',
                  'programs.json': 'Programs', 'levels.json': 'Levels' };

// ---------- entry points ----------
function doGet() {
  // No data is ever returned on GET.
  return json_({ ok: false, error: 'Use POST with a JSON body.' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Body is not valid JSON.' });
  }
  if (!checkSecret_(req.secret)) {
    Utilities.sleep(500); // slow down guessing
    return json_({ ok: false, error: 'Unauthorized.' });
  }
  var handlers = {
    ping: ping_, getContent: getContent_, putContent: putContent_,
    getLogs: getLogs_, appendLogs: appendLogs_, upsertLogs: upsertLogs_,
    getSettings: getSettings_, setSettings: setSettings_,
    setImageLink: setImageLink_, getImage: getImage_
  };
  var fn = handlers[req.action];
  if (!fn) return json_({ ok: false, error: 'Unknown action: ' + req.action });
  try {
    var out = fn(req) || {};
    out.ok = true;
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------- one-time setup (run from the editor) ----------
/** Creates all tabs with header rows. Safe to run again. */
function setup() {
  var ss = ss_();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var hdr = TABS[name];
    sh.getRange(1, 1, 1, hdr.length).setValues([hdr]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  // Touch DriveApp so the authorization prompt includes Drive (needed by getImage).
  DriveApp.getRootFolder();
  var hasSecret = !!PropertiesService.getScriptProperties().getProperty('SECRET');
  Logger.log('Tabs ready. SECRET set: ' + hasSecret);
}

// ---------- actions ----------
function ping_() {
  return { pong: true, schema: SCHEMA_VERSION, time: new Date().toISOString(),
           tabs: Object.keys(TABS).filter(function (t) { return !!ss_().getSheetByName(t); }) };
}

/**
 * getContent
 *  - no name: returns a manifest of complete uploads + all image links
 *  - name: returns the reassembled text of that file (latest complete upload)
 */
function getContent_(req) {
  var rows = rows_('Content');
  var byName = {};
  rows.forEach(function (r) {
    var n = r.name; if (!n) return;
    (byName[n] = byName[n] || {})[r.upload_id] = (byName[n][r.upload_id] || []).concat([r]);
  });
  function latestComplete(name) {
    var ups = byName[name] || {}, best = null;
    Object.keys(ups).forEach(function (uid) {
      var chunks = ups[uid], total = Number(chunks[0].total_chunks);
      var idx = {}; chunks.forEach(function (c) { idx[Number(c.chunk_index)] = c; });
      if (Object.keys(idx).length !== total) return; // incomplete
      var t = chunks.reduce(function (m, c) { return c.updated_at > m ? c.updated_at : m; }, '');
      if (!best || t > best.updated_at) best = { upload_id: uid, updated_at: t, kind: chunks[0].kind, total: total, idx: idx };
    });
    return best;
  }
  if (req.name) {
    var b = latestComplete(req.name);
    if (!b) throw new Error('No complete upload for ' + req.name);
    var text = '';
    for (var i = 0; i < b.total; i++) text += String(b.idx[i].data).replace(/^~/, '');
    return { name: req.name, kind: b.kind, upload_id: b.upload_id, updated_at: b.updated_at, data: text };
  }
  var files = Object.keys(byName).map(function (n) {
    var b = latestComplete(n);
    return b ? { name: n, kind: b.kind, upload_id: b.upload_id, updated_at: b.updated_at } : null;
  }).filter(Boolean);
  var images = rows_('Images').map(function (r) {
    return { exercise_id: r.exercise_id, figure: r.figure, page: r.page, drive_link: r.drive_link, updated_at: r.updated_at };
  });
  return { files: files, images: images };
}

/**
 * putContent — one chunk per call.
 * { name, kind: 'guide'|'data', upload_id, chunk_index (0-based), total_chunks, data }
 * Re-sending a chunk overwrites it (so a resumed upload is safe).
 * When the last missing chunk arrives, older uploads of the same name are removed and
 * JSON data files are exploded into their tab.
 */
function putContent_(req) {
  ['name', 'upload_id', 'data'].forEach(function (k) { if (req[k] === undefined) throw new Error('Missing ' + k); });
  var ci = Number(req.chunk_index), tot = Number(req.total_chunks);
  if (!(ci >= 0 && tot >= 1 && ci < tot)) throw new Error('Bad chunk_index/total_chunks');
  if (String(req.data).length > MAX_CELL - 1) throw new Error('Chunk too large (max ' + MAX_CELL + ' chars)');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet_('Content'), now = new Date().toISOString();
    var vals = sh.getDataRange().getValues(), found = -1, have = {};
    for (var r = 1; r < vals.length; r++) {
      if (vals[r][0] === req.name && String(vals[r][2]) === String(req.upload_id)) {
        have[Number(vals[r][3])] = true;
        if (Number(vals[r][3]) === ci) found = r + 1;
      }
    }
    // Data is stored with a leading "~" so Sheets never treats it as a formula or number.
    var row = [req.name, req.kind || 'guide', String(req.upload_id), ci, tot, '~' + String(req.data), now];
    var target = found > 0 ? found : sh.getLastRow() + 1;
    sh.getRange(target, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    have[ci] = true;
    var complete = Object.keys(have).length === tot, exploded = 0;
    if (complete) {
      removeOlderUploads_(sh, req.name, String(req.upload_id));
      if (DATA_TABS[req.name]) exploded = explode_(req.name);
    }
    return { name: req.name, chunk_index: ci, received: Object.keys(have).length, total_chunks: tot, complete: complete, exploded_rows: exploded };
  } finally { lock.releaseLock(); }
}

/** getLogs { since?: ISO string } → sessions and sets updated after `since` */
function getLogs_(req) {
  var since = req.since || '';
  function f(r) { return !since || String(r.updated_at) > since; }
  return { sessions: rows_('Sessions').filter(f), sets: rows_('Sets').filter(f), server_time: new Date().toISOString() };
}

/**
 * appendLogs { sessions: [...], sets: [...] }
 * Records with an id already in the Sheet are skipped (so retries never duplicate).
 */
function appendLogs_(req) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var res = {};
    [['Sessions', req.sessions || []], ['Sets', req.sets || []]].forEach(function (p) {
      var tab = p[0], items = p[1], sh = sheet_(tab), hdr = TABS[tab];
      var existing = {}; colValues_(sh, 1).forEach(function (v) { existing[String(v)] = true; });
      var now = new Date().toISOString(), add = [], accepted = [], skipped = [];
      items.forEach(function (it) {
        if (!it || !it.id) return;
        var id = String(it.id);
        if (existing[id]) { skipped.push(id); return; }
        existing[id] = true; accepted.push(id);
        add.push(hdr.map(function (h) {
          if (h === 'updated_at') return it.updated_at || now;
          if (h === 'created_at') return it.created_at || now;
          var v = it[h]; return v === undefined || v === null ? '' : v;
        }));
      });
      if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, hdr.length).setValues(add);
      res[tab.toLowerCase()] = { accepted: accepted, skipped: skipped };
    });
    return res;
  } finally { lock.releaseLock(); }
}

/**
 * upsertLogs { sessions: [...], sets: [...] }  (Stage 4)
 * New ids are added. An id already in the Sheet is replaced only when the incoming
 * updated_at is newer, so an old retry can never undo a later edit.
 * Deleting is a normal edit with deleted: true (the row stays, marked deleted).
 */
function upsertLogs_(req) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var res = {};
    [['Sessions', req.sessions || []], ['Sets', req.sets || []]].forEach(function (p) {
      var tab = p[0], items = p[1], sh = sheet_(tab), hdr = TABS[tab];
      var uCol = hdr.indexOf('updated_at'), cCol = hdr.indexOf('created_at');
      var vals = sh.getDataRange().getValues(), rowOf = {};
      for (var r = 1; r < vals.length; r++) if (vals[r][0] !== '') rowOf[String(vals[r][0])] = r;
      var now = new Date().toISOString(), add = [], accepted = [], updated = [], skipped = [];
      items.forEach(function (it) {
        if (!it || !it.id) return;
        var id = String(it.id), incoming = String(it.updated_at || now);
        var row = hdr.map(function (h) {
          if (h === 'updated_at') return incoming;
          if (h === 'created_at') return it.created_at || now;
          var v = it[h]; return v === undefined || v === null ? '' : v;
        });
        if (rowOf[id] === undefined) {
          rowOf[id] = -1; add.push(row); accepted.push(id); return;
        }
        var at = rowOf[id];
        if (at < 0) { skipped.push(id); return; }            // same id twice in one request
        var cur = vals[at][uCol]; cur = cur instanceof Date ? cur.toISOString() : String(cur);
        if (incoming <= cur) { skipped.push(id); return; }  // the Sheet already has this or a newer edit
        if (vals[at][cCol]) row[cCol] = vals[at][cCol] instanceof Date ? vals[at][cCol].toISOString() : vals[at][cCol];
        sh.getRange(at + 1, 1, 1, hdr.length).setValues([row]);
        vals[at] = row; updated.push(id);
      });
      if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, hdr.length).setValues(add);
      res[tab.toLowerCase()] = { accepted: accepted, updated: updated, skipped: skipped };
    });
    return res;
  } finally { lock.releaseLock(); }
}

function getSettings_() {
  // First row wins (the same row upsert_ writes to), so a stray duplicate can never hide a newer value.
  var out = {}, updated = {};
  rows_('Settings').forEach(function (r) {
    if (r.key === '' || out.hasOwnProperty(r.key)) return;
    out[r.key] = r.value; updated[r.key] = r.updated_at;
  });
  return { settings: out, updated_at: updated };
}

/** setSettings { settings: { key: value, ... } } — upserts each key */
function setSettings_(req) {
  var s = req.settings || {}, keys = Object.keys(s);
  var lock = LockService.getScriptLock(); lock.waitLock(20000); // two phones (or two requests) at once can't add duplicate rows
  try {
    keys.forEach(function (k) { upsert_('Settings', 0, k, [k, typeof s[k] === 'string' ? s[k] : JSON.stringify(s[k]), new Date().toISOString()]); });
  } finally { lock.releaseLock(); }
  // Read back what the Sheet now holds, so the phone can confirm the save.
  var stored = {};
  rows_('Settings').forEach(function (r) { if (keys.indexOf(r.key) >= 0 && !stored.hasOwnProperty(r.key)) stored[r.key] = String(r.value); });
  return { saved: keys, stored: stored };
}

/** setImageLink { exercise_id, figure, page, drive_link } — upsert by exercise_id + figure */
function setImageLink_(req) {
  if (!req.exercise_id || !req.figure) throw new Error('Missing exercise_id or figure');
  if (req.drive_link && !fileIdFromLink_(req.drive_link)) throw new Error('That does not look like a Google Drive file link');
  var key = req.exercise_id + '|' + req.figure;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { upsert_('Images', 0, key, [key, req.exercise_id, req.figure, req.page || '', req.drive_link || '', new Date().toISOString()]); }
  finally { lock.releaseLock(); }
  return { key: key };
}

/**
 * getImage { drive_link } or { exercise_id, figure }
 * Reads the file as YOU (it can stay private) and returns base64.
 */
function getImage_(req) {
  var link = req.drive_link;
  if (!link && req.exercise_id && req.figure) {
    var key = req.exercise_id + '|' + req.figure;
    rows_('Images').forEach(function (r) { if (r.key === key) link = r.drive_link; });
  }
  if (!link) throw new Error('No Drive link for this figure');
  var id = fileIdFromLink_(link);
  if (!id) throw new Error('Could not find a file id in the link');
  var file = DriveApp.getFileById(id);
  var blob = file.getBlob(), mime = blob.getContentType() || '';
  if (mime.indexOf('image/') !== 0) throw new Error('File is not an image (' + mime + ')');
  if (file.getSize() > MAX_IMAGE_BYTES) throw new Error('Image is larger than 8 MB');
  return { mime: mime, name: file.getName(), base64: Utilities.base64Encode(blob.getBytes()) };
}

// ---------- helpers ----------
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '" — run setup() once from the script editor.');
  return sh;
}

function rows_(name) {
  var vals = sheet_(name).getDataRange().getValues();
  if (vals.length < 2) return [];
  var hdr = vals[0];
  return vals.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {}; hdr.forEach(function (h, i) { o[h] = r[i] instanceof Date ? r[i].toISOString() : r[i]; }); return o;
  });
}

function colValues_(sh, col) {
  var n = sh.getLastRow(); if (n < 2) return [];
  return sh.getRange(2, col, n - 1, 1).getValues().map(function (r) { return r[0]; });
}

/** Write `row` to the first row whose key matches (or a new row), and remove any duplicates of that key. */
function upsert_(tab, keyCol, key, row) {
  var sh = sheet_(tab), vals = sh.getDataRange().getValues(), first = -1, dupes = [];
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][keyCol]) !== String(key)) continue;
    if (first < 0) first = r; else dupes.push(r);
  }
  if (first >= 0) sh.getRange(first + 1, 1, 1, row.length).setValues([row]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  for (var i = dupes.length - 1; i >= 0; i--) sh.deleteRow(dupes[i] + 1); // bottom-up so row numbers stay right
}

function removeOlderUploads_(sh, name, keepUploadId) {
  var vals = sh.getDataRange().getValues();
  for (var r = vals.length - 1; r >= 1; r--) {
    if (vals[r][0] === name && String(vals[r][2]) !== keepUploadId) sh.deleteRow(r + 1);
  }
}

/** Writes one record per row into the data tab for exercises/methods/programs/levels. */
function explode_(name) {
  var text = getContent_({ name: name }).data;
  var data = JSON.parse(text), tab = DATA_TABS[name], now = new Date().toISOString(), rows = [];
  if (name === 'levels.json') {
    (data.progressions || []).forEach(function (p) { rows.push(['progression:' + p.id, clip_(JSON.stringify(p)), now]); });
    var rest = {}; Object.keys(data).forEach(function (k) { if (k !== 'progressions') rest[k] = data[k]; });
    rows.push(['_meta', clip_(JSON.stringify(rest)), now]);
  } else {
    data.forEach(function (rec) { rows.push([rec.id, clip_(JSON.stringify(rec)), now]); });
  }
  var sh = sheet_(tab);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
  return rows.length;
}

function clip_(s) { return s.length > MAX_CELL ? s.slice(0, MAX_CELL - 20) + '…[see Content tab]' : s; }

function fileIdFromLink_(link) {
  var m = String(link).match(/\/d\/([a-zA-Z0-9_-]{20,})/) || String(link).match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(String(link)) ? String(link) : null;
}

function checkSecret_(given) {
  var real = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!real || !given) return false;
  var a = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(given), Utilities.Charset.UTF_8);
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(real), Utilities.Charset.UTF_8);
  var diff = 0; for (var i = 0; i < a.length; i++) diff |= (a[i] ^ b[i]);
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
