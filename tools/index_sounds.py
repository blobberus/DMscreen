"""Index the sounds in a checkout of the private sounds repo (blobberus/DMscreen-sounds).

    python tools/index_sounds.py --dir <checkout> [--cache <folder of <sha>.json waveforms>]

The website reads that repo through the GitHub API, so the repo carries its own list: library.json
names every audio file under sounds/ (path, git blob id, size, length) with the folders, and
peaks/<blob id>.json holds each one's waveform (build_site.py's format). A rename or move keeps the
blob id, so its waveform is reused; only sounds not seen before are read with ffmpeg, and waveforms no
file uses any more are deleted. --cache is only read from (waveforms from an earlier build). library.json
is left alone when nothing in it but the time changed, so the repo's "Index the sounds" workflow makes no
empty commits. Needs ffmpeg for new sounds (pip install imageio-ffmpeg, or ffmpeg on the PATH).
"""
import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True      # no __pycache__ beside build_site.py (or in the workflow's checkout)
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_site import AUDIO_EXTS, GITHUB_FILE_LIMIT, blob_sha, compute_peaks, find_ffmpeg, git_shas  # noqa: E402


def read_peaks(path: Path):
    """A waveform file, or None if it's missing or unreadable."""
    try:
        peaks = json.loads(path.read_text('utf-8'))
        return peaks if isinstance(peaks, dict) and 'duration' in peaks else None
    except (OSError, ValueError):
        return None


def same_apart_from_built(path: Path, library: dict) -> bool:
    try:
        old = json.loads(path.read_text('utf-8'))
    except (OSError, ValueError):
        return False
    strip = lambda d: {k: v for k, v in d.items() if k != 'built'} if isinstance(d, dict) else d
    return strip(old) == strip(library)


def main():
    for stream in (sys.stdout, sys.stderr):     # a Windows console that can't show a file name gets a ?
        stream.reconfigure(errors='replace')
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--dir', required=True, help='the checkout of the sounds repo (has sounds/)')
    ap.add_argument('--cache', help='a folder of <sha>.json waveforms to reuse (only read)')
    args = ap.parse_args()

    root = Path(args.dir).resolve()
    sounds, peaks_dir = root / 'sounds', root / 'peaks'
    cache = Path(args.cache) if args.cache else None
    if not sounds.is_dir():
        raise SystemExit(f'{sounds}: no such folder')
    peaks_dir.mkdir(exist_ok=True)

    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        print('warning: no ffmpeg, so new sounds get no waveform or length (pip install imageio-ffmpeg)', file=sys.stderr)

    known = git_shas(sounds)
    folders, files, used, total, fresh = [], [], set(), 0, 0
    for dirpath, dirnames, filenames in os.walk(sounds):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith('.'))
        d = Path(dirpath)
        if d != sounds:
            folders.append(d.relative_to(sounds).as_posix())
        for fn in sorted(filenames):
            src = d / fn
            if fn.startswith('.') or src.suffix.lower() not in AUDIO_EXTS:
                continue
            rel = src.relative_to(sounds).as_posix()
            size = src.stat().st_size
            total += size
            if size > GITHUB_FILE_LIMIT:
                print(f'warning: {rel} is over GitHub\'s 100 MB limit for one file', file=sys.stderr)
            sha = known.get(rel) or blob_sha(src)
            used.add(sha)
            dest = peaks_dir / f'{sha}.json'
            peaks = read_peaks(dest)
            if peaks is None and cache and (cache / f'{sha}.json').exists():
                peaks = read_peaks(cache / f'{sha}.json')
                if peaks is not None:
                    shutil.copyfile(cache / f'{sha}.json', dest)
            if peaks is None and ffmpeg:
                try:
                    peaks = compute_peaks(ffmpeg, src, size)
                    dest.write_text(json.dumps(peaks), 'utf-8')
                    fresh += 1
                except Exception as exc:
                    print(f'warning: {rel}: could not read the audio ({exc})', file=sys.stderr)
            entry = {'path': rel, 'sha': sha, 'size': size, 'duration': peaks['duration'] if peaks else 0}
            if peaks:
                entry['peaks'] = f'peaks/{sha}.json'
            files.append(entry)

    removed = 0
    for p in sorted(peaks_dir.glob('*.json')):      # waveforms of sounds that were deleted or replaced
        if p.stem not in used:
            p.unlink()
            removed += 1

    out = root / 'library.json'
    library = {'version': 1, 'built': int(time.time()), 'folders': sorted(folders), 'files': files}
    note = ''
    if same_apart_from_built(out, library):
        note = ' (unchanged)'
    else:     # bytes, so Windows writes \n line ends like Linux does
        out.write_bytes((json.dumps(library, indent=1, ensure_ascii=False) + '\n').encode('utf-8'))
    print(f'{len(files)} sounds ({total / 1024 ** 2:.1f} MB, {fresh} newly read, {removed} waveforms removed) '
          f'in {len(folders)} folders -> {out}{note}')


if __name__ == '__main__':
    main()
