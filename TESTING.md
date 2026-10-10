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
