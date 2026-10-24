# DM Screen (CLAUDE.md)

Password-gated ("Pleiades") DM screen for repo `blobberus/DMscreen`, in two versions from one `app/`:
the **website** (GitHub Pages, https://blobberus.github.io/DMscreen/, sounds from the repo's `sounds/`)
and the **PC version** (`server.py`, local library, YouTube downloads, Obsidian vault). Sister project of
`blobberus/Stone-Wardens` (campaign site, framed in a pane; this app borrows its design tokens, type and
markdown renderer) and `blobberus/Combat-Ring` (no longer shown: the user had it removed).

## Hard rules
- **Windows + Controlled Folder Access:** Git Bash cannot create or write files inside `Documents`.
  Use the Write/Edit tools or PowerShell for repo writes; scratch work goes to the session scratchpad.
- **No build step.** Plain HTML/CSS/native ES modules in `app/`. Vendored libs only (`app/vendor/`:
  marked, DOMPurify, js-yaml, copied from Stone Wardens). Fonts are local woff2 in `app/fonts/`.
- Server is Python (`server.py`, Flask + waitress). yt-dlp, ffmpeg (imageio-ffmpeg) and Deno run as
  subprocesses, so `pip install -U yt-dlp` takes effect without a restart.
- `data/` and `vault/` are user data and are gitignored. Never commit them. `_site/` and `.site-cache/`
  are build output.
- The repo is public: everything in `sounds/` and `screen/` is public. Notes never go to the repo.
- Sound sizes: GitHub's upload page takes files up to 25 MB and Pages stops at 1 GB for the whole site,
  so keep `sounds/` under ~900 MB. Long ambience goes in as 20-minute, 128 kb/s cuts (~18 MB) made with
  `tools/shrink_sounds.py`. The user's originals (one-hour, 192 kb/s) stay on their Desktop.
- Every feature must work in both versions or say plainly in the UI why it doesn't (`SITE` from
  `core/mode.js`). The PC server's login page loads `js/core/mode.js` and `gate.js` without a session.
- Design: taste-skill app style "data-terminal" (dark, panes darker than the ground) with the Stone
  Wardens palette and type kept. One selection mark: a 1px rubric (`--accent`) line as wide as its label.
  Colour only on live data (playback progress). Gold only for the Pleiades mark. Alegreya Sans for all
  UI, Cinzel for the wordmark only. No gradients, glows or resting shadows.

## Layout
```
server.py            auth gate, state docs, library + peaks + clips + export, downloads (jobs), YouTube
                     search/oEmbed, frame-check, notes vault API, config/tools
start.bat update.bat launch / update (creates .venv on first run)
extension/           optional Chrome/Edge MV3 "frame helper": strips XFO/CSP for sub-frames in DM tabs only
app/index.html       shell: rail, top bar (deck + master), #workspace
app/login.html       the gate (js/login.js, css/login.css)
app/css/             tokens.css base.css shell.css panels.css (one prefix per panel: cn pd pl lb ed yt wb nt st sc)
app/js/core/         dom util bus api state library keys kbd ui fader markdown
app/js/audio/        engine.js (AudioContext, buses, voices), board.js (pads), playlists.js, wave.js, cue.js
                     (the shared preview button). The preview bus goes to master, or with settings.previewOutput
                     through a MediaStream to an <audio> with setSinkId; a chosen output that's gone = silent
app/js/layout/       workspace.js (presets, grid splitters, panes/tabs, floating panel layer), rail.js (the
                     side rail: a hide/show button per pane, opened with each pane's tabs; panels when compact)
app/js/panels/       registry + console pads playlists library editor youtube web notes
app/js/dialogs/      settings.js shortcuts.js files.js (website: upload links, rename/move/new folder)
                     volume.js (a sound's own volume, from its ⋯ menu)
app/sw.js            website offline copy (media/peaks cache-first with byte ranges; the rest network-first)
app/js/core/         + mode.js (SITE, repo, IOS) gate.js (browser password check) github.js (REST,
                     commits) site.js (website data: library.json, setup, pending ops) vault.js zip.js
sounds/              the website's sounds: Music/<playlist> Ambience/<ambience playlist> Effects/<bank>, README.md each
screen/setup.json    the website's synced setup (written by the site through the GitHub API)
tools/build_site.py  builds _site/: app + media/<blob sha>.<ext> + peaks/<sha>.json + library.json
tools/shrink_sounds.py  cuts long recordings to upload-sized MP3s (20 min from 30 s in, 128 kb/s)
.github/workflows/pages.yml  build + deploy on push (ignores screen/**)
```

## Contracts
- State docs (`settings layouts playlists boards bookmarks keymap`) live in `data/state/*.json`;
  `state.update(name, fn)` mutates, emits `state:<name>`, saves after 500 ms.
- `library` (client): `list/get/update(id, patch)` (debounced PATCH), `peaks(id)`, `upload`, `clip`,
  `download`, jobs polling. Sound fields: name kind trimStart trimEnd flags[{id,t,label}] repeat (1 once,
  N times, 0 forever) volume fadeIn fadeOut loopFade tags.
