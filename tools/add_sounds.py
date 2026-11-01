"""Add the sounds in "Sounds to Add" on the Desktop to the DM screen, in one go.

Double-click add_sounds.bat (it runs this). The drop folder is laid out like the screen:

    Sounds to Add\\Music\\<playlist>\\...     a music playlist
    Sounds to Add\\Ambience\\<name>\\...      an ambience playlist
    Sounds to Add\\Effects\\<bank>\\...       a bank of soundboard pads

Every sound or video in those folders goes into the same folder of the private sounds repo
(blobberus/DMscreen-sounds, cloned beside this one) as an MP3: MP3s under 160 kb/s as they are,
everything else re-encoded at LAME V4 (about 140 kb/s; a video gives its sound), and whatever would
still be over 25 MB cut to 20 minutes at 128 kb/s by tools/shrink_sounds.py. A new folder gets the
README.md the screen would give it. The clone is brought up to date first; then each folder is one
commit, pushed on its own (a big folder in parts of about 120 MB: a 730 MB push timed out), and only
once GitHub has it do its originals move to Sounds to Add\\Added\\<date>\\. Nothing is ever deleted.
The repo's "Index the sounds" workflow lists the new sounds, and the screen shows them a minute later.

    .venv\\Scripts\\python tools\\add_sounds.py [--from <drop folder>] [--repo <sounds clone>] [--dry-run]

--dry-run shows what would happen and changes nothing (no encoding, no git). Needs git and ffmpeg
(start.bat's .venv has ffmpeg: imageio-ffmpeg). See ADDING_SOUNDS.md for the rest.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
from pathlib import Path

sys.dont_write_bytecode = True      # no __pycache__ beside the tools
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_site import AUDIO_EXTS                   # noqa: E402  (what the screen plays)
from shrink_sounds import find_ffmpeg, free_name    # noqa: E402

REPO = Path(__file__).resolve().parent.parent
SHRINK = Path(__file__).resolve().parent / 'shrink_sounds.py'
HOWTO = 'HOW TO ADD SOUNDS.txt'
# app/js/core/site.js's CATEGORY_NAMES: the top folder names the screen takes, and the kind each means
CATEGORY_NAMES = {'music': 'music', 'ambience': 'ambience', 'ambiance': 'ambience', 'ambient': 'ambience',
                  'effects': 'effect', 'effect': 'effect', 'sfx': 'effect', 'soundboard': 'effect'}
CATEGORIES = {'music': ('Music', 'playlist'), 'ambience': ('Ambience', 'ambience playlist'), 'effect': ('Effects', 'pad bank')}
VIDEO_EXTS = {'.mp4', '.m4v', '.mov', '.mkv', '.avi', '.wmv', '.mpg', '.mpeg', '.flv'}
SOUND_EXTS = AUDIO_EXTS | {'.wma', '.aif', '.aiff'} | VIDEO_EXTS     # ffmpeg reads them all; they go in as MP3
LIMIT = 25 * 2 ** 20                # GitHub's upload page (and shrink_sounds.py's --limit)
KEEP_BELOW = 160                    # MP3s under this many kb/s go in as they are
LOWEST_V4 = 8000                    # bytes a second: under 64 kb/s V4 is rare, so longer than LIMIT / this is cut straight away
IGNORED = {'desktop.ini', 'thumbs.db', HOWTO.lower()}


@dataclass
class Sound:
    src: Path                       # the original, in the drop folder
    rel: Path                       # its path in the drop folder
    category: str                   # Music, Ambience or Effects
    parts: tuple                    # its path inside the category folder (playlist folder first)
    target: Path = None             # where it goes in the sounds repo
    folder: str = ''                # its playlist / bank under sounds/, e.g. "Music/Epic & Introduction"
    folder_path: Path = None
    new_folder: bool = False
    length: float = 0.0
    codec: str = None
    kbps: float = 0.0
    size_in: int = 0
    size_out: int = 0
    ready: Path = None              # the MP3 that goes in (src itself when it goes in as it is)
    how: str = ''
    skip: str = ''
    error: str = ''

    @property
    def name(self):                 # its path inside its playlist folder, as an MP3
        return self.target.relative_to(self.folder_path).as_posix()

    @property
    def original(self):             # the same, as it is in the drop folder
        return '/'.join(self.parts[1:])


# ---- the screen's names (ported from app/js/core/site.js) ---------------------------------------
def folder_name(d):
    """folderName(): "01 Tavern_songs" shows as "Tavern songs" (two digits at the start set the order)."""
    base = d.rsplit('/', 1)[-1]
    prefix = re.match(r'\d{2}[\s._-]+', base)
    shown = base[prefix.end():] if prefix else base
    return (shown or base).replace('_', ' ')


def folder_readme(d):
    """folderReadme(): the note GitHub shows in a folder: what it is on the screen and how to add to it."""
    kind = CATEGORY_NAMES.get(d.split('/')[0].lower())
    name = folder_name(d)
    what = {
        'music': f'The **{name}** playlist. Every audio file in this folder is one of its tracks, played in file-name order. Its number key is set on the screen.',
        'ambience': f'The **{name}** ambience playlist. Its files play one after another in file-name order, like any playlist: starting it ends what was playing. To play one of its sounds over something else, use that sound\'s on-top button in the Playlists pane. Its number key is set on the screen.',
        'effect': f'The **{name}** bank of soundboard pads. Each sound here gets the next free letter key; change keys, labels and how pads play on the screen.',
    }.get(kind, f'Sounds in **{name}**. They appear in the Sound library.')
    up = '../' * max(1, len(d.split('/')))
    return (f'# {name}\n\n{what}\n\n**To add sounds:** choose **Add file**, then **Upload files**, drop in your MP3s (up to 25 MB each) '
            f'and press **Commit changes**. They show up on the DM screen about a minute later.\n\n'
            f'Naming rules and the rest of the folders: [sounds/README.md]({up}README.md)\n')


# ---- the drop folder ----------------------------------------------------------------------------
def default_drop():
    desktop = Path.home() / 'Desktop'
    return (desktop if desktop.is_dir() else Path.home()) / 'Sounds to Add'


def howto_text():
    return f"""HOW TO ADD SOUNDS TO THE DM SCREEN

