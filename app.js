const { resolveEnvPath } = require('./modules/paths')
const envFile = resolveEnvPath()
require('dotenv').config({ path: envFile, quiet: true })

// Refuse startup without API_KEY.
if (!process.env.API_KEY) {
	console.error('\n[ERROR] API_KEY is not set.')
	console.error(`  No API_KEY was found in ${envFile} or the process environment.`)
	console.error('  Run first-time setup:')
	console.error('    aexec setup')
	console.error('  Then start again:')
	console.error('    aexec start\n')
	process.exit(1)
}

const crypto = require('crypto')
const express = require('express')
const path = require('path')
const cookieParser = require('cookie-parser')
const logger = require('morgan')
const audit = require('./modules/audit')

const app = express()
{
	app.use(require('helmet')())
	// CORS is disabled by default. Enable it explicitly with CORS_ORIGIN.
	// Example: CORS_ORIGIN=* or CORS_ORIGIN=https://example.com,https://other.com
	const corsOrigin = process.env.CORS_ORIGIN
	if (corsOrigin) {
		const origins = corsOrigin === '*' ? '*' : corsOrigin.split(',').map(s => s.trim())
		app.use(require('cors')({ origin: origins }))
	}
}

app.use((req, res, next) => {
	req.id = crypto.randomUUID()
	res.setHeader('X-Request-ID', req.id)
	next()
})

// Master switch: reject all requests unless AGENT_EXEC_ENABLED=true.
// /ping is the only exception for health checks.
app.use((req, res, next) => {
	if (req.path === '/ping') return next()
	if (process.env.AGENT_EXEC_ENABLED !== 'true') {
		return res.status(503).json({ error: 'agent-exec is disabled', hint: 'Set AGENT_EXEC_ENABLED=true in .env to enable' })
	}
	next()
})

const LOG_LEVEL = process.env.LOG_LEVEL || 'info'

function redactUrl(url) {
	try {
		const u = new URL(url, 'http://agent-exec.local')
		if (u.searchParams.has('apiKey')) u.searchParams.set('apiKey', '[redacted]')
		return u.pathname + u.search
	} catch {
		return String(url || '').replace(/([?&]apiKey=)[^&]*/gi, '$1[redacted]')
	}
}

// Custom token that redacts apiKey from access logs.
logger.token('url-safe', req => redactUrl(req.originalUrl || req.url || ''))
const morganFmt = LOG_LEVEL === 'debug'
	? ':remote-addr - :remote-user [:date[clf]] ":method :url-safe HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
	: ':method :url-safe :status :response-time ms - :res[content-length]'
app.use(logger(morganFmt))

// rateLimit is enabled only when configured in settings.json.
const settings = require('./modules/settings')
{
	const rl = settings.load().rateLimit
	if (rl && rl.max) {
		const rateLimit = require('express-rate-limit')
		app.use(rateLimit({ windowMs: rl.windowMs || 60000, max: rl.max }))
	}
}

// IP access control uses req.ip and does not trust X-Forwarded-For.
// Configure app.set('trust proxy', ...) explicitly when running behind a proxy.
app.use((req, res, next) => {
	const denied = settings.checkIp(req.ip)
	if (denied) return res.status(403).type('text/plain').send(denied)
	next()
})

const { sendFormatted } = require('./modules/respond')

// API key extraction prefers X-API-Key / Authorization: Bearer.
// ?apiKey= is disabled by default because URLs are easy to leak.
// It is accepted only for compatibility when AGENT_EXEC_ALLOW_QUERY_API_KEY=true.
function extractApiKey(req) {
	const xApiKey = req.headers['x-api-key']
	if (xApiKey) return { key: String(xApiKey), source: 'header', queryAuthUsed: false }

	const auth = req.headers['authorization'] || ''
	const bearer = String(auth).match(/^Bearer\s+(.+)$/i)
	if (bearer) return { key: bearer[1], source: 'bearer', queryAuthUsed: false }

	if (process.env.AGENT_EXEC_ALLOW_QUERY_API_KEY === 'true' && req.query.apiKey) {
		return { key: String(req.query.apiKey), source: 'query', queryAuthUsed: true }
	}

	return { key: undefined, source: 'unknown', queryAuthUsed: false }
}

function verifyApiKey(key) {
	try {
		const expected = Buffer.from(process.env.API_KEY)
		const provided = Buffer.from(key)
		return expected.length === provided.length && crypto.timingSafeEqual(expected, provided)
	} catch {
		return false
	}
}

