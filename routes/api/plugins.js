const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const pluginControl = require('../../modules/plugin-control')
const { fmtToSuffix, detectFormat, appendApiKey, escapeHtml, sendHtml, attachSkillRoutes, buildNavigation, injectNavigation } = require('../../modules/respond')
const { pluginsRuntimeSjs } = require('../../modules/sjs')

router.path = '/api/plugins'

// GET /api/plugins/SKILL.md .html .json
attachSkillRoutes(router)

router.get('/', (req, res) => {
	const fmt = detectFormat(req, null, 'json')
	const sfx = fmtToSuffix(fmt)
	const nav = buildNavigation(req, fmt, { parent: '/api', index: '/SKILL', related: ['/api/acl', '/private/skills'] })

	const plugins = []
	for (const [name, pluginDir] of pluginControl.activePluginMap()) {
		if (fs.existsSync(path.join(pluginDir, 'SKILL.md'))) {
			plugins.push({
				name,
				skill: appendApiKey(`/private/skills/${name}/SKILL${sfx}`, req),
			})
		}
	}

	if (fmt === 'sjs') {
		return res.type('text/sjs').send(pluginsRuntimeSjs({ plugins }))
	}

	if (fmt === 'html') {
		const items = plugins.map(p => `<li><a href="${p.skill}">${escapeHtml(p.name)}</a></li>`).join('\n')
		const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>plugins</title>
<style>body{font-family:monospace;max-width:720px;margin:40px auto;padding:0 20px}a{color:#0066cc}</style>
</head><body>
<h1>Plugins</h1>
<ul>${items}</ul>
<p><a href="/api/plugins/SKILL.html">SKILL.html</a></p>
</body></html>`
		return sendHtml(res, injectNavigation(html, nav, 'html'))
	}

	if (fmt === 'json') {
		const body = { plugins }
		if (nav) body.navigation = nav
		return res.json(body)
	}

	const mdLines = plugins.map(p => `- [${p.name}](${p.skill})`).join('\n')
	res.type('text/markdown').send(injectNavigation(`# Plugins\n\n${mdLines || '(none)'}\n`, nav, 'md'))
})

module.exports = router
