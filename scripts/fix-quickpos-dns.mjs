const token = process.env.CLOUDFLARE_API_TOKEN;
const zoneName = 'quickpos.com.ng';

if (!token) {
  console.error('Set CLOUDFLARE_API_TOKEN to a Cloudflare API token with Zone:DNS:Edit for quickpos.com.ng.');
  process.exit(1);
}

async function cf(path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    const message = (json.errors || [])
      .map((error) => `${error.code}: ${error.message}`)
      .join('; ') || `${response.status} ${response.statusText}`;
    throw new Error(`${options.method || 'GET'} ${path} failed: ${message}`);
  }
  return json;
}

async function upsertRecord(zoneId, record) {
  const fqdn = record.name === '@' ? zoneName : `${record.name}.${zoneName}`;
  const existing = await cf(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(fqdn)}&per_page=100`);

  for (const item of existing.result) {
    const matchesTarget = item.type === record.type && item.content === record.content && item.proxied === false;
    if (!matchesTarget) {
      await cf(`/zones/${zoneId}/dns_records/${item.id}`, { method: 'DELETE' });
      console.log(`Deleted conflicting ${item.type} ${item.name} -> ${item.content}`);
    }
  }

  const current = await cf(`/zones/${zoneId}/dns_records?type=${record.type}&name=${encodeURIComponent(fqdn)}&per_page=100`);
  const found = current.result.find((item) => item.content === record.content && item.proxied === false);
  if (found) {
    console.log(`Kept ${record.type} ${fqdn} -> ${record.content}`);
    return;
  }

  await cf(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: record.type,
      name: fqdn,
      content: record.content,
      proxied: false,
      ttl: 1,
    }),
  });
  console.log(`Created ${record.type} ${fqdn} -> ${record.content}`);
}

const zones = await cf(`/zones?name=${zoneName}&per_page=1`);
const zone = zones.result[0];
if (!zone) {
  throw new Error(`Cloudflare zone not found: ${zoneName}`);
}

await upsertRecord(zone.id, { type: 'A', name: '@', content: '76.76.21.21' });
await upsertRecord(zone.id, { type: 'CNAME', name: 'www', content: 'cname.vercel-dns-0.com' });

console.log('DNS records are configured for Vercel.');
