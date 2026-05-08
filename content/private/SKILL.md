# SKILL: private
# Endpoint: GET /private
# Description: Private namespace. Requires API_KEY.

## Endpoints

- `GET /private/skills` — list available private skills
- `GET /private/skills/:name/SKILL.md` — read plugin documentation
- `GET /private/skills/:name/references` — list reference documents
- `GET /private/skills/:name/references/:file` — read a reference document

## Authentication

Required for all `/private/*` endpoints:
- `X-API-Key: <API_KEY>`
