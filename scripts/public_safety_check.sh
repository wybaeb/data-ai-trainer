#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

echo "Running public repo safety check in ${ROOT_DIR}"

PATTERN='(AIza[0-9A-Za-z_-]{35}|ghp_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|-----BEGIN (RSA|EC|OPENSSH|PRIVATE KEY)-----|oauth_token|refresh_token|client_secret|aws_secret_access_key|AIzaSy)'

if rg -n -i --hidden \
  --glob '!.git' \
  --glob '!node_modules' \
  --glob '!.github/workflows/*' \
  --glob '!scripts/public_safety_check.sh' \
  "${PATTERN}" .; then
  echo
  echo "Potential secret-like content found. Review before publishing."
  exit 1
fi

echo "No obvious secret patterns found."
