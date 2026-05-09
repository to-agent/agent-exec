#!/usr/bin/env bash
set -e

echo ""
echo "agent-exec installer"
echo "--------------------"

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
echo "Installing @to-agent/agent-exec ..."
npm install -g @to-agent/agent-exec@latest

echo ""
echo "Done. Run:"
echo "  aexec setup   — configure API key and settings"
echo "  aexec start   — start the server"
echo "  aexec share   — generate a prompt for another AI agent"
echo ""
echo "Optional:"
echo "  aexec starterkit — detect installed AI tools and generate plugins"
echo "  aexec restart    — reload generated plugins"
echo ""
echo "Security:"
echo "  agent-exec is not a sandbox or SSH replacement."
echo "  Fresh installs only allow: aexec --version"
echo "  Use localhost, VPN, firewall, TLS termination, or another trusted network boundary."
echo ""
