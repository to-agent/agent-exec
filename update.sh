#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "agent-exec updater"
echo "------------------"

# --- node / npm check ---
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is required. https://nodejs.org"
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo "Error: npm is required. https://nodejs.org"
  exit 1
fi

# --- npm install -g latest ---
echo "Updating @to-agent/agent-exec ..."
npm install -g @to-agent/agent-exec@latest

# --- rebuild local package cache when this script is run from a package checkout ---
echo "Rebuilding SKILL cache ..."
(cd "$ROOT_DIR" && node -e "require('./modules/convert').buildAllCache()") 2>/dev/null || true

# --- show version ---
echo ""
aexec version
echo ""
echo "After changing restart-required settings or plugins, run:"
echo "  aexec restart"
echo ""
