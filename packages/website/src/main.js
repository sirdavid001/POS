import './styles.css';
import { inject, track } from '@vercel/analytics';

inject();

const page = document.body.dataset.page || 'home';
const navigation = [
  ['home', '/', 'Home'],
  ['features', '/features', 'Features'],
  ['pricing', '/pricing', 'Pricing'],
  ['downloads', '/downloads', 'Downloads'],
  ['faq', '/faq', 'FAQ'],
  ['support', '/support', 'Support'],
];

const header = document.querySelector('[data-site-header]');
if (header) {
  header.innerHTML = `
    <div class="site-shell nav-shell">
      <a class="brand" href="/" aria-label="QuickPOS home">
        <span class="brand-mark">Q</span>
        <span>QuickPOS</span>
      </a>
      <button class="menu-button" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
      <nav id="site-nav" class="site-nav">
        ${navigation.map(([id, href, label]) => `
          <a href="${href}" class="${page === id ? 'active' : ''}">${label}</a>
        `).join('')}
        <a href="/downloads" class="button button-small">Download free</a>
      </nav>
    </div>
  `;
  const menu = header.querySelector('.menu-button');
  menu.addEventListener('click', () => {
    const open = header.classList.toggle('menu-open');
    menu.setAttribute('aria-expanded', String(open));
  });
}

const footer = document.querySelector('[data-site-footer]');
if (footer) {
  footer.innerHTML = `
    <div class="site-shell footer-grid">
      <div>
        <a class="brand" href="/"><span class="brand-mark">Q</span><span>QuickPOS</span></a>
        <p>Simple point of sale software built for growing stores.</p>
      </div>
      <div>
        <strong>Product</strong>
        <a href="/features">Features</a>
        <a href="/pricing">Pricing</a>
        <a href="/downloads">Downloads</a>
      </div>
      <div>
        <strong>Help</strong>
        <a href="/faq">FAQ</a>
        <a href="/support">Support</a>
        <a href="mailto:support@quickpos.name.ng">support@quickpos.name.ng</a>
      </div>
      <div>
        <strong>Legal</strong>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/refund">Refund policy</a>
      </div>
    </div>
    <div class="site-shell footer-bottom">
      <span>© ${new Date().getFullYear()} QuickPOS.</span>
      <span>Prices shown in Nigerian naira. No VAT breakdown yet.</span>
    </div>
  `;
}

function detectPlatform() {
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes('android')) return 'android';
  if (agent.includes('iphone') || agent.includes('ipad')) return 'ios';
  if (agent.includes('windows')) return 'windows';
  if (agent.includes('mac')) return 'macos';
  if (agent.includes('linux')) return 'linux';
  return null;
}

const platformNames = {
  windows: 'Windows',
  android: 'Android',
  macos: 'macOS',
  linux: 'Linux',
  ios: 'iPhone and iPad',
};

async function loadDownloads() {
  const target = document.querySelector('[data-download-grid]');
  if (!target) return;
  const detected = detectPlatform();
  const platforms = ['windows', 'android', 'macos', 'linux', 'ios'];

  try {
    const manifestUrls = [
      import.meta.env.VITE_RELEASE_MANIFEST_URL,
      'https://downloads.quickpos.name.ng/latest.json',
      'https://github.com/sirdavid001/POS/releases/latest/download/latest.json',
    ].filter(Boolean);
    let manifest = null;

    for (const manifestUrl of manifestUrls) {
      try {
        const response = await fetch(manifestUrl, { cache: 'no-store' });
        if (!response.ok) continue;
        manifest = await response.json();
        break;
      } catch {
        // Try the next release host.
      }
    }

    if (!manifest) throw new Error('Release manifest unavailable');

    target.innerHTML = platforms.map((platform) => {
      const release = manifest.releases?.find((item) => item.platform === platform);
      const available = release?.status === 'available' && release.url;
      return `
        <article class="download-card ${detected === platform ? 'detected' : ''}">
          ${detected === platform ? '<span class="eyebrow">Your device</span>' : ''}
          <div class="platform-icon">${platform === 'windows' ? '⊞' : platform === 'android' ? 'A' : platform === 'macos' ? 'M' : platform === 'linux' ? 'L' : 'i'}</div>
          <h3>${platformNames[platform]}</h3>
          <p>${available
            ? `Version ${release.version} · ${release.architecture || 'release'}`
            : platform === 'ios'
              ? 'TestFlight and App Store release coming soon.'
              : 'Release coming soon.'}</p>
          ${available ? `
            <a class="button download-link" href="${release.url}" data-platform="${platform}" data-version="${release.version}">
              Download ${release.file_type || ''}
            </a>
            <small>${release.size_display || ''}${release.sha256 ? ` · SHA-256 available` : ''}</small>
          ` : '<span class="button button-disabled">Coming soon</span>'}
        </article>
      `;
    }).join('');

    target.querySelectorAll('.download-link').forEach((link) => {
      link.addEventListener('click', () => {
        track('download_clicked', {
          platform: link.dataset.platform,
          version: link.dataset.version,
        });
      });
    });
  } catch {
    target.innerHTML = platforms.map((platform) => `
      <article class="download-card ${detected === platform ? 'detected' : ''}">
        <div class="platform-icon">${platform.charAt(0).toUpperCase()}</div>
        <h3>${platformNames[platform]}</h3>
        <p>Release information is temporarily unavailable.</p>
        <span class="button button-disabled">Check again soon</span>
      </article>
    `).join('');
  }
}

loadDownloads();
