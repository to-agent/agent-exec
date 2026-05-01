'use strict'

const path = require('path')
const { PACKAGE_DIR } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { run } = require('./_run')

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} transfer --from <path> --to <agent-exec-url> --apiKey <key> [options]

Transfer local agent-exec config to a remote agent-exec machine.

Categories:
  all       env + settings + plugins (default)
  env       .env only
  settings  settings.json and settings/local/settings.json
  plugins   user plugins directory
  skills    alias for plugins

Options:
  --from <path>     Source config dir or backup file (default: ~/.to-agent/agent-exec)
  --to <url|host>   Destination URL or host[:port]
  --apiKey <key>    Destination API key
  --yes             Confirm transfer
  --dry-run         Validate on the destination without writing
  --include <list>  Categories: all, env, settings, plugins
  --only <list>     Alias for --include
  --no-secrets      Skip .env / API_KEY
  --json            Print machine-readable result

Examples:
  ${bin} transfer --from ~/.to-agent/agent-exec --to http://192.168.1.20:3333 --apiKey test --dry-run
  ${bin} transfer --to 192.168.1.20 --apiKey test --dry-run
  ${bin} transfer --to 192.168.1.20 --apiKey test --only plugins --dry-run
  ${bin} transfer --from ./agent-exec-backup.json.gz --to 192.168.1.20:3333 --apiKey test --yes
  ${bin} transfer --from ~/.to-agent/agent-exec --to http://192.168.1.20:3333 --apiKey test --yes

Notes:
  --apiKey is the destination machine's API key.
  Use --no-secrets to preserve the destination .env.
`)
	},

	run(args) {
		run(process.execPath, [path.join(PACKAGE_DIR, 'scripts', 'transfer.js'), ...args])
	},
}