1. Put each sound in the folder of the playlist it belongs to:

     Music\\<playlist name>\\     a music playlist      Music\\Tavern\\Drinking song.mp3
     Ambience\\<name>\\           an ambience playlist  Ambience\\Forest\\Birdsong.mp3
     Effects\\<bank name>\\       a soundboard bank     Effects\\Magic\\Fireball.mp3

   Every playlist and bank on the screen already has its folder here (made each time
   add_sounds.bat runs): drop sounds into it. A new folder makes a new playlist or bank.
   The file name is the name on the screen. Two digits and a space at the start
   (01 Arrival.mp3) set the order without being shown.

2. Double-click add_sounds.bat in {REPO}

MP3, M4A, WAV, FLAC, OGG and videos (MP4, MOV, MKV...) all work: they go in as MP3s, and a
video gives its sound. Anything over 25 MB (long ambience) is cut to 20 minutes, which loops
fine on the screen. What was added moves to the Added folder here, by date; nothing is ever
deleted. The sounds are on the screen about a minute later.
"""


def set_up_drop(drop, sounds=None):
    """Make sure the drop folder has its three folders, an empty folder for each playlist and bank the
    sounds repo has (so adding to one is dropping files in it), and the how-to note. True if it was just
    made."""
    made = not drop.exists()
    for cat, _ in CATEGORIES.values():
        (drop / cat).mkdir(parents=True, exist_ok=True)
        if sounds and (sounds / cat).is_dir():
            for d in sorted((sounds / cat).iterdir()):
                if d.is_dir() and not d.name.startswith('.'):
                    (drop / cat / d.name).mkdir(exist_ok=True)
    note, text = drop / HOWTO, howto_text().replace('\n', '\r\n').encode('utf-8')
    try:
        if not note.is_file() or note.read_bytes() != text:
            note.write_bytes(text)
    except OSError:
        pass                        # open in Notepad, say: the sounds matter more than the note
    return made


def is_sound(path):
    return path.suffix.lower() in SOUND_EXTS


def ignored(name):
    return name.startswith('.') or name.lower() in IGNORED


def scan(drop):
    """The sounds in the drop folder's playlist folders, and (path, why) for what is left where it is."""
    found, skipped = [], []
    for top in sorted(drop.iterdir(), key=lambda p: p.name.lower()):
        if ignored(top.name):
            continue
        if top.is_file():
            example = Path('Music', '<playlist name>', top.name)
            skipped.append((top.name, f'is loose in the drop folder: put it in a playlist folder, for example {example}'
                            if is_sound(top) else 'is not a sound or video file'))
            continue
        if top.name.lower() == 'added':
            continue
        cat = CATEGORIES.get(CATEGORY_NAMES.get(top.name.lower()))
        if not cat:
            if any(f.is_file() for f in top.rglob('*')):
                skipped.append((top.name + os.sep, f'is not Music, Ambience or Effects: move it into one of them, '
                                                    f'for example {Path("Music", top.name)}{os.sep}'))
            continue
        canon, one = cat
        for f in sorted((f for f in top.rglob('*') if f.is_file()), key=lambda p: str(p).lower()):
            inner = f.relative_to(top).parts
            if any(ignored(p) for p in inner):
                continue
            rel = f.relative_to(drop)
            if not is_sound(f):
                skipped.append((str(rel), 'is not a sound or video file'))
            elif len(inner) == 1:
                example = Path(top.name, f'<{one} name>', f.name)
                skipped.append((str(rel), f'is straight in {top.name}: put it in a {one} folder inside it, for example {example}'))
            else:
                found.append(Sound(src=f, rel=rel, category=canon, parts=inner))
    return found, skipped


