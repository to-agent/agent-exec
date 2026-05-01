# gemini — Usage Reference

## Non-interactive Mode

```json
{"args": ["gemini", "-p", "your task"]}
{"args": ["gemini", "-p", "your task", "--model", "gemini-2.5-pro"]}
```

## Important Flags

| Flag | Description |
|---|---|
| `-p <prompt>` | Non-interactive prompt |
| `--model <model>` | Override model |
| `--yolo` | Auto-approve actions; dangerous |

## Gotchas

Use `gemini --help` on the target machine to confirm the installed version and
available flags.
