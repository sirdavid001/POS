import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function artifactDetails(file) {
  const name = path.basename(file);
  if (!/\.(exe|apk|dmg|AppImage|deb)$/i.test(name)) return null;
  if (/debug|unsigned/i.test(name)) {
    throw new Error(`Refusing to publish untrusted artifact: ${name}`);
  }
  if (/^QuickPOS-Setup-.*\.exe$/i.test(name)) return { platform: 'windows', architecture: 'x64', file_type: '.exe' };
  if (/^QuickPOS-.*\.apk$/i.test(name)) return { platform: 'android', architecture: 'universal', file_type: '.apk' };
  if (/^QuickPOS-.*\.dmg$/i.test(name)) return { platform: 'macos', architecture: name.includes('arm64') ? 'arm64' : 'x64', file_type: '.dmg' };
  if (/^QuickPOS-.*\.AppImage$/i.test(name)) return { platform: 'linux', architecture: 'x64', file_type: '.AppImage' };
  if (/^QuickPOS-.*\.deb$/i.test(name)) return { platform: 'linux', architecture: 'x64', file_type: '.deb' };
  return null;
}

function displaySize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const artifactsDirectory = path.resolve(argument('artifacts', 'release-artifacts'));
const output = path.resolve(argument('output', 'latest.json'));
const version = argument('version');
const releaseNotes = argument('notes', `QuickPOS ${version}`);
const minimumSupportedVersion = argument('minimum', version);
const baseUrl = argument('base-url', 'https://downloads.quickpos.name.ng').replace(/\/$/, '');

if (!version) throw new Error('--version is required');

const files = await walk(artifactsDirectory);
const releases = [];
const checksumLines = [];

for (const file of files) {
  const details = artifactDetails(file);
  if (!details) continue;
  const buffer = await fs.readFile(file);
  const stat = await fs.stat(file);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const name = path.basename(file);
  checksumLines.push(`${sha256}  ${name}`);
  releases.push({
    ...details,
    version,
    url: `${baseUrl}/releases/${version}/${encodeURIComponent(name)}`,
    sha256,
    size: stat.size,
    size_display: displaySize(stat.size),
    release_notes: releaseNotes,
    minimum_supported_version: minimumSupportedVersion,
    status: 'available',
  });
}

const comingSoon = [
  ['windows', 'x64', '.exe', 'Windows release coming soon.'],
  ['android', 'universal', '.apk', 'Signed Android release coming soon. Debug APKs are never published.'],
  ['macos', 'universal', '.dmg', 'Signed and notarized macOS release coming soon.'],
  ['linux', 'x64', '.AppImage', 'Linux AppImage and Debian package coming soon.'],
  ['ios', 'app-store', 'App Store', 'TestFlight and App Store release coming soon. No direct IPA download.'],
];

for (const [platform, architecture, fileType, notes] of comingSoon) {
  if (!releases.some((release) => release.platform === platform)) {
    releases.push({
      platform,
      architecture,
      file_type: fileType,
      version,
      url: null,
      sha256: null,
      size: null,
      release_notes: notes,
      minimum_supported_version: minimumSupportedVersion,
      status: 'coming_soon',
    });
  }
}

const manifest = {
  schema_version: 1,
  version,
  published_at: new Date().toISOString(),
  release_notes: releaseNotes,
  minimum_supported_version: minimumSupportedVersion,
  releases,
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
await fs.writeFile(path.join(path.dirname(output), 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`);
