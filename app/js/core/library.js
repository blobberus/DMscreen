// The sound library on the client: sounds, their waveforms, uploads, clips and download jobs.
// Emits 'library' when the list changes, 'library:sound' (sound) when one sound changes, 'jobs' for downloads.
// On the website the sounds are the repo's files (site.js): names and folders change by commit, and
// 'library:moved' ({from, to}) says a sound or folder has a new id.
import { api, upload as uploadForm, q } from './api.js';
import { bus } from './bus.js';
import { SITE } from './mode.js';
import * as site from './site.js';
import { state } from './state.js';

const sounds = new Map();
let order = [];
let folderList = [];
const pendingPatches = new Map();
const patchTimers = new Map();
const peakCache = new Map();
let jobs = [];
let jobTimer = null;
let analyzeTimer = null;

function setAll(list) {
  sounds.clear();
  for (const s of list) sounds.set(s.id, s);
  order = list.map((s) => s.id);
  bus.emit('library', list);
  watchAnalysis();
}

function watchAnalysis() {
  clearTimeout(analyzeTimer);
  if ([...sounds.values()].some((s) => s.status === 'analyzing')) {
    analyzeTimer = setTimeout(() => library.load(), 1500);
  }
}

export const KIND_LABEL = { music: 'Music', ambience: 'Ambience', effect: 'Effect' };
// A sound's volume (and a pad's) runs from silent to 3, 300% of the file. A louder one saved before the
// limit plays at 300%.
export const MAX_VOLUME = 3;

