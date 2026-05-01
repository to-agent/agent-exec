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
Usage: ${bin} setup [--yes]

Configure API key and server settings interactively.

Options:
  --yes              Non-interactive setup. Generate API_KEY if missing.

Creates or updates:
  ${configDir}/.env
  ${configDir}/settings.json
  ${configDir}/plugins/

Examples:
  ${bin} setup
  ${bin} setup --yes
`)
	},

	run(args) {
		run(process.execPath, [path.join(PACKAGE_DIR, 'setup.js'), ...args])
	},
}
