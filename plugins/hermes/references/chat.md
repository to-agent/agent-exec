# hermes chat — Reference

## Basic Usage

```bash
# Single query (non-interactive)
{"args": ["hermes", "chat", "-q", "Write a hello world in Python"]}

# With specific model
{"args": ["hermes", "chat", "-q", "Hello", "-m", "anthropic/claude-sonnet-4"]}

# Resume most recent session
{"args": ["hermes", "chat", "--continue"]}

# Resume by name
{"args": ["hermes", "chat", "--continue", "my project"]}

# Resume by ID
{"args": ["hermes", "chat", "--resume", "<session_id>"]}

# Quiet mode (suppress banner/spinner, output final response only)
{"args": ["hermes", "chat", "-q", "Hello", "-Q"]}

# Skip confirmation prompts (automation)
{"args": ["hermes", "chat", "-q", "Delete all .tmp files", "--yolo"]}
```

## Key Flags

| Flag | Description |
|---|---|
| `-q <message>` | Single query mode (non-interactive) |
| `-Q` / `--quiet` | Suppress banner/spinner, output response only |
| `-m <model>` | Override model (e.g. `anthropic/claude-sonnet-4`) |
| `--continue` / `-c` | Resume most recent session |
| `--resume <id>` / `-r` | Resume specific session by ID |
| `--worktree` / `-w` | Run in isolated git worktree |
| `--yolo` | Skip dangerous command approval prompts |
| `--max-turns N` | Max tool-calling iterations (default: 90) |

## Providers

`auto`, `anthropic`, `openai-codex`, `openrouter`, `gemini`, `copilot`, and more.

```bash
{"args": ["hermes", "chat", "-q", "Hello", "--provider", "anthropic"]}
```

## Recommended for Agents

Use `-q` + `-Q` for clean programmatic output:
```json
{"args": ["hermes", "chat", "-q", "your task here", "-Q"]}
```
