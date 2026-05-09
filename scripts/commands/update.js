'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { PACKAGE_DIR } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { run } = require('./_run')

const RESTART_FLAGS = new Set([
	'-f',
	'--foreground',
	'--force',
	'--public',
	'--use-project-env',
])

const RESTART_VALUE_FLAGS = new Set([
	'--host',
	'--port',
])

function parseArgs(args) {
	const restartArgs = []
	let restart = false
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === '--restart') {
			restart = true
			continue
		}
		if (RESTART_FLAGS.has(arg)) {
			restartArgs.push(arg)
			continue
		}
		const eqName = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : ''
		if (RESTART_VALUE_FLAGS.has(eqName)) {
			restartArgs.push(arg)
			continue
		}
		if (RESTART_VALUE_FLAGS.has(arg)) {
			const value = args[i + 1]
			if (!value || value.startsWith('-')) {
				console.error(`${arg} requires a value`)
				process.exit(1)
			}
			restartArgs.push(arg, value)
			i++
			continue
		}
		console.error(`Unknown update option: ${arg}`)
		console.error(`Run: ${cliName()} update --help`)
		process.exit(1)
	}
	if (!restart && restartArgs.length) {
		console.error('Restart options require --restart.')
		console.error(`Example: ${cliName()} update --restart --public`)
		process.exit(1)
	}
	return { restart, restartArgs }
}

function npmCommand() {
	return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function latestInstallArgs() {
	return ['install', '-g', '@to-agent/agent-exec@latest']
}

function readInstalledVersion() {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'))
		return pkg.version || ''
	} catch (_) {
		return ''
	}
}

function readNpmLatestVersion() {
	const result = spawnSync(npmCommand(), ['view', '@to-agent/agent-exec', 'version'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	if (result.status !== 0) return ''
	return String(result.stdout || '').trim()
}

function readNpmPrefix() {
	const result = spawnSync(npmCommand(), ['prefix', '-g'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	if (result.status !== 0) return ''
	return String(result.stdout || '').trim()
}

function warnIfVersionMismatch() {
	const latest = readNpmLatestVersion()
	const installed = readInstalledVersion()
	if (!latest || !installed || latest === installed) return

	console.warn('')
	console.warn('Warning: npm latest and this ae command version do not match.')
	console.warn(`  npm latest: ${latest}`)
	console.warn(`  ae command:  ${installed}`)
	console.warn(`  ae path:     ${process.argv[1] || '(unknown)'}`)
	const prefix = readNpmPrefix()
	if (prefix) console.warn(`  npm prefix:  ${prefix}`)
	console.warn('This usually means PATH or npm global prefix points to another installation.')
}

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} update [--restart] [restart options]

Update agent-exec to the latest version.

Runs npm install -g @to-agent/agent-exec@latest, then rebuilds the SKILL cache.
By default, a running server is not restarted automatically.

Options:
  --restart          Restart agent-exec after updating
  -f, --foreground   With --restart, restart in foreground
  --force            With --restart, force kill then restart
  --host <host>      With --restart, bind host for the restarted process
  --port <port>      With --restart, bind port for the restarted process
  --public           With --restart, shortcut for --host 0.0.0.0
  --use-project-env  With --restart, load current directory .env into the restarted process

Examples:
  ${bin} update
  ${bin} update --restart
  ${bin} update --restart --public
  ${bin} update --restart --force -f --public
`)
	},

	run(args = []) {
		const options = parseArgs(args)
		run(npmCommand(), latestInstallArgs())
		try {
			require(path.join(PACKAGE_DIR, 'modules', 'convert')).buildAllCache()
		} catch (_) {}
		console.log('')
		require('./version').run()
		warnIfVersionMismatch()
		if (options.restart) {
			console.log('\nRestarting agent-exec...')
			require('./restart').run(options.restartArgs)
			return
		}
		console.log('\nRestart required for any running server:')
		console.log(`  ${cliName()} restart`)
		console.log(`  ${cliName()} update --restart`)
	},

	_internals: { parseArgs, latestInstallArgs, readInstalledVersion, readNpmLatestVersion, warnIfVersionMismatch },
}
