'use strict'

const fs = require('fs')
const { spawnSync } = require('child_process')
const { PID_FILE, PID_META_FILE, PACKAGE_DIR, ENV_FILE } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { readRuntimeMeta, clearRuntimeMeta } = require('./_project-env')

function valueAfter(args, name) {
	const eq = args.find(arg => arg.startsWith(`${name}=`))
	if (eq) return eq.slice(name.length + 1)
	const i = args.indexOf(name)
	if (i !== -1) {
		const value = args[i + 1]
		if (!value || value.startsWith('-')) return ''
		return value
	}
	return null
}

function getPort(args = []) {
	const argPort = valueAfter(args, '--port')
	if (argPort) return argPort
	try {
		const content = fs.readFileSync(ENV_FILE, 'utf8')
		const m = content.match(/^PORT=(\d+)/m)
		return m ? m[1] : '3333'
	} catch (_) { return '3333' }
}

function killPort(port) {
	return spawnSync(process.execPath, [require('path').join(PACKAGE_DIR, 'scripts', 'kill-port.js'), port], { stdio: 'inherit' })
}

function sleep(ms) {
	const data = new Int32Array(new SharedArrayBuffer(4))
	Atomics.wait(data, 0, 0, ms)
}

function isRunning(pid) {
	try {
		process.kill(pid, 0)
		return true
	} catch (_) {
		return false
	}
}

function stopPid(pid, label) {
	if (!pid || !isRunning(pid)) return false
	try {
		process.kill(pid, 'SIGTERM')
	} catch (e) {
		if (e.code === 'ESRCH') return true
		console.error(`Failed to stop ${label} PID ${pid}: ${e.message}`)
		return false
	}
	for (let i = 0; i < 10; i++) {
		if (!isRunning(pid)) {
			console.log(`agent-exec stopped (${label} PID: ${pid})`)
			return true
		}
		sleep(100)
	}
	try {
		process.kill(pid, 'SIGKILL')
		console.log(`agent-exec killed (${label} PID: ${pid})`)
		return true
	} catch (e) {
		if (e.code === 'ESRCH') return true
		console.error(`Failed to kill ${label} PID ${pid}: ${e.message}`)
		return false
	}
}

function stopRuntimeMetaProcess() {
	const meta = readRuntimeMeta()
	if (!meta?.pid) return false
	const ok = stopPid(parseInt(meta.pid, 10), meta.mode || 'runtime')
	if (ok) clearRuntimeMeta()
	return ok
}

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} stop [--force] [--port <port>]

Stop the background agent-exec server.

Options:
  --force        Force kill process on port even without PID file
  --port <port>  Port to use with --force

Examples:
  ${bin} stop
  ${bin} stop --force
  ${bin} stop --force --port 3333
`)
	},

	run(args, opts = {}) {
		const exitOnNotRunning = opts.exitOnNotRunning !== false
		const force = args.includes('--force')
		const port = getPort(args)

		if (!fs.existsSync(PID_FILE)) {
			if (stopRuntimeMetaProcess()) return true
			if (force) {
				const result = killPort(port)
				fs.rmSync(PID_META_FILE, { force: true })
				return result.status === 0
			}
			console.log('agent-exec is not running (no PID file)')
			console.log(`If a foreground server is still bound to port ${port}, run: ${cliName()} stop --force --port ${port}`)
			if (exitOnNotRunning) process.exit(1)
			return false
		}

		const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
		fs.rmSync(PID_FILE, { force: true })
		fs.rmSync(PID_META_FILE, { force: true })

		if (stopPid(pid, 'background')) {
			return true
		} else {
			console.log('agent-exec is not running (stale PID file removed)')
			if (force) {
				const result = killPort(port)
				return result.status === 0
			}
		}
		return false
	},
}
