# SKILL: private
# Endpoint: /private
# Description: Private namespace. Requires API key.

## Endpoints

- `GET /private/skills` — list available private skills
- `GET /private/skills/:name/SKILL.md` — read plugin documentation
- `GET /private/skills/:name/references` — list reference documents
- `GET /private/skills/:name/references/:file` — read a reference document

## Authentication

Required for all `/private/*` endpoints:
- `X-API-Key: <key>`
