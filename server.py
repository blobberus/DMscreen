"""DM Screen: the local server.

Serves the app in ./app behind one password, keeps the sound library in ./data,
reads and writes Obsidian-style notes in the vault folder, and runs yt-dlp and
ffmpeg for downloads, waveforms, clips and exports.

    python server.py            # http://localhost:7070
    python server.py --open     # ...and open the browser
    python server.py --lan      # also reachable from other devices on this network

Environment: DMSCREEN_PASSWORD (default "Pleiades"), DMSCREEN_PORT (7070),
DMSCREEN_DATA (./data).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import mimetypes
import os
import queue
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from array import array
from datetime import timedelta
from pathlib import Path

from flask import Flask, Response, abort, jsonify, redirect, request, send_file, send_from_directory, session

ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / 'app'
DATA = Path(os.environ.get('DMSCREEN_DATA') or ROOT / 'data').resolve()
AUDIO = DATA / 'audio'
PEAKS = DATA / 'peaks'
STATE = DATA / 'state'
TMP = DATA / 'tmp'
for _d in (AUDIO, PEAKS, STATE, TMP):
    _d.mkdir(parents=True, exist_ok=True)

PASSWORD = os.environ.get('DMSCREEN_PASSWORD', 'Pleiades')
PORT = int(os.environ.get('DMSCREEN_PORT', '7070'))

AUDIO_EXTS = {'mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'webm', 'mp4'}
MIME = {
    'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg', 'oga': 'audio/ogg', 'opus': 'audio/ogg',
    'm4a': 'audio/mp4', 'mp4': 'audio/mp4', 'aac': 'audio/aac', 'flac': 'audio/flac', 'webm': 'audio/webm',
}
STATE_DOCS = {'settings', 'layouts', 'playlists', 'boards', 'bookmarks', 'keymap', 'merchants'}
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/130.0 Safari/537.36')
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

for ext, mime in MIME.items():
    mimetypes.add_type(mime, '.' + ext)
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('font/woff2', '.woff2')
mimetypes.add_type('image/svg+xml', '.svg')


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

_lock = threading.RLock()


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text('utf-8'))
    except FileNotFoundError:
        return default
    except (json.JSONDecodeError, UnicodeDecodeError):
        broken = path.with_suffix(path.suffix + f'.broken-{int(time.time())}')
        try:
            shutil.copy2(path, broken)
        except OSError:
            pass
        return default


def write_text_atomic(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f'.{secrets.token_hex(4)}.tmp')
    tmp.write_text(text, 'utf-8', newline='')
    for attempt in range(6):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            # Windows: another program (antivirus, Obsidian) briefly holds the file
            time.sleep(0.05 * (attempt + 1))
    os.replace(tmp, path)


def write_json(path: Path, data):
    write_text_atomic(path, json.dumps(data, indent=2, ensure_ascii=False))


def new_id(prefix='s') -> str:
    return f'{prefix}_{secrets.token_hex(5)}'


def clean_name(name: str, fallback='Untitled') -> str:
    name = re.sub(r'\s+', ' ', str(name or '')).strip()
    return name[:160] or fallback


def safe_filename(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name).strip(' .')
    return name[:120] or 'sound'


def find_ffmpeg():
    exe = shutil.which('ffmpeg')
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def find_deno():
    scripts = Path(sys.executable).parent
    for name in ('deno.exe', 'deno'):
        if (scripts / name).exists():
            return str(scripts / name)
    return shutil.which('deno')


FFMPEG = find_ffmpeg()
DENO = find_deno()


def ytdlp_version():
    try:
        out = subprocess.run([sys.executable, '-m', 'yt_dlp', '--version'], capture_output=True, text=True,
                             timeout=30, creationflags=NO_WINDOW)
        return out.stdout.strip() or None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Server config (things only the server can act on)
# ---------------------------------------------------------------------------

CONFIG_PATH = DATA / 'config.json'
DEFAULT_CONFIG = {'vaultPath': str(ROOT / 'vault'), 'ytCookies': 'none'}
COOKIE_FILE = DATA / 'cookies.txt'
COOKIE_SOURCES = {'none', 'firefox', 'edge', 'chrome', 'brave', 'file'}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    cfg.update({k: v for k, v in read_json(CONFIG_PATH, {}).items() if v not in (None, '')})
    return cfg


def save_config(cfg):
    write_json(CONFIG_PATH, cfg)


# ---------------------------------------------------------------------------
# App and the password gate
# ---------------------------------------------------------------------------

app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 4 * 1024 ** 3


def _secret_key() -> bytes:
    path = DATA / 'secret.key'
    if path.exists():
        return path.read_bytes()
    key = secrets.token_bytes(32)
    path.write_bytes(key)
    return key


app.secret_key = _secret_key()
AUTH_TOKEN = hmac.new(app.secret_key, PASSWORD.encode('utf-8'), hashlib.sha256).hexdigest()
app.config.update(
    SESSION_COOKIE_NAME='dmscreen',
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)

PUBLIC_PATHS = {'/login', '/api/login', '/favicon.svg', '/css/tokens.css', '/css/login.css', '/js/login.js',
                '/js/core/mode.js', '/js/core/gate.js', '/manifest.webmanifest'}
PUBLIC_PREFIXES = ('/fonts/', '/img/')
_fails: dict[str, list[float]] = {}


@app.before_request
def gate():
    path = request.path
    if path in PUBLIC_PATHS or path.startswith(PUBLIC_PREFIXES):
        return None
    if session.get('auth') == AUTH_TOKEN:
        return None
    if path.startswith(('/api/', '/media/')):
        return jsonify(error='locked'), 401
    nxt = request.full_path if request.query_string else path
    return redirect('/login' + ('?next=' + urllib.parse.quote(nxt) if path != '/' else ''))


@app.after_request
def headers(resp):
    resp.headers.setdefault('Content-Security-Policy', "frame-ancestors 'none'")
    resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
    resp.headers.setdefault('Referrer-Policy', 'same-origin')
    return resp


@app.get('/login')
def login_page():
    if session.get('auth') == AUTH_TOKEN:
        return redirect('/')
    return send_from_directory(APP_DIR, 'login.html', max_age=0)


@app.post('/api/login')
def login():
    ip = request.remote_addr or '?'
    now = time.time()
    recent = [t for t in _fails.get(ip, []) if now - t < 60]
    if len(recent) >= 6:
        wait = int(60 - (now - recent[0])) + 1
        return jsonify(ok=False, error=f'Too many tries. Wait {wait} seconds.'), 429
    body = request.get_json(silent=True) or request.form
    given = str(body.get('password', ''))
    if hmac.compare_digest(given.encode('utf-8'), PASSWORD.encode('utf-8')):
        _fails.pop(ip, None)
        session.clear()
        session['auth'] = AUTH_TOKEN
        session.permanent = bool(body.get('remember'))
        return jsonify(ok=True)
    recent.append(now)
    _fails[ip] = recent
    return jsonify(ok=False, error="That isn't the password."), 401


@app.post('/api/logout')
def logout():
    session.clear()
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# State documents (layout, playlists, boards, settings, ...)
# ---------------------------------------------------------------------------

@app.get('/api/state')
def state_all():
    return jsonify({name: read_json(STATE / f'{name}.json', None) for name in STATE_DOCS})


@app.route('/api/state/<name>', methods=['PUT', 'POST'])
def state_put(name):
    if name not in STATE_DOCS:
        abort(404)
    data = request.get_json(force=True, silent=True)
    if data is None:
        return jsonify(error='Expected JSON.'), 400
    with _lock:
        write_json(STATE / f'{name}.json', data)
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# Sound library
# ---------------------------------------------------------------------------

LIB_PATH = DATA / 'library.json'
EDITABLE = {
    'name': str, 'kind': str, 'trimStart': (int, float), 'trimEnd': (int, float, type(None)), 'flags': list,
    'repeat': int, 'volume': (int, float), 'fadeIn': (int, float), 'fadeOut': (int, float),
    'loopFade': (int, float), 'tags': list,
}
KINDS = {'music', 'ambience', 'effect'}


def lib_load():
    return read_json(LIB_PATH, {'sounds': []})


def lib_save(lib):
    write_json(LIB_PATH, lib)


def lib_find(lib, sid):
    for s in lib['sounds']:
        if s['id'] == sid:
            return s
    return None


def sound_or_404(sid):
    with _lock:
        s = lib_find(lib_load(), sid)
    if not s:
        abort(404)
    return s


def probe_duration(path: Path):
    if not FFMPEG:
        return None
    try:
        out = subprocess.run([FFMPEG, '-hide_banner', '-i', str(path)], capture_output=True, text=True,
                             errors='replace', timeout=60, creationflags=NO_WINDOW)
    except Exception:
        return None
    m = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', out.stderr)
    if not m:
        return None
    h, mi, se = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(se)


def guess_kind(duration):
    if duration is None:
        return 'music'
    if duration < 30:
        return 'effect'
    if duration > 15 * 60:
        return 'ambience'
    return 'music'


def add_sound(path: Path, title: str, kind=None, source=None, parent=None, flags=None):
    duration = probe_duration(path)
    kind = kind if kind in KINDS else guess_kind(duration)
    s = {
        'id': path.stem,
        'name': clean_name(title, 'Untitled sound'),
        'kind': kind,
        'file': path.name,
        'size': path.stat().st_size,
        'duration': round(duration, 3) if duration else 0,
        'source': source,
        'parent': parent,
        'trimStart': 0,
        'trimEnd': None,
        'flags': flags or [],
        'repeat': 0 if kind == 'ambience' else 1,
        'volume': 1.0,
        'fadeIn': 0,
        'fadeOut': 0,
        'loopFade': 1.5 if kind == 'ambience' else 0,
        'tags': [],
        'added': int(time.time()),
        'status': 'analyzing' if FFMPEG else 'ready',
    }
    with _lock:
        lib = lib_load()
        lib['sounds'].insert(0, s)
        lib_save(lib)
    if FFMPEG:
        analysis.put(s['id'])
    return s


# --- waveform peaks ---------------------------------------------------------

PEAK_SR = 4000  # decode rate for the overview; plenty for drawing


def compute_peaks(src: Path, dest: Path, duration_hint):
    duration_hint = duration_hint or 0
    per_sec = 50 if duration_hint <= 3600 else max(5, int(180000 / duration_hint))
    bucket = max(1, PEAK_SR // per_sec)
    cmd = [FFMPEG, '-v', 'error', '-i', str(src), '-vn', '-ac', '1', '-ar', str(PEAK_SR),
           '-f', 's16le', '-acodec', 'pcm_s16le', '-']
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=NO_WINDOW)
    out = bytearray()
    total = 0
    block = bucket * 2 * 2048
    carry = b''
    while True:
        buf = proc.stdout.read(block)
        if not buf:
            break
        buf = carry + buf
        usable = len(buf) - (len(buf) % (bucket * 2))
        carry = buf[usable:]
        samples = array('h')
        samples.frombytes(buf[:usable])
        if sys.byteorder == 'big':
            samples.byteswap()
        total += len(samples)
        for i in range(0, len(samples), bucket):
            chunk = samples[i:i + bucket]
            v = max(max(chunk), -min(chunk))
            out.append(min(255, int(((v / 32768) ** 0.5) * 255 + 0.5)))
    if carry:
        samples = array('h')
        samples.frombytes(carry[: len(carry) // 2 * 2])
        if samples:
            total += len(samples)
            v = max(max(samples), -min(samples))
            out.append(min(255, int(((v / 32768) ** 0.5) * 255 + 0.5)))
    proc.wait()
    duration = total / PEAK_SR
    write_json(dest, {'version': 1, 'rate': PEAK_SR / bucket, 'count': len(out), 'duration': duration,
                      'data': base64.b64encode(bytes(out)).decode('ascii')})
    return duration


analysis: queue.Queue = queue.Queue()


def analysis_worker():
    while True:
        sid = analysis.get()
        try:
            with _lock:
                s = lib_find(lib_load(), sid)
            if not s:
                continue
            src = AUDIO / s['file']
            duration = compute_peaks(src, PEAKS / f'{sid}.json', s.get('duration'))
            with _lock:
                lib = lib_load()
                s = lib_find(lib, sid)
                if s:
                    if duration and (not s.get('duration') or abs(s['duration'] - duration) > 0.25):
                        s['duration'] = round(duration, 3)
                    s['status'] = 'ready'
                    lib_save(lib)
        except Exception as exc:  # keep the worker alive
            print(f'[peaks] {sid}: {exc}', file=sys.stderr)
            with _lock:
                lib = lib_load()
                s = lib_find(lib, sid)
                if s:
                    s['status'] = 'ready'
                    lib_save(lib)
        finally:
            analysis.task_done()


def queue_missing_peaks():
    with _lock:
        lib = lib_load()
    for s in lib['sounds']:
        if FFMPEG and (s.get('status') == 'analyzing' or not (PEAKS / f"{s['id']}.json").exists()):
            analysis.put(s['id'])


@app.get('/api/library')
def library_list():
    with _lock:
        return jsonify(lib_load())


@app.post('/api/library/upload')
def library_upload():
    files = request.files.getlist('files')
    kind = request.form.get('kind') or None
    created, errors = [], []
    for f in files:
        name = f.filename or 'sound'
        ext = Path(name).suffix.lower().lstrip('.')
        if ext not in AUDIO_EXTS:
            errors.append(f'{name}: not an audio file this screen can play')
            continue
        sid = new_id()
        dest = AUDIO / f'{sid}.{ext}'
        f.save(dest)
        created.append(add_sound(dest, Path(name).stem.replace('_', ' '), kind=kind))
    return jsonify(sounds=created, errors=errors)


@app.patch('/api/library/<sid>')
def library_patch(sid):
    patch = request.get_json(force=True, silent=True) or {}
    with _lock:
        lib = lib_load()
        s = lib_find(lib, sid)
        if not s:
            abort(404)
        for key, value in patch.items():
            if key not in EDITABLE or not isinstance(value, EDITABLE[key]) or isinstance(value, bool):
                continue
            if key == 'kind' and value not in KINDS:
                continue
            if key == 'name':
                value = clean_name(value, s['name'])
            if key == 'flags':
                value = [
                    {'id': str(f.get('id') or new_id('f')), 't': round(float(f.get('t', 0)), 3),
                     'label': clean_name(f.get('label', ''), 'Flag')[:60]}
                    for f in value if isinstance(f, dict)
                ]
                value.sort(key=lambda f: f['t'])
            if key == 'tags':
                value = [clean_name(t)[:40] for t in value if isinstance(t, str) and t.strip()]
            s[key] = value
        lib_save(lib)
        return jsonify(s)


@app.delete('/api/library/<sid>')
def library_delete(sid):
    with _lock:
        lib = lib_load()
        s = lib_find(lib, sid)
        if not s:
            abort(404)
        lib['sounds'] = [x for x in lib['sounds'] if x['id'] != sid]
        lib_save(lib)
    for p in (AUDIO / s['file'], PEAKS / f'{sid}.json'):
        try:
            p.unlink()
        except OSError:
            pass
    return jsonify(ok=True)


@app.get('/api/library/<sid>/peaks')
def library_peaks(sid):
    s = sound_or_404(sid)
    path = PEAKS / f'{sid}.json'
    if not path.exists():
        return jsonify(status=s.get('status', 'analyzing')), 202
    return send_file(path, mimetype='application/json', max_age=0)


def ffmpeg_render(src: Path, dest: Path, start: float, end: float, volume=1.0, fade_in=0.0, fade_out=0.0):
    if not FFMPEG:
        raise RuntimeError('ffmpeg is not available')
    length = max(0.05, end - start)
    filters = []
    if abs(volume - 1.0) > 0.001:
        filters.append(f'volume={volume:.3f}')
    if fade_in > 0:
        filters.append(f'afade=t=in:st=0:d={min(fade_in, length):.3f}')
    if fade_out > 0:
        filters.append(f'afade=t=out:st={max(0, length - fade_out):.3f}:d={min(fade_out, length):.3f}')
    codec = ['-c:a', 'libmp3lame', '-q:a', '2'] if dest.suffix == '.mp3' else ['-c:a', 'pcm_s16le']
    cmd = [FFMPEG, '-v', 'error', '-y', '-ss', f'{start:.3f}', '-i', str(src), '-t', f'{length:.3f}', '-vn']
    if filters:
        cmd += ['-af', ','.join(filters)]
    cmd += codec + [str(dest)]
    out = subprocess.run(cmd, capture_output=True, text=True, errors='replace', creationflags=NO_WINDOW)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip()[-300:] or 'ffmpeg failed')


@app.post('/api/library/<sid>/clip')
def library_clip(sid):
    s = sound_or_404(sid)
    body = request.get_json(force=True, silent=True) or {}
    try:
        start = max(0.0, float(body.get('start', 0)))
        end = float(body.get('end', s.get('duration') or 0))
    except (TypeError, ValueError):
        return jsonify(error='Start and end must be numbers.'), 400
    if end - start < 0.05:
        return jsonify(error='Select at least a twentieth of a second.'), 400
    new = new_id()
    dest = AUDIO / f'{new}.mp3'
    try:
        ffmpeg_render(AUDIO / s['file'], dest, start, end)
    except RuntimeError as exc:
        return jsonify(error=f'Could not cut the clip: {exc}'), 500
    flags = [dict(f, t=round(f['t'] - start, 3)) for f in s.get('flags', []) if start <= f['t'] < end]
    kind = body.get('kind') if body.get('kind') in KINDS else s['kind']
    clip = add_sound(dest, body.get('name') or f"{s['name']} (clip)", kind=kind, source=s.get('source'),
                     parent=sid, flags=flags)
    return jsonify(clip)


@app.get('/api/library/<sid>/export')
def library_export(sid):
    s = sound_or_404(sid)
    src = AUDIO / s['file']
    fmt = 'wav' if request.args.get('fmt') == 'wav' else 'mp3'
    duration = s.get('duration') or probe_duration(src) or 0
    start = float(request.args.get('start', s.get('trimStart') or 0))
    end_arg = request.args.get('end')
    end = float(end_arg) if end_arg not in (None, '', 'null') else (s.get('trimEnd') or duration)
    whole = start <= 0.001 and abs(end - duration) < 0.05
    plain = abs(s.get('volume', 1) - 1) < 0.001 and not s.get('fadeIn') and not s.get('fadeOut')
    name = safe_filename(s['name']) + '.' + fmt
    if whole and plain and src.suffix.lower() == '.' + fmt:
        return send_file(src, as_attachment=True, download_name=name)
    dest = TMP / f'export-{secrets.token_hex(6)}.{fmt}'
    try:
        ffmpeg_render(src, dest, start, end, s.get('volume', 1), s.get('fadeIn') or 0, s.get('fadeOut') or 0)
        data = dest.read_bytes()
    except RuntimeError as exc:
        return jsonify(error=f'Could not export: {exc}'), 500
    finally:
        try:
            dest.unlink()
        except OSError:
            pass
    return send_file(io.BytesIO(data), as_attachment=True, download_name=name, mimetype=MIME[fmt])


@app.get('/media/<sid>')
def media(sid):
    s = sound_or_404(sid)
    path = AUDIO / s['file']
    if not path.exists():
        abort(404)
    ext = path.suffix.lower().lstrip('.')
    return send_file(path, mimetype=MIME.get(ext, 'application/octet-stream'), conditional=True, max_age=3600)


# ---------------------------------------------------------------------------
# Downloads (yt-dlp) and YouTube search
# ---------------------------------------------------------------------------

JOBS: dict[str, dict] = {}
ANSI = re.compile(r'\x1b\[[0-9;]*m')


def ytdlp_cmd(with_cookies=True):
    cmd = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-playlist', '--newline']
    if DENO:
        cmd += ['--js-runtimes', f'deno:{DENO}']
    if FFMPEG:
        cmd += ['--ffmpeg-location', FFMPEG]
    if with_cookies:
        src = load_config().get('ytCookies', 'none')
        if src == 'file' and COOKIE_FILE.exists():
            cmd += ['--cookies', str(COOKIE_FILE)]
        elif src in COOKIE_SOURCES - {'none', 'file'}:
            cmd += ['--cookies-from-browser', src]
    return cmd


def child_env():
    env = dict(os.environ)
    env['PYTHONIOENCODING'] = 'utf-8'
    env['PYTHONUTF8'] = '1'
    return env


def classify_error(text: str):
    t = text.lower()
    if 'confirm you' in t and 'bot' in t:
        return 'bot-check', ("YouTube wants proof you're not a bot on this network. Pick a browser that is signed "
                             'in to YouTube in Settings, YouTube, then try again.')
    if 'could not copy' in t and 'cookie' in t or 'failed to decrypt' in t or 'could not find' in t and 'cookies' in t:
        return 'cookies', ("Couldn't read that browser's cookies. Close the browser and retry, or use Firefox or a "
                           'cookies.txt file in Settings, YouTube.')
    if 'unsupported url' in t:
        return 'unsupported', "That link isn't a page the downloader knows. Try the video's own page or a direct audio link."
    if 'private video' in t or 'video unavailable' in t or 'removed' in t:
        return 'unavailable', 'That video is private or no longer available.'
    if 'sign in to confirm your age' in t or 'age-restricted' in t:
        return 'age', 'That video is age-restricted. Add browser cookies in Settings, YouTube to download it.'
    return 'failed', text.strip()[-400:] or 'The download failed.'


def fmt_section(seconds):
    seconds = max(0.0, float(seconds))
    return f'{int(seconds // 60)}:{seconds % 60:06.3f}'


def run_job(job):
    tmpdir = TMP / job['id']
    tmpdir.mkdir(parents=True, exist_ok=True)
    cmd = ytdlp_cmd() + [
        '--no-simulate', '--progress', '--progress-template', 'download:@@progress %(progress._percent_str)s',
        '--print', 'before_dl:@@title %(title)s', '--print', 'after_move:@@file %(filepath)s',
        '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '2',
        '-o', str(tmpdir / '%(id).80s.%(ext)s'),
    ]
    if job.get('start') is not None or job.get('end') is not None:
        start = fmt_section(job.get('start') or 0)
        end = fmt_section(job['end']) if job.get('end') is not None else 'inf'
        cmd += ['--download-sections', f'*{start}-{end}', '--force-keyframes-at-cuts']
    cmd += ['--', job['url']]
    job['status'] = 'starting'
    filepath, lines = None, []
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8',
                                errors='replace', env=child_env(), creationflags=NO_WINDOW)
        job['_proc'] = proc
        for raw in proc.stdout:
            line = ANSI.sub('', raw).strip()
            if not line:
                continue
            if line.startswith('@@progress'):
                m = re.search(r'([\d.]+)%', line)
                if m:
                    job['progress'] = min(1.0, float(m.group(1)) / 100)
                    job['status'] = 'converting' if job['progress'] >= 0.999 else 'downloading'
            elif line.startswith('@@title'):
                title = line[len('@@title'):].strip()
                if title and title != 'NA':
                    job['title'] = title
                job['status'] = 'downloading'
            elif line.startswith('@@file'):
                filepath = line[len('@@file'):].strip()
            else:
                lines.append(line)
                del lines[:-40]
        rc = proc.wait()
        if job.get('cancelled'):
            job.update(status='cancelled')
            return
        if rc != 0 or not filepath or not Path(filepath).exists():
            errors = [l for l in lines if l.startswith('ERROR')] or lines[-3:]
            code, message = classify_error('\n'.join(errors))
            job.update(status='error', errorCode=code, error=message)
            return
        job['status'] = 'analyzing'
        sid = new_id()
        dest = AUDIO / f'{sid}.mp3'
        shutil.move(filepath, dest)
        title = job.get('name') or job.get('title') or 'Downloaded sound'
        s = add_sound(dest, title, kind=job.get('kind'), source=job['url'])
        job.update(status='done', progress=1.0, soundId=s['id'], title=s['name'])
    except Exception as exc:
        job.update(status='error', errorCode='failed', error=str(exc))
    finally:
        job.pop('_proc', None)
        job['finished'] = time.time()
        shutil.rmtree(tmpdir, ignore_errors=True)


def public_job(job):
    return {k: v for k, v in job.items() if not k.startswith('_')}


@app.post('/api/download')
def download():
    body = request.get_json(force=True, silent=True) or {}
    url = str(body.get('url', '')).strip()
    if not re.match(r'^https?://', url):
        return jsonify(error='Paste a full link that starts with http.'), 400

    def num(v):
        try:
            return None if v in (None, '') else max(0.0, float(v))
        except (TypeError, ValueError):
            return None

    job = {
        'id': new_id('job'), 'url': url, 'kind': body.get('kind') if body.get('kind') in KINDS else None,
        'name': clean_name(body.get('name') or '', '') or None, 'start': num(body.get('start')),
        'end': num(body.get('end')), 'title': body.get('name') or url, 'status': 'queued', 'progress': 0.0,
        'error': None, 'errorCode': None, 'soundId': None, 'created': time.time(),
    }
    JOBS[job['id']] = job
    threading.Thread(target=run_job, args=(job,), daemon=True).start()
    return jsonify(public_job(job))


@app.get('/api/jobs')
def jobs_list():
    now = time.time()
    for jid in [j for j, job in JOBS.items() if job.get('finished') and now - job['finished'] > 3600]:
        JOBS.pop(jid, None)
    return jsonify(jobs=[public_job(j) for j in sorted(JOBS.values(), key=lambda j: -j['created'])])


@app.delete('/api/jobs/<jid>')
def job_cancel(jid):
    job = JOBS.get(jid)
    if not job:
        abort(404)
    proc = job.get('_proc')
    if proc and proc.poll() is None:
        job['cancelled'] = True
        proc.terminate()
    elif job.get('finished'):
        JOBS.pop(jid, None)
    return jsonify(ok=True)


@app.get('/api/yt/search')
def yt_search():
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify(results=[])
    count = min(30, max(5, int(request.args.get('n', 18))))
    cmd = ytdlp_cmd(with_cookies=False) + ['--flat-playlist', '--dump-json', '--', f'ytsearch{count}:{q}']
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60,
                             env=child_env(), creationflags=NO_WINDOW)
    except subprocess.TimeoutExpired:
        return jsonify(error='YouTube took too long to answer. Try again.'), 504
    results = []
    for line in out.stdout.splitlines():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        vid = e.get('id')
        if not vid:
            continue
        results.append({
            'id': vid, 'title': e.get('title') or vid, 'channel': e.get('channel') or e.get('uploader') or '',
            'duration': e.get('duration'), 'views': e.get('view_count'),
            'url': f'https://www.youtube.com/watch?v={vid}', 'thumb': f'https://i.ytimg.com/vi/{vid}/mqdefault.jpg',
        })
    if not results and out.returncode != 0:
        code, message = classify_error(out.stderr)
        return jsonify(error=message, errorCode=code), 502
    return jsonify(results=results)


@app.get('/api/yt/oembed')
def yt_oembed():
    url = request.args.get('url', '')
    if not re.match(r'^https?://(www\.|m\.|music\.)?(youtube\.com|youtu\.be)/', url):
        return jsonify(error='Not a YouTube link.'), 400
    api = 'https://www.youtube.com/oembed?format=json&url=' + urllib.parse.quote(url, safe='')
    try:
        with urllib.request.urlopen(urllib.request.Request(api, headers={'User-Agent': UA}), timeout=8) as r:
            data = json.loads(r.read().decode('utf-8'))
        return jsonify(title=data.get('title'), channel=data.get('author_name'), thumb=data.get('thumbnail_url'))
    except Exception:
        return jsonify(error='Could not read that video.'), 502


# ---------------------------------------------------------------------------
# Can a site be shown in a pane? (X-Frame-Options / CSP frame-ancestors)
# ---------------------------------------------------------------------------

_frame_cache: dict[str, tuple[float, dict]] = {}


@app.get('/api/frame-check')
def frame_check():
    url = request.args.get('url', '').strip()
    if not re.match(r'^https?://', url):
        return jsonify(error='Not a web address.'), 400
    hit = _frame_cache.get(url)
    if hit and time.time() - hit[0] < 600:
        return jsonify(hit[1])
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8',
                                               'Accept-Language': 'en-US,en;q=0.9'})
    status, hdrs, final = None, None, url
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            status, hdrs, final = r.status, r.headers, r.geturl()
    except urllib.error.HTTPError as exc:
        status, hdrs = exc.code, exc.headers
    except Exception as exc:
        result = {'ok': True, 'blocked': False, 'status': None, 'reason': 'unknown', 'detail': str(exc)[:200]}
        return jsonify(result)
    xfo = (hdrs.get('X-Frame-Options') or '').lower() if hdrs else ''
    csp = ' '.join(hdrs.get_all('Content-Security-Policy') or []) if hdrs else ''
    blocked, reason = False, None
    if xfo and any(word in xfo for word in ('deny', 'sameorigin', 'allow-from')) or (xfo.startswith('http')):
        blocked, reason = True, 'header'
    m = re.search(r'frame-ancestors([^;]*)', csp, re.I)
    if m:
        sources = m.group(1).split()
        if '*' not in sources and not any('localhost' in s or '127.0.0.1' in s for s in sources):
            blocked, reason = True, 'header'
    if not blocked and status == 404:
        reason = 'missing'
    result = {'ok': not blocked and (status or 200) < 400, 'blocked': blocked, 'status': status, 'reason': reason,
              'finalUrl': final}
    _frame_cache[url] = (time.time(), result)
    return jsonify(result)


# ---------------------------------------------------------------------------
# Notes: an Obsidian-style vault of Markdown files
# ---------------------------------------------------------------------------

TEMPLATES = {
    'Templates/Session.md': (
        '---\nsession: {{session}}\ndate: {{date}}\ntags: [session]\n---\n'
        '# Session {{session}}\n\n## Recap\n- \n\n## Log\n**{{time}}** Start\n\n'
        '## People\n- \n\n## Loot\n- \n\n## Threads\n- [ ] \n\n## Next time\n- \n'
    ),
    'Templates/NPC.md': (
        '---\ntags: [npc]\n---\n# {{title}}\n\n**Role:** \n**Where:** \n**Wants:** \n**Voice:** \n\n'
        '## Met\n- {{date}}: \n'
    ),
    'Templates/Location.md': (
        '---\ntags: [location]\n---\n# {{title}}\n\n**Region:** \n**Feel:** \n\n## People here\n- \n\n## Notes\n- \n'
    ),
}
NOTE_EXTS = {'.md'}
_note_cache: dict[str, tuple[float, dict]] = {}
WIKILINK = re.compile(r'\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]')
TAG = re.compile(r'(?:^|\s)#([\w/-]*[A-Za-z_/-][\w/-]*)')
CODE = re.compile(r'```.*?```|`[^`\n]*`', re.S)


def vault_root() -> Path:
    root = Path(load_config()['vaultPath']).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    root = root.resolve()
    if not any(root.iterdir()):
        for rel, text in TEMPLATES.items():
            write_text_atomic(root / rel, text)
        for folder in ('Sessions', 'People', 'Places'):
            (root / folder).mkdir(exist_ok=True)
    return root


def vault_path(rel: str, must_be_note=True) -> Path:
    root = vault_root()
    rel = str(rel or '').replace('\\', '/').strip().strip('/')
    parts = rel.split('/')
    if not rel or any(p in ('', '.', '..') for p in parts) or ':' in rel:
        abort(400, 'Bad note path')
    p = (root / rel).resolve()
    if root != p and root not in p.parents:
        abort(400, 'Bad note path')
    if must_be_note and p.suffix.lower() not in NOTE_EXTS:
        abort(400, 'Notes must be .md files')
    return p


def rel_of(root: Path, p: Path) -> str:
    return p.relative_to(root).as_posix()


def walk_vault(root: Path):
    files, folders = [], []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
        d = Path(dirpath)
        if d != root:
            folders.append(rel_of(root, d))
        for fn in filenames:
            if fn.startswith('.') or Path(fn).suffix.lower() not in NOTE_EXTS:
                continue
            p = d / fn
            st = p.stat()
            files.append({'path': rel_of(root, p), 'mtime': st.st_mtime, 'size': st.st_size})
    return files, folders


def note_meta(root: Path, f: dict) -> dict:
    hit = _note_cache.get(f['path'])
    if hit and hit[0] == f['mtime']:
        return hit[1]
    try:
        text = (root / f['path']).read_text('utf-8', errors='replace')
    except OSError:
        text = ''
    fm_tags = []
    fm = re.match(r'^---\r?\n(.*?)\r?\n---', text, re.S)
    body = text[fm.end():] if fm else text
    if fm:
        m = re.search(r'^tags:\s*\[([^\]]*)\]', fm.group(1), re.M)
        if m:
            fm_tags = [t.strip().strip('\'"#') for t in m.group(1).split(',') if t.strip()]
        else:
            m = re.search(r'^tags:\s*\n((?:\s*-\s*.+\n?)+)', fm.group(1), re.M)
            if m:
                fm_tags = [t.strip().lstrip('-').strip().strip('\'"#') for t in m.group(1).splitlines() if t.strip()]
    plain = CODE.sub('', body)
    meta = {
        'links': sorted({m.group(1).strip() for m in WIKILINK.finditer(plain)}),
        'tags': sorted(set(fm_tags) | {m.group(1) for m in TAG.finditer(plain)}),
    }
    _note_cache[f['path']] = (f['mtime'], meta)
    return meta


@app.get('/api/notes/tree')
def notes_tree():
    root = vault_root()
    files, folders = walk_vault(root)
    for f in files:
        f.update(note_meta(root, f))
    return jsonify(root=str(root), name=root.name, files=files, folders=sorted(folders))


@app.get('/api/notes/file')
def notes_get():
    p = vault_path(request.args.get('path'))
    if not p.exists():
        return jsonify(error='No such note.'), 404
    return jsonify(path=rel_of(vault_root(), p), content=p.read_text('utf-8', errors='replace'),
                   mtime=p.stat().st_mtime)


@app.put('/api/notes/file')
def notes_put():
    body = request.get_json(force=True, silent=True) or {}
    p = vault_path(body.get('path'))
    content = str(body.get('content', ''))
    base = body.get('baseMtime')
    exists = p.exists()
    if body.get('create') and exists:
        return jsonify(error='A note with that name already exists.', exists=True), 409
    if exists and base is not None and not body.get('force'):
        current = p.stat().st_mtime
        if abs(current - float(base)) > 0.002:
            return jsonify(error='Changed in another app.', conflict=True, mtime=current,
                           content=p.read_text('utf-8', errors='replace')), 409
    write_text_atomic(p, content)
    return jsonify(path=rel_of(vault_root(), p), mtime=p.stat().st_mtime)


@app.post('/api/notes/rename')
def notes_rename():
    body = request.get_json(force=True, silent=True) or {}
    src = vault_path(body.get('from'))
    dest = vault_path(body.get('to'))
    if not src.exists():
        return jsonify(error='No such note.'), 404
    if dest.exists() and dest != src:
        return jsonify(error='A note with that name already exists.'), 409
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, dest)
    root = vault_root()
    old, newname = src.stem, dest.stem
    changed = 0
    if old != newname and body.get('updateLinks', True):
        pattern = re.compile(r'\[\[' + re.escape(old) + r'(?=[\]|#])')
        for f in walk_vault(root)[0]:
            fp = root / f['path']
            text = fp.read_text('utf-8', errors='replace')
            new_text = pattern.sub('[[' + newname, text)
            if new_text != text:
                write_text_atomic(fp, new_text)
                changed += 1
    return jsonify(path=rel_of(root, dest), mtime=dest.stat().st_mtime, linksUpdated=changed)


@app.delete('/api/notes/file')
def notes_delete():
    p = vault_path(request.args.get('path'))
    if not p.exists():
        return jsonify(ok=True)
    trash = vault_root() / '.trash'
    trash.mkdir(exist_ok=True)
    target = trash / p.name
    n = 1
    while target.exists():
        target = trash / f'{p.stem} {n}{p.suffix}'
        n += 1
    os.replace(p, target)
    return jsonify(ok=True)


@app.post('/api/notes/folder')
def notes_folder():
    body = request.get_json(force=True, silent=True) or {}
    p = vault_path(body.get('path'), must_be_note=False)
    p.mkdir(parents=True, exist_ok=True)
    return jsonify(path=rel_of(vault_root(), p))


@app.get('/api/notes/search')
def notes_search():
    q = request.args.get('q', '').strip().lower()
    if not q:
        return jsonify(results=[])
    root = vault_root()
    results = []
    for f in sorted(walk_vault(root)[0], key=lambda f: -f['mtime']):
        name_hit = q in Path(f['path']).stem.lower()
        try:
            lines = (root / f['path']).read_text('utf-8', errors='replace').splitlines()
        except OSError:
            continue
        hits = [(i, l) for i, l in enumerate(lines) if q in l.lower()][:3]
        if name_hit or hits:
            results.append({'path': f['path'], 'name': name_hit,
                            'hits': [{'line': i + 1, 'text': l.strip()[:160]} for i, l in hits]})
        if len(results) >= 60:
            break
    results.sort(key=lambda r: not r['name'])
    return jsonify(results=results)


# ---------------------------------------------------------------------------
# Config and tools
# ---------------------------------------------------------------------------

@app.get('/api/config')
def config_get():
    cfg = load_config()
    try:
        root = vault_root()
        notes = len(walk_vault(root)[0])
    except OSError:
        root, notes = Path(cfg['vaultPath']), None
    return jsonify(
        vaultPath=str(root), vaultNotes=notes, ytCookies=cfg.get('ytCookies', 'none'),
        hasCookieFile=COOKIE_FILE.exists(), extensionPath=str(ROOT / 'extension'),
        tools={'ffmpeg': bool(FFMPEG), 'deno': bool(DENO)},
    )


@app.put('/api/config')
def config_put():
    body = request.get_json(force=True, silent=True) or {}
    cfg = load_config()
    if 'vaultPath' in body:
        raw = str(body['vaultPath']).strip().strip('"')
        p = Path(raw).expanduser()
        if not raw or not p.is_absolute():
            return jsonify(error='Use a full folder path, like C:\\Users\\you\\Documents\\Vault.'), 400
        if not p.exists():
            if not p.parent.exists():
                return jsonify(error="That folder's parent doesn't exist."), 400
            p.mkdir()
        if not p.is_dir():
            return jsonify(error="That's a file, not a folder."), 400
        cfg['vaultPath'] = str(p.resolve())
        _note_cache.clear()
    if 'ytCookies' in body:
        if body['ytCookies'] not in COOKIE_SOURCES:
            return jsonify(error='Unknown cookie source.'), 400
        cfg['ytCookies'] = body['ytCookies']
    save_config(cfg)
    return config_get()


@app.post('/api/config/cookies')
def config_cookies():
    f = request.files.get('file')
    if not f:
        return jsonify(error='Choose a cookies.txt file.'), 400
    text = f.read().decode('utf-8', errors='replace')
    if 'youtube.com' not in text or '\t' not in text:
        return jsonify(error="That file doesn't look like a cookies.txt with YouTube cookies in it."), 400
    write_text_atomic(COOKIE_FILE, text)
    cfg = load_config()
    cfg['ytCookies'] = 'file'
    save_config(cfg)
    return config_get()


@app.delete('/api/config/cookies')
def config_cookies_delete():
    try:
        COOKIE_FILE.unlink()
    except OSError:
        pass
    cfg = load_config()
    if cfg.get('ytCookies') == 'file':
        cfg['ytCookies'] = 'none'
        save_config(cfg)
    return config_get()


@app.get('/api/tools')
def tools():
    return jsonify(ytdlp=ytdlp_version(), ffmpeg=bool(FFMPEG), deno=bool(DENO))


@app.post('/api/tools/test-youtube')
def tools_test_youtube():
    # "Me at the zoo", 19 seconds: the shortest well-known video
    cmd = ytdlp_cmd() + ['--simulate', '--print', 'title', '--', 'https://www.youtube.com/watch?v=jNQXAC9IVRw']
    out = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120,
                         env=child_env(), creationflags=NO_WINDOW)
    if out.returncode == 0 and out.stdout.strip():
        return jsonify(ok=True, message='YouTube downloads work from this network.')
    code, message = classify_error(out.stderr or out.stdout)
    return jsonify(ok=False, errorCode=code, message=message)


@app.post('/api/tools/update')
def tools_update():
    cmd = [sys.executable, '-m', 'pip', 'install', '--upgrade', '--disable-pip-version-check', '--quiet',
           'yt-dlp[default]']
    out = subprocess.run(cmd, capture_output=True, text=True, errors='replace', timeout=600, creationflags=NO_WINDOW)
    if out.returncode != 0:
        return jsonify(ok=False, message=out.stderr.strip()[-300:] or 'The update failed.'), 500
    return jsonify(ok=True, version=ytdlp_version())


# ---------------------------------------------------------------------------
# The app itself
# ---------------------------------------------------------------------------

@app.get('/')
def index():
    return send_from_directory(APP_DIR, 'index.html', max_age=0)


@app.get('/<path:path>')
def static_files(path):
    target = (APP_DIR / path).resolve()
    if APP_DIR not in target.parents or not target.is_file():
        abort(404)
    return send_from_directory(APP_DIR, path, max_age=0)


# ---------------------------------------------------------------------------

def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(('127.0.0.1', port)) == 0


def lan_address():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('8.8.8.8', 80))
            return s.getsockname()[0]
    except OSError:
        return None


def main():
    args = set(sys.argv[1:])
    url = f'http://localhost:{PORT}/'
    if port_in_use(PORT):
        print(f'DM Screen is already running at {url}')
        if '--open' in args:
            webbrowser.open(url)
        return
    shutil.rmtree(TMP, ignore_errors=True)
    TMP.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=analysis_worker, daemon=True).start()
    queue_missing_peaks()
    host = '0.0.0.0' if '--lan' in args else '127.0.0.1'
    print(f'DM Screen is running at {url}')
    if host == '0.0.0.0' and lan_address():
        print(f'Other devices on this network: http://{lan_address()}:{PORT}/')
    if not FFMPEG:
        print('Warning: ffmpeg was not found, so waveforms, clips and downloads are off.')
    print('Close this window to stop it.')
    if '--open' in args:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    try:
        from waitress import serve
        serve(app, host=host, port=PORT, threads=12, channel_timeout=300, ident='DM Screen')
    except ImportError:
        app.run(host=host, port=PORT, threaded=True)


if __name__ == '__main__':
    main()
