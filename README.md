# OVG Training

A private, phone-first training app for bodyweight strength work, built on my own condensed notes from *Overcoming Gravity* (2nd edition, Steven Low). It works offline. My workouts, ladder marks and plan go to my own Google Sheet through an Apps Script web app that I deploy myself.

**This repo holds only the app code.** The book notes (guide markdown and JSON data), the book's pictures, my secret phrase and my /exec URL are never in the repo.

## What it does

| Tab | What you get |
|---|---|
| **Today** | Start a workout, log sets (reps, seconds or minutes), effort as RPE 0–10, optional weight, band, rest and notes. Edit or delete any set. The book's "last set to failure" hint (pp. 117–118) and the RPE-10 overreaching warning (pp. 192–194). Closing the app mid-workout is safe: it offers to continue. |
| **Guide** | Chapters (the guide files, with a safety note on the injury chapter), Exercises (397 moves: search, filter, ladder steps, cues, book pages), Pictures (link each illustration to a private Drive file once; keep copies for offline use). |
| **Progress** | Charts of each exercise over time (best set, total, average effort), with a table view. Ladders for each progression: mark the steps you've passed; your level in each family is the highest step passed. |
| **Plan** | One of the book's own routines for your level, days a week, focus and equipment, with each slot moved to your next step on its ladder, its dose, and its book pages. Exercises needing gear you don't have use the book's alternative when one fits, or are flagged. Start a planned workout with a "Still to do" list. |
| **Sync** | /exec URL and secret phrase (stored on this device only), an outbox count ("N sets waiting to sync"), book-content upload and download, and "Settings last sent". |

There's no rest timer, by design.

## How it fits together

```
Phone (installed web app)                    Google (mine)
┌──────────────────────────────┐   POST    ┌──────────────────────────────┐
│ IndexedDB: content, images,  │  text/    │ Apps Script web app (Code.gs) │
│ sessions, sets, outbox,      │ ───────▶  │  checks the secret phrase on  │
│ settings, checkpoints,       │  plain    │  every request                │
│ device (URL + phrase)        │ ◀───────  │ Google Sheet "OVG Training"   │
│ Service worker: app shell    │   JSON    │ Google Drive: private images  │
└──────────────────────────────┘           └──────────────────────────────┘
          ▲ app code only
     GitHub Pages (this repo)
```

- **Offline first.** Every change is saved on the device first and goes into an outbox. The outbox sends itself when there's signal: on launch, when the connection returns, when the app is reopened, and every minute while anything is waiting. Re-sending is always safe, because the Sheet skips ids it already has and keeps the newest edit.
- **Resume points.** Uploads, downloads and the workout in progress all keep checkpoints, so a stop or crash picks up where it left off.
- **No CORS preflight.** Requests are `POST` with `Content-Type: text/plain` and a JSON body.
- **No outside code.** There are no frameworks and no CDN scripts; the charts are hand-drawn SVG. Nothing third-party runs next to the secret phrase.

## Repo layout

```
index.html            app shell
manifest.json         install info (name, icons, colors)
sw.js                 service worker: caches the app shell (bump VERSION on every release)
css/app.css           all styles (dark, phone-first)
js/app.js             router, header status, Sync page
js/storage.js         IndexedDB wrapper and unique ids
js/sync.js            Apps Script calls, outbox, pull, settings, status
js/ui.js              small shared helpers
js/content.js         book content upload/download (chunked, resumable), picture links and cache
js/md.js              small Markdown renderer for the guide files
js/library.js         Guide: chapters, exercises, pictures
js/log.js             workouts and sets, hints
js/workout.js         Today tab and the workout page
js/charts.js          SVG charts
js/levels.js          ladder marks and family levels
js/progress.js        Progress: charts and ladders
js/plan.js            Plan generator
icons/                app icons (the only images allowed in the repo)
apps-script/Code.gs   the back end, pasted into Apps Script (not run from GitHub)
apps-script/SETUP.md  step-by-step back-end setup
TESTING.md            phone test steps for each stage
.gitignore            blocks book content, images, local and dev files
```

Local test tools live in `dev/`, which is git-ignored and never uploaded.

## Set it up

1. **Sheet and Apps Script.** Follow `apps-script/SETUP.md`:
   1. Create the Sheet.
   2. Paste `Code.gs`.
   3. Set the `SECRET` script property.
   4. Run `setup`.
   5. Deploy as a Web app (Execute as: Me, Who has access: Anyone) and copy the **/exec URL**.
2. **GitHub Pages.**
   1. Create a public repo and upload the files listed above. Keep the folders, and put `index.html` at the top level.
   2. Go to **Settings → Pages → Deploy from a branch → main / (root)**.
3. **Connect.** Open `https://<username>.github.io/<repo>/`, go to **Sync**, paste the /exec URL and phrase, and tap **Save and test**.
4. **Load the book content (once).**
   1. On a computer, open the site, go to **Sync → Book content**, and upload the 19 content files.
   2. Every other device taps **Get latest from Sheet**.
5. **Install on the phone.**
   - iPhone: Share → Add to Home Screen.
   - Android: ⋮ → Install app.

   On iPhone the installed app has its own storage, so enter the URL and phrase inside the installed app.
6. **Pictures (optional).** In **Guide → Pictures**, paste a Drive link for each illustration. Sharing can stay Restricted. Then tap **Save linked pictures on this phone**.

## Updating

- **Site files:** upload the changed files. The app shows "A new version is ready", and **Reload** switches to it. Sync → This phone shows the version.
- **Code.gs:** paste the new code, then **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**. The URL stays the same. Don't use "New deployment", which makes a new URL. **Save and test** warns if the deployed script is older than the app expects.

## Security

- **Book content** lives only in my Sheet and on my devices. The app downloads it with the secret phrase, and `.gitignore` blocks content file names. The final check scans every repo file for any 60-character passage from the content files and finds none. The app's own short labels and page citations, such as "(pp. 117–118)", are mine.
- **Images** stay private in my Drive. The app never loads Drive links directly: `getImage` reads the file with DriveApp as me, checks the phrase, and returns base64.
- **The secret phrase** is stored in Script Properties on the server and in the device's own storage. It's sent only to my Apps Script, with each request, and is never written to the Sheet. A wrong phrase gets `Unauthorized` and a half-second delay. GET requests return no data.
- **"Who has access: Anyone"** only lets requests reach the script. Without the phrase, every request is rejected.

## Data the app writes to the Sheet

| Tab | What |
|---|---|
| Sessions | One row per workout. `plan_id` is set when the workout was started from the plan. Deleting marks `deleted` TRUE; rows are never erased. |
| Sets | One row per set. Edits replace the row only when they're newer. |
| Settings | Units, effort scale, `ladder.passed` (JSON list), `plan.inputs`, `plan.current` (JSON). |
| Images | Drive link for each illustration (key = `exercise_id|figure`). |
| Content | The book content in chunks of up to 40,000 characters, plus one-record-per-row copies in Exercises, Methods, Programs and Levels. |

## Rules the site adds (NOT IN BOOK)

These were approved choices, recorded in `99-gaps-and-questions.md` in the project notes, not in this repo.

- **Family level** = the highest chart level you've passed (A2).
- **Suggested plan level** = the lower of your Pushing and Pulling levels.
- **Equipment** = 9 tickable items. A wall, the floor, a chair, a box or a block count as household items everyone has. "Rings or bar" means either one will do.
- **Move-up rule** where the book gives no number: the book's general last-set-to-failure test (A3).
- **Reps in reserve:** offered as an optional extra; RPE is the book's scale (A4).
