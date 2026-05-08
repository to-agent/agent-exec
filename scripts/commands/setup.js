'use strict'

const path = require('path')
const { PACKAGE_DIR, USER_CONFIG_DIR } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { run } = require('./_run')

module.exports = {
	help() {
		const bin = cliName()
		const configDir = USER_CONFIG_DIR
		console.log(`
Usage: ${bin} setup [options]

Configure API key and server settings interactively.

Options:
  --yes              Non-interactive setup. Generate API_KEY if missing.
  --skip             Alias for --yes.
  --use-project-env  Refused by setup. Use '${bin} dev --use-project-env'
                     for process-only development env injection.
  -h, --help         Show this help.

Creates or updates:
  ${configDir}/.env
  ${configDir}/settings.json
  ${configDir}/plugins/

Notes:
  Non-interactive stdin behaves like --yes.

Examples:
  ${bin} setup
  ${bin} setup --yes
  ${bin} setup --skip
`)
	},

	run(args) {
		run(process.execPath, [path.join(PACKAGE_DIR, 'setup.js'), ...args])
	},
}
