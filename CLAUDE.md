# DM Screen (CLAUDE.md)

Password-gated ("Pleiades") DM screen for repo `blobberus/DMscreen`, in two versions from one `app/`:
the **website** (GitHub Pages, https://blobberus.github.io/DMscreen/, sounds from the PRIVATE repo
`blobberus/DMscreen-sounds`, clone at `../DMscreen-sounds`, read with each device's GitHub token)
and the **PC version** (`server.py`, local library, YouTube downloads, Obsidian vault). Sister project of
`blobberus/Stone-Wardens` (campaign site, framed in a pane; this app borrows its design tokens, type and
markdown renderer) and `blobberus/Combat-Ring` (no longer shown: the user had it removed).

**Adding, uploading or compressing sounds:** follow `ADDING_SOUNDS.md` step by step (folders in the
sounds repo, 25 MB / ~2 GB limits, `tools/shrink_sounds.py --in-place` works on `../DMscreen-sounds`,
commit and push there a folder at a time, watch its "Index the sounds" run).
The user shouldn't have to explain it. Keep the local clone current with `git pull --ff-only`
(`sync.bat`; `start.bat` also pulls quietly) so renames made on the website reach it.

## Hard rules
- **Windows + Controlled Folder Access:** Git Bash cannot create or write files inside `Documents`.
  Use the Write/Edit tools or PowerShell for repo writes; scratch work goes to the session scratchpad.
- **No build step.** Plain HTML/CSS/native ES modules in `app/`. Vendored libs only (`app/vendor/`:
  marked, DOMPurify, js-yaml, copied from Stone Wardens). Fonts are local woff2 in `app/fonts/`.
- Server is Python (`server.py`, Flask + waitress). yt-dlp, ffmpeg (imageio-ffmpeg) and Deno run as
  subprocesses, so `pip install -U yt-dlp` takes effect without a restart.
- `data/` and `vault/` are user data and are gitignored. Never commit them. `_site/` and `.site-cache/`
  are build output.
- This repo is public: everything in it (`screen/` too) is public. Sounds never go in it (they moved to
  the private `blobberus/DMscreen-sounds` on 2026-11-01; old copies remain in this repo's history).
  Notes never go to the repo.
- Sound sizes: GitHub's upload page takes files up to 25 MB, so that's the file limit; keep the sounds
  repo under ~2 GB (pushes over ~150 MB at once timed out: push a folder at a time). Long ambience goes in as 20-minute, 128 kb/s cuts (~18 MB) made with
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
add_sounds.bat       + tools/add_sounds.py: adds Desktop\Sounds to Add\<Category>\<folder>\* to the DMscreen-sounds
                     clone (convert, shrink, commit per folder, push, move originals to Added\<date>)
extension/           optional Chrome/Edge MV3 "frame helper": strips XFO/CSP for sub-frames in DM tabs only
app/index.html       shell: rail, top bar (deck + master), #workspace
app/login.html       the gate (js/login.js, css/login.css)
app/css/             tokens.css base.css shell.css panels.css (one prefix per panel: cn pd pl lb ed yt wb nt st sc ck fg)
app/js/core/         dom util bus api state library keys kbd ui fader markdown flags (a sound's flags: pure helpers)
app/js/audio/        engine.js (AudioContext, buses, voices), board.js (pads), playlists.js, wave.js, cue.js
                     (the shared preview button). The preview bus goes to master, or with settings.previewOutput
                     through a MediaStream to an <audio> with setSinkId; a chosen output that's gone = silent
app/js/layout/       workspace.js (presets, grid splitters, panes/tabs, floating panel layer), rail.js (the
                     side rail: a hide/show button per pane, opened with each pane's tabs; panels when compact)
app/js/panels/       registry + console pads playlists library editor youtube web notes merchants
app/content/merchants.json  premade merchants (6 categories, 55 shops, ~1,670 items): names, prices,
                     weights and Rural/Urban/Premium availability indexed from thievesguild.cc/shops (via the
                     Internet Archive: the live site is behind Cloudflare); every synopsis and description is our
                     own (don't copy the source's prose; the repo is public). Village/Town/Capital use the
                     cheap/normal/expensive price column and their locale's stock. Generated JSON: edit it directly
app/js/dialogs/      settings.js shortcuts.js files.js (website: upload links, rename/move/new folder)
                     volume.js (a sound's own volume, from its ⋯ menu) soundcheck.js (Settings, Audio)
                     flags.js (dropFlag: a flag on a playing voice + its toast; the flag menus; openFlags:
                     the Flags dialog for any sound, prefix fg)
app/sw.js            website offline copy (media/peaks cache-first with byte ranges; the rest network-first)
app/js/core/         + mode.js (SITE, repo, IOS) gate.js (browser password check) github.js (REST,
                     commits) site.js (website data: library.json, setup, pending ops) vault.js zip.js
../DMscreen-sounds/  the PRIVATE sounds repo: sounds/Music/<playlist> Ambience/<ambience playlist> Effects/<bank>
                     (README.md each), library.json + peaks/<blob sha>.json (written by its .github/workflows/
                     index.yml running tools/index_sounds.py, and by the site's commits)
screen/setup.json    the website's synced setup (written by the site through the GitHub API)
tools/build_site.py  builds _site/: app + media/<blob sha>.<ext> + peaks/<sha>.json + library.json
tools/shrink_sounds.py  cuts long recordings to upload-sized MP3s (20 min from 30 s in, 128 kb/s)
tools/index_sounds.py   the sounds repo's library.json + peaks/ (reuses build_site's reading)
.github/workflows/pages.yml  build + deploy on push (ignores screen/**)
```

## Contracts
- State docs (`settings layouts playlists boards bookmarks keymap merchants`) live in `data/state/*.json`;
  `state.update(name, fn)` mutates, emits `state:<name>`, saves after 500 ms.
- `library` (client): `list/get/update(id, patch)` (debounced PATCH), `peaks(id)`, `upload`, `clip`,
  `download`, jobs polling. Sound fields: name kind trimStart trimEnd flags[{id,t,label}] repeat (1 once,
  N times, 0 forever) volume fadeIn fadeOut loopFade tags.
- Flags (t = seconds into the file, not the trimmed part) change only through `core/flags.js`: `withFlag`
  / `withLabel` / `withTime` / `withoutFlag` return a new sorted list, `saveFlags(id, list)` saves it.
  `library.update` hands the sound fresh copies on every save, so change a flag by id in the sound's
  current list, never through an object held from before (the editor's label box kept only the first
  letter typed). Two flags within `NEAR` (0.05 s) are one moment; a live drop (`flagVoice`: the Console's
  flag buttons, Alt+Shift+F `flag.add`, the dialog's Drop a flag now) uses `LIVE_NEAR` (0.4 s) so a
  double tap is one flag. Flags can be added from the Console (transport button, each Playing row, the
  Flags row: Edit flags / Flags for a sound… through `pickSound`), the Flags dialog (also in the Sound
  library's, a playlist track's and a pad's menus) and the editor. Everything showing flags follows
  'library:sound' (Console, editor, library rows, the dialog) and never rebuilds a list under the typing:
  it catches up when the focus leaves.
- Dialogs stack (`dialogStack` in ui.js): Escape closes only the top one, and not while a menu is open
  over it (every dialog listened on the document, so one Escape closed them all).
- `engine`: ONE deck (`engine.music`, a `Deck`) plays any playlist (music or ambience) or single track;
  starting one ends the one before (the user's rule: a playlist never plays its sounds at once). A
  sound plays on its kind's bus; a loop-forever sound plays once per pass on the deck. Sounds "on top"
  are layers, started only on purpose by a track's on-top button (startLayer/stopLayer/toggleLayer).
  The library hands out fresh sound objects on every reload, so the engine re-points playing voices on
  'library' and re-applies gain on 'library:sound' (a volume change missed playing sounds before). A
  sound's volume (and a pad's) goes up to `MAX_VOLUME` (3, 300%, in library.js; the engine caps louder
  saved values); the Console mixer has a fader per playing sound (by sound id, added/removed one at a
  time so a drag survives a pad going off) setting `engine.setMix(id, level)`: a level for this play only
  that stands in for sound.volume (never saved; the user's rule). `pruneMix()` drops it once the sound has
  no live voice (after `changed()`, so a looping track's next pass keeps it), and a new saved volume
  replaces it. The Console turns off the browser's
  scroll anchoring and keeps its view still itself (`steady()`): Safari before 27 has none, and the
  mixer jumped on the iPad whenever a row was added above it.
- Performance: per-frame code ('audio:tick') writes to the DOM only when what it shows changes, moves
  progress bars and the playhead with transforms, never reads layout (the waveform's size comes from a
  ResizeObserver), and skips hidden panels. This took playback from ~800 layouts / 900 ms of work per
  5 s to ~10 / 80 ms. The build adds modulepreload links for main.js's static imports. The Console's
  Playing bars and the pads' progress lines step in whole pixels (widths from ResizeObservers): short
  pads redrew every frame in thousandths. `will-change` on those bars measured slower, so it isn't used.
  'audio' fires on every start/stop (several a second with pads): handlers write only what changed
  (`setText`/`setAttr`/`setIcon` in dom.js skip identical writes; titles rebuild on a key). The Playing
  rows are kept per voice serial and never moved or rebuilt under a drag (a full rebuild cut a scrub
  drag short when a pad started); the Effects row only toggles its marks.
  `playingNow()` lists deck + on top + every pad voice for the Console's Playing list (each row scrubs with
  `seekItem`, pauses with `togglePauseItem`, and loops a top/pad sound with `setLooping`, which sets the
  voice's repeat live: MediaVoice re-arms its end, BufferVoice restarts its source where it is). Every voice has its own low-pass BiquadFilter; `setLowpass(0..1)` sweeps the ones switched
  in (`lowpass.deck`, each layer's `lowpass`, `lowpass.pads`; `setFiltered`), previews never.
  `setSpeed(0.5..2)` sets `voice.rate` for the same voices (`rateFor`), pitch following (media elements
  get `preservesPitch = false`; decoded sources can't keep it). Voice timers (ends, fade-outs, the deck's
  crossfade lead, loop crossfades) are real seconds, so they divide by rate. A BufferVoice changes speed
  in place on its source (`playbackRate` set 10 ms ahead, positions counted from there): its end is a
  start() duration in buffer seconds, which holds at any speed; a counted loop re-calls stop(). Two
  crossfaded copies a few ms apart cancelled out (dips to 9% on a tone) - don't go back to that. Transport
  (playPlaylist/playSingle/next/prev/togglePlay/jumpFlag/nextFlag/prevFlag), pads (firePad,
  stopPadVoice), fadeAll, toggleDuck, preview.
  Files ≤ 2 min decode to AudioBuffers (≤ 45 s on iOS); longer ones stream through MediaElementSource.
  Streamed sounds must be constant-bitrate MP3: a browser seeks a VBR MP3 only to its 100-point Xing table
  (Chrome started a 6.6 s trim ~4 s early, silent while currentTime said 6.6). add_sounds.py encodes CBR
  160k and re-encodes VBR MP3s over 45 s.
  Crossfades (the deck's track changes, `crossIn` + `stop(fade, 'power')`, and MediaVoice loop wraps) use
  `powerRamp`: an equal-power sine/cosine fade built from short linear segments (setValueCurveAtTime can't be
  cut short: a pause or volume change mid-fade threw). Straight lines dipped 3 dB mid-crossfade (noise test:
  -3.2 dB, now -0.2).
  Keeping the sound going (iPad + Bluetooth): a route change interrupts the context, can stop its clock
  while it says 'running', and pauses <audio> elements behind the engine's back. `watchOutput()` resumes
  the context by itself (retries, then `needTap()`'s note), restarts a stopped clock (suspend + resume),
  and plays paused-behind-our-back elements again (`pausedBehindUs`, `revive` after 400 ms, `kick` at once
  inside a tap; a loop's next pass is `starting` until it plays). `look()` runs on taps, visibility, focus,
  pageshow and devicechange. Media buttons (`sessionActions`): play only resumes a paused track, pause only
  pauses (both toggled before, so a speaker's stray "play" paused the music). `recoveries` logs what was done.
  The iPad's rules (WebKit source, checked 2026-11-06): an <audio> made outside a tap may not play until a tap
  (`RequireUserGestureForAudioRateChange` is skipped only for elements made inside one), so the deck's next
  track, a loop's crossfade pass and a queued sound used to stay silent or end. Taps (`tapped`: touchend,
  click, keydown, a mouse's pointerdown; a finger's pointerdown is no tap to iPadOS) top up `spares` (6 made in the
  tap); `takeElement()` hands one to each MediaVoice (MediaElementSource made once per element, `dmNode`,
  `dmCtx`) and `releasePair` gives it back (once: `released`) if it was a spare or has played (`dmPlayed`).
  A pair's listeners and `seekReady` hang on its AbortController (`off`): a released element can be someone
  else's a moment later, so nothing of the old use may touch it. `playbackSession()` sets
  `navigator.audioSession.type = 'playback'` BEFORE the context is made and again on taps (iPadOS 17+: else
  Web Audio is "ambient", muted by Silent mode on the built-in speaker while headphones still play);
  `keepPlaybackOld()` loops a silent WAV where there is no audioSession. `unlock()` starts a silent sample
  in each tap until the context runs. `restart()` (Settings, Audio, Sound check) makes a new context and
  new elements after setting the session to 'auto' and closing the old one (an iPadOS Home Screen app can be
  left silent while 'running'); everything stops, the deck keeps its queue, 'audio:restarted' re-preloads pads.
  `fadeEffects(s)` fades every pad voice (settings.fadeEffects, 2 s; Alt+Shift+0; buttons in the top bar,
  the Console's mixer and the Soundboard); a press while they fade `hurry()`s them. Sound check:
  `dialogs/soundcheck.js` (`engine.facts()`, `testTone()` straight to the destination, a plain <audio> of
  the same chime as a WAV, a short and a long library sound as previews; prefix `ck`).
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
- Private sounds (`SOUNDS_REPO` from the build's `--sounds-repo` / meta dm-sounds-repo): `site.js` reads
  the sounds repo's library.json through the API (`github.readRaw`; last copy in localStorage for offline);
  media is `pmedia/<blob sha>.<ext>`, peaks `ppeaks/<sha>.json`, both answered by sw.js with the token the
  page puts in IndexedDB ('dm' db, 'kv' store, key 'github' = {token, api, repo, branch}; `github.share()`
  at boot, `setToken`/`forget`). The API sends a blob whole (`git/blobs/<sha>`, raw) and refuses Range
  (its CORS preflight doesn't allow the header; raw.githubusercontent download_urls 403 the preflight
  too), so sw.js streams: one download per sha, 206 answers for each range as the bytes arrive, the
  finished file cached. boot waits for the worker to control the page (`workerReady`). `soundAccess()`:
  ok / connect / denied / expired / indexing; anything but ok shows `accessNote()` and the playlists and
  pads are NOT reconciled (an empty list would wipe the synced setup). File commits (`apply`) go to the
  sounds repo and rewrite its library.json in the same commit (`editList`, read from the branch), so the
  list never lags; setup.json saves separately through `sync()`.
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
- Synced docs (`playlists boards keymap bookmarks merchants` + sound meta) live in `setup.doc` and go to GitHub
  6 s after a change (Contents API, 3-way merge on conflict). `settings layouts` stay in localStorage.
- Renames/moves/deletes/new folders (and `library.moveFolder` between Music and Ambience): one Git Data API commit with the remapped setup.json, then a
  pending op in localStorage until library.json shows it; emits 'library:moved' {from, to}. Deleting a folder
  (`library.removeFolder`, a playlist / pad bank's "Delete this …") removes every blob under it plus its
  setup entries (op `rmdir`), then emits 'library:removed' per sound; a deletion also turns a pending
  move/mkdir/movedir into the deleted thing into a deletion of its source (`addDeletion`), or the
  never-landing op brought it back for an hour. 'library:removed' stops the sound everywhere (deck,
  layers, pads, preview) and drops it from the deck's queue so a playlist plays past it.

## Testing
Run a throwaway server: `DMSCREEN_DATA=<scratch> DMSCREEN_PORT=7071 .venv/Scripts/python.exe server.py`
and drive headless Chrome via the taste-skill CDP lib (log in with `fetch('/api/login')` first).
Website (private sounds, as published): build with `--sounds-repo blobberus/DMscreen-sounds`, and run
the stand-in with `--private-repo blobberus/DMscreen-sounds --private-sounds <a copy laid out like the
sounds repo>` (it emulates the API's 404s, raw blobs without ranges, the preflight and the index workflow).
Website (public sounds, the old way): `python tools/build_site.py --out <scratch>/site --sounds <test sounds> --github-api <stand-in>
--github-raw <stand-in>/raw`, serve it with a byte-range static server, and point the GitHub metas at a
local stand-in API (never a real token in tests).
