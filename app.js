const { resolveEnvPath } = require('./modules/paths')
const envFile = resolveEnvPath()
require('dotenv').config({ path: envFile, quiet: true })

// Refuse startup unless API_KEY is set.
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
		if (u.searchParams.has('memo')) u.searchParams.set('memo', '[memo]')
		return u.pathname + u.search
	} catch {
		return String(url || '')
			.replace(/([?&]apiKey=)[^&]*/gi, '$1[redacted]')
			.replace(/([?&]memo=)[^&]*/gi, '$1[memo]')
	}
}

// Custom token that redacts apiKey from access logs.
logger.token('url-safe', req => redactUrl(req.originalUrl || req.url || ''))
const morganFmt = LOG_LEVEL === 'debug'
	? ':remote-addr - :remote-user [:date[clf]] ":method :url-safe HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
	: ':method :url-safe :status :response-time ms - :res[content-length]'
app.use(logger(morganFmt))

function memoValueFor(req) {
	if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'memo')) return req.body.memo
	const headerMemo = req.headers['x-agent-memo']
	if (headerMemo !== undefined) return Array.isArray(headerMemo) ? headerMemo.join(',') : String(headerMemo)
	if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'memo')) return req.query.memo
	return undefined
}

function memoLiteral(value) {
	return JSON.stringify(value)
}

function escapeInlineHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function requestLooksLikeSjs(req) {
	const p = ((req.originalUrl || req.url || '').split('?')[0] || '').toLowerCase()
	const accept = String(req.headers?.accept || '').toLowerCase()
	return p.endsWith('.sjs') || p.endsWith('.s.js') || p.endsWith('.js') || accept.includes('text/sjs')
}

function responseType(res) {
	return String(res.getHeader('Content-Type') || '').toLowerCase()
}

function injectMemoIntoString(req, res, body, memo) {
	const ct = responseType(res)
	const text = String(body)
	if (ct.includes('json')) {
		try {
			const obj = JSON.parse(text)
			if (obj && typeof obj === 'object' && !Array.isArray(obj) && !Object.prototype.hasOwnProperty.call(obj, 'memo')) {
				return JSON.stringify({ memo, ...obj })
			}
		} catch {}
		return body
	}
	if (ct.includes('html')) {
		const mark = `<p><small>agent-exec memo: <code>${escapeInlineHtml(typeof memo === 'string' ? memo : JSON.stringify(memo))}</code></small></p>`
		return text.includes('<body>') ? text.replace('<body>', `<body>${mark}`) : `${mark}${text}`
	}
	if (requestLooksLikeSjs(req) || ct.includes('text/sjs')) {
		if (/\bm\.memo\s*=/.test(text)) return body
		const line = `m.memo = ${memoLiteral(memo)};`
		const withMemo = /m\s*=\s*\{\};/.test(text)
			? text.replace(/(m\s*=\s*\{\};\s*)/, `$1\n${line}\n`)
			: `${line}\n${text}`
		return withMemo
	}
	if (ct.includes('markdown')) {
		return `> agent-exec memo: \`${String(memo).replace(/`/g, '\\`')}\`\n\n${text}`
	}
	if (ct.startsWith('text/')) {
		return `agent-exec memo: ${typeof memo === 'string' ? memo : JSON.stringify(memo)}\n\n${text}`
	}
	return body
}

// Agent memo is an opaque echo channel. The server never interprets or stores it.
app.use((req, res, next) => {
	const send = res.send.bind(res)
	res.send = function sendWithMemo(body) {
		const memo = memoValueFor(req)
		if (memo === undefined) return send(body)
		if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
			if (!Object.prototype.hasOwnProperty.call(body, 'memo')) body = { memo, ...body }
			return send(body)
		}
		if (typeof body === 'string') body = injectMemoIntoString(req, res, body, memo)
		return send(body)
	}
	next()
})

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

const { sendFormatted, escapeHtml } = require('./modules/respond')