export const library = {
  async load() {
    const data = SITE ? site.library() : await api.get('/api/library');
    folderList = data.folders || [];
    for (const s of data.sounds) {
      const prev = sounds.get(s.id);
      if (prev && prev.status === 'analyzing' && s.status === 'ready') peakCache.delete(s.id);
      if (pendingPatches.has(s.id)) Object.assign(s, pendingPatches.get(s.id));
    }
    setAll(data.sounds);
  },
  get: (id) => sounds.get(id) || null,
  list: () => order.map((id) => sounds.get(id)).filter(Boolean),
  has: (id) => sounds.has(id),
  /** Website: every folder under sounds/, and the playlists, ambience folders or pad banks of a kind. */
  folders: () => folderList.slice(),
  groups: (kind) => (SITE ? site.groupsOf(kind) : []),

  /** The part of a sound that plays: [from, to] in seconds. */
  region(s) {
    const dur = s.duration || 0;
    const from = Math.max(0, Math.min(s.trimStart || 0, dur));
    const to = s.trimEnd == null ? dur : Math.max(from, Math.min(s.trimEnd, dur));
    return [from, to];
  },

  /** Change fields now; they reach the server a moment later. */
  update(id, patch) {
    const s = sounds.get(id);
    if (!s) return;
    Object.assign(s, patch);
    pendingPatches.set(id, { ...(pendingPatches.get(id) || {}), ...patch });
    bus.emit('library:sound', s);
    clearTimeout(patchTimers.get(id));
    patchTimers.set(id, setTimeout(() => this.flush(id), 400));
  },
  async flush(id) {
    const patch = pendingPatches.get(id);
    if (!patch) return;
    pendingPatches.delete(id);
    clearTimeout(patchTimers.get(id));
    if (SITE) { site.patchSound(id, patch); return; }
    try {
      const saved = await api.patch(`/api/library/${id}`, patch);
      const s = sounds.get(id);
      if (s && saved) { s.flags = saved.flags; s.name = saved.name; s.tags = saved.tags; }
    } catch (e) {
      bus.emit('toast', { message: `Couldn't save “${sounds.get(id)?.name || 'sound'}”: ${e.message}`, type: 'error' });
    }
  },

  async upload(files, { kind, onProgress } = {}) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    if (kind) fd.append('kind', kind);
    const res = await uploadForm('/api/library/upload', fd, onProgress);
    await this.load();
    return res;
  },

  async remove(id) {
    if (SITE) { state.saveNow(); await site.deleteSound(id); } else await api.del(`/api/library/${id}`);
    peakCache.delete(id);
    sounds.delete(id);
    order = order.filter((x) => x !== id);
    bus.emit('library', this.list());
    bus.emit('library:removed', id);
  },

  async clip(id, { start, end, name, kind }) {
    const clip = await api.post(`/api/library/${id}/clip`, { start, end, name, kind });
    await this.load();
    return clip;
  },

  exportUrl(id, { start, end, fmt = 'mp3' } = {}) {
    if (SITE) return this.mediaUrl(id);
    const p = new URLSearchParams({ fmt });
    if (start != null) p.set('start', start.toFixed(3));
    if (end != null) p.set('end', end.toFixed(3));
    return `/api/library/${id}/export?${p}`;
  },

  mediaUrl: (id) => (SITE ? sounds.get(id)?.media || '' : `/media/${id}`),

  // ---- website: the files are the repo's, so these are commits -------------------------
  /** Rename or move a sound (website). Resolves to its new id. */
  async rename(id, name) { return this.moved(await this.commit(() => site.renameSound(id, name))); },
  async move(id, dir) { return this.moved(await this.commit(() => site.moveSound(id, dir))); },
  async renameFolder(dir, name) { return this.moved(await this.commit(() => site.renameFolder(dir, name))); },
  /** Move a folder to another category, keeping its name (a playlist to Ambience and back). */
  async moveFolder(dir, parent) { return this.moved(await this.commit(() => site.renameFolder(dir, site.folderName(dir), parent))); },
  async createFolder(parent, name) {
    const dir = await this.commit(() => site.createFolder(parent, name));
    await this.load();
    return dir;
  },
  async commit(run) {
    for (const id of [...pendingPatches.keys()]) this.flush(id);
    state.saveNow();
    return run();
  },
  async moved({ from, to }) {
    if (from === to) return to;
    for (const [id, p] of [...pendingPatches]) {
      if (id === from || id.startsWith(`${from}/`)) { pendingPatches.delete(id); pendingPatches.set(to + id.slice(from.length), p); }
    }
    for (const [id, p] of [...peakCache]) if (id === from || id.startsWith(`${from}/`)) peakCache.set(to + id.slice(from.length), p);
    await this.load();
    bus.emit('library:moved', { from, to });
    return to;
  },

  /** Waveform peaks: {rate, duration, data: Uint8Array (0..255, perceptual)}. Waits while analysing. */
  peaks(id) {
    if (peakCache.has(id)) return peakCache.get(id);
    const p = (async () => {
      if (SITE) {
        const s = sounds.get(id);
        const res = s?.peaks ? await fetch(s.peaks).then((r) => (r.ok ? r.json() : null)) : null;
        if (!res) throw new Error('No waveform for this sound');
        const bin = atob(res.data);
        const data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        return { rate: res.rate, duration: res.duration, data };
      }
      for (let tries = 0; tries < 400; tries++) {
        const res = await api.get(`/api/library/${id}/peaks`);
        if (!res.pending) {
          const bin = atob(res.data);
          const data = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
          return { rate: res.rate, duration: res.duration, data };
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
      throw new Error('Waveform not ready');
    })();
    peakCache.set(id, p);
    p.catch(() => peakCache.delete(id));
    return p;
  },

  // ---- downloads -----------------------------------------------------------
  jobs: () => jobs,
  async download(opts) {
    const job = await api.post('/api/download', opts);
    jobs = [job, ...jobs.filter((j) => j.id !== job.id)];
    bus.emit('jobs', jobs);
    this.pollJobs();
    return job;
  },
  async cancelJob(id) {
    await api.del(`/api/jobs/${id}`);
    await this.refreshJobs();
  },
  async refreshJobs() {
    if (SITE) return jobs;
    const before = new Map(jobs.map((j) => [j.id, j.status]));
    const data = await api.get('/api/jobs');
    jobs = data.jobs;
    bus.emit('jobs', jobs);
    let finished = false;
    for (const j of jobs) {
      const was = before.get(j.id);
      if (was && was !== j.status && (j.status === 'done' || j.status === 'error')) {
        finished = true;
        bus.emit('job:finished', j);
      }
    }
    if (finished) await this.load();
    return jobs;
  },
  pollJobs() {
    clearTimeout(jobTimer);
    const tick = async () => {
      try { await this.refreshJobs(); } catch { /* server busy; try again */ }
      if (jobs.some((j) => !['done', 'error', 'cancelled'].includes(j.status))) jobTimer = setTimeout(tick, 800);
    };
    jobTimer = setTimeout(tick, 400);
  },

  async searchYouTube(query) {
    return api.get(`/api/yt/search?q=${q(query)}`);
  },
};

// The website found new or changed files (published, or a setup saved on another device).
bus.on('site:library', () => library.load());
