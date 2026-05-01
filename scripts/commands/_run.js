'use strict'

const { spawnSync } = require('child_process')

function run(command, args, opts = {}) {
	const result = spawnSync(command, args, { stdio: 'inherit', ...opts })
	if (result.error) {
		console.error(result.error.message)
		process.exit(1)
	}
	if (result.signal) {
		console.error(`${command} terminated by ${result.signal}`)
		process.exit(1)
	}
	if (typeof result.status === 'number' && result.status !== 0) {
		process.exit(result.status)
	}
}

module.exports = { run }
