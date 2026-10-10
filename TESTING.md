# Phone tests, stage by stage

## Stage 2: app shell, Sync panel, offline outbox

### Put the files on GitHub
Add these to the repo, keeping the folders (Add file → Upload files, then drag the folders in):
```
index.html
manifest.json
sw.js
TESTING.md
css/app.css
js/app.js
js/storage.js
js/sync.js
icons/icon-192.png
icons/icon-512.png
icons/maskable-512.png
icons/apple-touch-icon.png
```
Commit, then wait about a minute for Pages to update. Leave `apps-script/` and `.gitignore` as they are. You can delete `test/stage1-check.html` now. **No book content goes in the repo.**

### Test on the phone
1. Open `https://<your-username>.github.io/<repo>/`. The base address works now, with no more 404.
2. **Install it.**
   - iPhone (Safari): Share → **Add to Home Screen**.
   - Android (Chrome): ⋮ → **Install app** (or Add to Home screen).
   Open it from the new ring icon. **Do the rest of the steps inside the installed app.** On iPhone, the installed app keeps its own storage, separate from Safari.
3. The chip at the top right says **Set up sync**. Tap it.
4. Paste your **/exec URL** and **secret phrase**, then tap **Save and test**.
   - Expect: "Connected… Your Sheet has 9 tabs." The chip changes to **Synced** (green dot).
   - Try one wrong letter in the phrase first if you like. It should say the Sheet rejected it and that nothing was saved.
5. **Outbox test.**
   - Turn on **airplane mode**.
   - Tap **Add a test set** 3 times. The big number shows **3**, and the chip says **Offline, 3 waiting**.
6. **Offline open test.** Still in airplane mode, close the app completely (swipe it away), then reopen it. It should open normally and still show 3 waiting.
7. Turn airplane mode **off**. Within a few seconds the chalk line under the header fills, the count drops to **0**, and the chip says **Synced**. If nothing happens, tap **Sync now**.
8. Open the Sheet. **Sessions** has one "Stage 2 test" row, and **Sets** has 3 rows, with no duplicates. You can delete these rows.
9. Optional: tap **Forget URL and phrase** twice. The chip goes back to **Set up sync**. Paste the URL and phrase again afterwards.

| If you see | It means / do this |
|---|---|
| "The address must end in /exec" | You copied the /dev test address. Use the Web app URL from Deploy → Manage deployments |
| "Couldn't reach your Apps Script" | Check the URL, then check that the deployment's access is **Anyone** |
| "A new version is ready" with a Reload button | Tap Reload. It appears after each update to the site |
| Old version still showing | Close and reopen the app twice (the first open downloads the update) |
| "Storage kept safe: Not guaranteed" | Normal on iPhone and in plain browser tabs. Installing the app helps. Your Sheet is the backup |

## Stage 3: book content, Guide, Exercises, Pictures

No change to Code.gs, so there's nothing to redeploy.

### Update the site on GitHub
1. Unzip `stage3-site.zip`, open the folder it makes, and select everything **inside** it.
2. On GitHub: **Add file → Upload files**, drag those items in, and **Commit**. Files with the same name are replaced. New files: `js/ui.js`, `js/md.js`, `js/content.js`, `js/library.js`.
3. **Never upload `book-content.zip` or anything inside it to GitHub.** It goes to your Sheet only, using the steps below.

### Load the book content into your Sheet (once, easiest on a computer)
1. Unzip `book-content.zip`. You get 19 files: 15 `.md` and 4 `.json`.
2. Open the site in a browser on the computer: `https://<your-username>.github.io/<repo>/#/sync`. Paste the /exec URL and phrase and tap **Save and test**. The computer is a separate device, so it needs them too.
3. Under **Book content**, open **Upload content files to your Sheet** → **Choose files**, then select all 19 files. You should see "19 files ready (1.1 MB)".
4. Tap **Upload 19 files**. A bar fills while about 40 parts are sent, which takes a minute or two. If it stops partway, tap **Resume upload**: it only sends the missing parts, even after closing the browser.
5. Check the Sheet: the **Content** tab has about 40 rows, and the **Exercises** tab has 397 rows.

### Test on the phone
1. Open the installed app. Within a few seconds a **"A new version is ready"** toast should appear. Tap **Reload**.
2. **Sync → This phone** says **App version 3.0.0**. If not, close and reopen the app twice.
3. Tap **Get latest from Sheet**. Expect "Downloaded 19 files."
4. **Guide** tab → **Chapters**: 15 chapters. Open **Health and Injuries**. A red-edged "Information only, not a diagnosis" note sits at the top and the bottom.
5. Open **Exercises: Pulling Family**. Each picture spot shows `See "…" illustration, p. N` until you add its picture.
6. **Exercises** tab: tap **Pushing** and type `planche`. The list is grouped by line, with the level number on the left. Open one: you see Move up when, How to do it, Next step, and In the book (pages).
7. **Pictures** tab, to add one picture:
   - In the Drive app, find the image → **⋮ → Share → Copy link**. Keep its sharing **Restricted**; your Apps Script reads it as you.
   - In the app, search the caption (for example `Wall Handstand – Levels 1-4`), tap it, paste the link, and tap **Save**. Expect "Saved for N steps."
   - Tap **Show picture**.
