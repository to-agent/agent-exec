'use strict'

const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { USER_CONFIG_DIR, PID_FILE, PID_META_FILE, WWW_PATH } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { projectEnvInfo, warnProjectEnv, buildRuntimeEnv, writeRuntimeMeta, clearRuntimeMeta } = require('./_project-env')

const LOG_FILE = path.join(USER_CONFIG_DIR, 'agent-exec.log')

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

function probeHost(host) {
	if (!host || host === '0.0.0.0' || host === '::') return '127.0.0.1'
	return host
}

function canReachPing(env) {
	const host = probeHost(env.HOST || '127.0.0.1')
	const port = String(env.PORT || '3333')
	const script = `
const http = require('http')
const req = http.get({ host: process.argv[1], port: Number(process.argv[2]), path: '/ping', timeout: 500 }, res => {
  res.resume()
  process.exit(res.statusCode === 200 ? 0 : 1)
})
req.on('timeout', () => {
  req.destroy()
  process.exit(1)
})
req.on('error', () => process.exit(1))
`
	const result = spawnSync(process.execPath, ['-e', script, host, port], {
		stdio: 'ignore',
		timeout: 1000,
	})
	return result.status === 0
}

function waitForReady(pid, env, timeoutMs = 4000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (!isRunning(pid)) return false
		if (canReachPing(env)) return true
		sleep(150)
	}
	return false
}

function stopChild(pid) {
	try { process.kill(pid) } catch (_) {}
}

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

function readLogTail(file, maxBytes = 4000) {
	try {
		if (!fs.existsSync(file)) return ''
		const stat = fs.statSync(file)
		const start = Math.max(0, stat.size - maxBytes)
		const fd = fs.openSync(file, 'r')
		try {
			const buffer = Buffer.alloc(stat.size - start)
			fs.readSync(fd, buffer, 0, buffer.length, start)
			return buffer.toString('utf8')
		} finally {
			fs.closeSync(fd)
		}
	} catch (_) {
		return ''
	}
}

function printStartupFailureHint(logText) {
	const bin = cliName()
	if (/API_KEY is not set/.test(logText)) {
		console.error('')
		console.error('Missing API_KEY.')
		console.error('Run first-time setup, then start again:')
		console.error(`  ${bin} setup`)
		console.error(`  ${bin} start`)
		return
	}
	if (/EADDRINUSE|Port .+ already in use/.test(logText)) {
		console.error('')
		console.error('The configured port is already in use.')
		console.error('Use another port or stop the existing process:')
		console.error(`  ${bin} start --port 3334`)
		console.error(`  ${bin} stop --force`)
		return
	}
	if (/EACCES|permission denied/.test(logText)) {
		console.error('')
		console.error('The configured host/port could not be bound.')
		console.error('On Windows this often means the port is reserved or blocked by the OS.')
		console.error('Try another port:')
		console.error(`  ${bin} start --port 3334`)
		console.error('')
		console.error('To inspect Windows reserved TCP port ranges, run:')
		console.error('  netsh interface ipv4 show excludedportrange protocol=tcp')
	}
}

function startOptions(args) {
	const host = valueAfter(args, '--host')
	const port = valueAfter(args, '--port')
	const publicHost = args.includes('--public')
	if (host === '') {
		console.error('--host requires a value')
		process.exit(1)
	}
	if (port === '') {
		console.error('--port requires a value')
		process.exit(1)
	}
	if (port && !/^\d+$/.test(port)) {
		console.error('--port must be a number')
		process.exit(1)
	}
	return {
		host: host || (publicHost ? '0.0.0.0' : null),
		port,
	}
}

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} start [-f] [--host <host>] [--port <port>] [--public]

Start agent-exec using:
  ${path.join(USER_CONFIG_DIR, '.env')}

Options:
  -f, --foreground      Run in foreground (default: background)
  --host <host>         Bind host for this process (example: 0.0.0.0)
  --port <port>         Bind port for this process
  --public              Shortcut for --host 0.0.0.0
  --use-project-env     Load current directory .env into this process only

Creates:
  ${PID_FILE}
  ${LOG_FILE}

Examples:
  ${bin} start
  ${bin} start -f
  ${bin} start -f --public
  ${bin} start -f --host 0.0.0.0 --port 3333
  ${bin} start --use-project-env
`)
	},

	run(args) {
		const foreground = args.includes('-f') || args.includes('--foreground')
		const options = startOptions(args)
		const projectEnv = projectEnvInfo(args)
		const env = buildRuntimeEnv(projectEnv)
		if (options.host) env.HOST = options.host
		if (options.port) env.PORT = options.port
		warnProjectEnv(projectEnv)

		if (foreground) {
			fs.mkdirSync(USER_CONFIG_DIR, { recursive: true })
			writeRuntimeMeta({
				mode: 'foreground',
				pid: process.pid,
				startedAt: new Date().toISOString(),
				projectEnv: projectEnv.enabled && projectEnv.exists ? projectEnv.file : null,
				projectEnvExists: projectEnv.enabled ? projectEnv.exists : false,
				processOnly: true,
				effective: {
					port: env.PORT || '3333',
					host: env.HOST || '127.0.0.1',
				},
			})
			process.once('exit', () => {
				try { clearRuntimeMeta() } catch (_) {}
			})
			Object.assign(process.env, env)
			require(WWW_PATH)
			return
		}

		fs.mkdirSync(USER_CONFIG_DIR, { recursive: true })

		if (fs.existsSync(PID_FILE)) {
			const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
			if (isRunning(pid)) {
				console.log(`agent-exec is already running (PID: ${pid})`)
				process.exit(1)
			}
			fs.rmSync(PID_FILE, { force: true })
			fs.rmSync(PID_META_FILE, { force: true })
		}

		const logFd = fs.openSync(LOG_FILE, 'a')

		const child = spawn(process.execPath, [WWW_PATH], {
			detached: true,
			stdio: ['ignore', logFd, logFd],
			env,
		})
		child.unref()
		fs.closeSync(logFd)

		if (!waitForReady(child.pid, env)) {
			const logTail = readLogTail(LOG_FILE)
			console.error('agent-exec failed to start')
			printStartupFailureHint(logTail)
			console.error(`See log: ${LOG_FILE}`)
			if (isRunning(child.pid)) stopChild(child.pid)
			process.exit(1)
		}

		fs.writeFileSync(PID_FILE, String(child.pid))
		const meta = {
			mode: 'start',
			pid: child.pid,
			startedAt: new Date().toISOString(),
			projectEnv: projectEnv.enabled && projectEnv.exists ? projectEnv.file : null,
			projectEnvExists: projectEnv.enabled ? projectEnv.exists : false,
			processOnly: projectEnv.enabled,
			effective: {
				port: env.PORT || '3333',
				host: env.HOST || '127.0.0.1',
			},
		}
		writeRuntimeMeta(meta)
		console.log(`agent-exec started (PID: ${child.pid})`)
	},
}
