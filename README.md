# DM Screen

A Dungeon Master's screen for the table: up to four panes you arrange however the session needs,
built around a sound console you can run from the keyboard without looking.

- **Sound console**: what is playing, its flags, the transport, your playlists and a mixer.
- **Soundboard**: effect pads laid out like your keyboard. Alt+Q fires the pad on Q.
- **Playlists**: music plus the ambience under it for each scene, on number keys (Alt+1 to 9).
- **Sound library and editor**: add files, download from links, trim, drop flags, set repeats and
  fades, cut part of a sound into a new one, export MP3 or WAV.
- **YouTube**: search, preview, and download the audio (all of it, or just a stretch) as MP3.
- **Stone Wardens** and **Combat Ring**: your campaign sites in a pane.
- **Web**: 5e.tools, D&D Beyond, any address or a search.
- **Notes**: Markdown notes in an Obsidian vault, made for writing during a session.

The whole screen is behind one password: **Pleiades**.

It comes in two versions that look and play the same:

- **The website**, **https://blobberus.github.io/DMscreen/**, for any device including an iPad.
  Its sounds are the MP3s in this repo's [`sounds`](sounds/) folder.
- **The PC version** (`start.bat`), which can also download from YouTube and save notes straight into
  an Obsidian folder.

## The website

Open **https://blobberus.github.io/DMscreen/** and enter the password.

**Sounds live in the repo, and the folders are the screen** ([full guide](sounds/README.md)):

| Folder | On the screen |
|---|---|
| `sounds/Music/<name>/` | the playlist *name*; its files are the tracks, in file-name order |
| `sounds/Ambience/<name>/` | ambience that starts with the playlist of the same name |
| `sounds/Effects/<name>/` | the soundboard bank *name*; each sound takes the next free letter key |

- **Add sounds:** every folder on the screen has an **Add** button. It opens GitHub's upload page for
  that folder: drop in MP3s and press **Commit changes**. They appear on the screen about a minute later.
- **Rename and move sounds** on the screen (a sound's menu, or the name and folder at the top of the
  editor). The file is renamed in the repo, and its flags, pads and keys go with it. Folders (playlists,
  pad banks) rename the same way, and **New** makes one.
- Renaming, and keeping your flags, pads and keys the same on every device, needs the device
  **connected to GitHub** once: Settings, GitHub has the four steps. It makes a token that can only change
  this repo's files, kept in that browser. Without it everything still plays, and changes stay on that device.
- The setup (flags, trims, pads, playlist keys, shortcuts, bookmarks) is saved in `screen/setup.json`.
  Layouts and settings belong to each device.
