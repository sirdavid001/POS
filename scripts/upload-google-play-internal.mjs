#!/usr/bin/env node
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageName = "ng.name.quickpos";
const keyPath = resolve(root, ".credentials/google-play-service-account.json");
const aabPath = resolve(root, "android/app/build/outputs/bundle/release/app-release.aab");
const track = process.env.PLAY_TRACK || "internal";
const releaseName = process.env.PLAY_RELEASE_NAME || "1.0.2";
const existingVersionCode = process.env.PLAY_VERSION_CODE;
const skipUpload = process.env.PLAY_SKIP_UPLOAD === "1" || process.env.PLAY_SKIP_UPLOAD === "true";
const releaseNotes =
  process.env.PLAY_RELEASE_NOTES ||
  "Updated store listing and app configuration for QuickPOS.";
const releaseStatus = process.env.PLAY_RELEASE_STATUS || "draft";

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function requestJson(url, options = {}) {
  return request(url, options).then(({ status, text }) => {
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (status < 200 || status >= 300) {
      const detail = typeof body === "string" ? body : JSON.stringify(body, null, 2);
      throw new Error(`Request failed ${status} ${url}\n${detail}`);
    }

    return body;
  });
}

function request(url, options = {}) {
  return new Promise((resolveRequest, reject) => {
    const req = fetch(url, options);
    req.then(async (response) => {
      resolveRequest({ status: response.status, text: await response.text() });
    }).catch(reject);
  });
}

async function getAccessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key);
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const token = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });

  return token.access_token;
}

async function main() {
  const key = JSON.parse(await readFile(keyPath, "utf8"));
  const token = await getAccessToken(key);
  const authHeaders = { authorization: `Bearer ${token}` };
  const encodedPackage = encodeURIComponent(packageName);

  console.log(`Creating Google Play edit for ${packageName}...`);
  const edit = await requestJson(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodedPackage}/edits`,
    { method: "POST", headers: authHeaders },
  );

  let versionCode = existingVersionCode;
  if (!skipUpload) {
    console.log(`Uploading ${basename(aabPath)}...`);
    const aab = await readFile(aabPath);
    const bundle = await requestJson(
      `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${encodedPackage}/edits/${edit.id}/bundles?uploadType=media`,
      {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/octet-stream",
          "content-length": String(aab.length),
        },
        body: aab,
      },
    );
    versionCode = String(bundle.versionCode);
  }

  if (!versionCode) {
    throw new Error("Set PLAY_VERSION_CODE when PLAY_SKIP_UPLOAD is enabled.");
  }

  console.log(`Updating ${track} track to version code ${versionCode}...`);
  await requestJson(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodedPackage}/edits/${edit.id}/tracks/${track}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        track,
        releases: [
          {
            name: releaseName,
            versionCodes: [versionCode],
            status: releaseStatus,
            releaseNotes: [{ language: "en-GB", text: releaseNotes }],
          },
        ],
      }),
    },
  );

  console.log("Committing edit...");
  const committed = await requestJson(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodedPackage}/edits/${edit.id}:commit`,
    { method: "POST", headers: authHeaders },
  );

  console.log(`Done. Edit ${committed.id} committed with release status "${releaseStatus}".`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
