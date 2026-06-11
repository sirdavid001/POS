import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import config from '../../config/index.js';
import { manifestFromGitHubRelease } from '../../../../shared/src/releases.js';

const router = Router();

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Release source returned HTTP ${response.status}`);
  }
  return response.json();
}

async function loadReleaseManifest() {
  const manifestUrl = config.downloads.manifestUrl;
  if (manifestUrl) {
    try {
      return await fetchJson(manifestUrl);
    } catch {
      // Fall through to GitHub release discovery.
    }
  }

  const release = await fetchJson(config.downloads.githubLatestReleaseUrl);
  const manifest = manifestFromGitHubRelease(release, config.downloads.iosWebUrl);
  if (!manifest) {
    throw new Error('Release manifest unavailable');
  }
  return manifest;
}

router.use(authenticate);

router.get('/manifest', authorize('admin'), async (req, res, next) => {
  try {
    if (!req.subscription?.can_write || req.subscription?.activation_required) {
      return res.status(402).json({
        error: req.subscription?.activation_required
          ? 'Complete store activation before downloading QuickPOS.'
          : 'Renew your QuickPOS subscription before downloading the app.',
        code: req.subscription?.activation_required
          ? 'INITIAL_ACTIVATION_REQUIRED'
          : 'SUBSCRIPTION_EXPIRED',
        subscription: req.subscription,
      });
    }

    const manifest = await loadReleaseManifest();
    res.json(manifest);
  } catch (error) {
    next(error);
  }
});

export default router;
