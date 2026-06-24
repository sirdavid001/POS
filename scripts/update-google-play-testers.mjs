#!/usr/bin/env node
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageName = "ng.name.quickpos";
const keyPath = resolve(root, ".credentials/google-play-service-account.json");
const track = process.env.PLAY_TRACK || "alpha";
const googleGroups = (process.env.PLAY_TESTER_GROUPS || "")
  .split(",")
  .map((group) => group.trim())
  .filter(Boolean);

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    throw new Error(`Request failed ${response.status} ${url}\n${detail}`);
  }

  return body;
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
  if (googleGroups.length === 0) {
    throw new Error("Set PLAY_TESTER_GROUPS to one or more Google Group emails, separated by commas.");
  }

  const key = JSON.parse(await readFile(keyPath, "utf8"));
  const token = await getAccessToken(key);
  const authHeaders = { authorization: `Bearer ${token}` };
  const encodedPackage = encodeURIComponent(packageName);

  console.log(`Creating Google Play edit for ${packageName}...`);
  const edit = await requestJson(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodedPackage}/edits`,
    { method: "POST", headers: authHeaders },
  );

  console.log(`Attaching tester groups to ${track}: ${googleGroups.join(", ")}`);
  await requestJson(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodedPackage}/edits/${edit.id}/testers/${track}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({ googleGroups }),
    },
  );

  console.log("Committing edit...");
  const committed = await requestJson(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodedPackage}/edits/${edit.id}:commit`,
    { method: "POST", headers: authHeaders },
  );

  console.log(`Done. Tester groups saved in edit ${committed.id}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
