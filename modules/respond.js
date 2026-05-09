'use strict'

/**
 * modules/respond.js — shared format detection and navigation responses
 *
 * detectFormat:  extension → Accept header → default format
 * appendApiKey:  compatibility helper; apiKey is never propagated into links
 * authHint:      navigation hint for header-based authentication
 * sendFormatted: consistent md/html/json navigation responses for 404/401/etc.
 */

const { buildSjsErrorBody, buildSjsDocumentPostFallback } = require('./sjs')

// Format → file extension.
function fmtToSuffix(fmt) {
	if (fmt === 'sjs') return '.s.js'
	return fmt === 'json' ? '.json' : fmt === 'html' ? '.html' : '.md'
}

// Extension → query format → Accept header → namespace default.
// defaultFmt: 'md' for /skills/** and /private/**, 'json' for /api/**.
function detectFormat(req, ext, defaultFmt = 'md') {
	if (ext) return ext
	// Use originalUrl so mounted routers still detect suffixes when req.path is shortened to '/'.
	const p = ((req.originalUrl || '').split('?')[0] || req.path || '').toLowerCase()
	if (p.endsWith('.json')) return 'json'
	if (p.endsWith('.html')) return 'html'
	if (p.endsWith('.md'))   return 'md'
	if (p.endsWith('.sjs') || p.endsWith('.s.js')) return 'sjs'
	const qfmt = String(req.query?.format || '').toLowerCase()
	if (qfmt === 'json') return 'json'
	if (qfmt === 'html') return 'html'
	if (qfmt === 'md' || qfmt === 'markdown') return 'md'
	const accept = req.headers?.['accept'] || ''
	if (accept.includes('text/sjs'))          return 'sjs'
	if (accept.includes('application/json')) return 'json'
	if (accept.includes('text/html'))        return 'html'
	if (accept.includes('text/markdown'))    return 'md'
	return defaultFmt
}

// apiKey is never propagated into links. This helper is kept for compatibility.
function appendApiKey(url, _req) {
	return url
}

// Escape HTML special characters.
function escapeHtml(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

// Header-auth hint.
function authHint(req, fmt) {
	if (fmt === 'md')   return '> Add `X-API-Key: <API_KEY>` header to access authenticated endpoints.'
	if (fmt === 'html') return '<p><small>Add <code>X-API-Key: &lt;API_KEY&gt;</code> header to access authenticated endpoints.</small></p>'
	return 'Add API_KEY in X-API-Key header to access authenticated endpoints.'
}

function normalizeRecoveryReason(error) {
	if (error === 'not found') return 'not_found'
	return error || 'error'
}

function stripFormatSuffix(path) {
	const p = String(path || '').split('?')[0] || ''
	if (p.endsWith('.s.js')) return p.slice(0, -5)
	if (p.endsWith('.sjs')) return p.slice(0, -4)
	if (p.endsWith('.json')) return p.slice(0, -5)
	if (p.endsWith('.html')) return p.slice(0, -5)
	if (p.endsWith('.md')) return p.slice(0, -3)
	return p
}

function rootRecoveryCandidates(path) {
	const base = stripFormatSuffix(path).replace(/\/+$/, '')
	const parts = base.split('/').filter(Boolean)
	if (!parts.length) return []

	const urls = [`/${parts.join('/')}/SKILL.s.js`]
	if (parts.length > 1) urls.push(`/${parts.slice(0, -1).join('/')}/SKILL.s.js`)

	return [...new Set(urls)]
		.filter(url => url !== '/SKILL.s.js')
		.map(url => ({ url, verified: false }))
}

function rootRecovery(status, error, path) {
	const p = path || ''
	const recovery = {
		result: {
			status: Number(status) || 404,
			type: 'fallback',
			reason: normalizeRecoveryReason(error),
			path: p,
		},
		fallback: {
			method: 'GET',
			url: '/SKILL.s.js',
			document: '/SKILL.s.js',
		},
		refs: [
			'/SKILL.md',
			'/SKILL.json',
			'/SKILL.html',
		],
	}
	const candidates = rootRecoveryCandidates(p)
	if (candidates.length) recovery.candidates = candidates
	return recovery
}

function renderRootRecoveryMarkdown(status, error, recovery) {
	const candidateLines = Array.isArray(recovery.candidates) && recovery.candidates.length
		? `\n## Candidates\n\n${recovery.candidates.map(c => `- \`${c.url}\` (verified: ${c.verified})`).join('\n')}\n`
		: ''
	return (
		`# ${status} ${error || 'Error'}\n\n` +
		`## Result\n\n` +
		`- status: \`${recovery.result.status}\`\n` +
		`- type: \`${recovery.result.type}\`\n` +
		`- reason: \`${recovery.result.reason}\`\n` +
		`- path: \`${recovery.result.path}\`\n\n` +
		`## Fallback\n\n` +
		`- \`${recovery.fallback.method} ${recovery.fallback.url}\`\n` +
		`- document: \`${recovery.fallback.document}\`\n` +
		candidateLines +
		`\n## References\n\n` +
		recovery.refs.map(ref => `- \`${ref}\``).join('\n') +
		`\n`
	)
}

