# SKILL: goose
# Endpoint: POST /api/exec
# Description: Goose — Block's open-source extensible AI agent

## Overview

Goose is an open-source AI agent by Block. Run via `POST /api/exec`:

```json
{"args": ["goose", "run", "--text", "<prompt>"]}
```

## Key Flags

| Flag | Description |
|---|---|
| `run --text <prompt>` | Non-interactive mode |
| `run --with-builtin developer` | Enable developer tools |
| `session resume` | Resume last session |

## Recommended for Agents

```json
{"args": ["goose", "run", "--text", "your task", "--with-builtin", "developer"]}
```

## Detailed Documentation

- [usage](references/usage.md) — Full flag reference
