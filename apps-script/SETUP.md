# Stage 1 — Set up the Google Sheet + Apps Script back end

You only do this once. Plan on about 15 minutes. You need a computer for steps 1–5 (the script editor is awkward on a phone); step 6 is on your phone.

## 1. Create the Sheet and paste the script
1. Go to **sheets.google.com** and create a blank spreadsheet. Name it **OVG Training**.
2. Click **Extensions → Apps Script**. A new tab opens with a file called `Code.gs`.
3. Delete everything in that file and paste in all of **`apps-script/Code.gs`**. Click the **💾 Save** icon.
4. Rename the project (top left, "Untitled project") to **OVG Training API**.

## 2. Set your secret phrase (never put it in the code)
1. In the Apps Script editor, click **⚙ Project Settings** (left sidebar).
2. Scroll to **Script Properties → Add script property**.
3. Property: `SECRET`  · Value: a long phrase only you know (e.g. 5+ random words). Click **Save script properties**.
4. Write the phrase down somewhere safe. You'll type it into your phone once.

> To change it later, edit this property. Every device then needs the new phrase.

## 3. Create the tabs and approve access
1. Go back to the **Editor** (`< >` icon). In the function dropdown at the top, choose **`setup`**, then click **▶ Run**.
2. Google asks for permission: **Review permissions** → pick your account → **Advanced → Go to OVG Training API (unsafe)** → **Allow**.
   - It asks for **Sheets** (to store content and logs) and **Drive** (so `getImage` can read your private images). The script only runs as you, for you.
3. The log at the bottom should say `Tabs ready. SECRET set: true`. Your Sheet now has 9 tabs: `Content, Exercises, Methods, Programs, Levels, Images, Sessions, Sets, Settings`.
   - If it says `SECRET set: false`, redo step 2.

## 4. Deploy as a web app
1. Click **Deploy → New deployment**.
2. Click the ⚙ next to "Select type" → **Web app**.
3. Description: `v1` · **Execute as: Me** · **Who has access: Anyone**. Click **Deploy**.
   - "Anyone" only means a request can *reach* the script. Every request without your secret phrase gets `Unauthorized`.
4. Copy the **Web app URL**. It ends in **`/exec`**. This is your **/exec URL**.

> **When you change Code.gs later:** Deploy → **Manage deployments** → ✏ Edit → Version: **New version** → Deploy. The URL stays the same. (Using "New deployment" again makes a *new* URL.)

## 5. Quick check from the computer (optional)
In a terminal (replace the URL and phrase):
```bash
curl -L -H 'Content-Type: text/plain' \
  -d '{"action":"ping","secret":"YOUR PHRASE"}' \
  'https://script.google.com/macros/s/XXXX/exec'
```
You should see `{"pong":true,"schema":1,…,"ok":true}`. With a wrong phrase you should see `{"ok":false,"error":"Unauthorized."}`.

## 6. Test on your phone
The test page `test/stage1-check.html` needs to be served from a web address. The simplest way is the GitHub Pages site you'll use anyway:
1. On GitHub, create a **public** repo (e.g. `ovg-training`) and add these files so the repo looks like this (folders are created by the files inside them — GitHub can't hold empty folders):
   ```
   .gitignore
   apps-script/Code.gs
   apps-script/SETUP.md
   test/stage1-check.html
   ```
   Easiest way, per file: **Add file → Create new file**, type the name *with* its folder (e.g. `test/stage1-check.html` — typing the `/` makes the folder), paste the file's contents, **Commit**. Or **Add file → Upload files** and drag the downloaded `apps-script` and `test` folders in (dragging a folder keeps its name). `.gitignore` is easiest as **Create new file** (Macs hide files starting with a dot). Only `test/stage1-check.html` is strictly needed for this test. **Don't upload any book content.**
2. Repo **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**. Wait about a minute.
3. On your phone, open `https://<your-username>.github.io/ovg-training/test/stage1-check.html`.
4. Paste the **/exec URL** and your **secret phrase**, then tap the buttons in order:

| Button | Expected |
|---|---|
| 1. Ping | ✔ green, `pong: true`, 9 tabs listed |
| 2. Wrong phrase | ✔ green ("rejected"), `error: "Unauthorized."` |
| 3. Send a test set | ✔ green: first call accepted 1 set, second call **skipped** it (no duplicate) |
| 4. Read logs | ✔ green, at least 1 session and 1 set |
| 5. Setting | ✔ green, `units: "lb"` |

5. Open the Sheet: the **Sessions** and **Sets** tabs have your test rows ("Stage 1 test — safe to delete"). Delete those rows when you're done.

The test page remembers the URL and phrase on that phone only (browser storage). The real Sync panel replaces it in Stage 2.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `Unauthorized.` with the right phrase | Check for a trailing space; re-check the `SECRET` script property |
| `Missing tab …` | Run `setup` again (step 3) |
| Network error on the phone | The URL must end in `/exec` (not `/dev`); redeploy if you edited the deployment access |
| `Unknown action` | Your deployment is an old version — Manage deployments → New version |
| getImage: `Access denied` / not found | The Drive file must be in **your** Drive (or shared with you); paste its normal share link |

## Sheet layout (created by `setup`)
| Tab | Columns | Holds |
|---|---|---|
| Content | name, kind, upload_id, chunk_index, total_chunks, data, updated_at | Guide markdown + JSON files, in chunks of ≤45,000 characters (data stored with a leading `~` so Sheets never treats it as a formula) |
| Exercises / Methods / Programs / Levels | id, json, updated_at | One record per row, rebuilt automatically after each complete upload (for browsing in the Sheet) |
| Images | key, exercise_id, figure, page, drive_link, updated_at | Your Drive links for each illustration (key = `exercise_id|figure`) |
| Sessions | id, date, started_at, plan_id, notes, created_at, updated_at, deleted | One row per workout |
| Sets | id, session_id, exercise_id, set_index, measure, reps, hold_seconds, effort, effort_scale, rest_seconds, added_weight, band_assist, unit, notes, created_at, updated_at, deleted | One row per set |
| Settings | key, value, updated_at | Units, effort scale, generator inputs, etc. |

## API reference (all `POST`, `Content-Type: text/plain`, JSON body with `action` + `secret`)
| Action | Params | Returns |
|---|---|---|
| `ping` | — | `pong, schema, time, tabs` (schema 2 = has upsertLogs) |
| `getContent` | `name?` | no name → `files[]` (complete uploads) + `images[]`; with name → `data` (full text) |
| `putContent` | `name, kind, upload_id, chunk_index, total_chunks, data` | `received, total_chunks, complete, exploded_rows` — re-sending a chunk is safe; a finished upload replaces the older one |
| `getLogs` | `since?` (ISO time) | `sessions[], sets[], server_time` |
| `appendLogs` | `sessions[], sets[]` (each with unique `id`) | per tab `accepted[]`, `skipped[]` (already in the Sheet) |
| `upsertLogs` (Stage 4) | `sessions[], sets[]` with `updated_at` | per tab `accepted[]` (new), `updated[]` (replaced because newer), `skipped[]` (Sheet already has this or a newer edit). Deletes are edits with `deleted: true` |
| `getSettings` | — | `settings{}` |
| `setSettings` | `settings{}` | `saved[]` |
| `setImageLink` | `exercise_id, figure, page, drive_link` | `key` |
| `getImage` | `drive_link` or `exercise_id + figure` | `mime, name, base64` (max 8 MB, images only) |
