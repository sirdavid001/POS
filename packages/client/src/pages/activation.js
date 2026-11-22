import { api } from '../api.js';
import { getSubscription } from '../entitlement.js';
import { getOfflineQueueCount } from '../offline.js';

export const ACCOUNT_PORTAL_URL = 'https://quickpos.com.ng/account#billing';

export async function signOut() {
  const pending = getOfflineQueueCount();
  if (pending > 0 && !confirm(`${pending} offline change${pending === 1 ? ' is' : 's are'} still saved on this device. Sign out anyway?`)) return false;

  try {
    if (navigator.onLine) await api.post('/auth/logout', { refreshToken: api.refreshToken });
  } catch {
    // Local sign-out should still complete.
  }
  api.clearTokens();
  window.location.hash = '#/login';
  return true;
}

export function renderActivationGate(resume) {
  const app = document.getElementById('app');
  const isAdmin = JSON.parse(localStorage.getItem('user') || '{}').role === 'admin';
  document.title = 'Store activation · QuickPOS';
  app.innerHTML = `
    <main class="install-gate pos-activation" data-pos-activation>
      <section class="install-gate-panel" aria-labelledby="pos-activation-title">
        <div class="install-gate-brand">
          <img src="./brand/quickpos-mark.svg" alt="" width="52" height="52"><span>QuickPOS</span>
        </div>
        <p class="install-gate-kicker">Setup · Step 2 of 3</p>
        <h1 id="pos-activation-title" tabindex="-1">${isAdmin ? 'Activate your store' : 'Store activation required'}</h1>
        <p class="install-gate-copy">${isAdmin
          ? 'Complete the one-time payment in the account portal to start using QuickPOS. Already paid? Check your activation status here.'
          : 'Ask a store admin to complete activation in the account portal. After they confirm payment, check your activation status here.'}</p>
        <div class="install-gate-actions">
          ${isAdmin ? `<a class="btn btn-primary btn-lg" href="${ACCOUNT_PORTAL_URL}" target="_blank" rel="noopener noreferrer">Open activation checkout</a>` : ''}
          <button class="btn ${isAdmin ? 'btn-ghost' : 'btn-primary'} btn-lg" type="button" data-refresh-activation>Check activation status</button>
        </div>
        <p class="pos-activation-status" role="status"></p>
        <div class="pos-activation-utilities">
          <a class="btn btn-ghost" href="https://quickpos.com.ng/support" target="_blank" rel="noopener noreferrer">Get support</a>
          <button class="btn btn-ghost" type="button" data-activation-logout>Sign out</button>
        </div>
      </section>
    </main>
  `;
  const refresh = app.querySelector('[data-refresh-activation]');
  const status = app.querySelector('.pos-activation-status');
  const logout = app.querySelector('[data-activation-logout]');
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    status.textContent = 'Checking your store’s activation…';
    try {
      const result = await api.get('/auth/me');
      if (!app.contains(refresh)) return;
      if (result.subscription?.can_write && getSubscription()?.can_write) {
        resume();
        return;
      }
      status.textContent = 'Your store is not active yet. If you’ve paid, check again in a moment or contact support.';
    } catch {
      status.textContent = 'Couldn’t check activation. Make sure you’re online, then try again.';
    } finally {
      refresh.disabled = false;
    }
  });
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    if (!await signOut()) logout.disabled = false;
  });
  app.querySelector('#pos-activation-title').focus({ preventScroll: true });
}