// API_KEY extraction prefers X-API-Key / Authorization: Bearer.
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
	if (canReadPublicDoc && /^\/index\.(md|html|json)$/i.test(req.path)) return next()
	if (canReadPublicDoc && /\/SKILL\.(?:raw\.)?(md|html|json|sjs|s\.js)$/i.test(req.path)) return next()
	const auth = extractApiKey(req)
	if (verifyApiKey(auth.key)) {
		req.agentExecApiKeyId = audit.keyId(auth.key)
		req.agentExecAuthSource = auth.source
		req.agentExecQueryAuthUsed = auth.queryAuthUsed
		return next()
	}
	sendFormatted(res, 401, {
		error: 'unauthorized',
		hint: 'Provide API_KEY via X-API-Key header or Authorization: Bearer',
		path: (req.originalUrl || req.path || '').split('?')[0],
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
		hint: 'Provide API_KEY via X-API-Key header or Authorization: Bearer',
		path: (req.originalUrl || req.path || '').split('?')[0],
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
			if (safeQuery.memo) safeQuery.memo = '[memo]'
			parts.push(`query=${JSON.stringify(safeQuery)}`)
		}
		if (req.body && Object.keys(req.body).length) {
			const safeBody = { ...req.body }
			if (safeBody.memo) safeBody.memo = '[memo]'
			parts.push(`body=${JSON.stringify(safeBody)}`)
		}
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
function requestedResponseFormat(req) {
	const p = ((req.originalUrl || '').split('?')[0] || req.path || '').toLowerCase()
	if (p.endsWith('.sjs') || p.endsWith('.s.js')) return 'sjs'
	if (p.endsWith('.json')) return 'json'
	if (p.endsWith('.html')) return 'html'
	if (p.endsWith('.md')) return 'md'
	const qfmt = String(req.query?.format || '').toLowerCase()
	if (qfmt === 'sjs') return 'sjs'
	if (qfmt === 'json') return 'json'
	if (qfmt === 'html') return 'html'
	if (qfmt === 'md' || qfmt === 'markdown') return 'md'
	const accept = String(req.headers?.accept || '').toLowerCase()
	if (accept.includes('text/sjs')) return 'sjs'
	if (accept.includes('application/json')) return 'json'
	if (accept.includes('text/html')) return 'html'
	if (accept.includes('text/markdown')) return 'md'
	return null
}

function sendApi404(req, res) {
	const fmt = requestedResponseFormat(req)
	const host = req.get('host') || '<host>'
	const origin = `${req.protocol}://${host}`
	const reqPath = (req.originalUrl || req.path || '').split('?')[0]
	const curlLines = [
		`curl -s ${origin}/api`,
		`curl -s ${origin}/api/acl -H "X-API-Key: <API_KEY>"`,
		`curl -s ${origin}/api/plugins -H "X-API-Key: <API_KEY>"`,
		`curl -s ${origin}/api/exec/SKILL.md`,
		`curl -s ${origin}/SKILL.md`,
	]

	if (!fmt) {
		return res.status(404).type('text/plain').send(
			`404 not found\n\n` +
			`Unknown API path: ${reqPath}\n\n` +
			`Try with curl:\n${curlLines.join('\n')}\n`
		)
	}

	if (fmt === 'sjs') {
		return sendFormatted(res, 404, {
			error: 'not_found',
			path: reqPath,
		})
	}

	if (fmt === 'md') {
		return res.status(404).type('text/markdown').send(
			`# 404 not found\n\n` +
			`Unknown API path: \`${reqPath}\`\n\n` +
			`## Try with curl\n\n` +
			'```bash\n' +
			curlLines.join('\n') +
			'\n```\n'
		)
	}

	if (fmt === 'html') {
		const items = curlLines.map(line => `<li><code>${escapeHtml(line)}</code></li>`).join('')
		return res.status(404).type('text/html').send(
			`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>404</title></head><body>` +
			`<h1>404 not found</h1>` +
			`<p>Unknown API path: <code>${escapeHtml(reqPath)}</code></p>` +
			`<h2>Try with curl</h2><ul>${items}</ul>` +
			`</body></html>`
		)
	}

	return res.status(404).json({
		error: 'not_found',
		message: 'Unknown API path.',
		path: reqPath,
		read: '/SKILL.json',
		curl: curlLines,
		retry: {
			api: { method: 'GET', url: '/api' },
			acl: { method: 'GET', url: '/api/acl', headers: { 'X-API-Key': '<API_KEY>' } },
			plugins: { method: 'GET', url: '/api/plugins', headers: { 'X-API-Key': '<API_KEY>' } },
			execSkill: { method: 'GET', url: '/api/exec/SKILL.md' },
		},
	})
}

app.use((req, res) => {
	if (req.path === '/api' || req.path.startsWith('/api/')) return sendApi404(req, res)
	sendFormatted(res, 404, {
		error: 'not found',
		hint: 'Read /SKILL.md first, then inspect /api/acl with API_KEY in X-API-Key header before executing commands.',
		skill: '/SKILL.md',
		path: req.path,
		suggest: [
			'GET /SKILL.md',
			'GET /api/acl',
			'GET /api/plugins',
			'POST /api/exec',
		],
		defaultFormat: 'json',
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
