# Sounds for the DM screen

Everything in this folder plays on the DM screen at **https://blobberus.github.io/DMscreen/**. The folders are the screen's sections:

| Folder | On the screen |
|---|---|
| `Music/<name>/` | A **playlist** called *name*. Its files are the tracks, played in file-name order. Playlists take the number keys in folder order: Alt+1 starts the first. |
| `Ambience/<name>/` | An **ambience playlist** called *name*. Its files play one after another and the playlist repeats, **under** the music and the pads, so music, ambience and effects all play at once. It starts with the music playlist of the **same name** (`Ambience/Tavern` plays under `Music/01 Tavern`), or on its own from the Playlists pane, the Console or its number key. |
| `Effects/<name>/` | A **bank of soundboard pads** called *name*. Each sound takes the next free letter key: Q, W, E, R, T and on. |

## Adding sounds

1. Open the folder. On the screen, a folder's **Add** button opens GitHub right there.
2. Choose **Add file**, then **Upload files**, and drop in your MP3s.
3. Press **Commit changes**.

About a minute later they are on the screen (the repo's **Actions** tab shows it publishing).

**A new playlist, ambience playlist or pad bank** is a new folder. Make it on the screen (Playlists, **New** under Music or Ambience; the **+** beside the soundboard's banks), or here: **Add file**, **Create new file**, type the folder name, a slash and `README.md` (for example `Tavern/README.md`), and commit. A folder needs one file in it to exist.

## Names

- **The file name is the name on the screen.** `Goblin war drums.mp3` shows as *Goblin war drums*. Underscores become spaces.
- **Two digits and a space at the start set the order** without being shown: `01 Arrival.mp3`, `02 The long road.mp3`. It works for folders too; that is how the playlists get their number keys in order.
- **A playlist can change sides:** its **⋯** menu in the Playlists pane has *Make it an ambience playlist* (or *a music playlist*), which moves its folder between `Music` and `Ambience`.
- **Rename and move sounds on the screen** (a sound's menu, or the name and folder at the top of the editor). That renames the file here and keeps its flags, pads and keys with it. GitHub's own website can't rename audio files.

## Good to know

- **MP3 plays everywhere**, the iPad included. M4A, WAV and FLAC work too.
- **GitHub's upload page takes files up to 25 MB.** That is about 25 minutes of MP3 at 128 kb/s, or 17 minutes at 192 kb/s. A one-hour ambience download won't fit: cut it to 20 minutes or so at 128 kb/s (about 18 MB). Ambience loops on the screen anyway, so 20 minutes is plenty. On the PC, `tools/shrink_sounds.py` does it for a whole folder: `.venv\Scripts\python tools\shrink_sounds.py "C:\path\to\folder"`.
- **All the sounds together should stay under about 900 MB:** a GitHub Pages site stops at 1 GB.
- **This repo is public**: anyone can download what is in it. Only add sounds you are allowed to share, such as your own recordings and royalty-free or Creative Commons sounds.
- Flags, trims, pad keys and playlist keys are saved in `screen/setup.json` by any device connected to GitHub (on the screen: Settings, GitHub). There is no need to edit it by hand.
