"""Make long sounds small enough for the website.

GitHub's upload page takes files up to 25 MB, and a GitHub Pages site stops at 1 GB, so a one-hour
ambience download (about 80 MB at 192 kb/s) won't go in as it is. This cuts each file to a stretch
(20 minutes from 30 s in, skipping a fade-in or intro) and re-encodes it as 128 kb/s stereo MP3: about
18 MB a file. Ambience loops on the screen, so 20 minutes is plenty. The originals are only read.

    .venv\\Scripts\\python tools\\shrink_sounds.py "C:\\Users\\me\\Desktop\\Tavern" --out "C:\\Users\\me\\Desktop\\small"
    python tools/shrink_sounds.py one.mp3 another.mp3 --minutes 25

A folder given in the list keeps its name under --out; its sound files (mp3 m4a wav flac ogg opus webm)
are all done. It's for long recordings: leave short effects as they are (--start would cut them away).
Needs ffmpeg (pip install imageio-ffmpeg, or ffmpeg on the PATH).
"""
import argparse
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

AUDIO = {'.mp3', '.m4a', '.wav', '.flac', '.ogg', '.opus', '.webm', '.aac'}


def find_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which('ffmpeg')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('inputs', nargs='+', help='sound files or folders of them')
    ap.add_argument('--out', default='shrunk', help='where the small copies go (default: ./shrunk)')
    ap.add_argument('--minutes', type=float, default=20, help='length of each copy (default 20; 25 is the most that fits at 128k)')
    ap.add_argument('--start', type=float, default=30, help='seconds to skip at the start (default 30)')
    ap.add_argument('--rate', default='128k', help='MP3 bit rate (default 128k)')
    args = ap.parse_args()

    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        sys.exit('No ffmpeg: pip install imageio-ffmpeg')
    out = Path(args.out)
    jobs = []
    for arg in args.inputs:
        p = Path(arg)
        if p.is_dir():
            jobs += [(f, out / p.name / f'{f.stem}.mp3') for f in sorted(p.iterdir()) if f.suffix.lower() in AUDIO]
        elif p.is_file():
            jobs.append((p, out / f'{p.stem}.mp3'))
        else:
            print(f'not found: {p}', file=sys.stderr)

    def shrink(job):
        src, dst = job
        dst.parent.mkdir(parents=True, exist_ok=True)
        r = subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(args.start), '-t', str(args.minutes * 60),
                            '-i', str(src), '-map', '0:a:0', '-vn', '-map_metadata', '-1',
                            '-c:a', 'libmp3lame', '-b:a', args.rate, '-ar', '44100', '-ac', '2', str(dst)],
                           capture_output=True, text=True)
        if r.returncode:
            return f'FAILED {src.name}: {r.stderr.strip()[:200]}'
        mb = dst.stat().st_size / 2 ** 20
        return f'{mb:5.1f} MB  {dst}' + ('   (over 25 MB: use fewer --minutes)' if mb > 25 else '')

    with ThreadPoolExecutor(4) as pool:
        for line in pool.map(shrink, jobs):
            print(line, flush=True)
    total = sum(dst.stat().st_size for _, dst in jobs if dst.exists())
    print(f'{len(jobs)} files, {total / 2 ** 20:.0f} MB in all, in {out}')


if __name__ == '__main__':
    main()
