'use strict'

const path = require('path')
const { PACKAGE_DIR } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { run } = require('./_run')

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} share [options]

Generate a prompt to paste to any AI agent.

Options:
  --all            Show all detected IPs
  --local          Use loopback only (127.0.0.1)
  --ip <addr>      Add a specific IP to the output
  --no-filter      Show all IPs without filtering
  --show-key       Skip confirmation and display API_KEY immediately
  --safe           Include security notes in the prompt
  --check          Run connectivity check without displaying the prompt
  --lang <lang>    Prompt language: en (default), ja, zh

Examples:
  ${bin} share
  ${bin} share --local
  ${bin} share --safe
  ${bin} share --check
  ${bin} share --lang ja
`)
	},

	run(args) {
		run(process.execPath, [path.join(PACKAGE_DIR, 'scripts', 'share.js'), ...args])
	},
}
