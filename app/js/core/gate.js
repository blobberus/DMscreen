// The password gate of the website version. The check runs in the browser: the repo is public, so
// this keeps people out of the screen, not out of the files. The PC version checks on its server.
export const PASS_HASH = '01c848b1a50cf1e3e54fb2f2a6460cbf8fb9be54246e7c02d0b90b70e70c156c';
const KEY = 'dm:pass';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const gate = {
  unlocked() {
    try { return (localStorage.getItem(KEY) || sessionStorage.getItem(KEY)) === PASS_HASH; } catch { return false; }
  },
  async unlock(password, remember) {
    if ((await sha256(password)) !== PASS_HASH) return false;
    try { (remember ? localStorage : sessionStorage).setItem(KEY, PASS_HASH); } catch { /* private mode: this visit only */ }
    return true;
  },
  lock() {
    try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch { /* nothing kept */ }
  },
};
