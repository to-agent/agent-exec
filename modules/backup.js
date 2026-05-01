'use strict'

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

const paths = require('./paths')

const BACKUP_FORMAT = 'agent-exec.backup'
const BACKUP_VERSION = 1
const BACKUP_CATEGORIES = ['env', 'settings', 'plugins']

function timestamp(d = new Date()) {
	return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function sha256(buf) {
	return crypto.createHash('sha256').update(buf).digest('hex')
}

function normalizeRel(p) {
	return p.split(path.sep).join('/')
}

function assertSafeRel(rel) {
	if (!rel || rel === '.' || rel.startsWith('/') || rel.includes('\0'))
		throw new Error(`unsafe backup path: ${rel}`)
	const parts = rel.split('/')
	if (parts.includes('..') || parts.includes(''))
		throw new Error(`unsafe backup path: ${rel}`)
}

function resolveInside(base, rel) {
	assertSafeRel(rel)
	const out = path.resolve(base, ...rel.split('/'))
	const root = path.resolve(base)
	if (out !== root && !out.startsWith(root + path.sep))
		throw new Error(`backup path escapes config dir: ${rel}`)
	return out
}

function defaultBackupPath(configDir = paths.USER_CONFIG_DIR) {
	return path.join(configDir, 'backups', `agent-exec-backup-${timestamp()}.json.gz`)
}

function parseCategories(value, fallback = BACKUP_CATEGORIES) {
	if (value === undefined || value === null || value === '' || value === true) return [...fallback]
	const raw = Array.isArray(value) ? value : String(value).split(',')
	const out = []
	for (const item of raw.map(v => String(v).trim()).filter(Boolean)) {
		if (item === 'all') {
			for (const c of BACKUP_CATEGORIES) if (!out.includes(c)) out.push(c)
			continue
		}
		const normalized = item === 'skills' ? 'plugins' : item
		if (!BACKUP_CATEGORIES.includes(normalized))
			throw new Error(`unknown backup category: ${item}`)
		if (!out.includes(normalized)) out.push(normalized)
	}
	return out.length ? out : [...fallback]
}

function categoryForPath(rel) {
	if (rel === '.env') return 'env'
	if (rel === 'settings.json') return 'settings'
	if (rel === 'settings' || rel.startsWith('settings/')) return 'settings'
	if (rel === 'plugins' || rel.startsWith('plugins/')) return 'plugins'
	return 'other'
}

function shouldSkip(rel, opts) {
	if (rel === 'backups' || rel.startsWith('backups/')) return 'backups directory'
	if (rel === 'cache' || rel.startsWith('cache/')) return 'cache directory'
	if (rel === 'agent-exec.pid') return 'pid file'
	if (rel === 'agent-exec.log') return 'log file'
	if (!opts.includeSecrets && rel === '.env') return 'secret file'
	const category = categoryForPath(rel)
	if (category !== 'other' && !opts.categories.includes(category)) return `category not selected: ${category}`
	if (category === 'other') return 'not part of selected backup categories'
	return null
}

function walk(base, rel, opts, entries, skipped) {
	const abs = rel ? path.join(base, ...rel.split('/')) : base
	if (!fs.existsSync(abs)) return

	for (const name of fs.readdirSync(abs).sort()) {
		const childRel = rel ? `${rel}/${name}` : name
		const reason = shouldSkip(childRel, opts)
		if (reason) {
			skipped.push({ path: childRel, reason })
			continue
		}

		const childAbs = path.join(abs, name)
		const st = fs.lstatSync(childAbs)
		if (st.isSymbolicLink()) {
			skipped.push({ path: childRel, reason: 'symlink' })
			continue
		}
		if (st.isDirectory()) {
			entries.push({
				type: 'dir',
				path: childRel,
				mode: st.mode & 0o777,
				mtimeMs: st.mtimeMs,
			})
			walk(base, childRel, opts, entries, skipped)
			continue
		}
		if (!st.isFile()) {
			skipped.push({ path: childRel, reason: 'not a regular file' })
			continue
		}

		const content = fs.readFileSync(childAbs)
		entries.push({
			type: 'file',
			path: childRel,
			mode: st.mode & 0o777,
			mtimeMs: st.mtimeMs,
			size: content.length,
			sha256: sha256(content),
			content: content.toString('base64'),
		})
	}
}

function buildBackup(opts = {}) {
	const configDir = opts.configDir || paths.USER_CONFIG_DIR
	const includeSecrets = opts.includeSecrets !== false
	const categories = parseCategories(opts.categories)
	const entries = []
	const skipped = []

	if (!fs.existsSync(configDir))
		throw new Error(`config dir does not exist: ${configDir}`)

	walk(configDir, '', { includeSecrets, categories }, entries, skipped)

	return {
		format: BACKUP_FORMAT,
		version: BACKUP_VERSION,
		createdAt: new Date().toISOString(),
		agentExecVersion: readPackageVersion(),
		source: {
			configDir,
			platform: process.platform,
			hostname: os.hostname(),
		},
		includeSecrets,
		categories,
		entries,
		skipped,
	}
}

function readPackageVersion() {
	try {
		return require(path.join(paths.PACKAGE_DIR, 'package.json')).version || null
	} catch {
		return null
	}
}

function writeBackup(file, data) {
	const out = path.resolve(file)
	fs.mkdirSync(path.dirname(out), { recursive: true })
	const json = JSON.stringify(data, null, 2) + '\n'
	const buf = out.endsWith('.gz') ? zlib.gzipSync(json) : Buffer.from(json, 'utf8')
	fs.writeFileSync(out, buf, { mode: 0o600 })
	try { fs.chmodSync(out, 0o600) } catch {}
	return out
}

function validateBackup(data) {
	if (data.format !== BACKUP_FORMAT)
		throw new Error('not an agent-exec backup')
	if (data.version !== BACKUP_VERSION)
		throw new Error(`unsupported backup version: ${data.version}`)
	if (!Array.isArray(data.entries))
		throw new Error('invalid backup: entries must be an array')
	for (const entry of data.entries) assertSafeRel(entry.path)
	return data
}

function readBackup(file) {
	const buf = fs.readFileSync(file)
	const text = file.endsWith('.gz')
		? zlib.gunzipSync(buf).toString('utf8')
		: buf.toString('utf8')
	try {
		return validateBackup(JSON.parse(text))
	} catch (e) {
		if (e.message === 'not an agent-exec backup') {
			throw new Error(`not an agent-exec backup: ${file}`)
		}
		throw e
	}
}

function packTransferPayload(data) {
	validateBackup(data)
	return {
		encoding: 'gzip+base64',
		payload: zlib.gzipSync(JSON.stringify(data)).toString('base64'),
	}
}

function unpackTransferPayload(body) {
	if (!body || typeof body !== 'object')
		throw new Error('transfer body must be an object')
	if (body.encoding === 'gzip+base64') {
		if (typeof body.payload !== 'string' || body.payload === '')
			throw new Error('transfer payload must be a non-empty string')
		const text = zlib.gunzipSync(Buffer.from(body.payload, 'base64')).toString('utf8')
		return validateBackup(JSON.parse(text))
	}
	if (body.backup && typeof body.backup === 'object') {
		return validateBackup(body.backup)
	}
	throw new Error('unsupported transfer payload')
}

function createPreImportDir(configDir = paths.USER_CONFIG_DIR) {
	return path.join(configDir, 'backups', `pre-import-${timestamp()}`)
}

function restoreBackup(data, opts = {}) {
	validateBackup(data)
	const configDir = opts.configDir || paths.USER_CONFIG_DIR
	const includeSecrets = opts.includeSecrets !== false
	const categories = parseCategories(opts.categories)
	const dryRun = !!opts.dryRun
	const preImportDir = opts.preImportDir || createPreImportDir(configDir)
	const restored = []
	const skipped = []
	const overwritten = []

	for (const entry of data.entries) {
		assertSafeRel(entry.path)
		const category = categoryForPath(entry.path)
		if (category !== 'other' && !categories.includes(category)) {
			skipped.push({ path: entry.path, reason: `category not selected: ${category}` })
			continue
		}
		if (!includeSecrets && entry.path === '.env') {
			skipped.push({ path: entry.path, reason: 'secret file' })
			continue
		}

		const dest = resolveInside(configDir, entry.path)
		if (entry.type === 'dir') {
			restored.push({ path: entry.path, type: 'dir' })
			if (!dryRun) {
				fs.mkdirSync(dest, { recursive: true })
				if (entry.mode) try { fs.chmodSync(dest, entry.mode) } catch {}
			}
			continue
		}

		if (entry.type !== 'file') {
			skipped.push({ path: entry.path, reason: `unsupported entry type: ${entry.type}` })
			continue
		}

		const content = Buffer.from(entry.content || '', 'base64')
		if (entry.sha256 && sha256(content) !== entry.sha256)
			throw new Error(`checksum mismatch for ${entry.path}`)

		if (fs.existsSync(dest)) {
			overwritten.push(entry.path)
			if (!dryRun) {
				const backupDest = resolveInside(preImportDir, entry.path)
				fs.mkdirSync(path.dirname(backupDest), { recursive: true })
				fs.copyFileSync(dest, backupDest)
			}
		}

		restored.push({ path: entry.path, type: 'file' })
		if (!dryRun) {
			fs.mkdirSync(path.dirname(dest), { recursive: true })
			fs.writeFileSync(dest, content, { mode: entry.path === '.env' ? 0o600 : (entry.mode || 0o600) })
			try { fs.chmodSync(dest, entry.path === '.env' ? 0o600 : (entry.mode || 0o600)) } catch {}
			if (entry.mtimeMs) {
				const t = entry.mtimeMs / 1000
				try { fs.utimesSync(dest, t, t) } catch {}
			}
		}
	}

	return { restored, skipped, overwritten, preImportDir: overwritten.length ? preImportDir : null }
}

module.exports = {
	BACKUP_FORMAT,
	BACKUP_VERSION,
	BACKUP_CATEGORIES,
	defaultBackupPath,
	parseCategories,
	buildBackup,
	writeBackup,
	readBackup,
	validateBackup,
	packTransferPayload,
	unpackTransferPayload,
	restoreBackup,
}
