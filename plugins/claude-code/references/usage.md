# claude — Usage Reference

## Non-interactive Mode

```json
{"args": ["claude", "-p", "your task"]}
{"args": ["claude", "-p", "your task", "--output-format", "json"]}
{"args": ["claude", "-p", "your task", "--output-format", "stream-json"]}
```

## Session Management

```json
{"args": ["claude", "--continue", "-p", "follow-up"]}
{"args": ["claude", "--resume", "<session-id>", "-p", "follow-up"]}
```

## Useful Flags

| Flag | Description |
|---|---|
| `-p`, `--print` | Print response and exit |
| `--output-format json` | Return JSON result |
| `--output-format stream-json` | Return streaming JSON events |
| `--model <model>` | Override model |
| `--permission-mode <mode>` | Select permission mode |
| `--system-prompt <prompt>` | Override system prompt |
| `--append-system-prompt <prompt>` | Add to system prompt |

## Gotchas

Bare `claude` is interactive. Use `-p` for agent-exec automation.