- **Notes** are kept in the browser on that device, never in the repo (it's public). Settings, Notes
  downloads them all as Markdown for Obsidian.
- **The repo is public**, so anyone can download its sounds. Only add sounds you're allowed to share.
  The password keeps people out of the screen, not out of the files.
- The website can't search or download from YouTube (that needs the PC version); its YouTube pane plays
  a pasted link.

### On an iPad

Open the site in Safari, then **Share, Add to Home Screen**. It opens full-screen like an app, and Safari
won't clear its sounds and setup. Sounds you've played stay on the iPad; **Settings, This device, Keep
every sound on this device** downloads all of them, so the screen works without Wi-Fi.

Tap pads to fire them, hold a finger on a sound or pad for its menu, and drag the lines between panes to
resize them. With a keyboard, Option works as Alt, so every shortcut works.

Sites that refuse to be shown inside another page open in a new tab on the iPad. Use Split View to keep
them beside the screen.

### How it's published

`.github/workflows/pages.yml` runs `tools/build_site.py` on every push: it copies `app/`, turns each
sound into `media/<content id>` with a waveform, and lists them in `library.json`. Waveforms are cached
between runs. Saving `screen/setup.json` doesn't rebuild; the site reads it live. Run the build
yourself with `python tools/build_site.py` (needs `pip install imageio-ffmpeg`).

## The PC version

### Start it

Double-click **`start.bat`**. The first run sets up Python packages (a minute or two); after that it
starts in a few seconds and opens `http://localhost:7070` in your browser. Leave the black window
open while you play; close it to stop the screen.

Needs Python 3.10 or newer (already on this computer). Everything else installs itself into `.venv`.

- `start.bat --lan` also lets other devices on your network open it (a tablet at the table).
- `update.bat` updates the downloader. YouTube changes often, so run it when downloads start failing
  (or use Settings, YouTube, Update the downloader).

## Running the sound

| Keys | What they do |
| --- | --- |
| Alt+1 … Alt+9 | Start the playlist on that number (music crossfades, its ambience fades in) |
| Alt+Q, Alt+W, … | Fire the pad on that key in the current bank |
| Alt+P | Play or pause the music |
| Alt+, / Alt+. | Previous / next track |
| Alt+[ / Alt+] | Back to the previous flag / skip to the next flag |
| Alt+Shift+1 … 9 | Jump to flag 1 to 9 of the playing track |
| Alt+- / Alt+= | Music quieter / louder |
| Alt+\ | Duck music and ambience while you talk |
| Alt+0 | Fade everything out |
| Alt+Backspace | Stop all effects |
| Alt+Up / Alt+Down | Previous / next pad bank |
| Alt+Enter | Maximise the pane you're in (Esc restores) |
| Alt+/ | Show every shortcut |

Alt shortcuts work everywhere, even while you type a note. When you're not typing, the key alone
works too (Q fires pad Q, Space plays or pauses), which you can turn off in Settings. Every key can be
changed in Settings, Keys. Your keyboard's media keys control the music as well.

If you click inside a site pane (Stone Wardens, 5e.tools), that site has the keyboard until you move
away from it or click anywhere on the screen; the top bar says "Keys paused" while that's so.

### Flags, trims and clips

Open a sound in the Sound library. Play it and press **F** at each moment you want to jump to (the
storm breaks, the chorus, the roar), then name the flags. **I** and **O** set where it starts and ends.
Drag across the waveform to select a stretch, then **Save as a new sound** to cut it into its own file:
a "100 sword sounds" video becomes a hundred pads. A pad can also start at a flag and stop at the next
one, so one long recording can feed a whole bank.

Ambience loops forever by default, with a short blend at the loop point so it never clicks. Any sound
can be set to play once, a number of times, or forever, with fades in and out.

## Panes and layouts

Drag the lines between panes to resize them (the dot where two lines meet moves both). The Layout
menu has eight arrangements, from four equal panes to one; save the ones you like (Combat, Roleplay,
Prep) and switch between them from the same menu. Each pane holds tabs: drag a tab onto another pane
to move it, right-click a tab for more, and use the rail on the left to bring any panel forward.
Lock the layout during a session so nothing moves by accident.

## YouTube downloads

Searching and previewing always work. On some networks (this one included) YouTube asks the
downloader to prove it isn't a bot. If a download fails with "YouTube wants a sign-in":

1. Sign in to YouTube in Firefox (it works best on Windows; Chrome encrypts its cookies against this).
2. Settings, YouTube, choose Firefox, then **Test a download**.

Or upload a `cookies.txt` exported while you're on youtube.com. Links from SoundCloud, Bandcamp,
archive.org, direct MP3s and hundreds of other sites work the same way, and usually need no sign-in.

## Sites that refuse to be framed

Some sites forbid being shown inside another page. 5e.tools and D&D Beyond can also refuse when
Cloudflare decides to check your browser. The pane then offers to **open the site in a window placed
exactly over the pane**, or in a new tab.

To show those sites inside the pane, add the **frame helper** (one minute, Chrome or Edge):

1. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**.
2. **Load unpacked**, and choose the `extension` folder inside this folder.
3. Reload the DM Screen.

The helper only removes the "don't frame me" headers for frames inside the DM Screen's own tab.

## Notes and Obsidian

Notes are plain Markdown files. Settings, Notes: point the vault folder at your Obsidian vault and the
same notes appear in both. **Tonight's session** makes the next numbered note from
`Templates/Session.md`. The quick inserts stamp the time, log the scene that's playing, and link people
and places (making their notes in `People/` and `Places/` as you go). `[[` suggests notes to link,
`- [ ]` makes a thread to follow up, Ctrl+E switches between writing and reading. If Obsidian changes a
note while it's open here, you choose whose version to keep. Deleted notes go to the vault's `.trash`.

## Where things live

| Path | What |
| --- | --- |
| `data/audio/` | Your sounds (MP3s and the files you added) |
| `data/library.json` | Names, flags, trims and settings for each sound |
| `data/state/` | Layouts, playlists, pad banks, settings, keys |
| `vault/` | Notes, until you point Settings at another folder |

`data/` and `vault/` stay out of git, so your sounds, notes and sign-in cookies never reach GitHub.
Back them up by copying the folders.

To change the password, set the `DMSCREEN_PASSWORD` environment variable before starting.
