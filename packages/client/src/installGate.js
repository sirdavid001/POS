const DOWNLOADS_URL = 'https://quickpos.name.ng/downloads';

function isNativeAppShell() {
  const protocol = window.location.protocol;
  const capacitor = window.Capacitor;

  return (
    protocol === 'file:' ||
    protocol === 'capacitor:' ||
    protocol === 'ionic:' ||
    capacitor?.isNativePlatform?.() === true ||
    capacitor?.getPlatform?.() === 'android' ||
    capacitor?.getPlatform?.() === 'ios'
  );
}

export function canAccessInstalledApp() {
  if (import.meta.env.DEV) return true;
  return isNativeAppShell();
}

export function renderInstallRequiredPage() {
  document.title = 'Download QuickPOS';
  const app = document.getElementById('app');

  app.innerHTML = `
    <main class="install-gate">
      <section class="install-gate-panel animate-fade-in" aria-labelledby="install-gate-title">
        <div class="install-gate-brand">
          <img src="./brand/quickpos-mark.svg" alt="" width="52" height="52">
          <span>QuickPOS</span>
        </div>
        <p class="install-gate-kicker">App access required</p>
        <h1 id="install-gate-title">Download QuickPOS to continue</h1>
        <p class="install-gate-copy">
          This link is only for getting the official app. For security, the POS system opens after QuickPOS is installed on your device.
        </p>
        <div class="install-gate-device-list" aria-label="Supported installation options">
          <div><strong>Desktop</strong><span>Windows, macOS, and Linux installers</span></div>
          <div><strong>Mobile</strong><span>Android APK installer</span></div>
          <div><strong>Secure access</strong><span>Sign in after installation only</span></div>
        </div>
        <div class="install-gate-actions">
          <a class="btn btn-primary btn-lg" href="${DOWNLOADS_URL}">Download app</a>
          <a class="btn btn-ghost btn-lg" href="https://quickpos.name.ng/support">Get support</a>
        </div>
      </section>
    </main>
  `;
}
