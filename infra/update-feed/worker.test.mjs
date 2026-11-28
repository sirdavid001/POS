/* global Request, Response */
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleUpdateFeed } from './worker.mjs';

const root = 'https://downloads.quickpos.com.ng';
const legacy = 'https://downloads.quickpos.name.ng';
const slug = 'v1.0.12';
const releases = 'https://github.com/sirdavid001/POS/releases/download/' + slug + '/';
const exe = 'QuickPOS-Setup-1.0.12.exe';
const files = ['QuickPOS-1.0.12.apk', 'QuickPOS-1.0.12-arm64.dmg', 'QuickPOS-1.0.12-x86_64.AppImage', exe, 'latest.yml'];
const upstream = {
  tag_name: slug,
  body: '<img src=x onerror=alert(1)>',
  assets: files.map((name) => ({ name, browser_download_url: releases + name, digest: 'sha256:' + 'a'.repeat(64), size: 100 })),
};
const send = (url, method = 'GET', fetcher = mockFetch) => handleUpdateFeed(new Request(url, { method }), fetcher);
async function mockFetch(url) {
  if (url.startsWith('https://api.github.com/')) return Response.json(upstream);
  if (url === releases + 'latest.yml') return new Response('version: 1.0.12\npath: ' + exe + '\n');
  throw new Error('Unexpected upstream request');
}

test('serves the manifest on both existing update hosts, with public CORS and safe release text', async () => {
  for (const host of [root, legacy]) {
    const result = await send(host + '/latest.json');
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), '*');
    const value = await result.json();
    assert.equal(value.version, '1.0.12');
    assert.equal(value.releases.length, 5);
    assert.equal(value.releases.find(item => item.platform === 'ios').file_type, 'PWA');
    assert.equal(value.releases.find(item => item.platform === 'android').sha256.length, 64);
    assert(!JSON.stringify(value).includes('onerror'));
  }
});

test('supports Windows metadata and resolves a versioned download to the official repository', async () => {
  const yaml = await send(root + '/desktop/windows/latest.yml');
  assert.match(await yaml.text(), /^version: 1\.0\.12/);
  for (const name of [exe, exe + '.blockmap']) {
    const result = await send(root + '/desktop/windows/' + name);
    assert.equal(result.status, 302);
    assert.equal(result.headers.get('Location'), releases + name);
  }
});

test('does not accept alternate asset origins, unverified assets, arbitrary paths, or methods', async () => {
  const upstreamBad = { ...upstream, assets: [
    { ...upstream.assets[0], browser_download_url: 'https://example.com/installer' },
    { ...upstream.assets[1], digest: null },
    upstream.assets[3],
  ] };
  const read = await send(root + '/latest.json', 'GET', async () => Response.json(upstreamBad));
  assert.deepEqual((await read.json()).releases.map(x => x.platform), ['windows', 'ios']);
  const unused = () => { throw new Error('Must not fetch upstream'); };
  assert.equal((await send(root + '/desktop/windows/fake.exe', 'GET', unused)).status, 404);
  assert.equal((await send(root + '/latest.json', 'POST', unused)).status, 405);
  assert.equal((await send(root + '/latest.json', 'OPTIONS', unused)).status, 204);
  assert.equal(await (await send(root + '/latest.json', 'HEAD')).text(), '');
});

test('returns a noncacheable retry response on an invalid or unreachable release', async () => {
  const bad = await send(root + '/latest.json', 'GET', async () => Response.json({ ...upstream, prerelease: true }));
  assert.equal(bad.status, 503);
  assert.equal(bad.headers.get('Cache-Control'), 'no-store');
  const offline = await send(root + '/latest.json', 'GET', async () => { throw new Error('offline'); });
  assert.equal(offline.status, 503);
});
