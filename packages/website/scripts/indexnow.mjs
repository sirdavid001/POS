#!/usr/bin/env node
// Notify IndexNow search engines (Bing, Yandex, Naver, Seznam, Yep) that pages changed.
// Bing's index also feeds DuckDuckGo, Yahoo, Ecosia, ChatGPT search and Microsoft Copilot.
// Google does not use IndexNow; use Search Console for Google.
//
// Run after a production deploy:
//   npm run seo:indexnow -w packages/website            # every URL in the sitemap
//   npm run seo:indexnow -w packages/website -- /pricing /features   # only these paths
//   npm run seo:indexnow -w packages/website -- --dry-run

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const HOST = 'quickpos.com.ng';
const SITE = `https://${HOST}`;
const KEY = '85ff477e323755691efa448a0c445b69';
const KEY_LOCATION = `${SITE}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const paths = args.filter((arg) => arg.startsWith('/'));

async function sitemapUrls() {
  const sitemap = await readFile(resolve(import.meta.dirname, '../public/sitemap.xml'), 'utf8');
  return [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1].trim());
}

async function verifyKeyFile() {
  const response = await fetch(KEY_LOCATION, { redirect: 'manual' });
  const body = (await response.text()).trim();
  if (!response.ok || body !== KEY) {
    throw new Error(
      `Key file ${KEY_LOCATION} returned ${response.status} with unexpected content. Deploy the site first.`,
    );
  }
}

const urlList = paths.length ? paths.map((path) => `${SITE}${path}`) : await sitemapUrls();
if (!urlList.length) throw new Error('No URLs to submit.');

console.log(`IndexNow: ${urlList.length} URL(s) for ${HOST}`);
urlList.forEach((url) => console.log(`  ${url}`));
if (dryRun) process.exit(0);

await verifyKeyFile();
const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
});

// 200 = accepted, 202 = accepted and key validation pending.
if (response.status === 200 || response.status === 202) {
  console.log(`IndexNow accepted the submission (HTTP ${response.status}).`);
} else {
  console.error(`IndexNow rejected the submission (HTTP ${response.status}): ${await response.text()}`);
  process.exit(1);
}
