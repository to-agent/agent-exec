'use strict'

const path = require('path')
const { PACKAGE_DIR } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { run } = require('./_run')

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} update

Update agent-exec to the latest version.

Runs npm update for @to-agent/agent-exec, then rebuilds the SKILL cache.

Examples:
  ${bin} update
`)
	},

	run() {
		run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['update', '-g', '@to-agent/agent-exec'])
		try {
			require(path.join(PACKAGE_DIR, 'modules', 'convert')).buildAllCache()
		} catch (_) {}
		console.log('')
		require('./version').run()
	},
}
