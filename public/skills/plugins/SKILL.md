# SKILL: plugins
# Endpoint: GET /api/plugins
# Description: List available plugins and their skill documentation

## Overview

Use `/api/plugins` to see which plugins are installed on this server.
Each plugin has a skill document at `/private/skills/:name/SKILL.md` with detailed usage instructions.
Requires an API key.

## Request

```bash
curl -X GET http://<host>/api/plugins \
  -H "X-API-Key: <key>"
```

## Response

```json
{
  "plugins": [
    { "name": "hermes",      "skill": "/private/skills/hermes/SKILL.json" },
    { "name": "claude-code", "skill": "/private/skills/claude-code/SKILL.json" }
  ]
}
```

The `skill` URL follows the response format. JSON responses point to
`SKILL.json`; Markdown responses point to `SKILL.md`; HTML responses point to
`SKILL.html`.

## Next step

For each plugin, read its skill document to understand what commands are available and how to use them:

```bash
curl -X GET http://<host>/private/skills/hermes/SKILL.json \
  -H "X-API-Key: <key>"
```

Plugin skill documents may also reference additional files under `/private/skills/:name/references/` for deeper documentation.
