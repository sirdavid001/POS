import { api } from './api.js';
import { openCameraScanner } from './scanner.js';
import { escapeHTML } from './utils.js';
import './pages/staff-identity.css';

const registerPath = '/register-control';
export const isStaffBadge = (value) => /^QPB[0-9]{38}$/i.test(value);
export const registerPost = (path, body) => api.post(registerPath + path, body, { skipOfflineQueue: true });
export const registerPatch = (path, body) => api.patch(registerPath + path, body, { skipOfflineQueue: true });
export const registerDelete = (path) => api.delete(registerPath + path, { skipOfflineQueue: true });
export const registerGet = (path) => api.get(registerPath + path, { skipOfflineQueue: true });

export function terminalId(store, user) {
  const key = `quickpos_register_terminal_${store}_${user}`;
  let id = sessionStorage.getItem(key);
  if (!id) {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    id = crypto.randomUUID?.() || `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

export function openRegisterPrompt({ title, description, supervisor = false, initialBadge, handle }) {
  if (document.querySelector('[data-register-prompt]')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.registerPrompt = 'true';
  overlay.innerHTML = `
    <section role="dialog" aria-modal="true" aria-labelledby="register-scan-title" aria-describedby="register-scan-intro" class="modal register-prompt">
      <h2 id="register-scan-title">${escapeHTML(title)}</h2>
      <p class="settings-help" id="register-scan-intro">${escapeHTML(description)}</p>
      <form data-register-barcode data-form-experience="off">
        <label class="label" for="register-card-code">Badge barcode</label>
        <input class="input" id="register-card-code" name="badge" type="password" maxlength="41" autocomplete="off"
          aria-describedby="register-scan-intro" required autofocus>
        <div class="register-actions">
          <button class="btn btn-primary" type="submit">Verify badge</button>
          <button class="btn btn-ghost" type="button" data-register-camera>Use camera</button>
        </div>
      </form>
      ${supervisor ? `<details data-register-pin>
        <summary>Use supervisor PIN instead</summary>
        <form data-form-experience="off">
          <label for="register-supervisor-email" class="label">Supervisor email</label>
          <input id="register-supervisor-email" class="input" type="email" name="email" autocomplete="username" required>
          <label for="register-supervisor-pin" class="label">Supervisor PIN</label>
          <input id="register-supervisor-pin" class="input" type="password" name="pin" inputmode="numeric" minlength="8" maxlength="8" pattern="[0-9]{8}" autocomplete="off" required>
          <button class="btn btn-primary" type="submit">Approve with PIN</button>
        </form>
      </details>` : ''}
      <p role="status" class="register-message"></p>
      <button type="button" class="btn btn-ghost" data-dialog-close>Cancel</button>
    </section>
  `;
  document.body.append(overlay);
  const badgeInput = overlay.querySelector('[name=badge]');
  const status = overlay.querySelector('[role=status]');
  let pending = false;
  const close = () => { if (!pending) overlay.remove(); };
  overlay.querySelector('[data-dialog-close]').addEventListener('click', close);
  async function submit(credential) {
    if (pending || !overlay.isConnected) return;
    pending = true;
    overlay.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    status.textContent = 'Verifying…';
    try {
      if (credential.badge && !isStaffBadge(credential.badge)) throw new Error('This is not a QuickPOS staff badge.');
      await handle(credential);
      overlay.remove();
    } catch (error) {
      if (overlay.isConnected) {
        status.textContent = error.message || 'Could not verify. Try again.';
        const retry = credential.badge ? badgeInput : overlay.querySelector('[name=pin]');
        retry.value = '';
        retry.focus();
      }
    } finally {
      pending = false;
      overlay.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    }
  }
  overlay.querySelector('[data-register-barcode]').addEventListener('submit', (event) => {
    event.preventDefault();
    submit({ badge: badgeInput.value.trim().toUpperCase() });
  });
  overlay.querySelector('[data-register-pin] form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    submit({ pin: { email: String(data.get('email')).trim(), pin: String(data.get('pin')) } });
  });
  overlay.querySelector('[data-register-camera]').addEventListener('click', () => {
    openCameraScanner((value) => submit({ badge: value.trim().toUpperCase() }), { title: 'Scan staff badge', sensitive: true });
  });
  badgeInput.focus();
  if (initialBadge) submit({ badge: initialBadge.trim().toUpperCase() });
}
