# SKILL: exec
# Endpoint: POST /api/exec
# Description: Execute a command on this machine

## Overview

Execute a command via `POST /api/exec`. The command must be in the `exec.allow` list and must not match `exec.deny`.

## Request

```bash
curl -X POST http://<host>/api/exec \
  -H "X-API-Key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"args": ["aexec", "--version"]}'
```

### Body

| Field | Type | Description |
|---|---|---|
| `args` | array | Command and arguments: `["cmd", "arg1", "arg2"]` — **required** |

No other body fields are accepted. `cmd`, `command`, `env`, `cwd`, and `shell` return HTTP 400.

### Query Parameters

| Parameter | Values | Default | Description |
|---|---|---|---|
| `format` | `json`, `text` | `json` | Response format |
| `mode` | `buffered`, `stream` | `buffered` | Execution mode. `stream` is direct-command only and is rejected for plugin commands. |

## Response

### buffered + format=json

```json
{"output": "agent-exec v0.1.0\n", "length": 20, "exitCode": 0, "status": "done", "duration": 3}
```

### stream + format=json

Use streaming only for direct commands. If the command is handled by a plugin, use buffered mode or a plugin-specific `/api/command/:name/*` route.

NDJSON — one JSON object per line:

```
{"output":"line1\n","length":6,"status":"running"}
{"output":null,"exitCode":0,"status":"done","duration":42}
```

## ACL

Commands are checked against server-side ACL rules before execution. `exec.deny` is evaluated before `exec.allow`.
Plain string patterns are exact matches only. Glob patterns may use `*`, and regexp patterns use `/.../` when the host intentionally wants broader matching.
A rule like `cmd *` allows any arguments to `cmd`; treat broad glob rules as host policy, not agent permission to assume safety.

agent-exec executes `args` as argv. It does not run commands through a shell, and command/args are not accepted from the query string.
Shell metacharacters such as `&&`, `;`, and `|` are not interpreted by agent-exec itself.

Check allowed commands with `GET /api/acl`. Denied commands return HTTP 403.

## Authentication

Required: `X-API-Key: <API_KEY>`.
