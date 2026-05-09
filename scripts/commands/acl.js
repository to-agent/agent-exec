'use strict'

const path = require('path')
const { PACKAGE_DIR } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { run } = require('./_run')

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} acl <subcommand> [options]

Manage exec.allow rules in the primary user settings file.

Subcommands:
  list                 Show effective exec ACL rules and sources
  add <rule>           Add an exec.allow rule to user settings
  remove <rule>        Remove an exec.allow rule from user settings
  remove --contains <text>
                       Remove user exec.allow rules containing text
  doctor               Warn about broad effective allow rules

Options:
  --yes                Confirm non-interactive changes
  --force              Allow broad rule changes in non-interactive use
  --contains <text>    Match user exec.allow rules by substring for remove
  --json               Print machine-readable output
  -h, --help           Show this help

Examples:
  ${bin} acl list
  ${bin} acl add "date"
  ${bin} acl add "codex *" --force --yes
  ${bin} acl remove "date" --yes
  ${bin} acl remove --contains "codex" --yes
  ${bin} acl doctor

Run '${bin} acl <subcommand> --help' for details.
`)
	},

	run(args) {
		run(process.execPath, [path.join(PACKAGE_DIR, 'scripts', 'acl.js'), ...args])
	},
}
