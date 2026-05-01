# SKILL: gemini
# Endpoint: POST /api/exec
# Description: Gemini CLI — Google's AI agent for the terminal

## Overview

Use Gemini CLI through `POST /api/exec`.

For autonomous agents, use `-p` to pass a prompt non-interactively.

```json
{"args": ["gemini", "-p", "your task here"]}
```

## Agent Usage

Recommended one-shot call:

```json
{"args": ["gemini", "-p", "your task here"]}
```

With model override:

```json
{"args": ["gemini", "-p", "your task here", "--model", "gemini-2.5-pro"]}
```

Auto-approval mode, only when the machine policy allows it:

```json
{"args": ["gemini", "-p", "your task here", "--yolo"]}
```

## Known Gotchas

- Do not call bare `gemini` for automation; it may start an interactive flow.
- Use `-p` for non-interactive tasks.
- `--yolo` auto-approves actions and should be treated as dangerous.
- Long-running agent tasks may hit the server timeout. Prefer smaller tasks or stream mode.
- Verify installed Gemini CLI flags with `gemini --help`.

## Key Commands

```json
{"args": ["gemini", "--version"]}
{"args": ["gemini", "--help"]}
{"args": ["gemini", "-p", "Summarize this machine's SKILL.md"]}
```

## Detailed Documentation

- [usage](references/usage.md) — Basic non-interactive usage
