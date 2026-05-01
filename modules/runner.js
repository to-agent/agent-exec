'use strict'

const { execFile, spawn } = require('child_process')
const settings = require('./settings')

let activeExec = 0

function numericSetting(name, fallback, envName) {
	const raw = process.env[envName] ?? settings.load()[name]
	const n = Number(raw)
	return Number.isFinite(n) && n > 0 ? n : fallback
}

function limits() {
	return {
		timeoutMs:        numericSetting('timeoutMs', 120000, 'AGENT_EXEC_TIMEOUT_MS'),
		maxOutputBytes:   numericSetting('maxOutputBytes', 1024 * 1024, 'AGENT_EXEC_MAX_OUTPUT_BYTES'),
		maxStreamBytes:   numericSetting('maxStreamBytes', 1024 * 1024, 'AGENT_EXEC_MAX_STREAM_BYTES'),
		maxConcurrent:    numericSetting('maxConcurrentExec', 4, 'AGENT_EXEC_MAX_CONCURRENT_EXEC'),
		killGraceMs:      numericSetting('killGraceMs', 1000, 'AGENT_EXEC_KILL_GRACE_MS'),
	}
}

function acquire() {
	const { maxConcurrent } = limits()
	if (maxConcurrent > 0 && activeExec >= maxConcurrent) {
		return {
			ok: false,
			result: {
				error: 'too many concurrent executions',
				code: 'too_many_concurrent_exec',
				status: 'error',
				apiStatus: 429,
			},
		}
	}
	activeExec++
	let released = false
	return {
		ok: true,
		release() {
			if (!released) {
				released = true
				activeExec = Math.max(0, activeExec - 1)
			}
		},
	}
}

function killProcessTree(proc, signal = 'SIGTERM') {
	if (!proc || !proc.pid) return
	try {
		if (process.platform !== 'win32') process.kill(-proc.pid, signal)
		else proc.kill(signal)
	} catch {
		try { proc.kill(signal) } catch {}
	}
}

function scheduleKill(proc, graceMs) {
	killProcessTree(proc, 'SIGTERM')
	return setTimeout(() => killProcessTree(proc, 'SIGKILL'), graceMs)
}

function runBuffered(command, args, timeoutMs) {
	return new Promise((resolve) => {
		const slot = acquire()
		if (!slot.ok) return resolve(slot.result)
		const limit = limits()
		const timeout = timeoutMs || limit.timeoutMs
		const start = Date.now()
		let timedOut = false
		let killTimer = null
		let timer = null
		const proc = execFile(command, args, {
			maxBuffer: limit.maxOutputBytes,
			detached: process.platform !== 'win32',
		}, (err, stdout, stderr) => {
			slot.release()
			clearTimeout(timer)
			if (killTimer) clearTimeout(killTimer)
			const duration = Date.now() - start
			const output = stdout || ''
			const stderrOut = stderr || ''
			const isEnoent = err && err.code === 'ENOENT'
			const isMaxBuffer = err && err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
			const exitCode = err ? (typeof err.code === 'number' ? err.code : 1) : 0
			resolve({
				output,
				length: Buffer.byteLength(output),
				exitCode: timedOut ? null : exitCode,
				status: timedOut || isMaxBuffer || exitCode !== 0 ? 'error' : 'done',
				duration,
				...(stderrOut ? { stderr: stderrOut } : {}),
				...(isEnoent ? { enoent: true, message: err.message } : {}),
				...(timedOut ? { code: 'timeout', message: 'command timed out', apiStatus: 408 } : {}),
				...(isMaxBuffer ? { code: 'max_output_exceeded', message: 'command output exceeded maxOutputBytes', apiStatus: 413, maxOutputBytes: limit.maxOutputBytes } : {}),
			})
		})
		proc.stdin?.end()
		timer = setTimeout(() => {
			timedOut = true
			killTimer = scheduleKill(proc, limit.killGraceMs)
		}, timeout)
	})
}

function runStream(command, args, format, res) {
	const slot = acquire()
	if (!slot.ok) {
		const result = slot.result
		res.status(result.apiStatus || 429)
		res.type(format === 'json' ? 'application/json' : 'text/plain')
		return res.end(format === 'json' ? JSON.stringify(result) + '\n' : result.error)
	}
	const limit = limits()
	const start = Date.now()
	const proc = spawn(command, args, { detached: process.platform !== 'win32' })
	proc.stdin?.end()

	res.setHeader('Content-Type', format === 'json' ? 'application/x-ndjson' : 'text/plain')
	res.setHeader('Cache-Control', 'no-cache')

	let ended = false
	let streamedBytes = 0
	let killTimer = null
	const release = () => {
		if (!ended) {
			ended = true
			slot.release()
		}
	}
	const end = () => {
		if (!ended) {
			release()
			if (!res.destroyed && !res.writableEnded) res.end()
		}
	}

	res.on('close', () => {
		killProcessTree(proc)
		release()
	})

	const timer = setTimeout(() => {
		killTimer = scheduleKill(proc, limit.killGraceMs)
		if (format === 'json') res.write(JSON.stringify({ output: null, status: 'error', message: 'timeout' }) + '\n')
		end()
	}, limit.timeoutMs)
	proc.on('close', () => {
		clearTimeout(timer)
		if (killTimer) clearTimeout(killTimer)
	})

	function writeChunk(chunk, streamName) {
		if (ended) return
		streamedBytes += chunk.length
		if (streamedBytes > limit.maxStreamBytes) {
			if (format === 'json') {
				res.write(JSON.stringify({
					output: null,
					stderr: streamName === 'stderr' ? 'stream output exceeded maxStreamBytes' : null,
					status: 'error',
					code: 'max_stream_output_exceeded',
					maxStreamBytes: limit.maxStreamBytes,
				}) + '\n')
			} else {
				res.write('\n[agent-exec] stream output exceeded maxStreamBytes\n')
			}
			killTimer = scheduleKill(proc, limit.killGraceMs)
			end()
			return
		}
		if (format === 'json') {
			const body = streamName === 'stderr'
				? { output: null, stderr: chunk.toString(), status: 'running' }
				: { output: chunk.toString(), length: chunk.length, status: 'running' }
			res.write(JSON.stringify(body) + '\n')
		} else {
			res.write(chunk)
		}
	}

	if (format === 'json') {
		proc.stdout.on('data', (chunk) => writeChunk(chunk, 'stdout'))
		proc.stderr.on('data', (chunk) => writeChunk(chunk, 'stderr'))
		proc.on('close', (code) => {
			if (ended) return
			const exitCode = code ?? 1
			res.write(JSON.stringify({ output: null, exitCode, status: exitCode === 0 ? 'done' : 'error', duration: Date.now() - start }) + '\n')
			end()
		})
	} else {
		proc.stdout.on('data', (chunk) => writeChunk(chunk, 'stdout'))
		proc.stderr.on('data', (chunk) => writeChunk(chunk, 'stderr'))
		proc.on('close', end)
	}

	proc.on('error', (err) => {
		if (ended) return
		res.write(format === 'json' ? JSON.stringify({ output: null, status: 'error', message: err.message }) + '\n' : err.message)
		end()
	})
}

module.exports = { runBuffered, runStream }