function renderRootRecoveryHtml(status, error, recovery) {
	const candidates = Array.isArray(recovery.candidates) && recovery.candidates.length
		? `<h2>Candidates</h2><ul>${recovery.candidates.map(c => `<li><code>${escapeHtml(c.url)}</code> <small>verified: ${c.verified}</small></li>`).join('')}</ul>`
		: ''
	const refs = recovery.refs.map(ref => `<li><a href="${escapeHtml(ref)}">${escapeHtml(ref)}</a></li>`).join('')
	return (
		`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${status}</title></head><body>` +
		`<h1>${status} ${escapeHtml(error || 'Error')}</h1>` +
		`<h2>Result</h2><ul>` +
		`<li>status: <code>${recovery.result.status}</code></li>` +
		`<li>type: <code>${escapeHtml(recovery.result.type)}</code></li>` +
		`<li>reason: <code>${escapeHtml(recovery.result.reason)}</code></li>` +
		`<li>path: <code>${escapeHtml(recovery.result.path)}</code></li>` +
		`</ul>` +
		`<h2>Fallback</h2><p><code>${escapeHtml(recovery.fallback.method)} ${escapeHtml(recovery.fallback.url)}</code></p>` +
		`<p>Document: <a href="${escapeHtml(recovery.fallback.document)}">${escapeHtml(recovery.fallback.document)}</a></p>` +
		candidates +
		`<h2>References</h2><ul>${refs}</ul>` +
		`</body></html>`
	)
}

function sendSjsError(res, status, details = {}) {
	return res.status(200).type('text/sjs').send(buildSjsErrorBody(status, details))
}

function sendSjsDocumentPostFallback(res, reqPath) {
	return res.status(200).type('text/sjs').send(buildSjsDocumentPostFallback(reqPath))
}

function sendFormatted(res, status, { error, hint, skill, path: reqPath, suggest, fields, defaultFormat, formatAwareRecovery } = {}) {
	const req = res.req
	const urlPath = ((req?.originalUrl || req?.path || '').split('?')[0] || '')
	const defaultFmt = defaultFormat || (urlPath === '/api' || urlPath.startsWith('/api/') ? 'json' : 'md')
	const fmt = detectFormat(req, null, defaultFmt)
	const ext = fmtToSuffix(fmt)
	const recovery = formatAwareRecovery === 'root' ? rootRecovery(status, error, reqPath || urlPath) : null
	if (recovery) {
		if (fmt === 'sjs') {
			return sendSjsError(res, status, { error, path: reqPath || urlPath, fields, fallback: recovery.fallback, candidates: recovery.candidates, refs: recovery.refs })
		}
		if (fmt === 'md') {
			return res.status(status).type('text/markdown').send(renderRootRecoveryMarkdown(status, error, recovery))
		}
		if (fmt === 'html') {
			res.status(status)
			return sendHtml(res, renderRootRecoveryHtml(status, error, recovery))
		}
		return res.status(status).json(recovery)
	}
	const recoveryLegacy = {}
	const nav = recoveryLegacy.suggest || suggest || []
	const hintText = recoveryLegacy.hint || hint
	const skillUrl = recoveryLegacy.skill || skill || `/SKILL${ext}`

	if (fmt === 'sjs') {
		return sendSjsError(res, status, { error, path: reqPath || urlPath, fields, skill: skillUrl })
	}

	if (fmt === 'md') {
		const lines = nav.length ? `\n## Navigation\n\n${nav.map(s => `- \`${s}\``).join('\n')}\n` : ''
		return res.status(status).type('text/markdown').send(
			`# ${status} ${error || 'Error'}\n\n${hintText ? hintText + '\n' : ''}${lines}\nRead \`${skillUrl}\` for documentation.\n`
		)
	}

	if (fmt === 'html') {
		const items = nav.map(s => `<li><code>${s}</code></li>`).join('')
		res.status(status)
		return sendHtml(res,
			`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${status}</title></head><body>` +
			`<h1>${status} ${error || 'Error'}</h1>` +
			(hintText ? `<p>${hintText}</p>` : '') +
			(items ? `<h2>Navigation</h2><ul>${items}</ul>` : '') +
			`<p>Read <a href="${skillUrl}">${skillUrl}</a></p>` +
			`</body></html>`
		)
	}

	const body = { error }
	if (hintText) body.hint = hintText
	if (skillUrl) body.skill = skillUrl
	if (recoveryLegacy.sjs) body.sjs = recoveryLegacy.sjs
	if (reqPath) body.path = reqPath
	if (nav.length) body.suggest = nav
	return res.status(status).json(body)
}

