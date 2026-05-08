# SKILL: plugins
# Endpoint: GET /api/plugins
# Description: List active plugins and links to their documentation

## Overview

Returns active plugins with links to their SKILL documentation.

```bash
curl -H "X-API-Key: <API_KEY>" http://<host>/api/plugins
```

## Response

```json
{
  "plugins": [
    {"name": "<plugin name>", "skill": "/private/skills/<name>/SKILL.json"}
  ]
}
```

The `skill` URL follows the response format:

- `GET /api/plugins.json` returns `SKILL.json` links
- `GET /api/plugins.md` returns `SKILL.md` links
- `GET /api/plugins.html` returns `SKILL.html` links

## How to use

1. Call `GET /api/plugins` to get the plugin list
2. For each plugin, fetch the `skill` URL with your API_KEY to read its usage documentation
3. Use the documented commands via `POST /api/exec`

```bash
# Step 1: list plugins
curl -H "X-API-Key: <API_KEY>" http://<host>/api/plugins

# Step 2: read plugin docs
curl -H "X-API-Key: <API_KEY>" http://<host>/private/skills/<name>/SKILL.json

# Step 3: execute
curl -X POST http://<host>/api/exec \
  -H "X-API-Key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"args": ["<command>", "--version"]}'
```

## Authentication

Required: `X-API-Key: <API_KEY>`.
