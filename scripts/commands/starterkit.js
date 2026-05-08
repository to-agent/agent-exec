'use strict'

const path = require('path')
const { PACKAGE_DIR } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { run } = require('./_run')

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} starterkit [name] [options]

Auto-detect installed AI tools and generate plugins for each.
Recommended for first-time setup.

Arguments:
  name  Optional supported agent command or plugin name.

Options:
  --silent           Do not print generated settings.json contents.
  --quiet            Alias for --silent.
  --force            Replace an existing generated plugin directory.
  -h, --help         Show this help.

Generated ACL:
  Starter Kit writes detected help/version commands to each plugin settings.json.
  It does not generate "<cmd> *"; add broader command patterns manually after review.
  Review generated exec.allow rules before restart.

Environment:
  AGENT_EXEC_STARTERKIT_DEPTH=<n>  Help scan depth. Default: 0.

Examples:
  ${bin} starterkit
  ${bin} starterkit --silent
  ${bin} starterkit hermes
  ${bin} starterkit codex
  ${bin} starterkit codex --silent
  ${bin} starterkit codex --force
`)
	},

	run(args) {
		run(process.execPath, [path.join(PACKAGE_DIR, 'scripts', 'starterkit.js'), ...args])
	},
}