- `engine`: ONE deck (`engine.music`, a `Deck`) plays any playlist (music or ambience) or single track;
  starting one ends the one before (the user's rule: a playlist never plays its sounds at once). A
  sound plays on its kind's bus; a loop-forever sound plays once per pass on the deck. Sounds "on top"
  are layers, started only on purpose by a track's on-top button (startLayer/stopLayer/toggleLayer).
  `playingNow()` lists deck + on top + long pads for the Console's Playing list (each row scrubs with
  `seekItem`). Every voice has its own low-pass BiquadFilter; `setLowpass(0..1)` sweeps the ones switched
  in (`lowpass.deck`, each layer's `lowpass`, `lowpass.pads`; `setFiltered`), previews never. Transport
  (playPlaylist/playSingle/next/prev/togglePlay/jumpFlag/nextFlag/prevFlag), pads (firePad,
  stopPadVoice), fadeAll, toggleDuck, preview.
  Files ≤ 2 min decode to AudioBuffers; longer ones stream through MediaElementSource.
- `keys`: actions with Alt combos (event.code based); unused letters fire pads via `board.fire(key)`.
  Frames: cross-site iframes give the page no pointer events, so a frame counts as chosen when the pointer
  was last seen within 24px of it (or a fresh tap, a Tab, or a tap inside a same-origin frame). A frame
  that takes focus unasked is reclaimed once, never fought (a refocusing search box looped ~400/s).
- Workspace: panes p1..p4 placed by preset grid areas (`L.order[i]` gets letter i); `L.hidden` lists
  panes taken off screen, and `collapse()` gives each one's cells to the neighbours on one side (sizes kept
  per derived arrangement, key `preset/letters`). Picking a preset clears `hidden`; panels are created once and float over their
  pane's body (`.ws-layer`), so they never re-parent (iframes don't reload). `reflow()` measures every pane before moving any;
  panels get `resize()` once per frame (`resizeSoon`); a splitter drag applies once per frame and holds
  iframes at their size until release (embedded sites relaid out on every step was the resize lag). Panel modules export
  `default ({id, kind, el, workspace, getState, setState}) -> {show, hide, resize, title, menuItems, destroy}`.
  Default: `left-2` (Stone Wardens large left, console over pads) with `L.four = 'left-3'` (notes in p4).
- Sites: one viewer, the `wardens` tab (`panels/web.js`, sandboxed: no top navigation). Searches, the Sites
  list, note links (`workspace.openSite(url)`) and Stone Wardens' new-tab links (same-origin frames only)
  load there. No separate web panes; `prune()` drops old `combat` / `web-N` tabs from stored layouts.

## Website contracts
- Sound id = its path under `sounds/` ("Effects/Magic/Fireball.mp3"); media URL is by blob sha, so a
  rename never changes it. `groupOf(path)` = category + first folder = the playlist / pad bank id.
- `playlists.reconcile()` and `board.reconcile()` rebuild playlists and banks from the folders on every
  'library' and 'site:docs' event; `seen` remembers auto-placed pads so removals stick. Music folders are
  playlists, Ambience folders playlists with `kind: 'ambience'` (listed apart, same deck). Nothing
  starts with a playlist: reconcile deletes the old `ambience` / `seenAmbience` / `withAmbience` fields.
- Caching: Pages lets browsers keep files 10 minutes, so `build_site.py` stamps `?v=<hash>` on every
  module import and the pages' script/style links, and `const BUILD` in sw.js (a new worker per publish).
  sw.js answers `?v=` files cache-first by exact address (one build per page, even on a slow network),
  everything else network-first with `no-cache`. A new worker whose `dm-shell-*` cache name differs
  reloads open pages once (the migration off the pre-version worker); later publishes reach open pages
  through `controllerchange` in main.js (reload when nothing plays, else a toast). The user's browser ran
  old/mixed code for hours once (all Tavern layers at once). Tests: `rangeserve.py` honours
  `CACHE=max-age=600`, and drive.mjs has an `exec` step to publish a new build mid-test. Import modules
  with the page's version: `'./js/x.js' + new URL(document.querySelector('script[type=module]').src).search`.
- Synced docs (`playlists boards keymap bookmarks` + sound meta) live in `setup.doc` and go to GitHub
  6 s after a change (Contents API, 3-way merge on conflict). `settings layouts` stay in localStorage.
- Renames/moves/deletes/new folders (and `library.moveFolder` between Music and Ambience): one Git Data API commit with the remapped setup.json, then a
  pending op in localStorage until library.json shows it; emits 'library:moved' {from, to}.

## Testing
Run a throwaway server: `DMSCREEN_DATA=<scratch> DMSCREEN_PORT=7071 .venv/Scripts/python.exe server.py`
and drive headless Chrome via the taste-skill CDP lib (log in with `fetch('/api/login')` first).
Website: `python tools/build_site.py --out <scratch>/site --sounds <test sounds> --github-api <stand-in>
--github-raw <stand-in>/raw`, serve it with a byte-range static server, and point the GitHub metas at a
local stand-in API (never a real token in tests).
