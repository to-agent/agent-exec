# hermes commands — Full Reference

## All Subcommands

| Command | Description |
|---|---|
| `chat` | Interactive chat / single query (`-q`) |
| `status` | Show status of all components |
| `sessions` | Manage session history |
| `logs` | View and filter log files |
| `model` | Select default model and provider |
| `config` | View and edit configuration |
| `skills` | Search, install, configure skills |
| `plugins` | Manage plugins |
| `mcp` | Manage MCP servers |
| `memory` | Configure external memory provider |
| `tools` | Configure enabled tools per platform |
| `auth` | Manage pooled provider credentials |
| `login` / `logout` | Authenticate with inference provider |
| `gateway` | Messaging gateway management |
| `cron` | Cron job management |
| `webhook` | Manage webhook subscriptions |
| `doctor` | Check configuration and dependencies |
| `profile` | Manage multiple isolated instances |
| `backup` / `import` | Backup and restore |
| `update` | Update to latest version |
| `version` | Show version |
| `acp` | Run as ACP server (stdio, for editors) |

## Get Help for Any Subcommand

```json
{"args": ["hermes", "<subcommand>", "--help"]}
```

## Useful One-liners

```json
{"args": ["hermes", "--version"]}
{"args": ["hermes", "status"]}
{"args": ["hermes", "logs"]}
{"args": ["hermes", "logs", "-f"]}
{"args": ["hermes", "doctor"]}
{"args": ["hermes", "config"]}
```
