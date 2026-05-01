# opencode — Usage Reference

## Non-interactive Mode

```json
{"args": ["opencode", "run", "your task"]}
{"args": ["opencode", "run", "your task", "--format", "json"]}
{"args": ["opencode", "run", "your task", "--model", "anthropic/claude-sonnet-4-6"]}
```

## Session Management

```json
{"args": ["opencode", "run", "--continue", "follow-up"]}
{"args": ["opencode", "run", "--session", "<session-id>", "follow-up"]}
```

## Important Flags

| Flag | Description |
|---|---|
| `run <message>` | Run opencode with a message |
| `--format json` | Output raw JSON events |
| `--model <model>` / `-m <model>` | Select model |
| `--continue` / `-c` | Continue last session |
| `--session <id>` / `-s <id>` | Continue specific session |
| `--dir <path>` | Set working directory |
| `--dangerously-skip-permissions` | Auto-approve permissions; dangerous |

## Gotchas

`-f` means file attachment. Use `--format json` for JSON output.
