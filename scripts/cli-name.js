'use strict'

const path = require('path')

function cliName() {
	if (process.env.AGENT_EXEC_CLI === 'ae') return 'ae'
	const base = path.basename(process.argv[1] || '')
	return base === 'ae' ? 'ae' : 'aexec'
}

module.exports = { cliName }
