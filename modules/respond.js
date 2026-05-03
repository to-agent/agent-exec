'use strict'

/**
 * modules/respond.js — shared format detection and navigation responses
 *
 * detectFormat:  extension → Accept header → default format
 * appendApiKey:  compatibility helper; apiKey is never propagated into links
 * authHint:      navigation hint for header-based authentication
 * sendFormatted: consistent md/html/json navigation responses for 404/401/etc.
 */

// Format → file extension.
function fmtToSuffix(fmt) {
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
	const qfmt = String(req.query?.format || '').toLowerCase()
	if (qfmt === 'json') return 'json'
	if (qfmt === 'html') return 'html'
	if (qfmt === 'md' || qfmt === 'markdown') return 'md'
	const accept = req.headers?.['accept'] || ''
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

function sendFormatted(res, status, { error, hint, skill, path: reqPath, suggest }) {
	const req = res.req
	const urlPath = ((req?.originalUrl || req?.path || '').split('?')[0] || '')
	const defaultFmt = urlPath === '/api' || urlPath.startsWith('/api/') ? 'json' : 'md'
	const fmt = detectFormat(req, null, defaultFmt)
	const nav = suggest || []
	const ext = fmtToSuffix(fmt)
	const skillUrl = skill || `/SKILL${ext}`

	if (fmt === 'md') {
		const lines = nav.length ? `\n## Navigation\n\n${nav.map(s => `- \`${s}\``).join('\n')}\n` : ''
		return res.status(status).type('text/markdown').send(
			`# ${status} ${error || 'Error'}\n\n${hint ? hint + '\n' : ''}${lines}\nRead \`${skillUrl}\` for documentation.\n`
		)
	}

	if (fmt === 'html') {
		const items = nav.map(s => `<li><code>${s}</code></li>`).join('')
		res.status(status)
		return sendHtml(res,
			`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${status}</title></head><body>` +
			`<h1>${status} ${error || 'Error'}</h1>` +
			(hint ? `<p>${hint}</p>` : '') +
			(items ? `<h2>Navigation</h2><ul>${items}</ul>` : '') +
			`<p>Read <a href="${skillUrl}">${skillUrl}</a></p>` +
			`</body></html>`
		)
	}

	const body = { error }
	if (hint) body.hint = hint
	if (skillUrl) body.skill = skillUrl
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
 * /SKILL.md, /SKILL.html, and /SKILL.json together.
 */
function inferSkillNavigation(routerPath) {
	const parts = String(routerPath || '').split('/').filter(Boolean)
	const parent = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : undefined
	return { parent, index: '/SKILL' }
}

function attachSkillRoutes(router, navigationOptions) {
	const fs = require('fs')
	const path = require('path')
	const { PACKAGE_DIR } = require('./paths')
	const skillPath = path.join(PACKAGE_DIR, 'content', router.path, 'SKILL.md')
	const navOptions = navigationOptions || inferSkillNavigation(router.path)

	function serve(req, res, ext) {
		const content = fs.readFileSync(skillPath, 'utf8')
		const fmt = detectFormat(req, ext)
		const nav = buildNavigation(req, fmt, navOptions)
		serveMarkdown(req, res, content, { nav, extraJson: {} })
	}

	router.get('/SKILL.md',   (req, res) => serve(req, res, 'md'))
	router.get('/SKILL.html', (req, res) => serve(req, res, 'html'))
	router.get('/SKILL.json', (req, res) => serve(req, res, 'json'))
}

module.exports = { fmtToSuffix, detectFormat, appendApiKey, authHint, escapeHtml, sendFormatted, buildNavigation, injectNavigation, propagateQueryParams, sendHtml, serveMarkdown, attachSkillRoutes }
