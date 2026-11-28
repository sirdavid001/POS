# QuickPOS update feed

The Cloudflare Worker serves the HTTPS `/latest.json` path already used by
installed QuickPOS clients on both download subdomains. It reads the latest
stable release from the official GitHub repository, allows only that release's
installer URLs, and retains GitHub's checksums. No credentials are required
by the Worker and no customer data is handled.

The Windows channel also serves `/desktop/windows/latest.yml` and routes
versioned installers and blockmaps to their official release files.

Validate with `node --test infra/update-feed/worker.test.mjs`. Deploy using
`wrangler deploy --config infra/update-feed/wrangler.toml` from the repository
root, with access to the QuickPOS Cloudflare account and both domain zones.
Confirm that the configured download hostnames are unassigned before attaching
them to this Worker.