# ---- where each sound goes ----------------------------------------------------------------------
def actual_case(parent, name):
    """name as parent already spells it (a drop folder "tavern" goes into the repo's "Tavern"), or name."""
    try:
        for entry in os.scandir(parent):
            if entry.name.lower() == name.lower():
                return entry.name
    except OSError:
        pass
    return name


def resolve(found, sounds):
    """Each sound's place in the sounds repo; those already there, or there twice, are skipped."""
    keep, skipped, taken = [], [], set()
    for s in found:
        d, names = sounds, []
        for seg in (s.category, *s.parts[:-1]):
            seg = actual_case(d, seg)
            names.append(seg)
            d = d / seg
            if len(names) == 2:
                s.folder, s.folder_path = '/'.join(names), d
        s.new_folder = not s.folder_path.is_dir()
        s.target = d / actual_case(d, Path(s.parts[-1]).with_suffix('.mp3').name)
        rel = s.target.relative_to(sounds).as_posix()
        if s.target.exists():
            skipped.append((str(s.rel), f'is already on the screen ({rel})'))
        elif rel.lower() in taken:
            skipped.append((str(s.rel), f'would be {rel} too: give one of them another name'))
        else:
            taken.add(rel.lower())
            keep.append(s)
    order = {cat: i for i, (cat, _) in enumerate(CATEGORIES.values())}
    keep.sort(key=lambda s: (order[s.category], s.folder.lower(), s.name.lower()))
    return keep, skipped


# ---- the sound itself ---------------------------------------------------------------------------
def probe(ffmpeg, s):
    """Length, codec and kb/s from ffmpeg's report on the file (codec None: no sound in it)."""
    s.size_in = s.src.stat().st_size
    text = subprocess.run([ffmpeg, '-hide_banner', '-i', str(s.src)], capture_output=True).stderr.decode('utf-8', 'replace')
    m = re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)', text)
    s.length = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else 0.0
    a = re.search(r'Stream #\S+: Audio: (\w+)([^\n]*)', text)
    if not a:
        s.skip = 'has no sound in it (or ffmpeg can\'t read it)'
        return
    s.codec = a[1]
    rate = re.search(r'(\d+) kb/s', a[2]) or re.search(r'bitrate: (\d+) kb/s', text)
    s.kbps = int(rate[1]) if rate else (s.size_in * 8 / 1000 / s.length if s.length else 0)


