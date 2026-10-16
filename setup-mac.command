#!/bin/bash
# One-step installer for Youth Programme Studio on macOS.
# Run from Terminal:  bash setup-mac.command
set -e
cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is needed to build the app (one-time)."
  echo "Download the LTS installer from https://nodejs.org, install it, then run this script again."
  open "https://nodejs.org/en/download" || true
  exit 1
fi

echo "Installing dependencies (first run takes a minute)…"
npm install --no-audit --no-fund

echo "Building Youth Programme Studio.app…"
npm run build:app

APP=$(find dist -maxdepth 2 -name "Youth Programme Studio.app" -type d | head -1)
if [ -z "$APP" ]; then echo "Build failed: app not found in dist/"; exit 1; fi

echo "Copying to /Applications…"
rm -rf "/Applications/Youth Programme Studio.app"
ditto "$APP" "/Applications/Youth Programme Studio.app"

echo "Done. Opening Youth Programme Studio."
open "/Applications/Youth Programme Studio.app"
