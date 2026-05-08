# Changelog

## 0.2.1

This release adds a reset command for returning a local agent-exec installation
to a fresh safe state without silently losing the previous config.

### Added

- Added `aexec reset` to back up the current local config directory and recreate
  a fresh minimal config.
- Added `aexec reset --keep-api-key` for keeping the current API key while
  resetting settings and plugins.
- Added `aexec reset --api-key <key>` for reproducible lab or device setup.
- Added `aexec reset --dry-run` and `aexec reset --json` for inspection and
  automation.

### Behavior Notes

- Reset backs up by default to `~/.to-agent/backups/agent-exec/reset-*`.
- Fresh reset settings allow only `aexec --version`.
- `--no-backup` is available only as an explicit destructive mode.

## 0.2.0

This release is written against the published `@to-agent/agent-exec@0.1.10`
package. It updates the agent-facing documentation surfaces, execution fallback
responses, plugin generation defaults, and release packaging.

### Added

- Added Skill Script documentation surfaces through `.s.js`, `.sjs`, and
  `Accept: text/sjs`.
- Added a shared SJS renderer in `modules/sjs.js` for root, index, API,
  skill, runtime, and fallback surfaces.
- Added raw skill document variants such as `SKILL.raw.json`,
  `SKILL.raw.html`, `SKILL.raw.s.js`, and `SKILL.raw.sjs` for inspecting
  skill documents without `ae:` directive expansion.
- Added `ae:` Markdown directives for projecting selected Markdown JSON blocks
  into generated JSON, HTML, and SJS metadata.
- Added `/skills/private/SKILL.md` as the public entry document for the private
  skill namespace without listing private skill names.
- Added this changelog.

### Changed

- Root and index documents now expose direct SJS variants while ordinary HTML
  and Markdown entry points remain available.
- Public API skill documents remain discoverable, while API runtime calls,
  private routes, and CLI routes remain protected by API key checks.
- `/api/exec` invalid-request responses now expose the expected request body
  form and point back to `/api/exec/SKILL.s.js`.
- `/api/exec` SJS fallback responses are available when the request asks for
  `text/sjs`.
- `/api/exec` continues to reject unexpected JSON body fields such as `cmd`,
  `command`, `env`, `cwd`, and `shell`; `memo` is now allowed as optional
  request metadata.
- ACL and execution documentation now make the relationship between allowed
  command strings and `args` arrays more explicit.
- Root, API, skills, private, and plugin skill documents were updated for the
  current discovery and execution surfaces.

### Behavior Notes

- Skill Script is directly accessible, but it is not required for ordinary
  human use of the HTTP interface.
- Unknown non-API paths return recovery information without making SJS the
  default visible format.
- Fresh installs remain conservative and do not generate broad wildcard command
  allow rules by default.

### Plugin Generation And Safety

- `aexec plugin create` no longer generates broad `cmd *` style allow rules by
  default.
- `aexec starterkit` now generates ACL entries from detected help/version
  commands instead of broad wildcard execution rules.
- Generated plugin skill files include request body metadata that can be used
  by JSON, HTML, and SJS outputs.
- `aexec plugin doctor` warns about active broad wildcard allow rules.
- Starterkit and plugin generation help output was normalized for direct script
  and command usage.

### Internal Quality

- Expanded unit and e2e coverage for SJS rendering, `ae:` directives, fallback
  responses, plugin generation, starterkit output, ACL behavior, private/public
  skill separation, and packaging.
- Verified package contents include the new runtime SJS module and private
  namespace skill document.
