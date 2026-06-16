export function detectPlatform() {
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes('android')) return 'android';
  if (agent.includes('windows')) return 'windows';
  if (agent.includes('mac')) return 'macos';
  if (agent.includes('linux')) return 'linux';
  return null;
}

const platformDetails = {
  windows: {
    label: 'Windows',
    description: 'Windows 10 or later · 64-bit',
    installLabel: 'Run the setup file',
    installSteps: ['Download the signed setup file', 'Open the installer and approve Windows prompts', 'Launch QuickPOS and sign in'],
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4.8 10.7 3.7v7.4H3V4.8Zm8.8-1.3L21 2.2v8.9h-9.2V3.5ZM3 12.2h7.7v7.4L3 18.5v-6.3Zm8.8 0H21v8.9l-9.2-1.3v-7.6Z"/></svg>',
  },
  android: {
    label: 'Android',
    description: 'Android 8 or later · Signed APK',
    installLabel: 'Install the APK',
    installSteps: ['Download the verified APK', 'Allow installation when Android asks', 'Open QuickPOS and sign in'],
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7.3 5.8-1.2-2a.7.7 0 0 1 1.2-.7l1.2 2a8.6 8.6 0 0 1 7 0l1.2-2a.7.7 0 1 1 1.2.7l-1.2 2a7.1 7.1 0 0 1 3.1 5.5H4.2a7.1 7.1 0 0 1 3.1-5.5ZM8.2 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm7.6 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM4.2 12.5h15.6v7a2.3 2.3 0 0 1-2.3 2.3h-11a2.3 2.3 0 0 1-2.3-2.3v-7Z"/></svg>',
  },
  macos: {
    label: 'macOS',
    description: 'DMG previews for Intel and Apple silicon',
    installLabel: 'Mount the DMG',
    installSteps: ['Download the DMG for your Mac', 'Drag QuickPOS into Applications', 'Open the app and sign in'],
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.7 12.8c0-2.5 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2.1c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.3 2.5 1.3-.1 1.8-.8 3.4-.8s2 .8 3.4.8c1.4 0 2.3-1.2 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.9-1.1-2.9-3.8ZM14.1 5.1c.7-.9 1.2-2.1 1.1-3.3-1.1 0-2.4.7-3.2 1.6-.7.8-1.3 2-1.1 3.2 1.2.1 2.4-.6 3.2-1.5Z"/></svg>',
  },
  linux: {
    label: 'Linux',
    description: 'AppImage and Debian package',
    installLabel: 'Choose a package',
    installSteps: ['Download AppImage or Debian package', 'Mark AppImage executable if needed', 'Open QuickPOS and sign in'],
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c-2.2 0-3.8 2.2-3.8 5.3 0 1-.2 1.8-.8 2.7-1.5 2-2.4 4.1-2.1 6.2.2 1.5 1.1 2.3 2.2 2.3.7 0 1.3-.3 1.8-.7.8.9 1.7 1.4 2.7 1.4s1.9-.5 2.7-1.4c.5.4 1.1.7 1.8.7 1.1 0 2-.8 2.2-2.3.3-2.1-.6-4.2-2.1-6.2-.6-.9-.8-1.7-.8-2.7C15.8 4.2 14.2 2 12 2Zm-1.4 5.1c-.5 0-.9-.5-.9-1.1s.4-1.1.9-1.1.9.5.9 1.1-.4 1.1-.9 1.1Zm2.8 0c-.5 0-.9-.5-.9-1.1s.4-1.1.9-1.1.9.5.9 1.1-.4 1.1-.9 1.1Z"/></svg>',
  },
};

export const utilityIcons = {
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Zm-3 9 2 2 4-5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>',
  hash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 3-2 18m8-18-2 18M4 9h17M3 15h17" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"/></svg>',
  update: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5m10.2-3A8 8 0 0 0 5.5 6M4.8 15A8 8 0 0 0 18.5 18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>',
};

