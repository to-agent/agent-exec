# SKILL: agent-exec
# Endpoint: /
# Description: Self-describing HTTP execution surface for AI agents

## What is this?

agent-exec lets an AI agent discover this machine, inspect what is allowed,
and execute only permitted commands through HTTP.

This is the root guide for this running agent-exec server.

## Start

### 1. Inspect allowed operations

Protected API calls require an API key.

```bash
curl -s http://<host>/api/acl \
  -H "X-API-Key: <key>"
```

### 2. Discover plugins

```bash
curl -s http://<host>/api/plugins \
  -H "X-API-Key: <key>"
```

The `skill` URL in the response is the next document to read.

### 3. Execute an allowed command

```bash
curl -X POST http://<host>/api/exec \
  -H "X-API-Key: <key>" \
  -H "Content-Type: application/json" \
  -d '{"args": ["aexec", "--version"]}'
```

## Authentication

Most `/api/*` endpoints and all `/private/*` endpoints require an API key.

Use:

- `X-API-Key: <key>`

## Navigation Links (Optional)

Append `?navigation=true` to include next-step links in responses.

Examples:

```bash
curl -s "http://<host>/SKILL.md?navigation=true"
curl -s "http://<host>/skills?navigation=true"
curl -s "http://<host>/api/acl?navigation=true" -H "X-API-Key: <key>"
```

Notes:

- This is a response feature provided by agent-exec. It is not part of the original skill definition content.
- In Markdown/HTML responses, navigation is appended as a section/footer.
- In JSON responses, navigation is returned as a `navigation` field.

## Boundary

The agent discovers. The server enforces.

Read `/api/acl` before executing commands. Do not assume permissions.
