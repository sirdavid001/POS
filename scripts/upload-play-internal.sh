#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_ACCOUNT="$ROOT_DIR/.credentials/google-play-service-account.json"
AAB="$ROOT_DIR/android/app/build/outputs/bundle/release/app-release.aab"

if [[ ! -f "$SERVICE_ACCOUNT" ]]; then
  echo "Missing $SERVICE_ACCOUNT"
  echo "Create a Google Play service-account key JSON, save it there, then run this script again."
  exit 1
fi

if [[ ! -f "$AAB" ]]; then
  echo "Missing $AAB"
  echo "Build the signed bundle first, then run this script again."
  exit 1
fi

cd "$ROOT_DIR"
node scripts/upload-google-play-internal.mjs
