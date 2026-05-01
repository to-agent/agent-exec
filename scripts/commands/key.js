'use strict'

const fs = require('fs')
const crypto = require('crypto')
const { ENV_FILE } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { runtimeEnvSummary, keyPreview } = require('./_project-env')

function setEnvValue(content, key, value) {
	const lines = content ? content.split(/\r?\n/) : []
	let found = false
	const next = lines.map(line => {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) return line
		const i = line.indexOf('=')
		if (i < 1) return line
		if (line.slice(0, i).trim() !== key) return line
		found = true
		return `${key}=${value}`
	})
	if (!found) next.push(`${key}=${value}`)
	return next.filter((line, i) => i < next.length - 1 || line !== '').join('\n') + '\n'
}

function rotate(args) {
	const restart = args.includes('--restart')
	if (!fs.existsSync(ENV_FILE)) {
		console.error(`No .env found: ${ENV_FILE}`)
		console.error('Run `aexec setup` first.')
		process.exit(1)
	}
	const nextKey = crypto.randomBytes(32).toString('hex')
	const current = fs.readFileSync(ENV_FILE, 'utf8')
	const currentMatch = current.match(/^API_KEY=(.+)$/m)
	const currentKey = currentMatch ? currentMatch[1] : ''
	const envSummary = runtimeEnvSummary(ENV_FILE)
	fs.writeFileSync(ENV_FILE, setEnvValue(current, 'API_KEY', nextKey), { mode: 0o600 })
	fs.chmodSync(ENV_FILE, 0o600)

	console.log('API key rotated.')
	console.log('')
	console.log(`Env file: ${ENV_FILE}`)
	console.log(`Old API_KEY: ${keyPreview(currentKey)}`)
	console.log('New API_KEY:')
	console.log(nextKey)
	console.log('')
	console.log('Treat this key as machine execution capability.')

	if (envSummary.projectEnvHasApiKey) {
		console.log('\n⚠️  Active project .env API_KEY detected.')
		console.log(`  Project env: ${envSummary.projectEnvFile}`)
		console.log(`  Project API_KEY: ${envSummary.projectApiKeyPreview}`)
		console.log('')
		console.log('  The saved config .env was rotated, but the running server/share may')
		console.log('  continue using the project .env API_KEY until you remove API_KEY')
		console.log('  from that project .env or restart without --use-project-env.')
	}

	if (restart) {
		console.log('\nRestarting agent-exec...')
		require('./restart').run([])
		return
	}

	console.log('\nRestart required:')
	console.log(`  ${cliName()} restart`)
	console.log('\nThe running server may still accept the previous key until restart.')
}

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} key <command>

Manage the local API key.

Commands:
  rotate          Generate a new API_KEY in the local .env

Options:
  --restart       Restart agent-exec after rotating the key

Examples:
  ${bin} key rotate
  ${bin} key rotate --restart
`)
	},

	run(args) {
		const [sub = 'help', ...rest] = args
		if (sub === 'help' || sub === '--help' || sub === '-h') return this.help()
		if (sub === 'rotate') return rotate(rest)
		console.error(`Unknown key command: ${sub}`)
		this.help()
		process.exit(1)
	},
}
