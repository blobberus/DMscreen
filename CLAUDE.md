# DM Screen (CLAUDE.md)

Password-gated ("Pleiades") DM screen for repo `blobberus/DMscreen`, in two versions from one `app/`:
the **website** (GitHub Pages, https://blobberus.github.io/DMscreen/, sounds from the repo's `sounds/`)
and the **PC version** (`server.py`, local library, YouTube downloads, Obsidian vault). Sister project of
`blobberus/Stone-Wardens` (campaign site, framed in a pane; this app borrows its design tokens, type and
markdown renderer) and `blobberus/Combat-Ring` (not published yet; framed at its Pages URL).

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
app/js/audio/        engine.js (AudioContext, buses, voices), board.js (pads), playlists.js, wave.js
app/js/layout/       workspace.js (presets, grid splitters, panes/tabs, floating panel layer)
app/js/panels/       registry + console pads playlists library editor youtube web notes
app/js/dialogs/      settings.js shortcuts.js files.js (website: upload links, rename/move/new folder)
app/sw.js            website offline copy (media/peaks cache-first with byte ranges; the rest network-first)
app/js/core/         + mode.js (SITE, repo, IOS) gate.js (browser password check) github.js (REST,
                     commits) site.js (website data: library.json, setup, pending ops) vault.js zip.js
sounds/              the website's sounds: Music/<playlist> Ambience/<name> Effects/<bank>, README.md each
screen/setup.json    the website's synced setup (written by the site through the GitHub API)
tools/build_site.py  builds _site/: app + media/<blob sha>.<ext> + peaks/<sha>.json + library.json
.github/workflows/pages.yml  build + deploy on push (ignores screen/**)
```

## Contracts
- State docs (`settings layouts playlists boards bookmarks keymap`) live in `data/state/*.json`;
  `state.update(name, fn)` mutates, emits `state:<name>`, saves after 500 ms.
- `library` (client): `list/get/update(id, patch)` (debounced PATCH), `peaks(id)`, `upload`, `clip`,
  `download`, jobs polling. Sound fields: name kind trimStart trimEnd flags[{id,t,label}] repeat (1 once,
  N times, 0 forever) volume fadeIn fadeOut loopFade tags.
- `engine`: music deck (playPlaylist/playSingle/next/prev/togglePlay/jumpFlag/nextFlag/prevFlag),
  ambience layers (startLayer/stopLayer/setAmbience), pads (firePad), fadeAll, toggleDuck, preview.
  Files ≤ 2 min decode to AudioBuffers; longer ones stream through MediaElementSource.
- `keys`: actions with Alt combos (event.code based); unused letters fire pads via `board.fire(key)`.
- Workspace: panes p1..p4 placed by preset grid areas; panels are created once and float over their
  pane's body (`.ws-layer`), so they never re-parent (iframes don't reload). Panel modules export
  `default ({id, kind, el, workspace, getState, setState}) -> {show, hide, resize, title, menuItems, destroy}`.

## Website contracts
- Sound id = its path under `sounds/` ("Effects/Magic/Fireball.mp3"); media URL is by blob sha, so a
  rename never changes it. `groupOf(path)` = category + first folder = the playlist / pad bank id.
- `playlists.reconcile()` and `board.reconcile()` rebuild playlists and banks from the folders on every
  'library' and 'site:docs' event; `seen` / `seenAmbience` remember auto-placed sounds so removals stick.
- Synced docs (`playlists boards keymap bookmarks` + sound meta) live in `setup.doc` and go to GitHub
  6 s after a change (Contents API, 3-way merge on conflict). `settings layouts` stay in localStorage.
- Renames/moves/deletes/new folders: one Git Data API commit with the remapped setup.json, then a
  pending op in localStorage until library.json shows it; emits 'library:moved' {from, to}.

## Testing
Run a throwaway server: `DMSCREEN_DATA=<scratch> DMSCREEN_PORT=7071 .venv/Scripts/python.exe server.py`
and drive headless Chrome via the taste-skill CDP lib (log in with `fetch('/api/login')` first).
Website: `python tools/build_site.py --out <scratch>/site --sounds <test sounds> --github-api <stand-in>
--github-raw <stand-in>/raw`, serve it with a byte-range static server, and point the GitHub metas at a
local stand-in API (never a real token in tests).
