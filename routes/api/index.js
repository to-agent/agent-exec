const express = require('express')
const router = express.Router()
const { detectFormat, sendHtml, attachSkillRoutes, escapeHtml, buildNavigation, injectNavigation } = require('../../modules/respond')

router.path = '/api'

// GET /api/SKILL.md .html .json — no auth required (documentation only)
attachSkillRoutes(router)

// Public namespace index. It returns navigation only and does not expose protected data.
function respondIndex(req, res, ext) {
	const endpoints = [
		{ method: 'GET',  path: '/api/SKILL.md', description: 'API documentation' },
		{ method: 'GET',  path: '/api/acl',      description: 'Allowed and denied commands' },
		{ method: 'GET',  path: '/api/plugins',  description: 'Active plugin documentation links' },
		{ method: 'POST', path: '/api/exec',     description: 'Execute an allowed command' },
	]
	const fmt = detectFormat(req, ext, 'json')
	const nav = buildNavigation(req, fmt, { index: '/SKILL', related: ['/api/acl', '/api/plugins', '/api/exec/SKILL.md'] })

	if (fmt === 'json') {
		const body = {
		name: 'agent-exec API',
		description: 'Command execution and discovery endpoints.',
		endpoints,
		}
		if (nav) body.navigation = nav
		return res.json(body)
	}

	if (fmt === 'html') {
		const items = endpoints.map(e =>
			`<li><code>${escapeHtml(e.method)} ${escapeHtml(e.path)}</code> — ${escapeHtml(e.description)}</li>`
		).join('')
		return sendHtml(res, injectNavigation(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>agent-exec API</title></head><body><h1>agent-exec API</h1><ul>${items}</ul></body></html>`, nav, 'html'))
	}

	const lines = endpoints.map(e => `- \`${e.method} ${e.path}\` — ${e.description}`).join('\n')
	return res.type('text/markdown').send(injectNavigation(`# agent-exec API\n\n${lines}\n`, nav, 'md'))
}

router.get('/',           (req, res) => respondIndex(req, res, null))
router.get('/index.html', (req, res) => respondIndex(req, res, 'html'))
router.get('/index.json', (req, res) => respondIndex(req, res, 'json'))
router.get('/index.md',   (req, res) => respondIndex(req, res, 'md'))

module.exports = router
