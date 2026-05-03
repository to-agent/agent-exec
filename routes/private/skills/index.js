const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const pluginControl = require('../../../modules/plugin-control')
const convert = require('../../../modules/convert')
const { fmtToSuffix, detectFormat, appendApiKey, buildNavigation, injectNavigation, sendHtml, serveMarkdown } = require('../../../modules/respond')

router.path = '/private/skills'

function listSkillPlugins() {
	const result = []
	for (const [name, pluginDir] of pluginControl.activePluginMap()) {
		if (fs.existsSync(path.join(pluginDir, 'SKILL.md'))) {
			result.push({ name, pluginDir })
		}
	}
	return result
}

function findPlugin(name) {
	const plugins = pluginControl.activePluginMap()
	return plugins.get(name) || null
}


function respondList(req, res, ext) {
	const fmt = detectFormat(req, ext)
	const plugins = listSkillPlugins()
	const sfx = fmtToSuffix(fmt)
	const link = (name) => appendApiKey(`/private/skills/${name}/SKILL${sfx}`, req)
	const refs  = (name) => appendApiKey(`/private/skills/${name}/references${sfx}`, req)
	const nav = buildNavigation(req, fmt, { parent: '/private', index: '/SKILL', related: ['/api/plugins', '/api/acl'] })

	if (fmt === 'json') {
		const body = {
			description: 'Private skills — detailed plugin documentation. Requires API_KEY.',
			skills: plugins.map(({ name }) => ({
				name,
				skill: link(name),
				references: refs(name),
			})),
		}
		if (nav) body.navigation = nav
		return res.json(body)
	}

	const lines = plugins.map(({ name }) => `- [${name}](${link(name)})`).join('\n')
	const md = `# Private Skills

${lines}
`
	serveMarkdown(req, res, md, { nav })
}

function respondSkillsNamespace(req, res, fmt) {
	const plugins = listSkillPlugins()
	const sfx = fmtToSuffix(fmt)
	const link = (name) => appendApiKey(`/private/skills/${name}/SKILL${sfx}`, req)
	const pluginLines = plugins.map(({ name }) => `- [${name}](${link(name)})`).join('\n')

	const md = `# SKILL: private/skills
# Description: Private skills — plugin usage documentation. Requires API_KEY.

## Overview

Each plugin provides a SKILL.md with commands, arguments, and usage examples.

## Available Skills

${pluginLines || '(none installed)'}

## How to use

1. Pick a skill from the list above and read its SKILL.md
2. Check allowed commands: \`GET /api/acl\`
3. Execute: \`POST /api/exec\` with \`{"args": ["<command>", ...]}\`

## Authentication

Required: \`X-API-Key: <API_KEY>\`.
`
	const nav = buildNavigation(req, fmt, { parent: '/private/skills', index: '/SKILL', related: ['/api/plugins', '/api/acl'] })
	serveMarkdown(req, res, md, { extraJson: {}, nav })
}

// GET /private/skills
router.get('/', (req, res) => respondList(req, res, null))
router.get('/index.html', (req, res) => respondList(req, res, 'html'))
router.get('/index.json', (req, res) => respondList(req, res, 'json'))
router.get('/index.md', (req, res) => respondList(req, res, 'md'))

// GET /private/skills/SKILL.md — documentation for the /private/skills namespace
router.get('/SKILL.:ext(md|html|json)', (req, res) => respondSkillsNamespace(req, res, req.params.ext))

// Load a plugin skill and return it in the requested format.
function serveSkill(req, res, name, ext) {
	const fmt = detectFormat(req, ext)
	const pluginDir = findPlugin(name)
	const skillPath = pluginDir ? path.join(pluginDir, 'SKILL.md') : null

	if (!skillPath || !fs.existsSync(skillPath)) {
		const sfx = fmtToSuffix(fmt)
		const available = listSkillPlugins().map(({ name: n }) => `/private/skills/${n}/SKILL${sfx}`)
		return convert.convert_notFound(res, { name, fmt, available })
	}

	const result = convert.getSkill(name, skillPath, fmt, 'private')
	const nav = buildNavigation(req, fmt, { parent: '/private/skills', index: '/SKILL' })
	const out = injectNavigation(result, nav, fmt)

	if (fmt === 'json') return res.json(JSON.parse(out))
	if (fmt === 'html') return sendHtml(res, out)
	return res.type('text/markdown').send(out)
}

// GET /private/skills/:name  /SKILL.md  /SKILL.json  /SKILL.html
router.get('/:name',            (req, res) => serveSkill(req, res, req.params.name, null))
router.get('/:name/SKILL.:ext(md|html|json)', (req, res) => serveSkill(req, res, req.params.name, req.params.ext))

// GET /private/skills/:name/references[.json|.html|.md]
function serveReferences(req, res, ext) {
	const fmt = detectFormat(req, ext)
	const name = req.params.name
	const pluginDir = findPlugin(name)
	const refsDir = pluginDir ? path.join(pluginDir, 'references') : null
	const sfx = fmtToSuffix(fmt)
	const nav = buildNavigation(req, fmt, { parent: `/private/skills/${name}/SKILL`, index: '/SKILL', related: [`/private/skills/${name}/SKILL${sfx}`] })

	if (!refsDir || !fs.existsSync(refsDir)) {
		return serveMarkdown(req, res, `# No references found\n`, { status: 404, nav })
	}

	const files = fs.readdirSync(refsDir)
		.filter(f => f.endsWith('.md'))
		.map(f => ({
			name: f.replace('.md', ''),
			url: appendApiKey(`/private/skills/${name}/references/${f.replace('.md', sfx)}`, req),
		}))

	if (fmt === 'json') {
		const body = { references: files }
		if (nav) body.navigation = nav
		return res.json(body)
	}

	const lines = files.map(f => `- [${f.name}](${f.url})`).join('\n')
	serveMarkdown(req, res, `# ${name} — References\n\n${lines}\n`, { nav })
}

router.get('/:name/references',      (req, res) => serveReferences(req, res, null))
router.get('/:name/references.json', (req, res) => serveReferences(req, res, 'json'))
router.get('/:name/references.html', (req, res) => serveReferences(req, res, 'html'))
router.get('/:name/references.md',   (req, res) => serveReferences(req, res, 'md'))

// GET /private/skills/:name/references/:file
router.get('/:name/references/:file', (req, res) => {
	const pluginDir = findPlugin(req.params.name)
	const base = req.params.file.replace(/\.(md|html|json)$/, '')
	const refPath = pluginDir ? path.join(pluginDir, 'references', base + '.md') : null

	if (!refPath || !fs.existsSync(refPath)) {
		return res.status(404).json({
			error: 'reference not found',
			name: req.params.name,
			file: base,
			hint: `GET /private/skills/${req.params.name}/references to list available references`,
		})
	}

	const fmt = detectFormat(req)
	const nav = buildNavigation(req, fmt, { parent: `/private/skills/${req.params.name}/references`, index: '/SKILL', related: [`/private/skills/${req.params.name}/SKILL.md`] })
	serveMarkdown(req, res, fs.readFileSync(refPath, 'utf8'), { nav })
})

module.exports = router
