# SKILL: hermes
# Endpoint: POST /api/exec
# Command: hermes
# Description: Hermes — multi-agent AI assistant with chat, sessions, and plugin support

## Overview

Use Hermes through `POST /api/exec`.

For autonomous agents, use `hermes chat -q` for a single non-interactive query.

```json
{"args": ["hermes", "chat", "-q", "your task here"]}
```

## Agent Usage

Recommended one-shot call:

```json
{"args": ["hermes", "chat", "-q", "your task here", "-Q"]}
```

Resume the most recent session:

```json
{"args": ["hermes", "chat", "--continue", "-q", "follow-up task", "-Q"]}
```

Resume by session ID:

```json
{"args": ["hermes", "chat", "--resume", "<session-id>", "-q", "follow-up task", "-Q"]}
```

Auto-approval mode, only when the machine policy allows it:

```json
{"args": ["hermes", "chat", "-q", "your task here", "-Q", "--yolo"]}
```

## Known Gotchas

- Do not call bare `hermes` for automation; it starts interactive chat.
- Use `chat -q` for a single query.
- Use `-Q` / `--quiet` when the caller needs cleaner output.
- `--yolo` bypasses dangerous-command prompts and should be treated as dangerous.
- Resume flags depend on existing Hermes session history.

## Key Commands

```json
{"args": ["hermes", "--version"]}
{"args": ["hermes", "status"]}
{"args": ["hermes", "chat", "-q", "Hello", "-Q"]}
{"args": ["hermes", "sessions", "list"]}
```

## Detailed Documentation

- [commands](references/commands.md) — Command overview
- [chat](references/chat.md) — Non-interactive chat usage
- [sessions](references/sessions.md) — Session management