8. Tap **Save linked pictures on this phone**, turn on airplane mode, and open that exercise. The picture still shows.
9. With airplane mode still on, browse Chapters and Exercises. They all work offline.

| If you see | It means / do this |
|---|---|
| "Your Sheet has no content yet" | Do the upload steps above first |
| "That doesn't look like a Google Drive file link" | Copy the link from Drive's Share menu. It contains `/d/` followed by a long id |
| "File is not an image" | The link points to a PDF or document. Link the image file itself |
| Upload stopped | Tap **Resume upload**. Parts already sent are kept |

## Stage 4: logging workouts

### 1. Update the Apps Script (needed this time)
Stage 4 adds one action, `upsertLogs`, so edits and deletes reach your Sheet.
1. Open your Sheet → **Extensions → Apps Script**.
2. Select everything in `Code.gs`, delete it, paste in the new **`apps-script/Code.gs`**, and click **💾 Save**.
3. **Deploy → Manage deployments** → ✏ **Edit** → Version: **New version** → **Deploy**. Your /exec URL stays the same.
   Don't use "New deployment": that makes a new URL.

You don't need to run `setup` again, and the tabs don't change.

### 2. Update the site on GitHub
Unzip `stage4-site.zip` and upload what's **inside** the folder, like before. The new files are `js/log.js` and `js/workout.js`. Also replace `apps-script/Code.gs` in the repo with the new one.

### 3. Test on the phone
1. Open the app and tap **Reload**. **Sync → This phone** should show **App version 4.0.0**.
2. On Sync, tap **Save and test**. You should see "Connected." If it says "your Apps Script is the old version", redo step 1.
3. **Today → Start a workout**. Search `pull-ups` and tap one.
   - Use − / + or type 5, tap an effort (say 7), then **Save set**.
   - **Add set** starts at 5. Log 5, then a third set of 7.
   - A green note says your last set beat your first by 2 reps: "next time try 6 reps on every set (pp. 117–118)".
4. Tap **Set 2** to change it to 6, then **Save changes**. In the Sheet's **Sets** tab, that row now shows 6, still one row.
5. Tap **Set 3**, then tap **Delete set** twice. In the Sheet, that row's `deleted` column shows TRUE. Rows are marked, never erased.
6. Turn on **airplane mode** and add a set. The chip says **Offline, 1 waiting**.
7. **Add exercise → Not in the list?** Type `Deadlift`, tap **Log it**, then log a set. Use this for moves the book uses but never teaches.
8. Close the app completely and reopen it. Today shows **Workout in progress**: tap **Continue workout**.
9. Turn airplane mode off. The waiting sets go to the Sheet.
10. Type a note, then tap **Finish workout**. The workout appears under **Past workouts**. Tap it to view or edit it.
11. **Logging settings** on Today: pick lb or kg. "Reps in reserve" is offered as an extra (NOT IN BOOK); RPE 0–10 is the book's scale.
12. Clean up: open the test workout, tap **Delete workout** twice, then delete the old "Stage 1/2 test" rows from the Sheet by hand.

| If you see | It means / do this |
|---|---|
| "Your Apps Script is the old version…" | Redo step 1: paste Code.gs, then Manage deployments → Edit → **New version** |
| "Not sent, N waiting" | Open Sync to read the message. Your sets are safe on the phone |
| An edit made on another device doesn't show | Tap **Sync now**. The newest edit wins |

## Stage 5: progress charts and ladders

No Apps Script change this time.

### Update the site
Unzip `stage5-site.zip` and upload what's **inside** the folder. The new files are `js/charts.js`, `js/levels.js` and `js/progress.js`.

### Test on the phone
1. Open the app and tap **Reload**. Sync should show **App version 5.0.0**.
2. **Progress → Charts**: pick an exercise you've logged at least twice. You see:
   - a sentence like "Best set went from 5 to 7 reps"
   - **Best set per workout** (a line)
   - **Total per workout** (columns)
   - **Average effort**, if you rated sets
3. Tap or drag across a chart. A readout shows that workout's date and sets.
4. Switch between **4 weeks**, **3 months** and **All**. Open **Show as a table**: it lists the same workouts, and each date opens that workout.
5. **Progress → Ladders**: one box per family, showing your level ("–" until you mark something).
6. Open a ladder, e.g. **Planche**. It lists every step, highest first; your logged best shows on steps you've done.
   - Tap **Mark passed** on the steps you can do with solid technique.
   - Your next step gets a gold edge.
   - Go back: that family's box shows the highest level you passed.
7. In the Sheet's **Settings** tab, `ladder.passed` lists the steps you marked. Another device gets them on its next sync.
8. Turn on airplane mode: charts and ladders still work.
