const router = require('express').Router()
const fs = require('fs')
const path = require('path')
const convert = require('../modules/convert')
const { PACKAGE_DIR } = require('../modules/paths')
const pluginControl = require('../modules/plugin-control')
const { detectFormat, fmtToSuffix, buildNavigation, injectNavigation, sendHtml, sendSjsDocumentPostFallback } = require('../modules/respond')
const { rootSkillSjs, rootIndexJs, rootIndexSjs } = require('../modules/sjs')

router.path = '/'

const publicSkillsDir = path.join(PACKAGE_DIR, 'public', 'skills')

function publicSkills(fmt) {
	const sfx = fmtToSuffix(fmt)
	const names = new Set()
	if (fs.existsSync(publicSkillsDir)) {
		for (const name of fs.readdirSync(publicSkillsDir)) {
			if (fs.existsSync(path.join(publicSkillsDir, name, 'SKILL.md'))) names.add(name)
		}
	}
	for (const [name, pluginDir] of pluginControl.activePluginMap()) {
		if (fs.existsSync(path.join(pluginDir, 'public', 'SKILL.md'))) names.add(name)
	}
	return [...names].map(name => {
		const p1 = path.join(publicSkillsDir, name, 'SKILL.md')
		const pluginDir = pluginControl.activePluginMap().get(name)
		const p2 = pluginDir ? path.join(pluginDir, 'public', 'SKILL.md') : null
		const skillPath = fs.existsSync(p1) ? p1 : p2
		const meta = skillPath && fs.existsSync(skillPath)
			? convert.parseMeta(fs.readFileSync(skillPath, 'utf8'))
			: {}
		return {
			name,
			description: meta.description || '',
			endpoint: meta.endpoint || '',
			url: `/skills/${name}/SKILL${sfx}`,
		}
	})
}

router.get('/ping', (req, res) => res.send('pong'))

function projectEnvWarning(fmt) {
	if (process.env.AGENT_EXEC_PROJECT_ENV_MODE !== 'true') return null
	if (fmt === 'html') {
		return '<div style="border:1px solid #b7791f;background:#fffaf0;color:#7c2d12;padding:0.75rem;margin:0 0 1rem 0"><strong>Warning:</strong> Development runtime configuration is active.</div>'
	}
	if (fmt === 'json') {
		return 'Development runtime configuration is active.'
	}
	return '> WARNING: Development runtime configuration is active.\n'
}

function injectMarkdownWarning(content, warning) {
	if (!warning) return content
	const lines = content.split('\n')
	let insertAt = 0
	while (insertAt < lines.length && lines[insertAt].startsWith('# ')) insertAt++
	if (insertAt === 0) insertAt = 1
	lines.splice(insertAt, 0, '', warning.trim(), '')
	return lines.join('\n')
}

// /SKILL.md /SKILL.html /SKILL.json
// Express routing is case-insensitive by default, so /skill* reaches the same route.
function serveRootSkill(req, res, fmt) {
	if (fmt === null) fmt = detectFormat(req)
	if (fmt === 'sjs') return serveRootSkillSjs(req, res)
	const skillPath = path.join(__dirname, '../public/SKILL.md')
	if (!fs.existsSync(skillPath)) return res.status(404).send('SKILL.md not found')
	const result = convert.getSkill('_root', skillPath, fmt, 'public')
	const nav = buildNavigation(req, fmt, { related: ['/skills', '/api/acl', '/api/plugins'] })
	const out = injectNavigation(result, nav, fmt)
	const warning = projectEnvWarning(fmt)

	if (fmt === 'json') {
		const obj = JSON.parse(out)
		if (warning) obj.warning = warning
		return res.json(obj)
	}
	if (fmt === 'html') return sendHtml(res, warning ? warning + out : out)
	return res.type('text/markdown').send(injectMarkdownWarning(out, warning))
}

function serveRootSkillRaw(req, res, fmt) {
	const skillPath = path.join(__dirname, '../public/SKILL.md')
	if (!fs.existsSync(skillPath)) return res.status(404).send('SKILL.md not found')
	const result = convert.getSkill('_root', skillPath, fmt, 'public', {
		ignoreAe: true,
		base: '/',
		document: '/SKILL.raw.s.js',
	})

	if (fmt === 'json') return res.json(JSON.parse(result))
	if (fmt === 'html') return sendHtml(res, result)
	if (fmt === 'sjs') return res.type('text/sjs').send(result)
	return res.type('text/markdown').send(result)
}

function serveRootSkillSjs(req, res) {
	res.type('text/sjs').send(rootSkillSjs(req))
}

function serveRootIndexJs(req, res) {
	res.type('application/javascript').send(rootIndexJs(req))
}

function serveRootIndexSjs(req, res) {
	res.type('text/sjs').send(rootIndexSjs(req))
}

