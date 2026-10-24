"""Build the DM Screen website (GitHub Pages) from this repo.

    python tools/build_site.py [--out _site] [--cache .site-cache]

Copies app/ into the output and marks its pages as the website version. Every audio file in sounds/
becomes media/<content id>.<ext> plus a waveform in peaks/, and library.json lists them with the
folders. A file's content id is its git blob id, so renaming or moving it never changes its address,
and waveforms are cached by it: a rebuild only reads sounds it hasn't seen. Needs ffmpeg
(pip install imageio-ffmpeg, or ffmpeg on the PATH).
"""
import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO_EXTS = {'.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.webm'}
PEAK_SR = 4000                      # decode rate for the overview; plenty for drawing
GITHUB_FILE_LIMIT = 100 * 1024 ** 2
PAGES_SITE_LIMIT = 1024 ** 3
MARK_AFTER = '<meta name="robots" content="noindex, nofollow">'


def blob_sha(path: Path) -> str:
    h = hashlib.sha1(f'blob {path.stat().st_size}\0'.encode())
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def git_shas(sounds: Path) -> dict:
    """The blob ids git has for the files under sounds/ (the site commits renames by these ids)."""
    try:
        out = subprocess.run(['git', 'ls-files', '-s', '-z', '--', '.'], cwd=sounds, capture_output=True, check=True).stdout
    except Exception:
        return {}
    shas = {}
    for rec in out.split(b'\0'):
        if b'\t' in rec:
            meta, path = rec.split(b'\t', 1)
            shas[path.decode('utf-8')] = meta.split()[1].decode()
    return shas


def find_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which('ffmpeg')


