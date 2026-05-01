# SKILL: acl
# Endpoint: GET /api/acl
# Description: Get the access control list — allowed and denied commands

## Overview

Returns the current ACL configuration: which commands are allowed and which are denied.

```bash
curl -H "X-API-Key: <key>" http://<host>/api/acl
```

## Response

```json
{"allow": ["aexec --version", "hermes *"], "deny": ["/^sudo/", "/rm\\s+-rf/"]}
```

## ACL Pattern Types

| Pattern | Example | Match behavior |
|---|---|---|
| String | `"aexec --version"` | Exact match against `args.join(' ')` |
| Glob | `"hermes *"` | Explicit wildcard match; allows any arguments to `hermes` |
| Regexp | `"/^sudo/"` | Regex match against full `args.join(' ')` string |

`deny` is evaluated before `allow`. A command matching any deny pattern is rejected even if it matches an allow pattern.
A rule like `cmd *` allows any arguments to `cmd`; treat broad glob rules as host policy, not agent permission to assume safety.

## Notes

- ACL matches against `args.join(' ')`
- Plain string patterns are exact matches only
- A plain string deny pattern such as `"rm -rf /"` only blocks the exact joined command string.
- Use explicit glob or regexp deny patterns to cover argument variants, for example `"/\\brm\\b.*(-rf|-fr|--recursive|--force)/"`.

## Authentication

Required: `X-API-Key: <key>`.
