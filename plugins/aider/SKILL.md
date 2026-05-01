# SKILL: aider
# Endpoint: POST /api/exec
# Description: Aider — AI pair programming in your terminal

## Overview

Aider is an AI pair programming tool. Run via `POST /api/exec`:

```json
{"args": ["aider", "--message", "<prompt>"]}
```

## Key Flags

| Flag | Description |
|---|---|
| `--message <msg>` / `-m` | Send a message and exit |
| `--model <model>` | Specify model |
| `--yes` | Auto-confirm all prompts |
| `--no-git` | Run without git integration |

## Recommended for Agents

```json
{"args": ["aider", "--message", "your task", "--yes", "--no-git"]}
```

## Detailed Documentation

- [usage](references/usage.md) — Full flag reference
