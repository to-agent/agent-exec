# codex — Usage Reference

## Non-interactive Mode

Prefer `codex exec` for agent-exec:

```json
{"args": ["codex", "exec", "your task"]}
{"args": ["codex", "exec", "--skip-git-repo-check", "your task"]}
{"args": ["codex", "exec", "--full-auto", "--skip-git-repo-check", "your task"]}
```

## Important Flags

| Flag | Description |
|---|---|
| `exec` | Run Codex non-interactively |
| `--skip-git-repo-check` | Allow running outside a git repository |
| `--full-auto` | Low-friction sandboxed automatic execution |
| `--dangerously-bypass-approvals-and-sandbox` | Skip approvals and sandboxing; dangerous |
| `--model <model>` / `-m <model>` | Override model |
| `--cd <dir>` / `-C <dir>` | Set working directory |
| `--json` | Print JSONL events |
| `--output-last-message <file>` | Write final message to a file |

## Stdin Behavior

`codex exec` reads instructions from stdin if no prompt argument is provided.
Always pass the task as an argument when using agent-exec.

## Resume

```json
{"args": ["codex", "exec", "resume", "--last", "--skip-git-repo-check", "continue"]}
{"args": ["codex", "exec", "resume", "<session-id>", "--skip-git-repo-check", "follow-up task"]}
```

Resume is session-dependent. Prefer a fresh `codex exec "<task>"` unless you know
which session should be continued.

Use `codex exec resume` through agent-exec. Bare `codex resume` opens the
interactive interface and is not the recommended automation path.
