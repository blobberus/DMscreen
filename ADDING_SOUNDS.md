# Adding sounds to the DM screen

For you, or for Claude on any device. With Claude Code open in a copy of this repo, saying
**"add the sounds in &lt;folder&gt; to the DM screen"** is enough: Claude reads this file (CLAUDE.md
points here) and does the rest.

Small files can also go straight in through the website: every folder on the screen has an **Add**
button that opens GitHub's upload page. That page takes files up to **25 MB**; anything bigger goes
through the steps below.

## Where sounds go

The folders in `sounds/` are the screen. A file's name is its name on the screen; two digits and a
space at the start (`01 Arrival.mp3`) set the order without being shown.

| Folder | On the screen |
|---|---|
| `sounds/Music/<name>/` | a music playlist |
| `sounds/Ambience/<name>/` | an ambience playlist (Tavern, Outdoors, Weather…) |
| `sounds/Effects/<name>/` | a bank of soundboard pads; each sound takes the next free letter key |

A new folder is a new playlist or pad bank. Give it a `README.md` like its neighbours' (copy one and
change the name).

## The limits

- **25 MB per file** (GitHub's upload page) and **about 900 MB for everything**: GitHub Pages stops
  at 1 GB.
- Long recordings (one-hour YouTube ambience) become **20 minutes at 128 kb/s, about 18 MB**. They
  loop on the screen, so that is plenty. Short sounds and effects are kept whole.
- **The repo is public.** Only add sounds you may share: your own, royalty-free or Creative Commons.
  No commercial music.

## The steps (for Claude)

1. **Have the repo and its tools.** On a new device: `git clone https://github.com/blobberus/DMscreen.git`
   (on Windows, into Documents). The shrinking needs Python 3.10+ and ffmpeg: on Windows run
   `start.bat` once (it makes `.venv` with everything), elsewhere
   `python3 -m venv .venv && .venv/bin/pip install imageio-ffmpeg`.
2. **Bring it up to date:** `git pull --ff-only` (on Windows `sync.bat` does the same). Renames made
   on the website arrive this way.
3. **Put the files in their folders** in `sounds/`, named as they should appear. Copy them in; leave
   the user's originals where they are.
4. **Shrink what is too big, where it is:**
   `.venv\Scripts\python tools\shrink_sounds.py --in-place` (Windows) or
   `.venv/bin/python tools/shrink_sounds.py --in-place`. Every file over 25 MB is cut to 20 minutes at
   128 kb/s; its full-length original is copied first to **DM screen originals** on the Desktop
   (outside the repo). It prints the new sizes and the total.
5. **Check:** no file over 25 MB, and the total it printed under about 900 MB. If one is still over,
   run it again on that file with `--minutes 15`.
6. **Commit only the sounds and push:**
   `git add sounds` → `git commit -m "Add <what>: <folders>"` → `git push`. If the push is refused,
   `git pull --rebase` first (the screen commits its setup to `screen/setup.json` now and then).
7. **Wait for it to publish:** the GitHub Action "Publish the DM screen" takes about two minutes
   (`gh run watch`, or the repo's Actions tab). The new files then show in
   https://blobberus.github.io/DMscreen/library.json. Reload the screen.

## Renaming, moving and deleting

Do it **on the screen** (a sound's ⋯ menu, a folder's menu): it renames the file in the repo and keeps
its flags, pad and keys with it. Renaming files with git directly loses those, because
`screen/setup.json` refers to sounds by their path. Then `git pull` (or `sync.bat`) brings the new
names to this copy.

## Never

- Commit the originals, `data/`, `vault/` or notes.
- Edit `screen/setup.json` by hand while the screen is open on a device connected to GitHub.

The PC version (`start.bat`) keeps its own library on the PC: add sounds there with its **Add files**
button. They don't go through the repo.
