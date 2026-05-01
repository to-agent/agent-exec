'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const paths = require('./paths')
const settings = require('./settings')

function keyId(key) {
	if (!key) return null
	return 'sha256:' + crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 12)
}

function auditFile() {
	const cfg = settings.load().audit || {}
	if (cfg.file) return cfg.file.replace(/^~/, require('os').homedir())
	return path.join(paths.USER_CONFIG_DIR, 'audit.jsonl')
}

function enabled() {
	const cfg = settings.load().audit || {}
	return cfg.enabled !== false
}

function bytes(value) {
	return Buffer.byteLength(value || '')
}

function write(event) {
	if (!enabled()) return
	const file = auditFile()
	fs.mkdirSync(path.dirname(file), { recursive: true })
	const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n'
	fs.appendFileSync(file, line, { mode: 0o600 })
	try { fs.chmodSync(file, 0o600) } catch {}
}

function execEvent(req, data) {
	write({
		requestId: req.id || null,
		sourceIp: req.ip || null,
		apiKeyId: req.agentExecApiKeyId || null,
		authSource: req.agentExecAuthSource || 'unknown',
		queryAuthUsed: !!req.agentExecQueryAuthUsed,
		endpoint: req.originalUrl ? req.originalUrl.split('?')[0] : req.path,
		...data,
	})
}

module.exports = { keyId, bytes, write, execEvent }
