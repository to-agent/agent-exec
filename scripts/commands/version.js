'use strict'

const { PACKAGE_DIR } = require('../aexec-paths')
const { cliName } = require('../cli-name')

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} version

Show the installed agent-exec version.

Aliases:
  ${bin} --version
  ${bin} -v
`)
	},

	run() {
		const pkg = require(require('path').join(PACKAGE_DIR, 'package.json'))
		console.log(`agent-exec v${pkg.version}`)
	},
}