function serveRootIndex(req, res, forcedFmt) {
	const fmt = forcedFmt || detectFormat(req, null, 'html')
	if (fmt === 'sjs') return serveRootIndexSjs(req, res)
	const warning = projectEnvWarning(fmt)
	const skills = publicSkills(fmt)

	if (fmt === 'json') {
		const body = {
			name: 'agent-exec',
			description: 'HTTP command execution server for AI agents',
			authentication: 'Use X-API-Key header for protected API calls. Public API docs may be readable without authentication.',
			start: '/SKILL.md',
			steps: [
				'GET /SKILL.md — read this first',
				'GET /api/acl — check allowed commands',
				'GET /api/plugins — discover plugins',
				'POST /api/exec — execute an allowed command',
			],
			skills,
			private_skills: '/private/skills.json',
		}
		if (warning) body.warning = warning
		return res.json(body)
	}

	if (fmt === 'md') {
		const skillLines = skills.map(s =>
			`## ${s.name}\n- Description: ${s.description}\n- Endpoint: ${s.endpoint}\n- SKILL.md: ${s.url}`
		).join('\n\n')
		return res.type('text/markdown').send(`${warning || ''}# agent-exec

## What is this?

This is agent-exec — an HTTP server that allows AI agents to autonomously discover and execute commands on this machine.

## Authentication

Most protected \`/api/*\` endpoints and all \`/private/*\` endpoints require API_KEY.
Public API docs such as \`/api\` and \`/api/*/SKILL.md\` may be readable without authentication.

- Header: \`X-API-Key: API_KEY\`

## How to get started

1. Read \`GET /SKILL.md\`.
2. Call \`GET /api/acl\` to see which commands are allowed.
3. Call \`GET /api/plugins\` to discover installed plugins.
4. Call \`POST /api/exec\` to execute an allowed command.

## Public Skills

${skillLines || '(none)'}

## Private Skills

Requires API_KEY: [/private/skills](/private/skills)
`)
	}

	const items = skills.map(s => `
    <article>
      <h2><a href="${s.url}">${s.name}</a></h2>
      <p>${s.description}</p>
      <code>${s.endpoint}</code>
    </article>`).join('\n')
	return sendHtml(res, `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>agent-exec</title>
<style>body{font-family:monospace;max-width:720px;margin:40px auto;padding:0 20px}pre{background:#f4f4f4;padding:16px;border-radius:4px}a{color:#0066cc}.skill-banner{font-size:1.1em;margin-bottom:1.5em}.human-banner{font-size:1.0em;margin-bottom:0.5em;color:#555}</style>
</head><body>
${warning || ''}
<h1>agent-exec</h1>
<p>An HTTP server for AI agents to autonomously discover and execute commands.</p>
<p class="skill-banner">&#x1F916; Agent? Start here: <a href="/SKILL.md"><strong>/SKILL.md</strong></a></p>
<p class="human-banner">Human? Browse <a href="/skills">/skills</a> or <a href="/api">/api</a> &nbsp;|&nbsp; <a href="/ja">日本語</a></p>
<p>Direct index formats: <a href="/index.md">/index.md</a> <a href="/index.js">/index.js</a></p>
<h2>Authentication</h2>
<p>Most protected <code>/api/*</code> endpoints and all <code>/private/*</code> endpoints require API_KEY.
Public API docs such as <code>/api</code> and <code>/api/*/SKILL.md</code> may be readable without authentication.<br>
<code>X-API-Key: &lt;API_KEY&gt;</code></p>
<h2>How to get started</h2>
<ol>
  <li><a href="/SKILL.md">GET /SKILL.md</a> — read this first (self-describing guide)</li>
  <li><a href="/api/acl">GET /api/acl</a> — check allowed commands (auth required)</li>
  <li><a href="/api/plugins">GET /api/plugins</a> — discover plugins (auth required)</li>
  <li>POST /api/exec — execute a command (auth required)</li>
</ol>
<h2>Public Skills</h2>
${items}
<h2>Private Skills</h2>
<p>Requires API_KEY: <a href="/private/skills">/private/skills</a></p>
</body></html>`)
}

router.get('/',           (req, res) => serveRootIndex(req, res))
router.get('/index.html', (req, res) => serveRootIndex(req, res, 'html'))
	router.get('/index.md',   (req, res) => serveRootIndex(req, res, 'md'))
router.get('/index.json', (req, res) => serveRootIndex(req, res, 'json'))
router.get('/index.js',   serveRootIndexJs)
router.get('/index.s.js', serveRootIndexSjs)
router.post('/index.s.js', (req, res) => sendSjsDocumentPostFallback(res, '/index.s.js'))
router.get('/index.sjs', serveRootIndexSjs)
router.post('/index.sjs', (req, res) => sendSjsDocumentPostFallback(res, '/index.s.js'))
router.get('/SKILL',      (req, res) => serveRootSkill(req, res, null))
router.get('/SKILL.md',   (req, res) => serveRootSkill(req, res, 'md'))
router.get('/SKILL.html', (req, res) => serveRootSkill(req, res, 'html'))
router.get('/SKILL.json', (req, res) => serveRootSkill(req, res, 'json'))
router.get('/SKILL.raw.json', (req, res) => serveRootSkillRaw(req, res, 'json'))
router.get('/SKILL.raw.html', (req, res) => serveRootSkillRaw(req, res, 'html'))
router.get('/SKILL.raw.s.js', (req, res) => serveRootSkillRaw(req, res, 'sjs'))
router.get('/SKILL.raw.sjs', (req, res) => serveRootSkillRaw(req, res, 'sjs'))
router.get('/SKILL.s.js',  serveRootSkillSjs)
router.post('/SKILL.s.js', (req, res) => sendSjsDocumentPostFallback(res, '/SKILL.s.js'))
router.get('/SKILL.sjs', serveRootSkillSjs)
router.post('/SKILL.sjs', (req, res) => sendSjsDocumentPostFallback(res, '/SKILL.s.js'))

module.exports = router
