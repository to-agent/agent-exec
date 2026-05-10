'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { PACKAGE_DIR } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { run } = require('./_run')

const PACKAGE_NAME = '@to-agent/agent-exec'

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
	return ['install', '-g', `${PACKAGE_NAME}@latest`]
}

function readInstalledVersion() {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'))
		return pkg.name === PACKAGE_NAME ? (pkg.version || '') : ''
	} catch (_) {
		return ''
	}
}

function parseVersionOutput(output) {
	const text = String(output || '').trim()
	const m = text.match(/agent-exec\s+v?([0-9]+\.[0-9]+\.[0-9][^\s]*)/i) || text.match(/\b([0-9]+\.[0-9]+\.[0-9][^\s]*)\b/)
	return m ? m[1] : ''
}

function activeBinPath() {
	return process.argv[1] || ''
}

function isAgentExecEntry(binPath) {
	return ['ae', 'aexec', 'agent-exec', 'aexec.js'].includes(path.basename(binPath || ''))
}

function readActiveVersion(binPath = activeBinPath()) {
	if (!binPath || !isAgentExecEntry(binPath)) return ''
	const result = spawnSync(process.execPath, [binPath, '--version'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	if (result.status !== 0) return ''
	return parseVersionOutput(`${result.stdout || ''}\n${result.stderr || ''}`)
}

function readNpmLatestVersion() {
	const result = spawnSync(npmCommand(), ['view', PACKAGE_NAME, 'version'], {
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

function updateSource() {
	return `${npmCommand()} ${latestInstallArgs().join(' ')}`
}

function updateVerification(latest = readNpmLatestVersion()) {
	const active = readActiveVersion()
	const bundled = readInstalledVersion()
	const prefix = readNpmPrefix()
	const lines = [
		'Update verification:',
		`  active ae:     ${active || '(unknown)'}`,
		`  bundled:       ${bundled || '(unknown)'}`,
		`  npm latest:    ${latest || '(unknown)'}`,
		`  ae path:       ${activeBinPath() || '(unknown)'}`,
	]
	if (prefix) lines.push(`  npm prefix:    ${prefix}`)
	lines.push(`  update source: ${updateSource()}`)
	return lines
}

function printUpdateVerification(latest) {
	console.log('')
	for (const line of updateVerification(latest)) console.log(line)
}

function activeMatchesLatest(latest) {
	const active = readActiveVersion()
	if (!latest || !active) return false
	return active === latest
}

function warnIfVersionMismatch(latest = readNpmLatestVersion()) {
	const active = readActiveVersion()
	const bundled = readInstalledVersion()
	if (!latest) return
	if (active && active === latest) return
	if (!active && bundled === latest) return

	console.warn('')
	console.warn('Warning: npm update completed, but the active ae command does not appear to be latest.')
	console.warn(`  npm latest: ${latest}`)
	console.warn(`  active ae:  ${active || '(unknown)'}`)
	console.warn(`  bundled:    ${bundled || '(unknown)'}`)
	console.warn(`  ae path:    ${activeBinPath() || '(unknown)'}`)
	const prefix = readNpmPrefix()
	if (prefix) console.warn(`  npm prefix: ${prefix}`)
	console.warn(`Run this command directly if you need to update through the documented npm path:`)
	console.warn(`  ${updateSource()}`)
}

function rebuildSkillCache() {
	try {
		require(path.join(PACKAGE_DIR, 'modules', 'convert')).buildAllCache()
	} catch (_) {}
}

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} update [--restart] [restart options]

Run the documented npm update for agent-exec.

This command runs npm install -g @to-agent/agent-exec@latest, then prints
version diagnostics. It does not repair package-manager or PATH state.
With --restart, the server is restarted only when the active ${bin} command
appears to match npm latest.

Options:
  --restart          Restart agent-exec after updating, only if active command is latest
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
		const latest = readNpmLatestVersion()
		run(npmCommand(), latestInstallArgs())
		rebuildSkillCache()
		printUpdateVerification(latest)
		warnIfVersionMismatch(latest)

		if (options.restart) {
			if (!activeMatchesLatest(latest)) {
				console.error('')
				console.error('Not restarting: the active ae command does not match npm latest.')
				console.error(`Expected: ${latest || '(unknown)'}`)
				console.error(`Active:   ${readActiveVersion() || '(unknown)'}`)
				process.exit(1)
			}
			console.log('\nRestarting agent-exec...')
			require('./restart').run(options.restartArgs)
			return
		}
		console.log('\nRestart required for any running server:')
		console.log(`  ${cliName()} restart`)
		console.log(`  ${cliName()} update --restart`)
	},

	_internals: {
		parseArgs,
		latestInstallArgs,
		readInstalledVersion,
		parseVersionOutput,
		isAgentExecEntry,
		readActiveVersion,
		readNpmLatestVersion,
		activeMatchesLatest,
		warnIfVersionMismatch,
		updateSource,
		updateVerification,
	},
}
