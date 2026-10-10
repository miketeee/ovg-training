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
