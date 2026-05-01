'use strict'

const path = require('path')
const { PACKAGE_DIR } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { run } = require('./_run')

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} import <backup-file> [options]

Restore an agent-exec backup into ~/.to-agent/agent-exec.

Categories:
  all       env + settings + plugins (default)
  env       .env only
  settings  settings.json and settings/local/settings.json
  plugins   user plugins directory
  skills    alias for plugins

Options:
  --yes             Confirm restore
  --dry-run         Validate and show what would be restored
  --include <list>  Categories: all, env, settings, plugins
  --only <list>     Alias for --include
  --no-secrets      Skip .env even if the backup contains it
  --json            Print machine-readable result

Examples:
  ${bin} import ./agent-exec-backup.json.gz --yes
  ${bin} import ./agent-exec-backup.json.gz --dry-run
  ${bin} import ./agent-exec-backup.json.gz --only plugins --yes
  ${bin} import ./agent-exec-backup.json.gz --include settings,plugins --yes
`)
	},

	run(args) {
		run(process.execPath, [path.join(PACKAGE_DIR, 'scripts', 'import.js'), ...args])
	},
}
