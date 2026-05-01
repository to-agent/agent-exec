# SKILL: claude-code
# Endpoint: POST /api/exec
# Description: Claude Code — Anthropic's AI coding agent CLI

## Overview

Use Claude Code through `POST /api/exec`.

For autonomous agents, use `-p` / `--print` so Claude prints a response and exits.

```json
{"args": ["claude", "-p", "your task here"]}
```

## Agent Usage

Recommended one-shot call:

```json
{"args": ["claude", "-p", "your task here", "--output-format", "json"]}
```

Continue the most recent session:

```json
{"args": ["claude", "--continue", "-p", "follow-up task", "--output-format", "json"]}
```

Resume a specific session:

```json
{"args": ["claude", "--resume", "<session-id>", "-p", "follow-up task", "--output-format", "json"]}
```

## Known Gotchas

- Do not call bare `claude` for automation; it starts an interactive session.
- Use `-p` / `--print` for non-interactive output.
- Use `--output-format json` when the caller needs structured metadata.
- `--dangerously-skip-permissions` bypasses permission checks; use only in a trusted sandbox.
- Resume flags depend on existing Claude Code session history.

## Key Flags

| Flag | Description |
|---|---|
| `-p`, `--print` | Non-interactive mode; print response and exit |
| `--output-format <fmt>` | `text`, `json`, or `stream-json` |
| `--continue` | Continue the most recent conversation |
| `--resume <id>` | Resume a specific session |
| `--model <model>` | Override model |
| `--permission-mode <mode>` | Select permission behavior |

## Detailed Documentation

- [usage](references/usage.md) — Non-interactive usage and session flags
