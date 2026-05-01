'use strict'

const fs = require('fs')
const http = require('http')
const { PID_FILE, PID_META_FILE, ENV_FILE } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { readRuntimeMeta, clearRuntimeMeta } = require('./_project-env')

function readEnv(file) {
	const env = {}
	if (!fs.existsSync(file)) return env
	fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) return
		const i = trimmed.indexOf('=')
		if (i < 1) return
		env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim()
	})
	return env
}

function checkPing(port, done) {
	const req = http.get({
		host: '127.0.0.1',
		port,
		path: '/ping',
		timeout: 1000,
	}, res => {
		res.resume()
		done(res.statusCode === 200)
	})
	req.on('error', () => done(false))
	req.on('timeout', () => {
		req.destroy()
		done(false)
	})
}

function isRunning(pid) {
	try {
		process.kill(pid, 0)
		return true
	} catch (_) {
		return false
	}
}

function printProjectEnv(meta) {
	if (meta?.projectEnv) console.log(`Project env: ${meta.projectEnv}`)
}

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} status

Show whether agent-exec is running.

Also removes a stale PID file if the recorded process no longer exists.
If no PID file exists, checks /ping on the configured local port.

Examples:
  ${bin} status
`)
	},

	run() {
		if (fs.existsSync(PID_FILE)) {
			const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
			try {
				process.kill(pid, 0)
				console.log(`agent-exec is running (PID: ${pid})`)
				const meta = readRuntimeMeta()
				if (meta?.effective) {
					console.log(`Endpoint: http://${meta.effective.host || '127.0.0.1'}:${meta.effective.port || '3333'}`)
				}
				printProjectEnv(meta)
				return
			} catch (_) {
				fs.rmSync(PID_FILE, { force: true })
				fs.rmSync(PID_META_FILE, { force: true })
				console.log('agent-exec is not running (stale PID file removed)')
				return
			}
		}
		let meta = readRuntimeMeta()
		if (meta?.mode === 'foreground' && meta.pid && isRunning(meta.pid)) {
			const port = meta.effective?.port || '3333'
			const host = meta.effective?.host || '127.0.0.1'
			console.log(`agent-exec is running in foreground (PID: ${meta.pid})`)
			console.log(`Endpoint: http://${host}:${port}`)
			printProjectEnv(meta)
			return
		}
		if (meta?.mode === 'foreground' && meta.pid && !isRunning(meta.pid)) {
			clearRuntimeMeta()
			meta = null
		}
		const env = readEnv(ENV_FILE)
		const port = meta?.effective?.port || env.PORT || process.env.PORT || '3333'
		checkPing(port, ok => {
			if (ok) {
				console.log(`agent-exec is reachable at http://127.0.0.1:${port} (no PID file)`)
				printProjectEnv(readRuntimeMeta())
			} else {
				console.log('agent-exec is not running')
			}
		})
	},
}
