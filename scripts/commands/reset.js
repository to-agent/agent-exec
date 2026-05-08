'use strict'

const path = require('path')
const { PACKAGE_DIR, USER_CONFIG_DIR } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { run } = require('./_run')

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} reset [options]

Reset the local agent-exec config to a fresh safe state.

By default, the current config directory is backed up before reset.

Options:
  --backup           Back up current config before reset (default)
  --no-backup        Remove current config without backup
  --yes              Confirm reset in non-interactive use
  --api-key <key>    Write this API_KEY to the fresh .env
  --keep-api-key     Reuse the current API_KEY if one exists
  --dry-run          Show what would happen without changing files
  --json             Print machine-readable result
  -h, --help         Show this help

Creates a fresh config at:
  ${USER_CONFIG_DIR}

Examples:
  ${bin} reset --yes
  ${bin} reset --yes --api-key test
  ${bin} reset --yes --keep-api-key
  ${bin} reset --dry-run
`)
	},

	run(args) {
		run(process.execPath, [path.join(PACKAGE_DIR, 'scripts', 'reset.js'), ...args])
	},
}
