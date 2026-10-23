// The gate: one password, then on to the screen (or wherever the visitor was headed).
// The PC version checks it on its server; the website checks it here (core/gate.js).
import { SITE } from './core/mode.js';
import { gate } from './core/gate.js';

const form = document.getElementById('gate');
const pass = document.getElementById('pass');
const remember = document.getElementById('remember');
const error = document.getElementById('error');
const button = form.querySelector('.gate-enter');

function nextUrl() {
  const n = new URLSearchParams(location.search).get('next') || '/';
  return n.startsWith('/') && !n.startsWith('//') ? n : '/';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pass.value) { pass.focus(); return; }
  button.setAttribute('aria-busy', 'true');
  error.hidden = true;
  if (SITE) {
    if (await gate.unlock(pass.value, remember.checked)) { location.replace('./'); return; }
    error.textContent = "That isn't the password.";
  } else try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass.value, remember: remember.checked }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) { location.replace(nextUrl()); return; }
    error.textContent = data.error || "That isn't the password.";
  } catch {
    error.textContent = "Can't reach the DM Screen server. Is it still running?";
  }
  error.hidden = false;
  button.removeAttribute('aria-busy');
  form.classList.remove('is-shaking');
  void form.offsetWidth;
  form.classList.add('is-shaking');
  pass.select();
});
