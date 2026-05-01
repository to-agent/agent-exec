'use strict'

const path = require('path')
const { PACKAGE_DIR } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { run } = require('./_run')

const subcommands = {
	list:    path.join(PACKAGE_DIR, 'scripts', 'plugin-list.js'),
	create:  path.join(PACKAGE_DIR, 'scripts', 'plugin-create.js'),
	remove:  path.join(PACKAGE_DIR, 'scripts', 'plugin-remove.js'),
	enable:  path.join(PACKAGE_DIR, 'scripts', 'plugin-enable.js'),
	disable: path.join(PACKAGE_DIR, 'scripts', 'plugin-disable.js'),
	doctor:  path.join(PACKAGE_DIR, 'scripts', 'plugin-doctor.js'),
	refresh: path.join(PACKAGE_DIR, 'scripts', 'plugin-refresh.js'),
}

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} plugin <subcommand>

Subcommands:
  list     List installed plugins
  create   Scaffold a new plugin
  remove   Remove an installed plugin
  enable   Enable an installed plugin
  disable  Disable an installed plugin
  doctor   Check plugin consistency
  refresh  Rebuild SKILL cache and run doctor

Examples:
  ${bin} plugin list
  ${bin} plugin create --name=mytool --command=mytool
  ${bin} plugin disable --name=mytool
  ${bin} plugin enable --name=mytool
  ${bin} plugin doctor
  ${bin} plugin refresh
  ${bin} plugin remove --name=mytool --yes

Run '${bin} plugin <subcommand> --help' for details.
`)
	},

	run(args) {
		const [sub, ...rest] = args
		const script = subcommands[sub]

		if (!script) {
			this.help()
			process.exit(1)
		}

		run(process.execPath, [script, ...rest])
	},
}