def compute_peaks(ffmpeg: str, src: Path, size: int) -> dict:
    """Peak per bucket of a mono 4 kHz decode, square-root scaled to 0..255 (the PC server's format)."""
    proc = subprocess.Popen([ffmpeg, '-v', 'error', '-i', str(src), '-vn', '-ac', '1', '-ar', str(PEAK_SR),
                             '-f', 's16le', '-acodec', 'pcm_s16le', '-'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    raw = proc.stdout.read()
    err = proc.stderr.read().decode('utf-8', 'replace')
    proc.wait()
    samples = array('h')
    samples.frombytes(raw[: len(raw) // 2 * 2])
    if sys.byteorder == 'big':
        samples.byteswap()
    if not samples:
        raise RuntimeError(err.strip() or 'no audio decoded')
    duration = len(samples) / PEAK_SR
    per_sec = 50 if duration <= 3600 else max(5, int(180000 / duration))
    bucket = max(1, PEAK_SR // per_sec)
    out = bytearray()
    for i in range(0, len(samples), bucket):
        chunk = samples[i:i + bucket]
        v = max(max(chunk), -min(chunk))
        out.append(min(255, int(((v / 32768) ** 0.5) * 255 + 0.5)))
    return {'version': 1, 'rate': PEAK_SR / bucket, 'count': len(out), 'duration': round(duration, 3),
            'data': base64.b64encode(bytes(out)).decode('ascii')}


def mark_pages(out: Path, marks: dict):
    tags = ''.join(f'\n  <meta name="{k}" content="{v}">' for k, v in marks.items())
    for page in ('index.html', 'login.html'):
        p = out / page
        text = p.read_text('utf-8')
        if MARK_AFTER not in text:
            raise SystemExit(f'{page}: no robots meta to put the site marks after')
        p.write_text(text.replace(MARK_AFTER, MARK_AFTER + tags, 1), 'utf-8')


# Relative module imports: `from './x.js'`, `import './x.js'`, `import('./x.js')`.
IMPORT_RE = re.compile(r"""(\b(?:from|import)\s*\(?\s*)(['"])(\.{1,2}/[^'"?#]+?\.js)\2""")
PAGE_RE = re.compile(r'((?:src|href)=")((?:js|css)/[^"?#]+\.(?:js|css))"')


def stamp_version(out: Path):
    """Put this build's version on every module and stylesheet URL (?v=...). GitHub Pages lets browsers
    keep files for ten minutes, so right after a publish a browser could otherwise run a mix of old and
    new modules (the screen broke that way once). The version is a hash of the app's files."""
    h = hashlib.sha1()
    files = sorted(p for p in out.rglob('*') if p.is_file() and p.suffix in ('.js', '.css', '.html'))
    for p in files:
        h.update(p.relative_to(out).as_posix().encode())
        h.update(p.read_bytes())
    q = f'?v={h.hexdigest()[:10]}'
    sw = out / 'sw.js'
    if sw.exists():                           # the worker keeps its address; a new BUILD makes browsers install it
        sw.write_text(sw.read_text('utf-8').replace("const BUILD = 'dev';", f"const BUILD = '{q[3:]}';"), 'utf-8')
    for p in files:
        if p.name == 'sw.js':
            continue
        text = p.read_text('utf-8')
        if p.suffix == '.js':
            new = IMPORT_RE.sub(lambda m: f'{m.group(1)}{m.group(2)}{m.group(3)}{q}{m.group(2)}', text)
        elif p.suffix == '.html':
            new = PAGE_RE.sub(lambda m: f'{m.group(1)}{m.group(2)}{q}"', text)
        else:
            continue
        if new != text:
            p.write_text(new, 'utf-8')
    return q[3:]


def commit_id():
    if os.environ.get('GITHUB_SHA'):
        return os.environ['GITHUB_SHA']
    try:
        return subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--out', default=str(ROOT / '_site'))
    ap.add_argument('--cache', default=str(ROOT / '.site-cache'))
    ap.add_argument('--sounds', default=str(ROOT / 'sounds'), help='the folder of sounds (tests point this elsewhere)')
    ap.add_argument('--repo', default=os.environ.get('GITHUB_REPOSITORY', 'blobberus/DMscreen'))
    ap.add_argument('--branch', default=os.environ.get('GITHUB_REF_NAME', 'main'))
    for name in ('api', 'raw', 'web'):
        ap.add_argument(f'--github-{name}', help=f'a stand-in for GitHub ({name}) when testing')
    args = ap.parse_args()

    out, cache, sounds = Path(args.out), Path(args.cache), Path(args.sounds)
    if out.exists():
        shutil.rmtree(out, ignore_errors=True)     # a file still open elsewhere (Windows) just gets overwritten
    shutil.copytree(ROOT / 'app', out, dirs_exist_ok=True)
    marks = {'dm-mode': 'site', 'dm-repo': args.repo, 'dm-branch': args.branch}
    for name in ('api', 'raw', 'web'):
        if getattr(args, f'github_{name}'):
            marks[f'dm-github-{name}'] = getattr(args, f'github_{name}')
    mark_pages(out, marks)
    stamp_version(out)
    (out / '.nojekyll').write_text('', 'utf-8')

    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        print('warning: no ffmpeg, so no waveforms or lengths (pip install imageio-ffmpeg)', file=sys.stderr)
    (out / 'media').mkdir(exist_ok=True)
    (out / 'peaks').mkdir(exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    known = git_shas(sounds)
    folders, files, total, fresh = [], [], 0, 0
    for dirpath, dirnames, filenames in os.walk(sounds):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith('.'))
        d = Path(dirpath)
        if d != sounds:
            folders.append(d.relative_to(sounds).as_posix())
        for fn in sorted(filenames):
            src = d / fn
            ext = src.suffix.lower()
            if fn.startswith('.') or ext not in AUDIO_EXTS:
                continue
            rel = src.relative_to(sounds).as_posix()
            size = src.stat().st_size
            if size > GITHUB_FILE_LIMIT:
                print(f'warning: {rel} is over GitHub\'s 100 MB limit for one file', file=sys.stderr)
            sha = known.get(rel) or blob_sha(src)
            cached = cache / f'{sha}.json'
            peaks = None
            if cached.exists():
                peaks = json.loads(cached.read_text('utf-8'))
            elif ffmpeg:
                try:
                    peaks = compute_peaks(ffmpeg, src, size)
                    cached.write_text(json.dumps(peaks), 'utf-8')
                    fresh += 1
                except Exception as exc:
                    print(f'warning: {rel}: could not read the audio ({exc})', file=sys.stderr)
            media = f'media/{sha}{ext}'
            if not (out / media).exists():
                shutil.copyfile(src, out / media)
                total += size
            entry = {'path': rel, 'sha': sha, 'size': size, 'duration': peaks['duration'] if peaks else 0, 'media': media}
            if peaks:
                (out / 'peaks' / f'{sha}.json').write_text(json.dumps(peaks), 'utf-8')
                entry['peaks'] = f'peaks/{sha}.json'
            files.append(entry)

    library = {'version': 1, 'commit': commit_id(), 'built': int(time.time()), 'folders': sorted(folders), 'files': files}
    (out / 'library.json').write_text(json.dumps(library, indent=1), 'utf-8')
    if total > PAGES_SITE_LIMIT * 0.9:
        print(f'warning: {total / 1024 ** 2:.0f} MB of sounds; GitHub Pages sites stop at 1 GB', file=sys.stderr)
    print(f'{len(files)} sounds ({total / 1024 ** 2:.1f} MB, {fresh} newly read) in {len(folders)} folders -> {out}')


if __name__ == '__main__':
    main()
