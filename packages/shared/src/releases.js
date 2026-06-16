function displaySize(bytes) {
  if (!Number.isFinite(bytes)) return null;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function assetDetails(name) {
  if (/^QuickPOS-Setup-.*\.exe$/i.test(name)) {
    return { platform: 'windows', architecture: 'x64', file_type: '.exe', signature_status: 'unsigned' };
  }
  if (/^QuickPOS-.*\.apk$/i.test(name)) {
    return { platform: 'android', architecture: 'universal', file_type: '.apk', signature_status: 'signed' };
  }
  if (/^QuickPOS-.*\.dmg$/i.test(name)) {
    return {
      platform: 'macos',
      architecture: name.includes('universal')
        ? 'universal'
        : name.includes('arm64') ? 'arm64' : 'x64',
      file_type: '.dmg',
      signature_status: 'unsigned_preview',
    };
  }
  if (/^QuickPOS-.*\.AppImage$/i.test(name)) {
    return { platform: 'linux', architecture: 'x64', file_type: '.AppImage', signature_status: 'checksum' };
  }
  if (/^QuickPOS-.*\.deb$/i.test(name)) {
    return { platform: 'linux', architecture: 'x64', file_type: '.deb', signature_status: 'checksum' };
  }
  return null;
}

export function manifestFromGitHubRelease(release, iosWebUrl = 'https://quickposs.vercel.app') {
  const version = String(release.tag_name || release.name || '').replace(/^v/, '').replace(/^QuickPOS\s+/i, '');
  if (!version) return null;

  const releaseNotes = `QuickPOS ${version} multi-platform release`;
  const releases = (release.assets || []).flatMap((asset) => {
    const details = assetDetails(asset.name);
    if (!details) return [];
    return [{
      ...details,
      version,
      url: asset.browser_download_url,
      sha256: asset.digest?.replace(/^sha256:/, '') || null,
      size: asset.size,
      size_display: displaySize(asset.size),
      release_notes: releaseNotes,
      minimum_supported_version: version,
      status: 'available',
    }];
  });

  releases.push({
    platform: 'ios',
    architecture: 'web',
    file_type: 'PWA',
    signature_status: 'web',
    version,
    url: iosWebUrl,
    sha256: null,
    size: null,
    size_display: 'No download required',
    release_notes: 'Open QuickPOS in Safari and choose Add to Home Screen. Native App Store distribution will follow.',
    minimum_supported_version: version,
    status: 'available',
  });

  return {
    schema_version: 1,
    version,
    published_at: release.published_at,
    release_notes: releaseNotes,
    minimum_supported_version: version,
    releases,
  };
}
