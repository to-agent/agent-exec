'use strict'

const path = require('path')
const { PACKAGE_DIR } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { run } = require('./_run')

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} backup [options]

Create an agent-exec backup from ~/.to-agent/agent-exec.

Categories:
  all       env + settings + plugins (default)
  env       .env only
  settings  settings.json and settings/local/settings.json
  plugins   user plugins directory
  skills    alias for plugins

Options:
  --out <file>      Output file path
  --include <list>  Categories: all, env, settings, plugins
  --only <list>     Alias for --include
  --no-secrets      Exclude .env / API_KEY
  --json            Print machine-readable result

Examples:
  ${bin} backup
  ${bin} backup --include plugins
  ${bin} backup --include settings,plugins
  ${bin} backup --no-secrets
`)
	},

	run(args) {
		run(process.execPath, [path.join(PACKAGE_DIR, 'scripts', 'backup.js'), ...args])
	},
}
