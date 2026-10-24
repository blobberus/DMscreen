"""Make long sounds small enough for the website.

GitHub's upload page takes files up to 25 MB, and a GitHub Pages site stops at 1 GB, so a one-hour
ambience download (about 80 MB at 192 kb/s) won't go in as it is. This cuts each long file to a
stretch (20 minutes from 30 s in, skipping a fade-in or intro) and re-encodes it as 128 kb/s stereo
MP3: about 18 MB a file. Ambience loops on the screen, so 20 minutes is plenty. A sound shorter than
that is only re-encoded, never cut.

Shrink every oversized sound already in the repo's sounds/ folder, where it is (the usual way; the
full-length originals are copied to "DM screen originals" on the Desktop first, outside the repo):

    .venv\\Scripts\\python tools\\shrink_sounds.py --in-place          (Windows)
    python3 tools/shrink_sounds.py --in-place                        (macOS / Linux)

Or make small copies of files or folders somewhere else, leaving them untouched:

    python tools/shrink_sounds.py "C:\\Users\\me\\Desktop\\Tavern" --out "C:\\Users\\me\\Desktop\\small"

Needs ffmpeg: pip install imageio-ffmpeg (start.bat's .venv has it), or ffmpeg on the PATH.
See ADDING_SOUNDS.md for the whole routine.
"""
import argparse
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

AUDIO = {'.mp3', '.m4a', '.wav', '.flac', '.ogg', '.opus', '.webm', '.aac'}
REPO = Path(__file__).resolve().parent.parent
SOUNDS = REPO / 'sounds'


def find_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which('ffmpeg')


def duration(ffmpeg, path):
    """Length in seconds, from ffmpeg's report (0 if it can't tell)."""
    r = subprocess.run([ffmpeg, '-hide_banner', '-i', str(path)], capture_output=True, text=True, errors='replace')
    m = re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)', r.stderr)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0


def default_backup():
    desktop = Path.home() / 'Desktop'
    return (desktop if desktop.is_dir() else Path.home()) / 'DM screen originals'


def free_name(path):
    """path, or "name (2).ext" and so on if something different is already there."""
    n = 2
    candidate = path
    while candidate.exists():
        candidate = path.with_name(f'{path.stem} ({n}){path.suffix}')
        n += 1
    return candidate


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('inputs', nargs='*', help='sound files or folders (with --in-place, default: the repo\'s sounds/)')
    ap.add_argument('--in-place', action='store_true', help='shrink oversized sounds where they are, backing the originals up first')
    ap.add_argument('--out', default='shrunk', help='where the small copies go, without --in-place (default: ./shrunk)')
    ap.add_argument('--backup', default=None, help='where --in-place keeps the originals (default: "DM screen originals" on the Desktop)')
    ap.add_argument('--limit', type=float, default=25, help='--in-place shrinks files bigger than this many MB (default 25)')
    ap.add_argument('--minutes', type=float, default=20, help='length of each copy (default 20; 25 is the most that fits at 128k)')
    ap.add_argument('--start', type=float, default=30, help='seconds to skip at the start of a long sound (default 30)')
    ap.add_argument('--rate', default='128k', help='MP3 bit rate (default 128k)')
    args = ap.parse_args()

    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        sys.exit('No ffmpeg: pip install imageio-ffmpeg')

    files = []                                    # (source, relative path for naming)
    roots = [Path(p) for p in args.inputs] or ([SOUNDS] if args.in_place else [])
    if not roots:
        sys.exit('Name the files or folders to shrink, or use --in-place for the repo\'s sounds/.')
    for root in roots:
        if root.is_dir():
            base = root if args.in_place else root.parent
            files += [(f, f.relative_to(base)) for f in sorted(root.rglob('*')) if f.is_file() and f.suffix.lower() in AUDIO]
        elif root.is_file():
            files.append((root, Path(root.name)))
        else:
            print(f'not found: {root}', file=sys.stderr)

    backup = Path(args.backup) if args.backup else default_backup()
    if args.in_place:
        files = [(f, rel) for f, rel in files if f.stat().st_size > args.limit * 2 ** 20]
        if not files:
            print(f'Nothing to do: every sound is {args.limit:g} MB or less.')
            return
        print(f'{len(files)} sound(s) over {args.limit:g} MB. Originals go to {backup}')

    def shrink(job):
        src, rel = job
        length = duration(ffmpeg, src)
        cut = length == 0 or length > args.start + args.minutes * 60     # short sounds are kept whole
        timing = ['-ss', str(args.start), '-t', str(args.minutes * 60)] if cut else []
        if args.in_place:
            keep = free_name(backup / (src.relative_to(SOUNDS) if src.is_relative_to(SOUNDS) else rel))
            keep.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, keep)
            dst = src.with_suffix('.mp3')
            tmp = src.with_name(src.stem + '.shrinking.mp3')
        else:
            dst = Path(args.out) / rel.with_suffix('.mp3')
            dst.parent.mkdir(parents=True, exist_ok=True)
            tmp = dst
        r = subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', *timing,
                            '-i', str(src), '-map', '0:a:0', '-vn', '-map_metadata', '-1',
                            '-c:a', 'libmp3lame', '-b:a', args.rate, '-ar', '44100', '-ac', '2', str(tmp)],
                           capture_output=True, text=True, errors='replace')
        if r.returncode:
            tmp.unlink(missing_ok=True)
            return f'FAILED {src.name}: {r.stderr.strip()[:200]}'
        if args.in_place:
            if src != dst:
                src.unlink()                       # a .wav or .m4a becomes an .mp3 of the same name
            tmp.replace(dst)
        mb = dst.stat().st_size / 2 ** 20
        what = f'cut to {args.minutes:g} min' if cut else 'kept whole'
        return f'{mb:5.1f} MB  {dst}  ({what})' + ('   STILL OVER: use fewer --minutes' if mb > args.limit else '')

    with ThreadPoolExecutor(4) as pool:
        for line in pool.map(shrink, files):
            print(line, flush=True)
    if args.in_place:
        total = sum(f.stat().st_size for f in SOUNDS.rglob('*') if f.is_file())
        print(f'sounds/ is {total / 2 ** 20:.0f} MB in all (keep it under about 900 MB: GitHub Pages stops at 1 GB).')


if __name__ == '__main__':
    main()
