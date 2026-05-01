#!/usr/bin/env bash
set -e

CONFIG_DIR="${AGENT_EXEC_CONFIG_DIR:-$HOME/.to-agent/agent-exec}"

echo ""
echo "agent-exec uninstaller"
echo "----------------------"

# --- npm uninstall -g ---
if command -v npm &>/dev/null; then
  echo "Removing @to-agent/agent-exec ..."
  npm uninstall -g @to-agent/agent-exec
  echo "Removed: @to-agent/agent-exec"
else
  echo "Skipped: npm not found"
fi

# --- optionally remove config dir ---
if [ -d "$CONFIG_DIR" ]; then
  echo ""
  echo "Config dir:"
  echo "  $CONFIG_DIR"
  echo ""
  echo "This may contain API keys, settings, plugins, audit logs, and backups."
  read -p "Remove config dir $CONFIG_DIR ? [y/N] " answer
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    rm -rf "$CONFIG_DIR"
    echo "Removed: $CONFIG_DIR"
  else
    echo "Kept: $CONFIG_DIR"
  fi
else
  echo "Skipped: $CONFIG_DIR (not found)"
fi

echo ""
echo "agent-exec has been uninstalled."
echo ""