function releaseVariantLabel(platform, release) {
  if (platform === 'macos') {
    if (release.architecture === 'arm64') return 'Apple silicon Mac';
    if (release.architecture === 'universal') return 'Universal Mac';
    return 'Intel Mac';
  }
  if (platform === 'linux') return release.file_type === '.deb' ? 'Debian' : 'AppImage';
  if (platform === 'android') return 'APK';
  if (platform === 'windows') return 'Windows';
  return release.file_type || release.architecture || 'Download';
}

export function renderReleaseDownloads(target, manifest, { onDownloadClick } = {}) {
  const detected = detectPlatform();
  const platforms = ['windows', 'android', 'macos', 'linux'];

  const releaseGroups = new Map();
  (manifest.releases || []).forEach((release) => {
    const group = releaseGroups.get(release.platform) || [];
    group.push(release);
    releaseGroups.set(release.platform, group);
  });

  const preferredRelease = (platform) => {
    const group = releaseGroups.get(platform) || [];
    const preferredTypes = {
      windows: ['.exe'],
      android: ['.apk'],
      macos: ['.dmg'],
      linux: ['.AppImage', '.deb'],
    };
    return preferredTypes[platform]
      ?.map((type) => group.find((release) => release.file_type === type))
      .find(Boolean) || group[0];
  };

  const availablePlatforms = platforms.filter((platform) => {
    const release = preferredRelease(platform);
    return release?.status === 'available' && release.url;
  });
  const primaryPlatform = availablePlatforms.includes(detected) ? detected : availablePlatforms[0];
  const primaryRelease = preferredRelease(primaryPlatform);
  const upcomingPlatforms = platforms.filter((platform) => !availablePlatforms.includes(platform));

  if (!primaryPlatform || !primaryRelease) {
    target.innerHTML = `
      <div class="release-error">
        <span class="platform-icon">${utilityIcons.update}</span>
        <div><h3>No installer is published yet</h3><p>Your account is active. Contact support and we will send the current official installer as soon as it is available.</p></div>
        <a class="button button-secondary" href="/support">Contact support</a>
      </div>
    `;
    return;
  }

  const availableCards = availablePlatforms
    .filter((platform) => platform !== primaryPlatform)
    .map((platform) => {
      const release = preferredRelease(platform);
      const platformReleases = (releaseGroups.get(platform) || [])
        .filter((item) => item.status === 'available' && item.url);
      const detail = platformDetails[platform];
      const status = release.signature_status === 'unsigned_preview'
        ? 'Unsigned preview'
        : release.signature_status === 'signed' ? 'Signed' : release.file_type;
      const actions = platformReleases.map((item) => {
        const actionLabel = releaseVariantLabel(platform, item);
        return `
          <a class="compact-download-action download-link" href="${item.url}" aria-label="${actionLabel} QuickPOS for ${detail.label}" data-platform="${platform}" data-version="${item.version}">
            ${actionLabel}
          </a>
        `;
      }).join('');
      return `
        <article class="compact-download-card">
          <span class="platform-icon">${detail.icon}</span>
          <div><strong>${detail.label}</strong><span>Version ${release.version} · ${status || release.architecture || 'Release'}</span></div>
          <div class="compact-download-actions">${actions}</div>
        </article>
      `;
    }).join('');

  const roadmapCards = upcomingPlatforms.map((platform) => {
    const detail = platformDetails[platform];
    return `
      <article class="roadmap-card ${detected === platform ? 'detected' : ''}">
        <span class="platform-icon">${detail.icon}</span>
        <div><strong>${detail.label}</strong><span>${detail.description}</span></div>
        <span class="coming-badge">Coming soon</span>
      </article>
    `;
  }).join('');

  const primaryDetail = platformDetails[primaryPlatform];
  const releaseBadge = primaryRelease.signature_status === 'signed'
    ? `${utilityIcons.shield} Signed release`
    : primaryRelease.signature_status === 'unsigned_preview'
      ? `${utilityIcons.shield} Unsigned preview`
      : `${utilityIcons.shield} Checksum verified`;
  const primaryAction = primaryPlatform === 'macos'
      ? `Download for ${releaseVariantLabel(primaryPlatform, primaryRelease)}`
      : `Download for ${primaryDetail.label}`;
  const primaryCopy = `${primaryDetail.description}. Install the complete POS application and sign in with the same owner account.`;
  const alternateDownloads = (releaseGroups.get(primaryPlatform) || [])
    .filter((release) => release !== primaryRelease && release.status === 'available' && release.url)
    .map((release) => `
      <a class="alternate-download download-link" href="${release.url}" data-platform="${primaryPlatform}" data-version="${release.version}">
        ${utilityIcons.download} ${releaseVariantLabel(primaryPlatform, release)} (${release.file_type})
      </a>
    `).join('');
  const integrityText = primaryRelease.sha256
      ? 'SHA-256 checksum included in release details'
      : 'Versioned official installer';
  const installSteps = primaryDetail.installSteps
    .map((step, index) => `
      <li>
        <span>${index + 1}</span>
        <p>${step}</p>
      </li>
    `).join('');

  target.innerHTML = `
    <div class="download-showcase">
      <article class="primary-download-card">
        <div class="primary-card-top">
          <div class="installer-identity">
            <span class="platform-icon platform-icon-large">${primaryDetail.icon}</span>
            <div>
              <span>Detected installer</span>
              <strong>${primaryDetail.label}</strong>
            </div>
          </div>
          <span class="verified-badge">${releaseBadge}</span>
        </div>
        <div class="primary-card-copy">
          <span class="recommended-label">${detected === primaryPlatform ? 'Recommended for this device' : 'Available now'}</span>
          <h2>QuickPOS for ${primaryDetail.label}</h2>
          <p>${primaryCopy}</p>
        </div>
        <div class="installer-steps" aria-label="${primaryDetail.label} installation steps">
          <div>
            <span class="section-kicker">${primaryDetail.installLabel}</span>
            <strong>Install in three steps</strong>
          </div>
          <ol>${installSteps}</ol>
        </div>
        <div class="release-meta">
          <span><small>Version</small><strong>${primaryRelease.version}</strong></span>
          <span><small>File</small><strong>${primaryRelease.file_type || 'Installer'} · ${primaryRelease.architecture || 'universal'}</strong></span>
          <span><small>Size</small><strong>${primaryRelease.size_display || 'See download'}</strong></span>
        </div>
        <a class="button primary-download-button download-link" href="${primaryRelease.url}" data-platform="${primaryPlatform}" data-version="${primaryRelease.version}">
          ${utilityIcons.download} ${primaryAction}
        </a>
        ${alternateDownloads ? `<div class="alternate-downloads"><span>Other format</span>${alternateDownloads}</div>` : ''}
        ${primaryRelease.signature_status === 'unsigned_preview' ? '<p class="release-warning">macOS may block this preview because it is not yet signed or notarized. Open Privacy & Security to approve it manually.</p>' : ''}
        <div class="installer-assurance">
          <span>${utilityIcons.hash}<strong>${integrityText}</strong></span>
          <span>${utilityIcons.update}<strong>Updates handled inside the installed app</strong></span>
        </div>
      </article>
      <aside class="platform-panel">
        <div class="platform-panel-header">
          <span class="section-kicker">Device center</span>
          <h3>Install QuickPOS on every store device.</h3>
          <p>Use the official build for each register, tablet, or back-office computer. Staff sign in after the app is installed.</p>
        </div>
        ${availableCards ? `<div class="platform-panel-group"><div class="panel-title"><span>Other available builds</span><small>Direct download</small></div>${availableCards}</div>` : ''}
        <div class="platform-panel-group platform-roadmap">
          <div class="panel-title"><span>Platform roadmap</span><small>In development</small></div>
          <div class="roadmap-list">${roadmapCards}</div>
        </div>
        <a class="support-link" href="/support">Need installation help?<span>Contact support →</span></a>
      </aside>
    </div>
  `;

  target.querySelectorAll('.download-link').forEach((link) => {
    link.addEventListener('click', () => {
      onDownloadClick?.({
        platform: link.dataset.platform,
        version: link.dataset.version,
      });
    });
  });
}
