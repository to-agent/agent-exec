# SKILL: acl
# Endpoint: GET /api/acl
# Description: Get the access control list for exec

## Overview

Use `/api/acl` to see which commands are allowed or denied on this server.
Requires an API key.

## Request

```bash
curl -X GET http://<host>/api/acl \
  -H "X-API-Key: <key>"
```

## Response

```json
{
  "allow": ["aexec --version", "hermes *", "claude *"],
  "deny": ["/^sudo/", "/rm\\s+-rf/", "/--yolo/"]
}
```

## Pattern types

| Pattern | Example | Match |
|---|---|---|
| String | `"aexec --version"` | Exact match for this command and argument |
| Glob | `"hermes *"` | Explicit wildcard match; allows any arguments to `hermes` |
| Regexp | `"/^sudo/"` | Regex match against full args string |

`deny` is evaluated before `allow`. If a command matches both, it is denied.
A rule like `cmd *` allows any arguments to `cmd`; treat broad glob rules as host policy, not agent permission to assume safety.

## Next step

Once you know which commands are allowed, use `POST /api/exec` to execute them.
See `/skills/exec/SKILL.md` for details.
