# SKILL: codex
# Endpoint: POST /api/exec
# Description: OpenAI Codex CLI — AI coding agent by OpenAI

## Overview

Use Codex through `POST /api/exec`.

For autonomous agents, prefer `codex exec` because it is the non-interactive
entry point. Pass the task as an argument.

```json
{"args": ["codex", "exec", "Explain this repository"]}
```

## Agent Usage

Recommended one-shot call:

```json
{"args": ["codex", "exec", "--skip-git-repo-check", "your task here"]}
```

Low-friction sandboxed execution:

```json
{"args": ["codex", "exec", "--full-auto", "--skip-git-repo-check", "your task here"]}
```

Dangerous full bypass, only inside an external sandbox:

```json
{"args": ["codex", "exec", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "your task here"]}
```

## Resume / Session

```json
{"args": ["codex", "exec", "resume", "--last", "--skip-git-repo-check", "continue the task"]}
{"args": ["codex", "exec", "resume", "<session-id>", "--skip-git-repo-check", "follow-up task"]}
```

Use resume only when continuing a known Codex session. For a fresh task, prefer
`codex exec "<task>"`.

## Known Gotchas

- Do not call bare `codex` for automation; it starts the interactive TUI.
- Use `codex exec` for one-shot non-interactive tasks.
- Use `codex exec resume`, not bare `codex resume`, when resuming through agent-exec.
- Provide the prompt as an argument. If no prompt is provided, Codex reads from stdin.
- agent-exec closes stdin for spawned commands, so incomplete commands should fail instead of waiting forever.
- Long-running agent tasks may hit the server timeout. Prefer smaller tasks or stream mode.
- `--full-auto` is lower-friction but still sandboxed.
- `--dangerously-bypass-approvals-and-sandbox` is unsafe unless the machine is externally sandboxed.

## Key Commands

```json
{"args": ["codex", "--version"]}
{"args": ["codex", "exec", "--help"]}
{"args": ["codex", "exec", "--skip-git-repo-check", "Summarize package.json"]}
```

## Detailed Documentation

- [usage](references/usage.md) — Non-interactive usage and important flags