/**
 * buildNavigation — returns traversal links for ?navigation=true.
 * @param {object} req   - Express request
 * @param {string} fmt   - 'md' | 'html' | 'json'
 * @param {object} links - { parent?, index?, related? }
 * @returns {string|object|null}
 */
/**
 * buildNavigation — returns traversal links for ?navigation=true.
 *
 * @param {string} parent  - Parent listing base path, e.g. '/skills' or '/private/skills'.
 *                           A format suffix is added automatically.
 * @param {string} index   - Root SKILL base path, e.g. '/SKILL'.
 *                           A format suffix is added automatically.
 * @param {string[]} related - Related URLs used as-is without suffix rewriting.
 */
function buildNavigation(req, fmt, { parent, index, related } = {}) {
	if (req?.query?.navigation !== 'true') return null

	const sfx = fmtToSuffix(fmt)
	const ak = (url) => {
		const sep = url.includes('?') ? '&' : '?'
		return url + sep + 'navigation=true'
	}

	if (fmt === 'md') {
		const lines = []
		if (parent)  lines.push(`- Parent: [${parent}${sfx}](${ak(parent + sfx)})`)
		if (index)   lines.push(`- Index: [${index}${sfx}](${ak(index + sfx)})`)
		if (related) related.forEach(r => lines.push(`- Related: [${r}](${ak(r)})`))
		return (
			`\n---\n\n## Navigation[^nav]\n` +
			lines.join('\n') +
			`\n\n[^nav]: Appended by agent-exec via \`?navigation=true\`. Not part of skill definition.\n`
		)
	}

	if (fmt === 'html') {
		const items = []
		if (parent)  items.push(`<a href="${ak(parent + sfx)}">${parent}</a>`)
		if (index)   items.push(`<a href="${ak(index + sfx)}">${index}</a>`)
		if (related) related.forEach(r => items.push(`<a href="${ak(r)}">${r}</a>`))
		return (
			`<footer style="margin-top:2em;border-top:1px solid #ccc;padding-top:0.5em;font-size:0.85em">` +
			`<nav>${items.join(' &nbsp;|&nbsp; ')}</nav>` +
			`<small><code>?navigation=true</code> — not part of skill definition</small>` +
			`</footer>`
		)
	}

	// json
	const nav = { _: '?navigation=true — not part of skill definition' }
	if (parent)  nav.parent  = ak(parent + sfx)
	if (index)   nav.index   = ak(index + sfx)
	if (related) nav.related = related.map(r => ak(r))
	return nav
}

/**
 * propagateQueryParams — add safe traversal query params to relative HTML links.
 * apiKey is never propagated.
 */
function propagateQueryParams(html, req) {
	const navigation = req?.query?.navigation
	if (!navigation) return html

	const param = `navigation=${encodeURIComponent(navigation)}`
	return html.replace(/href="([^"]*)"/g, (match, url) => {
		if (/^(https?:|mailto:|\/\/|#)/.test(url)) return match
		if (url.includes('navigation=')) return match
		const sep = url.includes('?') ? '&' : '?'
		return `href="${url}${sep}${param}"`
	})
}

/**
 * injectNavigation — inject navigation into content according to response format.
 * @param {string} content - Original content string; JSON may be string or object.
 * @param {*} nav          - Value returned by buildNavigation.
 * @param {string} fmt     - 'md' | 'html' | 'json'
 * @returns {string}
 */
function injectNavigation(content, nav, fmt) {
	if (!nav) return content
	if (fmt === 'md') return content + nav
	if (fmt === 'sjs') return content
	if (fmt === 'html') {
		return content.includes('</body>')
			? content.replace('</body>', nav + '</body>')
			: content + nav
	}
	// json
	const obj = typeof content === 'string' ? JSON.parse(content) : content
	obj.navigation = nav
	return JSON.stringify(obj, null, 2)
}

/**
 * sendHtml — common helper for HTML responses.
 * Core routes use this so safe query propagation stays consistent.
 * Plugin authors can use res.type('text/html').send() directly without transformation.
 */
function sendHtml(res, html) {
	return res.type('text/html').send(propagateQueryParams(html, res.req))
}

/**
 * serveMarkdown — return Markdown content as md/html/json based on detectFormat.
 */
