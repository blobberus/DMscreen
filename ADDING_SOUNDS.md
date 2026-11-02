# Adding sounds to the DM screen

For you, or for Claude on any device. With Claude Code open in a copy of this repo, saying
**"add the sounds in &lt;folder&gt; to the DM screen"** is enough: Claude reads this file (CLAUDE.md
points here) and does the rest.

The sounds are in the **private** repo
[blobberus/DMscreen-sounds](https://github.com/blobberus/DMscreen-sounds), not in this one: the screen
reads them through each device's GitHub connection, so nobody else can play or download them. Small
files can also go straight in through the website: every folder on the screen has an **Add** button
that opens GitHub's upload page for that folder of the private repo. That page takes files up to
**25 MB**; anything bigger goes through the steps below.

## Where sounds go

The folders in the sounds repo's `sounds/` are the screen. A file's name is its name on the screen; two
digits and a space at the start (`01 Arrival.mp3`) set the order without being shown.

| Folder | On the screen |
|---|---|
| `sounds/Music/<name>/` | a music playlist |
| `sounds/Ambience/<name>/` | an ambience playlist (Tavern, Outdoors, Weather…) |
| `sounds/Effects/<name>/` | a bank of soundboard pads; each sound takes the next free letter key |

A new folder is a new playlist or pad bank. Give it a `README.md` like its neighbours' (copy one and
change the name).

## The limits

- **25 MB per file** (GitHub's upload page) and **about 2 GB for the whole sounds repo**.
- Long recordings (one-hour YouTube ambience) become **20 minutes at 128 kb/s, about 18 MB**. They
  loop on the screen, so that is plenty. Short sounds and effects are kept whole.
- MP4 audio (`.m4a`) becomes MP3 at **160 kb/s constant bitrate** (`-b:a 160k`), and so does an MP3 at
  160 kb/s or more. Constant-bitrate MP3s under 160 kb/s stay as they are. **No variable-bitrate MP3s for
  anything longer than 45 s:** those stream, and a browser seeks a variable-bitrate MP3 only to the nearest
  of 100 points, so a trim, a flag or a scrub lands seconds off (a 6.6 s trim started 4 s early).
- **Never put sounds in this repo (DMscreen):** it is public, and everything in it is published.

## On the Windows PC, the easy way

Drop the files into `Desktop\Sounds to Add\Music\<playlist>\` (or `Ambience\<name>\`, `Effects\<bank>\`; a
new name makes a new playlist or pad bank) and double-click `add_sounds.bat` in DMscreen. It pulls
DMscreen-sounds, keeps constant-bitrate MP3s under 160 kb/s as they are, re-encodes the rest (MP4, M4A,
WAV…, and variable-bitrate MP3s over 45 s) at 160 kb/s constant bitrate,
and cuts anything still over 25 MB with `shrink_sounds.py`. It commits only the new files under `sounds/`
(plus a README.md for a new folder), one commit per folder, pushing about 120 MB at a time. Only after a
push succeeds do the originals move to `Sounds to Add\Added\<date>\`. It stops with a message if the
clone has changes or commits of its own; sort those out with git, then run it again. `--dry-run` only
shows what it would do. The steps below are the same thing by hand.

## The steps (for Claude)

1. **Have both repos and the tools.** On a new device: `git clone https://github.com/blobberus/DMscreen.git`
   and, beside it, `git clone https://github.com/blobberus/DMscreen-sounds.git` (on Windows, both into
   Documents; the private one needs the user signed in to GitHub, e.g. `gh auth login`). The shrinking
   needs Python 3.10+ and ffmpeg: on Windows run `start.bat` once (it makes `.venv` with everything),
   elsewhere `python3 -m venv .venv && .venv/bin/pip install imageio-ffmpeg`.
2. **Bring them up to date:** `git pull --ff-only` in both (on Windows `sync.bat` does DMscreen).
   Renames made on the website arrive this way.
3. **Put the files in their folders** in `DMscreen-sounds/sounds/`, named as they should appear. Copy
   them in; leave the user's originals where they are.
4. **Shrink what is too big, where it is** (run from DMscreen; it works on the DMscreen-sounds clone
   beside it): `.venv\Scripts\python tools\shrink_sounds.py --in-place` (Windows) or
   `.venv/bin/python tools/shrink_sounds.py --in-place`. Every file over 25 MB is cut to 20 minutes at
   128 kb/s; its full-length original is copied first to **DM screen originals** on the Desktop
   (outside the repo). It prints the new sizes and the total.
5. **Check:** no file over 25 MB, and the total it printed under about 2 GB. If one is still over,
   run it again on that file with `--minutes 15`.
6. **Commit only the sounds and push, in DMscreen-sounds:**
   `git add sounds` → `git commit -m "Add <what>: <folders>"` → `git push`. More than about 150 MB in
   one push can time out (HTTP 408): commit and push a folder at a time. If the push is refused,
   `git pull --rebase` first (the screen commits renames and its `library.json` there).
7. **Wait for the index:** the sounds repo's workflow "Index the sounds" reads the new files' lengths and
   waveforms into `library.json` and `peaks/` (about a minute: `gh run watch -R blobberus/DMscreen-sounds`).
   The screen shows them after that (the Sound library's refresh button, or a reload). To skip the wait,
   run `.venv\Scripts\python tools\index_sounds.py --dir ..\DMscreen-sounds` before committing and
   commit `library.json` and `peaks/` with the sounds.

## Renaming, moving and deleting

Do it **on the screen** (a sound's ⋯ menu, a folder's menu): it renames the file in the sounds repo and
keeps its flags, pad and keys with it. Deleting a folder there deletes every sound in it and clears them
out of `screen/setup.json`. Renaming files with git directly loses those, because `screen/setup.json`
refers to sounds by their path. Then `git pull` in DMscreen-sounds brings the new names to that copy.

## Never

- Put sounds in this public repo, or commit the originals, `data/`, `vault/` or notes.
- Edit `screen/setup.json`, or the sounds repo's `library.json` and `peaks/`, by hand while the screen
  is open on a device connected to GitHub.

The PC version (`start.bat`) keeps its own library on the PC: add sounds there with its **Add files**
button. They don't go through either repo.
