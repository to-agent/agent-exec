# hermes sessions — Reference

## List Sessions

```json
{"args": ["hermes", "sessions", "list"]}
```

## Resume a Session

```json
{"args": ["hermes", "chat", "--continue"]}
{"args": ["hermes", "chat", "--continue", "session name"]}
{"args": ["hermes", "chat", "--resume", "<session_id>"]}
```

## Rename a Session

```json
{"args": ["hermes", "sessions", "rename", "<session_id>", "New Title"]}
```

## Delete / Prune

```json
{"args": ["hermes", "sessions", "delete", "<session_id>"]}
{"args": ["hermes", "sessions", "prune"]}
```

## Export

```json
{"args": ["hermes", "sessions", "export"]}
```

## Stats

```json
{"args": ["hermes", "sessions", "stats"]}
```