// /api/*: SKILL documents are public so agents can discover documentation.
function requireApiKey(req, res, next) {
	const canReadPublicDoc = req.method === 'GET' || req.method === 'HEAD'
	if (canReadPublicDoc && (req.path === '/' || req.path === '')) return next()
	if (canReadPublicDoc && /^\/index\.(md|html|json)$/.test(req.path)) return next()
	if (canReadPublicDoc && /\/SKILL\.(md|html|json)$/.test(req.path)) return next()
	const auth = extractApiKey(req)
	if (verifyApiKey(auth.key)) {
		req.agentExecApiKeyId = audit.keyId(auth.key)
		req.agentExecAuthSource = auth.source
		req.agentExecQueryAuthUsed = auth.queryAuthUsed
		return next()
	}
	sendFormatted(res, 401, {
		error: 'unauthorized',
		hint: 'Provide API key via X-API-Key header or Authorization: Bearer',
		path: req.path,
	})
}

// /private/* requires auth for every path, including SKILL documents.
function requireApiKeyStrict(req, res, next) {
	const auth = extractApiKey(req)
	if (verifyApiKey(auth.key)) {
		req.agentExecApiKeyId = audit.keyId(auth.key)
		req.agentExecAuthSource = auth.source
		req.agentExecQueryAuthUsed = auth.queryAuthUsed
		return next()
	}
	sendFormatted(res, 401, {
		error: 'unauthorized',
		hint: 'Provide API key via X-API-Key header or Authorization: Bearer',
		path: req.path,
	})
}

app.use('/api', requireApiKey)
app.use(['/private', '/private.md', '/private.html', '/private.json'], requireApiKeyStrict)
app.use(['/cli', '/cli.md', '/cli.html', '/cli.json'], requireApiKeyStrict)

function requestBodyLimit() {
	const raw = process.env.AGENT_EXEC_MAX_REQUEST_BODY_BYTES
		?? process.env.AGENT_EXEC_BODY_LIMIT
		?? settings.load().maxRequestBodyBytes
		?? '1mb'
	const n = Number(raw)
	return Number.isFinite(n) && n > 0 ? n : raw
}

// Body parsers run after rate limit, IP checks, and namespace auth so
// unauthenticated clients cannot force JSON parsing work on protected routes.
app.use(express.json({ limit: requestBodyLimit() }))
app.use(express.urlencoded({ extended: false, limit: requestBodyLimit() }))
app.use(cookieParser())

// LOG_LEVEL=debug prints request details with apiKey masked.
if (LOG_LEVEL === 'debug') {
	app.use((req, res, next) => {
		const parts = []
		if (Object.keys(req.query).length) {
			const safeQuery = { ...req.query }
			if (safeQuery.apiKey) safeQuery.apiKey = '***'
			parts.push(`query=${JSON.stringify(safeQuery)}`)
		}
		if (req.body && Object.keys(req.body).length) parts.push(`body=${JSON.stringify(req.body)}`)
		if (parts.length) console.debug(`  ↳ ${req.method} ${req.path} | ${parts.join(' | ')}`)
		next()
	})
}

// Auto-load routes. Each router declares its mount point with router.path.
{
	const fs = require('fs')
	function findJsFiles(dir) {
		const results = []
		for (const name of fs.readdirSync(dir)) {
			const full = path.join(dir, name)
			if (fs.statSync(full).isDirectory()) results.push(...findJsFiles(full))
			else if (name.endsWith('.js')) results.push(full)
		}
		return results
	}
	const files = findJsFiles(path.join(__dirname, 'routes'))
	files.forEach(file => {
		if (!file.endsWith('.js')) return
		const m = require(file)
		if (m.name !== 'router') return
		if (m.disabled) return
		typeof m.app === 'function' && m.app(app)
		app.use(m.path || '/', m)
			// Mount extension suffixes on the same router.
			// /api/acl.md reaches the acl router with req.path='/' while detectFormat uses req.originalUrl.
		if (m.path && m.path !== '/') {
			app.use(m.path + '.md',   m)
			app.use(m.path + '.html', m)
			app.use(m.path + '.json', m)
		}
	})
}

// Plugin routes: mount exec/trusted routes(router, api) under /api/command/${name}.
require('./modules/plugin-runtime').mountRoutes(app)

// Static files such as /index.html.
app.use(express.static(path.join(__dirname, 'public')))

// 404
app.use((req, res) => {
	sendFormatted(res, 404, {
		error: 'not found',
		hint: 'Read /SKILL.md first, then inspect /api/acl with X-API-Key before executing commands.',
		skill: '/SKILL.md',
		path: req.path,
		suggest: [
			'GET /SKILL.md',
			'GET /api/acl',
			'GET /api/plugins',
			'POST /api/exec',
		],
	})
})

// 500
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
	const status = err.type === 'entity.parse.failed' ? 400
		: err.type === 'entity.too.large' ? 413
			: err.status || 500
	const hint = err.type === 'entity.parse.failed' ? '{"args": ["cmd", "arg1"]}' : undefined
	sendFormatted(res, status, { error: err.message || 'internal server error', hint })
})

module.exports = app