function serveMarkdown(req, res, content, { status = 200, nav, extraJson } = {}) {
	const fmt = detectFormat(req)
	const { toHtml, parseMeta } = require('./convert')

	if (fmt === 'html') {
		let html = toHtml(content)
		if (nav) html = injectNavigation(html, nav, 'html')
		return sendHtml(res.status(status), html)
	}

	if (fmt === 'json') {
		const meta = extraJson !== undefined ? parseMeta(content) : {}
		const obj = { ...meta, ...(extraJson || {}), lines: content.split('\n') }
		if (nav) obj.navigation = nav
		return res.status(status).json(obj)
	}

	let out = content
	if (nav) out = injectNavigation(out, nav, 'md')
	return res.status(status).type('text/markdown').send(out)
}

/**
 * attachSkillRoutes — read content/<router.path>/SKILL.md and register
 * /SKILL.md, /SKILL.html, /SKILL.json, and /SKILL.s.js together.
 */
function inferSkillNavigation(routerPath) {
	const parts = String(routerPath || '').split('/').filter(Boolean)
	const parent = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : undefined
	return { parent, index: '/SKILL' }
}

function inferSkillVisibility(routerPath) {
	const p = String(routerPath || '')
	return p.startsWith('/private') || p.startsWith('/cli') ? 'private' : 'public'
}

function attachSkillRoutes(router, navigationOptions) {
	const fs = require('fs')
	const path = require('path')
	const { PACKAGE_DIR } = require('./paths')
	const skillPath = path.join(PACKAGE_DIR, 'content', router.path, 'SKILL.md')
	const skipSjs = Boolean(navigationOptions?.skipSjs)
	const navOptions = navigationOptions ? { ...navigationOptions } : inferSkillNavigation(router.path)
	delete navOptions.skipSjs
	const document = `${router.path}/SKILL.s.js`
	const rawDocument = `${router.path}/SKILL.raw.s.js`
	const visibility = inferSkillVisibility(router.path)

	function serve(req, res, ext) {
		const content = fs.readFileSync(skillPath, 'utf8')
		const fmt = detectFormat(req, ext)
		const nav = buildNavigation(req, fmt, navOptions)
		serveMarkdown(req, res, content, { nav, extraJson: {} })
	}

	function serveRaw(req, res, fmt) {
		const convert = require('./convert')
		const content = fs.readFileSync(skillPath, 'utf8')
		const meta = convert.parseMeta(content)
		const name = meta.skill || String(router.path || '').replace(/^\//, '').replace(/\//g, '_') || 'skill'
		const result = convert.renderSkillContent(name, content, fmt, visibility, {
			ignoreAe: true,
			base: router.path,
			document: rawDocument,
		})

		if (fmt === 'json') return res.json(JSON.parse(result))
		if (fmt === 'html') return sendHtml(res, result)
		if (fmt === 'sjs') return res.type('text/sjs').send(result)
		return res.type('text/markdown').send(result)
	}

	function serveSjs(req, res) {
		const convert = require('./convert')
		const content = fs.readFileSync(skillPath, 'utf8')
		const meta = convert.parseMeta(content)
		const name = meta.skill || String(router.path || '').replace(/^\//, '').replace(/\//g, '_') || 'skill'
		const result = convert.renderSkillContent(name, content, 'sjs', visibility, {
			base: router.path,
			document,
		})
		return res.type('text/sjs').send(result)
	}

	router.get('/SKILL.md',   (req, res) => serve(req, res, 'md'))
	router.get('/SKILL.html', (req, res) => serve(req, res, 'html'))
	router.get('/SKILL.json', (req, res) => serve(req, res, 'json'))
	if (!skipSjs) {
		router.get('/SKILL.s.js', serveSjs)
		router.post('/SKILL.s.js', (req, res) => sendSjsDocumentPostFallback(res, document))
		router.get('/SKILL.sjs', serveSjs)
		router.post('/SKILL.sjs', (req, res) => sendSjsDocumentPostFallback(res, document))
	}
	router.get('/SKILL.raw.json', (req, res) => serveRaw(req, res, 'json'))
	router.get('/SKILL.raw.html', (req, res) => serveRaw(req, res, 'html'))
	router.get('/SKILL.raw.s.js', (req, res) => serveRaw(req, res, 'sjs'))
	router.get('/SKILL.raw.sjs', (req, res) => serveRaw(req, res, 'sjs'))
}

module.exports = { fmtToSuffix, detectFormat, appendApiKey, authHint, escapeHtml, sendFormatted, sendSjsDocumentPostFallback, buildNavigation, injectNavigation, propagateQueryParams, sendHtml, serveMarkdown, attachSkillRoutes }
