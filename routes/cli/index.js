const express = require('express')
const router = express.Router()
const { detectFormat, sendHtml, attachSkillRoutes, escapeHtml, buildNavigation, injectNavigation } = require('../../modules/respond')

router.path = '/cli'

attachSkillRoutes(router)

function respondIndex(req, res, ext) {
	const endpoints = [
		{ method: 'GET',  path: '/cli/SKILL.md', description: 'CLI/admin namespace documentation' },
		{ method: 'POST', path: '/cli/transfer', description: 'Receive an ae transfer payload' },
	]
	const fmt = detectFormat(req, ext, 'json')
	const nav = buildNavigation(req, fmt, { index: '/SKILL', related: ['/cli/transfer/SKILL.md'] })

	if (fmt === 'json') {
		const body = {
		name: 'agent-exec CLI operations',
		description: 'Authenticated CLI/admin operations. Not part of normal agent discovery.',
		endpoints,
		}
		if (nav) body.navigation = nav
		return res.json(body)
	}

	if (fmt === 'html') {
		const items = endpoints.map(e =>
			`<li><code>${escapeHtml(e.method)} ${escapeHtml(e.path)}</code> — ${escapeHtml(e.description)}</li>`
		).join('')
		return sendHtml(res, injectNavigation(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>agent-exec CLI</title></head><body><h1>agent-exec CLI operations</h1><p>Authenticated CLI/admin operations. Not part of normal agent discovery.</p><ul>${items}</ul></body></html>`, nav, 'html'))
	}

	const lines = endpoints.map(e => `- \`${e.method} ${e.path}\` — ${e.description}`).join('\n')
	return res.type('text/markdown').send(injectNavigation(`# agent-exec CLI operations\n\nAuthenticated CLI/admin operations. Not part of normal agent discovery.\n\n${lines}\n`, nav, 'md'))
}

router.get('/',           (req, res) => respondIndex(req, res, null))
router.get('/index.html', (req, res) => respondIndex(req, res, 'html'))
router.get('/index.json', (req, res) => respondIndex(req, res, 'json'))
router.get('/index.md',   (req, res) => respondIndex(req, res, 'md'))

module.exports = router
