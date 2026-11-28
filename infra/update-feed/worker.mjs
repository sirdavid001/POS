/* global AbortSignal, Response, URL, fetch */
import { manifestFromGitHubRelease } from '../../packages/shared/src/releases.js';

const latestUrl = 'https://api.github.com/repos/sirdavid001/POS/releases/latest';
const repo = 'https://github.com/sirdavid001/POS/releases/download/';
const allowedHosts = new Set(['downloads.quickpos.com.ng', 'downloads.quickpos.name.ng', 'localhost', '127.0.0.1']);
const numericVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function headers(type) {
  return {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*', // Installed Electron/Android and web clients read this public feed.
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Cache-Control': 'public, max-age=120',
    'X-Content-Type-Options': 'nosniff',
  };
}

function reply(request, body, type, status = 200) {
  return new Response(request.method === 'HEAD' ? null : body, { status, headers: headers(type) });
}

async function loadRelease(fetcher) {
  const response = await fetcher(latestUrl, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'QuickPOS-Update-Feed' },
    signal: AbortSignal.timeout(5000),
    cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 120, '400-599': 0 } },
  });
  if (!response.ok) throw new Error('Release metadata unavailable');
  const release = await response.json();
  const version = typeof release?.tag_name === 'string' ? release.tag_name.slice(1) : '';
  if (!numericVersion.test(version) || release.tag_name !== 'v' + version || release.draft ||
      release.prerelease || !Array.isArray(release.assets)) throw new Error('Invalid release');
  const base = repo + release.tag_name + '/';
  const assets = release.assets.filter(({ name, browser_download_url: url, digest }) =>
    typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) && url === base + name &&
    (name === 'latest.yml' || /^sha256:[0-9a-f]{64}$/i.test(digest || ''))
  );
  return { ...release, assets };
}

function makeManifest(release) {
  const data = manifestFromGitHubRelease(release);
  const releaseNotes = data.version === '1.0.12'
    ? 'Update for staff ID cards, register approvals, and the activity log.'
    : 'A new QuickPOS release is ready. Update when you finish the current sale.';
  if (!data.releases.length) throw new Error('No verified installers');
  const installers = data.releases.map((item) => ({ ...item, release_notes: releaseNotes }));
  return {
    ...data,
    release_notes: releaseNotes,
    releases: [...installers, {
      platform: 'ios', architecture: 'web', file_type: 'PWA', status: 'available',
      version: data.version, url: 'https://quickposs.vercel.app',
      sha256: null, signature_status: 'web',
      minimum_supported_version: data.minimum_supported_version,
      release_notes: 'Open QuickPOS from the Home Screen to load the latest web app.',
    }],
  };
}

export async function handleUpdateFeed(request, fetcher = fetch) {
  const url = new URL(request.url);
  if (!allowedHosts.has(url.hostname)) return reply(request, 'Not found', 'text/plain', 404);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return new Response(null, {
    status: 405,
    headers: { ...headers('text/plain'), Allow: 'GET, HEAD, OPTIONS' },
  });
  const installer = url.pathname.match(/^\/desktop\/windows\/(QuickPOS-Setup-((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\.exe(?:\.blockmap)?)$/);
  if (!installer && !['/latest.json', '/desktop/windows/latest.yml'].includes(url.pathname)) {
    return reply(request, 'Not found', 'text/plain', 404);
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers('text/plain') });
  if (installer) {
    return new Response(null, {
      status: 302, headers: { ...headers('text/plain'), Location: repo + 'v' + installer[2] + '/' + installer[1] },
    });
  }
  try {
    const release = await loadRelease(fetcher);
    if (url.pathname === '/latest.json') {
      return reply(request, JSON.stringify(makeManifest(release)) + '\n', 'application/json; charset=utf-8');
    }
    const index = release.assets.find((asset) => asset.name === 'latest.yml');
    if (!index) throw new Error('Windows updater metadata unavailable');
    const metadata = await fetcher(index.browser_download_url, { signal: AbortSignal.timeout(5000) });
    if (!metadata.ok) throw new Error('Windows updater metadata unavailable');
    return reply(request, await metadata.text(), 'text/yaml; charset=utf-8');
  } catch {
    return new Response(request.method === 'HEAD' ? null : 'Update feed temporarily unavailable\n', {
      status: 503,
      headers: { ...headers('text/plain; charset=utf-8'), 'Cache-Control': 'no-store', 'Retry-After': '120' },
    });
  }
}

export default { fetch: (request) => handleUpdateFeed(request) };
