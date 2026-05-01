'use strict'

const start = require('./start')
const stop = require('./stop')
const { cliName } = require('../cli-name')

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} restart [-f] [--force] [--host <host>] [--port <port>] [--public] [--use-project-env]

Restart agent-exec.

Options:
  -f, --foreground   Restart in foreground
  --force            Force kill then restart
  --host <host>      Bind host for the restarted process
  --port <port>      Bind port for the restarted process
  --public           Shortcut for --host 0.0.0.0
  --use-project-env  Load current directory .env into the restarted process only

Examples:
  ${bin} restart
  ${bin} restart --force
  ${bin} restart -f --public
  ${bin} restart --force -f --public
  ${bin} restart --public
  ${bin} restart --host 0.0.0.0 --port 3333
  ${bin} restart --use-project-env
`)
	},

	run(args) {
		const stopArgs = args.filter(arg => arg !== '-f' && arg !== '--foreground')
		try { stop.run(stopArgs, { exitOnNotRunning: false }) } catch (_) {}
		setTimeout(() => start.run(args), 1000)
	},
}
