#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

tracked_env_files="$(
  git ls-files \
    | grep -E '(^|/)\.env($|\.)' \
    | grep -Ev '(^|/)\.env\.example$|^packages/client/\.env\.production$' || true
)"

if [[ -n "$tracked_env_files" ]]; then
  echo "Tracked environment files detected:"
  printf '%s\n' "$tracked_env_files"
  exit 1
fi

secret_matches="$(
  git grep -nE 'sk_live_[A-Za-z0-9]{10,}|pk_live_[A-Za-z0-9]{10,}|npg_[A-Za-z0-9]{10,}|postgresql://[^[:space:]]+neon\.tech' -- \
    . \
    ':(exclude).env.example' \
    ':(exclude)package-lock.json' \
    ':(exclude)packages/client/.env.production' || true
)"

if [[ -n "$secret_matches" ]]; then
  echo "Potential live credentials detected in tracked files:"
  printf '%s\n' "$secret_matches"
  exit 1
fi

echo "No tracked environment files or live credentials detected."
