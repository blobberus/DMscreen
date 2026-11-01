// GitHub calls for the website version: reading screen/setup.json and the private sound list, and
// committing renames, moves, new folders and the setup. The token (fine-grained, Contents read and write
// on this repo and the sounds repo only) is kept in this browser and sent only to the GitHub API. A copy
// goes in this browser's IndexedDB for the offline worker (sw.js), which fetches the private sounds and
// can't read localStorage.
import { REPO, BRANCH, GITHUB_API, GITHUB_RAW, SOUNDS_REPO } from './mode.js';

const TOKEN_KEY = 'dm:github-token';

/** Give the offline worker the token and where the sounds are (or take them away). */
function shareToken(token) {
  try {
    const open = indexedDB.open('dm', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', 'readwrite');
      if (token) tx.objectStore('kv').put({ token, api: GITHUB_API, repo: SOUNDS_REPO, branch: BRANCH }, 'github');
      else tx.objectStore('kv').delete('github');
      tx.oncomplete = () => open.result.close();
    };
  } catch { /* no IndexedDB: private sounds won't play here */ }
}

export const encPath = (p) => String(p).split('/').map(encodeURIComponent).join('/');

export function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** The id git gives a file's content, so we can tell whether the copy on GitHub is the one we read. */
export async function blobSha(text) {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  const d = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function explain(status, data) {
  const msg = data?.message || '';
  if (status === 401) return "GitHub didn't accept the token. Connect again in Settings, GitHub.";
  if (status === 403 && /rate limit/i.test(msg)) return 'GitHub is limiting requests from this network. Try again in a few minutes.';
  if (status === 403) return "The token can't change this repository. It needs Contents: Read and write on DMscreen.";
  if (status === 404) return "GitHub couldn't find that. Is the token for the DMscreen repository?";
  return msg ? `GitHub said: ${msg}` : `GitHub answered ${status}.`;
}

export const github = {
  token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  },
  connected() { return !!this.token(); },
  setToken(t) { localStorage.setItem(TOKEN_KEY, t); shareToken(t); },
  forget() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing kept */ } shareToken(null); },
  /** At start-up: the worker's copy matches this browser's token (a token from before the copy existed). */
  share() { if (SOUNDS_REPO) shareToken(this.token()); },

  /** A call to the REST API. With raw, the body comes back as text (a file's content). */
  async call(method, path, body, { token = this.token(), raw = false } = {}) {
    const headers = { Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(`${GITHUB_API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch {
      const e = new Error("Can't reach GitHub. Check the internet connection.");
      e.status = 0;
      throw e;
    }
    const data = res.status === 204 ? null : raw && res.ok ? await res.text() : await res.json().catch(() => null);
    if (!res.ok) {
      const e = new Error(explain(res.status, data));
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  },

  /** Check a token before keeping it: {login, repo, canPush, sounds}. sounds: false when it can't read the
   *  private sounds repo, {canPush} when it can, null when there is none. */
  async check(token) {
    const repo = await this.call('GET', `/repos/${REPO}`, undefined, { token });
    const user = await this.call('GET', '/user', undefined, { token }).catch(() => null);
    const sounds = SOUNDS_REPO ? await this.call('GET', `/repos/${SOUNDS_REPO}`, undefined, { token }).then(
      (r) => ({ canPush: r.permissions ? !!r.permissions.push : null }),
      (e) => { if (e.status === 404 || e.status === 403) return false; throw e; }) : null;
    return { login: user?.login || '', repo: repo.full_name, canPush: repo.permissions ? !!repo.permissions.push : null, sounds };
  },

  /** A file's content as text, through the API (a private repo's too), or null when it isn't there. */
  async readRaw(path, { repo = REPO } = {}) {
    try {
      return await this.call('GET', `/repos/${repo}/contents/${encPath(path)}?ref=${encodeURIComponent(BRANCH)}`, undefined, { raw: true });
    } catch (e) {
      // GitHub says 404 both for a missing file and for a repo the token can't see
      if (e.status === 404 && await this.call('GET', `/repos/${repo}`).then(() => true, () => false)) return null;
      throw e;
    }
  },
  /** A blob's content as text, by its id. */
  async blobText(sha, { repo = REPO } = {}) {
    return this.call('GET', `/repos/${repo}/git/blobs/${sha}`, undefined, { raw: true });
  },

  /** A text file from the branch: {text, sha}, or null when it doesn't exist yet. */
  async readText(path) {
    if (this.connected()) {
      try {
        const d = await this.call('GET', `/repos/${REPO}/contents/${encPath(path)}?ref=${encodeURIComponent(BRANCH)}`);
        return { text: b64decode(d.content), sha: d.sha };
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    }
    const res = await fetch(`${GITHUB_RAW}/${REPO}/${encodeURIComponent(BRANCH)}/${encPath(path)}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    const text = await res.text();
    return { text, sha: await blobSha(text) };
  },

  /** Write one text file. sha is the version we last read (null for a new file). Returns the new sha. */
  async putText(path, text, sha, message) {
    const body = { message, content: b64encode(text), branch: BRANCH };
    if (sha) body.sha = sha;
    const d = await this.call('PUT', `/repos/${REPO}/contents/${encPath(path)}`, body);
    return d.content.sha;
  },

  /**
   * One commit with many changes. `changes` is a list of {path, sha} (put an existing file there),
   * {path, sha: null} (delete) or {path, content} (write text), or a function that gets
   * `listTree()` (every file on the branch) and returns that list. Retries if the branch moved. In the
   * repo given (the sounds repo), else this one.
   */
  async commit(message, changes, { repo = REPO } = {}) {
    for (let attempt = 0; ; attempt++) {
      const ref = await this.call('GET', `/repos/${repo}/git/ref/heads/${encodeURIComponent(BRANCH)}`);
      const head = ref.object.sha;
      const commit = await this.call('GET', `/repos/${repo}/git/commits/${head}`);
      let listed = null;
      const listTree = async () => (listed ||= (await this.call('GET', `/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`)).tree);
      const list = typeof changes === 'function' ? await changes(listTree) : changes;
      const tree = await this.call('POST', `/repos/${repo}/git/trees`, {
        base_tree: commit.tree.sha,
        tree: list.map((c) => (c.content !== undefined
          ? { path: c.path, mode: '100644', type: 'blob', content: c.content }
          : { path: c.path, mode: c.mode || '100644', type: 'blob', sha: c.sha })),
      });
      const made = await this.call('POST', `/repos/${repo}/git/commits`, { message, tree: tree.sha, parents: [head] });
      try {
        await this.call('PATCH', `/repos/${repo}/git/refs/heads/${encodeURIComponent(BRANCH)}`, { sha: made.sha, force: false });
        return made.sha;
      } catch (e) {
        if (e.status === 422 && attempt < 2) continue;   // someone else committed first: build on theirs
        throw e;
      }
    }
  },

  /** The newest workflow run (publishing, or indexing the sounds): {status, conclusion, created_at, html_url} or null. */
  async latestRun({ repo = REPO } = {}) {
    const d = await this.call('GET', `/repos/${repo}/actions/runs?branch=${encodeURIComponent(BRANCH)}&per_page=1`);
    return d.workflow_runs?.[0] || null;
  },
};