def is_small_mp3(s):
    return s.codec == 'mp3' and s.src.suffix.lower() == '.mp3' and s.kbps < KEEP_BELOW


def route(s):
    """'keep', 'encode' or 'cut' (an encode still ends in a cut if it comes out over 25 MB)."""
    if is_small_mp3(s):
        return 'keep' if s.size_in <= LIMIT else 'cut'
    return 'cut' if s.length * LOWEST_V4 > LIMIT else 'encode'


def source(s):
    """What it was: "192 kb/s MP3", "M4A", "MP4 video"."""
    ext = s.src.suffix.lower()
    if ext in VIDEO_EXTS:
        return f'{ext[1:].upper()} video'
    return f'{s.kbps:.0f} kb/s MP3' if s.codec == 'mp3' else ext[1:].upper()


def prepare(s, ffmpeg, work, n):
    """Make the MP3 that goes in (s.ready), or set s.skip / s.error."""
    probe(ffmpeg, s)
    if s.skip:
        return s
    way = route(s)
    if way == 'keep':
        s.ready, s.size_out, s.how = s.src, s.size_in, f'as it is ({s.kbps:.0f} kb/s)'
        return s
    if way == 'encode':
        out = work / f'{n}.mp3'
        r = subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(s.src), '-map', '0:a:0', '-vn',
                            '-map_metadata', '-1', '-map_chapters', '-1', '-c:a', 'libmp3lame', '-q:a', '4', str(out)],
                           capture_output=True)
        if r.returncode or not out.is_file():
            s.error = 'ffmpeg could not convert it: ' + (r.stderr.decode('utf-8', 'replace').strip().splitlines() or ['?'])[-1][:200]
            return s
        if out.stat().st_size <= LIMIT:
            s.ready, s.size_out, s.how = out, out.stat().st_size, f're-encoded from {source(s)}'
            return s
        out.unlink()                # still too big: cut it from the original instead
    # the way tools/shrink_sounds.py makes long sounds small (20 minutes from 30 s in, 128 kb/s): it does it
    cut = work / f'{n}-cut'
    r = subprocess.run([sys.executable, str(SHRINK), str(s.src), '--out', str(cut)], capture_output=True,
                       env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
    said = (r.stdout + r.stderr).decode('utf-8', 'replace')
    out = cut / Path(s.src.name).with_suffix('.mp3')
    if r.returncode or 'FAILED' in said or not out.is_file():
        s.error = 'could not shrink it: ' + (said.strip().splitlines() or ['?'])[-1][:200]
        return s
    s.size_out = out.stat().st_size
    if s.size_out > LIMIT:
        s.error = f'still {size(s.size_out)} after cutting it (25 MB at most): cut it shorter with tools/shrink_sounds.py --minutes 15'
        return s
    m = re.search(r'cut to ([\d.]+) min', said)
    s.ready = out
    s.how = (f'cut to {m[1]} minutes at 128 kb/s (it was {s.length / 60:.0f})' if m else
             f're-encoded from {source(s)} at 128 kb/s')
    return s


def size(n):
    return f'{n / 2 ** 20:.1f} MB' if n >= 2 ** 20 / 10 else f'{n / 1024:.0f} KB'


# ---- git ----------------------------------------------------------------------------------------
def git(repo, *args, stdin=None):
    return subprocess.run(['git', '-C', str(repo), *args], input=stdin, capture_output=True,
                          text=True, encoding='utf-8', errors='replace')


def why(r):
    """The line of git's output that says what went wrong."""
    lines = [l.strip() for l in (r.stderr + '\n' + r.stdout).splitlines() if l.strip() and not l.lower().startswith('hint:')]
    for l in lines:
        if l.startswith(('fatal:', 'error:', '!')) and 'failed to push some refs' not in l:
            return l
    return lines[-1] if lines else f'git stopped with code {r.returncode}'


def abort_rebase(repo):
    for name in ('rebase-merge', 'rebase-apply'):
        p = git(repo, 'rev-parse', '--git-path', name).stdout.strip()
        if p and (Path(p) if Path(p).is_absolute() else repo / p).exists():
            git(repo, 'rebase', '--abort')
            return


def on_github(repo):
    return git(repo, 'merge-base', '--is-ancestor', 'HEAD', '@{u}').returncode == 0


def commit(repo, s0, part, message, readme):
    """Put a part's MP3s (and a new folder's README.md) into the clone and commit only them. None, or what went wrong."""
    placed = []
    try:
        for s in part:
            s.target.parent.mkdir(parents=True, exist_ok=True)
            if s.ready == s.src:
                shutil.copy2(s.src, s.target)
            else:
                shutil.move(str(s.ready), str(s.target))
            placed.append(s.target)
        if readme:
            path = s0.folder_path / 'README.md'
            path.write_bytes(folder_readme(s0.folder).encode('utf-8'))     # \n line ends, like the screen's
            placed.append(path)
        paths = '\0'.join(p.relative_to(repo).as_posix() for p in placed)
        r = git(repo, '--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul', stdin=paths)
        if r.returncode == 0:
            r = git(repo, 'commit', '-q', '-m', message)
        if r.returncode == 0:
            return None
        problem = f'git could not commit it: {why(r)}'
    except OSError as e:
        problem = f'could not write it into {repo}: {e}'
    git(repo, 'reset', '-q')        # unstage, and take the files back out: the clone is as it was
    for p in placed:
        p.unlink(missing_ok=True)
    return problem


def push(repo):
    """Send the commits to GitHub. When it refuses because GitHub has commits this clone hasn't, take
    them in (git pull --rebase) and try again, 3 times at most. None, or what went wrong."""
    problem = None
    for attempt in range(4):
        r = git(repo, 'push', '-q')
        if r.returncode == 0:
            return None
        problem = why(r)
        if attempt == 3:
            break
        p = git(repo, 'pull', '--rebase', '-q')
        if p.returncode:
            abort_rebase(repo)
            problem += f' (and then taking in GitHub\'s changes failed: {why(p)})'
            break
    if git(repo, 'fetch', '-q').returncode == 0 and on_github(repo):
        return None                 # it got there after all (a time-out after GitHub had it)
    return problem


def undo(repo, message):
    """Take back a commit of ours that never reached GitHub, files and all, so the next run starts over."""
    abort_rebase(repo)
    if git(repo, 'log', '-1', '--format=%s').stdout.strip() == message and not on_github(repo):
        git(repo, 'reset', '-q', '--hard', 'HEAD~1')


def ready_repo(repo):
    """Check the clone is clean and bring it up to date. None, or why not."""
    top = git(repo, 'rev-parse', '--show-toplevel')
    if top.returncode or not Path(top.stdout.strip()).samefile(repo):
        return f'{repo} is not a git clone of the sounds repo.'
    r = git(repo, 'status', '--porcelain', '-z')
    if r.returncode or r.stdout.strip():
        changed = [e[3:] for e in r.stdout.split('\0') if e[2:3] == ' '][:5]
        return (f'The sounds repo at {repo} has changes of its own that aren\'t on GitHub '
                f'({", ".join(changed) or why(r)}), so nothing was changed.\n'
                f'Ask Claude in the DMscreen folder to sort it out (see ADDING_SOUNDS.md), then run this again.')
    print('Getting the latest from GitHub...', end=' ', flush=True)
    r = git(repo, 'pull', '--ff-only', '-q')
    if r.returncode:
        print('failed.')
        return (f'Could not bring the sounds repo up to date with GitHub ({why(r)}), so nothing was changed.\n'
                f'Check the internet connection and run this again. If it keeps happening, ask Claude in the '
                f'DMscreen folder to sort it out (see ADDING_SOUNDS.md).')
    r = git(repo, 'rev-list', '--count', '@{u}..HEAD')
    if r.returncode or r.stdout.strip() != '0':
        print('stopped.')
        return (f'The sounds repo at {repo} has commits of its own that aren\'t on GitHub yet '
                f'({why(r) if r.returncode else r.stdout.strip()}), so nothing was changed.\n'
                f'Ask Claude in the DMscreen folder to sort it out (see ADDING_SOUNDS.md), then run this again.')
    print('done.')
    return None


# ---- the run ------------------------------------------------------------------------------------
def print_skipped(skipped):
    if skipped:
        print(f'\nLeft where they are ({len(skipped)}):')
        for where, reason in skipped:
            print(f'  {where}  {reason}')


def dry_run(found, skipped, ffmpeg):
    with ThreadPoolExecutor(4) as pool:
        list(pool.map(lambda s: probe(ffmpeg, s), found))
    skipped += [(str(s.rel), s.skip) for s in found if s.skip]
    found = [s for s in found if not s.skip]
    folder = None
    for s in found:
        if s.folder != folder:
            folder = s.folder
            kind = CATEGORIES[CATEGORY_NAMES[s.category.lower()]][1]
            print(f'\n{folder}' + (f'  (a new {kind}, with a README.md)' if s.new_folder else ''))
        way = route(s)
        what = {'keep': f'as it is ({source(s)})',
                'encode': f're-encoded at LAME V4 from {source(s)} (cut to 20 minutes if that comes out over 25 MB)',
                'cut': f'cut to 20 minutes at 128 kb/s (it is {s.length / 60:.0f} minutes)'}[way]
        print(f'  {s.name}  {size(s.size_in)}, {what}')
    print_skipped(skipped)
    print(f'\nDry run: {len(found)} sound(s) would be added. Nothing was changed.' if found else
          '\nDry run: nothing would be added. Nothing was changed.')
    return 0


def run(args):
    drop = Path(args.drop).expanduser().resolve()
    repo = Path(args.repo).expanduser().resolve()
    sounds = repo / 'sounds'
    print(f'Adding sounds from {drop}\nto the sounds repo at {repo}' + ('\n(dry run: nothing will be changed)' if args.dry_run else ''))

    if args.dry_run and not drop.is_dir():
        print(f'\nThere is no {drop} yet: a real run makes it, with Music, Ambience and Effects folders in it.')
        return 0
    if not args.dry_run and set_up_drop(drop, sounds):
        print(f'\nMade {drop}, with Music, Ambience and Effects folders in it.\n'
              f'Put sounds in them (see {HOWTO} there) and run this again.')
        return 0
    found, skipped = scan(drop)
    if not found:
        print_skipped(skipped)
        print(f'\nNothing to add. Put sounds in {Path(drop, "Music", "<playlist name>")} (or Ambience, Effects)'
              f' and run this again: {HOWTO} there says how.')
        return 0

    if not sounds.is_dir():
        print(f'\nThere is no sounds repo at {repo}. Clone it beside DMscreen first:\n'
              f'  git clone https://github.com/blobberus/DMscreen-sounds.git "{repo}"', file=sys.stderr)
        return 1
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        print('\nffmpeg is missing. Run start.bat once (it installs it), or: pip install imageio-ffmpeg', file=sys.stderr)
        return 1
    if args.dry_run:
        found, more = resolve(found, sounds)
        return dry_run(found, skipped + more, ffmpeg)
    if not shutil.which('git'):
        print('\nGit is needed for this: https://git-scm.com/download/win', file=sys.stderr)
        return 1
    print()
    problem = ready_repo(repo)
    if problem:
        print(f'\n{problem}', file=sys.stderr)
        return 1
    set_up_drop(drop, sounds)                # after the pull: playlists made on the screen get folders too
    found, more = resolve(found, sounds)     # after the pull: renames made on the screen count
    skipped += more

    day, limit = date.today().isoformat(), args.push_mb * 2 ** 20
    added, errors, folders = [], [], {}
    for s in found:
        folders.setdefault(s.folder.lower(), []).append(s)
    with tempfile.TemporaryDirectory(prefix='dm-add-sounds-', ignore_cleanup_errors=True) as tmp, ThreadPoolExecutor(4) as pool:
        work, n = Path(tmp), 0
        for done, items in enumerate(folders.values()):
            first = items[0]
            kind = CATEGORIES[CATEGORY_NAMES[first.category.lower()]][1]
            print(f'\n{first.folder}' + (f'  (a new {kind})' if first.new_folder else ''))
            ready = []
            for s in pool.map(lambda job: prepare(job[1], ffmpeg, work, job[0]), enumerate(items, n)):
                if s.skip:
                    skipped.append((str(s.rel), s.skip))
                    print(f'  {s.original}  left out: it {s.skip}')
                elif s.error:
                    errors.append(f'{s.rel}: {s.error}')
                    print(f'  {s.original}  FAILED: {s.error}')
                else:
                    ready.append(s)
                    print(f'  {s.name}  {size(s.size_in)} -> {size(s.size_out)}, {s.how}')
            n += len(items)
            parts, part, total = [], [], 0                # pushes of about --push-mb at most
            for s in ready:
                if part and total + s.size_out > limit:
                    parts.append(part)
                    part, total = [], 0
                part.append(s)
                total += s.size_out
            parts += [part] if part else []
            stopped = False
            for i, part in enumerate(parts, 1):
                count = f'{len(part)} sound' + ('s' if len(part) != 1 else '')
                message = f'Add {count} to {first.folder}' + (f' (part {i} of {len(parts)})' if len(parts) > 1 else '')
                problem = commit(repo, first, part, message, first.new_folder and i == 1)
                if not problem:
                    print(f'  Sending {count} to GitHub ({size(sum(s.size_out for s in part))})...', end=' ', flush=True)
                    problem = push(repo)
                    if problem:
                        undo(repo, message)
                        problem = f'could not send it to GitHub ({problem}). Check the internet connection'
                    print('failed.' if problem else 'done.')
                if problem:
                    errors.append(f'{first.folder}: {problem}. Those sounds were not added: their files are still in the drop folder.')
                    stopped = True
                    break
                moved = 0
                for s in part:                            # on GitHub now: the originals go to Added
                    try:
                        dest = free_name(drop / 'Added' / day / s.rel)
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        os.rename(s.src, dest)        # same drive: a move, or nothing (never a copy left behind)
                        moved += 1
                    except OSError as e:
                        errors.append(f'{s.rel} is on the screen now, but could not be moved to Added ({e.strerror or e}): move or delete it yourself.')
                added += part
                print(f'  Moved {"the originals" if moved == len(part) else f"{moved} of {len(part)} originals"} to {Path("Added", day)}.')
            if stopped:
                left = len(folders) - done - 1
                if left:
                    errors.append(f'Stopped there: {left} more folder(s) were not tried; their files are still in the drop folder. Run this again later.')
                break

    print('\n' + '-' * 72)
    if added:
        before, after = sum(s.size_in for s in added), sum(s.size_out for s in added)
        print(f'Added {len(added)} sound(s) ({size(before)} -> {size(after)}):')
        done_ids = {id(s) for s in added}
        for items in folders.values():
            mine = [s for s in items if id(s) in done_ids]
            if mine:
                print(f'  {mine[0].folder}: {len(mine)}, {size(sum(s.size_in for s in mine))} -> {size(sum(s.size_out for s in mine))}')
    else:
        print('Nothing new was added.')
    print_skipped(skipped)
    if errors:
        print(f'\nProblems ({len(errors)}):')
        for e in errors:
            print(f'  {e}')
    if added:
        total = sum(f.stat().st_size for f in sounds.rglob('*') if f.is_file())
        print(f'\nThe sounds repo holds {total / 2 ** 20:.0f} MB of sounds now (keep it under about 2 GB).')
        print('They will be on the screen in about a minute: press the refresh button in the Sound library, or reload.')
    return 1 if errors else 0


def main():
    for stream in (sys.stdout, sys.stderr):     # any file name prints, in a console or a pipe: never a crash
        stream.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--from', dest='drop', default=str(default_drop()), help='the drop folder (default: "Sounds to Add" on the Desktop)')
    ap.add_argument('--repo', default=str(REPO.parent / 'DMscreen-sounds'), help='the sounds repo\'s clone (default: DMscreen-sounds beside DMscreen)')
    ap.add_argument('--dry-run', action='store_true', help='show what would happen; change nothing')
    ap.add_argument('--push-mb', type=float, default=120, help='the most to send to GitHub in one push, in MB (default 120)')
    sys.exit(run(ap.parse_args()))


if __name__ == '__main__':
    main()
