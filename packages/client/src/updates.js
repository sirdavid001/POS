const MANIFEST_URL =
  import.meta.env.VITE_RELEASE_MANIFEST_URL ||
  'https://downloads.quickpos.com.ng/latest.json';
const DOWNLOADS_URL =
  import.meta.env.VITE_DOWNLOADS_URL ||
  'https://quickpos.com.ng/downloads';
const CURRENT_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';

function compareVersions(left, right) {
  const a = String(left)
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number(part.match(/^\d+/)?.[0] || 0));
  const b = String(right)
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number(part.match(/^\d+/)?.[0] || 0));
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function currentPlatform() {
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes('android')) return 'android';
  if (agent.includes('iphone') || agent.includes('ipad')) return 'ios';
  if (agent.includes('windows')) return 'windows';
  if (agent.includes('mac')) return 'macos';
  if (agent.includes('linux')) return 'linux';
  return null;
}

async function findAvailableRelease(platform) {
  try {
    const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) return null;

    const manifest = await response.json();
    const release = manifest.releases?.find((item) =>
      item.platform === platform && item.status === 'available'
    );
    if (platform === 'ios' && release?.file_type === 'PWA') return null;
    if (release) return { release, manifest };
  } catch {
    // Update checks should stay quiet if the official release host is unavailable.
  }

  return null;
}

export async function checkForAppUpdate() {
  if (!localStorage.getItem('user')) return;
  if (document.querySelector('.app-update-banner')) return;

  const platform = currentPlatform();
  if (!platform) return;

  try {
    const result = await findAvailableRelease(platform);
    if (!result) return;
    const { release, manifest } = result;
    if (!release || compareVersions(release.version, CURRENT_VERSION) <= 0) return;

    const banner = document.createElement('div');
    banner.className = 'app-update-banner';
    banner.innerHTML = `
      <div>
        <strong>QuickPOS ${release.version} is available</strong>
        <span>${release.release_notes || manifest.release_notes || 'A new verified release is ready.'}</span>
      </div>
      <a class="btn btn-primary btn-sm" href="${DOWNLOADS_URL}" target="_blank" rel="noopener">Download update</a>
      <button class="btn btn-ghost btn-sm" type="button" aria-label="Dismiss update">Later</button>
    `;
    banner.querySelector('button').addEventListener('click', () => banner.remove());
    document.body.appendChild(banner);
  } catch {
    // Update checks should never interrupt selling.
  }
}
