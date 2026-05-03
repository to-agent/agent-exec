const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const { PACKAGE_DIR } = require('../../modules/paths')
const { fmtToSuffix, detectFormat, appendApiKey, escapeHtml, sendHtml, attachSkillRoutes, buildNavigation, injectNavigation } = require('../../modules/respond')

router.path = '/private'

// GET /private — guide response
function respondGuide(req, res, ext) {
	const fmt = detectFormat(req, ext)
	const link = (url) => appendApiKey(url, req)
	const sfx = fmtToSuffix(fmt)
	const nav = buildNavigation(req, fmt, { parent: '/', index: '/SKILL', related: ['/private/skills', '/api/plugins'] })

	if (fmt === 'json') {
		const body = {
			description: 'Private namespace. Requires API_KEY.',
			endpoints: [
				link(`/private/skills`),
				link(`/private/skills/:name/SKILL${sfx}`),
				link(`/private/skills/:name/references`),
			],
			hint: `Start with GET ${link('/private/skills')}`,
		}
		if (nav) body.navigation = nav
		return res.json(body)
	}

	if (fmt === 'html') {
		const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>private</title></head>
<body>
<h1>Private</h1>
<p>Requires API_KEY.</p>
<ul>
  <li><a href="${link(`/private/skills${sfx === '.html' ? '.html' : ''}`)}">/private/skills</a></li>
</ul>
</body></html>`
		return sendHtml(res, injectNavigation(html, nav, 'html'))
	}

	return res.type('text/markdown').send(injectNavigation(fs.readFileSync(path.join(PACKAGE_DIR, 'content/private/SKILL.md'), 'utf8'), nav, 'md'))
}

router.get('/', (req, res) => respondGuide(req, res, null))
router.get('/index.html', (req, res) => respondGuide(req, res, 'html'))
router.get('/index.json', (req, res) => respondGuide(req, res, 'json'))
router.get('/index.md',   (req, res) => respondGuide(req, res, 'md'))

// GET /private/SKILL.md .html .json
attachSkillRoutes(router)

module.exports = router
