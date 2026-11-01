# DM Screen

A Dungeon Master's screen for the table: up to four panes you arrange however the session needs,
built around a sound console you can run from the keyboard without looking.

- **Sound console**: everything that is playing, sound effects included (each with a scrub bar and a
  stop), the track's flags, the transport, your playlists, ambience and pads to fire, and a mixer.
- **Soundboard**: effect pads laid out like your keyboard. Alt+Q fires the pad on Q.
- **Playlists**: music and ambience playlists, listed apart, on number keys (Alt+1 to 9). Starting a
  track ends the one playing; a track's on-top button plays it over whatever is playing instead.
- **Sound library and editor**: add files, download from links, trim, drop flags, set repeats and
  fades, cut part of a sound into a new one, export MP3 or WAV.
- **YouTube**: search, preview, and download the audio (all of it, or just a stretch) as MP3.
- **Stone Wardens**: your campaign site, and the screen's browser. Searches, addresses, your Sites list
  (5e.tools, D&D Beyond…), links in notes and links the campaign site opens in a new tab all load in
  this one tab.
- **Notes**: Markdown notes in an Obsidian vault, made for writing during a session.
- **Merchants**: shops by kind of place (Collector's, Capital, Artisan, Town, Village, Street), each
  listing what it sells with a short synopsis and a price; double-click an item for its details. Add
  your own categories, shops and items. Open it from any pane's **+**.

The whole screen is behind one password: **Pleiades**.

It comes in two versions that look and play the same:

- **The website**, **https://blobberus.github.io/DMscreen/**, for any device including an iPad.
  Its sounds are the MP3s in this repo's [`sounds`](sounds/) folder.
- **The PC version** (`start.bat`), which can also download from YouTube and save notes straight into
  an Obsidian folder.

## The website

Open **https://blobberus.github.io/DMscreen/** and enter the password.

**The sounds live in a private repo, [blobberus/DMscreen-sounds](https://github.com/blobberus/DMscreen-sounds),
and its folders are the screen** ([adding sounds](ADDING_SOUNDS.md)):

| Folder | On the screen |
|---|---|
| `sounds/Music/<name>/` | the playlist *name*; its files are the tracks, in file-name order |
| `sounds/Ambience/<name>/` | the ambience playlist *name*, listed apart from the music |
| `sounds/Effects/<name>/` | the soundboard bank *name*; each sound takes the next free letter key |

- **Each device plays them once it is connected to GitHub** (Settings, GitHub has the four steps). The
  repo is private, so the screen reads it with that device's token, which can only reach DMscreen and
  DMscreen-sounds and is kept in that browser. A sound streams the first time it plays, then stays on the
  device and plays offline. A token made before the sounds moved (DMscreen only) needs DMscreen-sounds
  added on GitHub; Settings, GitHub says how.
- **Add sounds:** every folder on the screen has an **Add** button. It opens GitHub's upload page for
  that folder of the sounds repo: drop in MP3s and press **Commit changes**. They appear on the screen
  about a minute later, once the repo's *Index the sounds* workflow has read them.
- **Rename and move sounds** on the screen (a sound's menu, or the name and folder at the top of the
  editor). The file is renamed in the sounds repo, and its flags, pads and keys go with it. Folders (playlists,
  pad banks) rename the same way, and **New** makes one. A playlist's ⋯ menu moves it between Music and
  Ambience.
- **Delete a sound** from its **⋯** menu (on each row of the Sound library and the Playlists pane, and at
  the top of the editor) or with the Delete key on a library row. **Delete a playlist, ambience playlist or
  pad bank** from its ⋯ menu (or hold / right-click it in the Playlists list): that deletes its folder and
  every sound in it from the sounds repo, in one commit. You're asked first, and GitHub keeps deleted
  files in its history, so they can be brought back there.
- The setup (flags, trims, pads, playlist keys, shortcuts, bookmarks) is saved in `screen/setup.json`
  here, kept the same on every connected device. Layouts and settings belong to each device.
- **Notes** are kept in the browser on that device, never in the repo (it's public). Settings, Notes
  downloads them all as Markdown for Obsidian.
- **This repo is public** (the screen's code and its setup); the password keeps people out of the
  screen, not out of these files. The sounds aren't here: only your connected devices can play or
  download them. Never put sounds in this repo.
- The website can't search or download from YouTube (that needs the PC version); its YouTube pane plays
  a pasted link.

### On an iPad

Open the site in Safari, then **Share, Add to Home Screen**. It opens full-screen like an app, and Safari
won't clear its sounds and setup. Connect it to GitHub once (Settings, GitHub) so it can play the sounds.
Sounds you've played stay on the iPad; **Settings, This device, Keep
every sound on this device** downloads all of them, so the screen works without Wi-Fi.

Tap pads to fire them, hold a finger on a sound or pad for its menu, and drag the lines between panes to
resize them. With a keyboard, Option works as Alt, so every shortcut works.

**Bluetooth speakers and headphones:** when one drops out for a moment, wakes up or reconnects, the iPad
interrupts the sound; the screen brings it back by itself, each sound from where it was. If Safari wants a
tap first, a note says so and any tap does it. The device's play and pause buttons only play and pause
the track (a stray "play" from a speaker used to pause it).

Sites that refuse to be shown inside another page open in a new tab on the iPad. Use Split View to keep
them beside the screen.

### How it's published

`.github/workflows/pages.yml` runs `tools/build_site.py` on every push: it copies `app/`, marks it with
the sounds repo and stamps each file with the build's version. No sounds are published. In the sounds
repo, its *Index the sounds* workflow runs this repo's `tools/index_sounds.py` whenever sounds change: it
lists every sound (path, content id, size, length) in that repo's `library.json`, with a waveform per
sound in `peaks/`. The site reads that list through the GitHub API, and its offline worker (`sw.js`)
fetches each sound by its content id with the device's token, streaming it the first time and keeping
it. Saving `screen/setup.json` doesn't rebuild; the site reads it live.

## The PC version

### Start it

Double-click **`start.bat`**. The first run sets up Python packages (a minute or two); after that it
starts in a few seconds and opens `http://localhost:7070` in your browser. Leave the black window
open while you play; close it to stop the screen.

Needs Python 3.10 or newer (already on this computer). Everything else installs itself into `.venv`.

- `start.bat --lan` also lets other devices on your network open it (a tablet at the table).
- **Adding sounds that are too big** (or from another device with Claude): see
  [ADDING_SOUNDS.md](ADDING_SOUNDS.md). `sync.bat` brings this copy up to date with GitHub, renames made
  on the website included; `start.bat` does it quietly each time.
- **Adding sounds to the website:** put them in **Sounds to Add** on the Desktop, in `Music\<playlist>`,
  `Ambience\<name>` or `Effects\<bank>` (a new name makes a new playlist or bank), then double-click
  **`add_sounds.bat`**. It converts them to MP3, cuts anything over 25 MB to 20 minutes, and sends each
  folder to the private sounds repo. What was added moves to `Sounds to Add\Added\<date>`. They're on the
  screen about a minute later. `add_sounds.bat --dry-run` only shows what it would do.
- `update.bat` updates the downloader. YouTube changes often, so run it when downloads start failing
  (or use Settings, YouTube, Update the downloader).
- **Deleting:** a sound's **⋯** menu in the Sound library (or the editor's, or the Delete key) deletes it
  and its file from this PC, and takes it off every playlist and pad. A playlist's ⋯ menu (or hold /
  right-click it in the list) deletes the playlist only; its sounds stay in the library.

## Running the sound

| Keys | What they do |
| --- | --- |
| Alt+1 … Alt+9 | Start the playlist on that number (it crossfades from what was playing) |
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
| Alt+Shift+H / Alt+Shift+S | Hide the pane you're in / show every hidden pane |
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
can be set to play once, a number of times, or forever, with fades in and out. In a playlist each sound
plays through once and the next crossfades in; choose **Repeat track** to loop just one.

### One track, and sounds on top

Playing a track or a playlist ends whatever was playing, so a playlist never plays all its sounds at
once. To layer sounds (music with rain under it, a crowd over a fire), press a track's **on-top** button
(the stacked squares) in the Playlists pane or the Sound library: just that sound plays over the rest,
and pressing it again stops it. Pads always play over everything. A track's **play next** button (the
skip arrow) queues it to play when the current track ends, then the playlist carries on; one sound waits
at a time, shown in the top bar with an × to take it off. The Console's **Playing** list shows
every sound that is playing, each with its own scrub bar (click or drag it to move just that sound),
pause, stop and low-pass switch (which also takes it in or out of the speed). Sounds on top and pads also have a loop button: on, the sound goes
round until you stop it; off, it finishes the pass it is in. (The track loops with Repeat track.)

**Low-pass:** the slider above the Playing list muffles the sounds switched into it (the wave button on
each row; the track and sounds on top are in by default, pads only with **Pads too**). Slide it while
the party ducks behind a door or goes underwater; double-click it to open it again.

**Speed:** the **Speed** button beside the low-pass opens a bar with a speed slider (half to double)
and presets (0.5× to 2×). It speeds up or slows the same sounds as the low-pass, pitch following like
a tape, and sounds started while it is set play at it too. With the bar closed, the button shows a
speed that isn't normal; double-click the slider, or press 1×, for normal speed. A reload plays at
normal speed.

**A sound's volume:** its **⋯** menu (or right-click in the Sound library) has **Volume…**, the level it
plays at everywhere, from silent up to 300%, kept with the sound; it changes what is already playing
too. The Console's mixer has a fader for every sound that is playing (the track, sounds on top, pads)
that sets its volume for that play only: the saved volume stays, and the sound starts at it again next
time. Double-click a fader to go back to the saved volume; a notch marks 100%. The Sound library's folders fold away: click a folder's heading, or **Collapse all**.

### Previews in your headphones

Every sound in the library and every track in a playlist has a headphones button: it previews the sound
without touching the music, ambience or pads (the editor's play button previews too). In **Settings,
Audio, Preview output**, send previews to a second output, like headphones, and only you hear them: press
**List my outputs**, pick one, and **Play a test sound**. Chrome and Edge ask for the microphone once to
show your outputs by name; nothing is recorded. If those headphones are unplugged, previews go silent
instead of out of the table's speakers. This needs Chrome or Edge (or Firefox) on a computer: an iPad
sends all its sound to one place, so there previews play through the main output.

## Panes and layouts

The screen starts with Stone Wardens large on the left and the console above the soundboard on the
right; notes wait in the fourth pane (tap its rail button for large left, three stacked). Drag the
lines between panes to resize them (the dot where two lines meet moves both). The Layout menu, whose
button draws the arrangement on screen, has eight arrangements, from four equal panes to one; save the
ones you like (Combat, Roleplay, Prep) and switch between them from the same menu. Each pane holds tabs: drag a tab onto another pane
to move it, right-click a tab for more, or use **+** in a pane's corner to show another panel there.
Lock the layout during a session so nothing moves by accident.

The rail on the left has one button for each of the four panes, drawn as a little map with that pane
filled in. Tap one to take its pane off the screen: the panes beside it grow into its space and
everything else stays where it was, while its tabs keep playing and waiting. Tap it again to bring the
pane back. The **–** in a pane's corner hides it too, and the top bar shows how many panes are hidden.
Open the rail (the button under the mark) to see each pane's name and a dropdown of its tabs: choose a
tab to show it, or **Add a panel here**. Right-click or hold a pane button for the same list with the
rail closed. Picking an arrangement from the Layout menu shows all of its panes again. In a narrow
window there is only one pane, so the rail lists the panels instead.

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

Google searches load in the pane, but inside another page the browser keeps Google's own cookies from
it, and Google may then leave out the AI Overview. The note over the results opens the same search in
a window over the pane, where everything shows.

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
