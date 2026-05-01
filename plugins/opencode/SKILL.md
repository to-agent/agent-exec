# SKILL: opencode
# Endpoint: POST /api/exec
# Description: OpenCode — AI coding agent built for the terminal

## Overview

Use OpenCode through `POST /api/exec`.

For autonomous agents, use `opencode run` because it accepts a message and exits.

```json
{"args": ["opencode", "run", "your task here"]}
```

## Agent Usage

Recommended one-shot call:

```json
{"args": ["opencode", "run", "your task here", "--format", "json"]}
```

Continue the last session:

```json
{"args": ["opencode", "run", "--continue", "follow-up task", "--format", "json"]}
```

Resume a specific session:

```json
{"args": ["opencode", "run", "--session", "<session-id>", "follow-up task", "--format", "json"]}
```

## Known Gotchas

- Do not call bare `opencode` for automation; it starts the TUI.
- Use `opencode run` for non-interactive tasks.
- Use `--format json`, not `-f json`; `-f` is for files.
- `--dangerously-skip-permissions` auto-approves permissions and should be treated as dangerous.
- Resume flags depend on existing OpenCode session history.

## Key Flags

| Flag | Description |
|---|---|
| `run <message>` | Run with a message |
| `--format json` | Output raw JSON events |
| `-m`, `--model <model>` | Specify model |
| `--continue` / `-c` | Continue last session |
| `--session` / `-s` | Continue specific session ID |
| `--dangerously-skip-permissions` | Auto-approve permissions; dangerous |

## Detailed Documentation

- [usage](references/usage.md) — Non-interactive usage and session flags
