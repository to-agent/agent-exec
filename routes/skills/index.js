const express = require('express')
const router = express.Router()
const fs = require('fs')
const path = require('path')
const settings = require('../../modules/settings')
const { PACKAGE_DIR } = require('../../modules/paths')
const pluginControl = require('../../modules/plugin-control')
const convert = require('../../modules/convert')
const { fmtToSuffix, detectFormat, buildNavigation, injectNavigation, sendHtml, serveMarkdown } = require('../../modules/respond')

router.path = '/skills'

const publicSkillsDir = path.join(PACKAGE_DIR, 'public', 'skills')

function findSkillMd(name) {
	// 1. public/skills/:name/SKILL.md (built-in public skills)
	const p1 = path.join(publicSkillsDir, name, 'SKILL.md')
	if (fs.existsSync(p1)) return p1
	// 2. plugins/:name/public/SKILL.md (plugin-provided public skills)
	const pluginDir = pluginControl.activePluginMap().get(name)
	if (pluginDir) {
		const p2 = path.join(pluginDir, 'public', 'SKILL.md')
		if (fs.existsSync(p2)) return p2
	}
	return null
}

function listSkills() {
	const skills = new Set()
	// Built-in public skills.
	if (fs.existsSync(publicSkillsDir)) {
		fs.readdirSync(publicSkillsDir).forEach(name => {
			if (fs.existsSync(path.join(publicSkillsDir, name, 'SKILL.md'))) skills.add(name)
		})
	}
	// Public skills from bundled and user plugins.
	for (const [name, pluginDir] of pluginControl.activePluginMap()) {
		if (fs.existsSync(path.join(pluginDir, 'public', 'SKILL.md'))) skills.add(name)
	}
	return [...skills]
}

// Read metadata from the first lines of SKILL.md via convert.parseMeta.
const parseSkillMeta = convert.parseMeta

function buildIndex(skills) {
	const skillLines = skills.map(s =>
		`## ${s.name}\n- Description: ${s.description}\n- Endpoint: ${s.endpoint}\n- SKILL.md: ${s.url}`
	).join('\n\n')

	return `# Public Skills

${skillLines}
`
}

function respondIndex(req, res, ext) {
	const fmt = detectFormat(req, ext)
	const names = listSkills()

	const sfx = fmtToSuffix(fmt)
	const nav = buildNavigation(req, fmt, { index: '/SKILL', related: ['/api'] })

	const skills = names.map(name => {
		const skillPath = findSkillMd(name)
		const content = skillPath ? fs.readFileSync(skillPath, 'utf8') : ''
		const meta = parseSkillMeta(content)
		return {
			name,
			description: meta.description || '',
			endpoint: meta.endpoint || '',
			url: `/skills/${name}/SKILL${sfx}`,
		}
	})

	if (fmt === 'json') {
		const body = {
			skills,
		}
		if (nav) body.navigation = nav
		return res.json(body)
	}

	if (fmt === 'md') {
		return res.type('text/markdown').send(injectNavigation(buildIndex(skills), nav, 'md'))
	}

	// html
	const items = skills.map(s => `
    <article>
      <h2><a href="${s.url}">${s.name}</a></h2>
      <p>${s.description}</p>
      <code>${s.endpoint}</code>
    </article>`).join('\n')
	const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Public Skills</title>
<style>body{font-family:monospace;max-width:720px;margin:40px auto;padding:0 20px}a{color:#0066cc}</style>
</head>
<body>
<h1>Public Skills</h1>
${items}
</body></html>`
	return sendHtml(res, injectNavigation(html, nav, 'html'))
}

function respondSkill(req, res, name, ext) {
	const fmt = detectFormat(req, ext)
	const skillPath = findSkillMd(name)
	if (!skillPath) {
		const publicSkills = listSkills()
		const sfx = fmtToSuffix(fmt)

		if (fmt === 'json') return res.status(404).json({
			requested: name,
			error: 'public skill not found',
			available_public: publicSkills.map(s => `/skills/${s}/SKILL${sfx}`),
		})

		if (fmt === 'html') {
			const items = publicSkills.map(s => `<li><a href="/skills/${s}/SKILL${sfx}">${s}</a></li>`).join('')
			res.status(404)
			return sendHtml(res,
				`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>skills</title></head><body>` +
				`<h1>Skills</h1>` +
				`<p>public skill not found: ${name}</p>` +
				`<h2>Public Skills</h2><ul>${items}</ul>` +
				`</body></html>`
			)
		}

		const lines = publicSkills.map(s => `- [${s}](/skills/${s}/SKILL.md)`).join('\n')
		return res.status(404).type('text/markdown').send(
			`# Skills\n\n` +
			`public skill not found: ${name}\n\n` +
			`## Public Skills\n\n${lines || '(none)'}\n`
		)
	}

	const result = convert.getSkill(name, skillPath, fmt, 'public')
	const nav = buildNavigation(req, fmt, { parent: '/skills', index: '/SKILL' })
	const out = injectNavigation(result, nav, fmt)

	if (fmt === 'json') return res.json(JSON.parse(out))
	if (fmt === 'html') return sendHtml(res, out)
	return res.type('text/markdown').send(out)
}

function respondIndexJa(req, res) {
	const names = listSkills()
	const skills = names.map(name => {
		const skillPath = findSkillMd(name)
		const content = skillPath ? fs.readFileSync(skillPath, 'utf8') : ''
		const meta = parseSkillMeta(content)
		return { name, description: meta.description || '', endpoint: meta.endpoint || '', url: `/skills/${name}/SKILL.html` }
	})

	const items = skills.map(s => `
    <article>
      <h2><a href="${s.url}">${s.name}</a></h2>
      <p>${s.description}</p>
      <code>${s.endpoint}</code>
    </article>`).join('\n')

	return sendHtml(res, `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>agent-exec</title>
<style>body{font-family:monospace;max-width:720px;margin:40px auto;padding:0 20px}pre{background:#f4f4f4;padding:16px;border-radius:4px}a{color:#0066cc}.skill-banner{font-size:1.1em;margin-bottom:1.5em}code{background:#f4f4f4;padding:2px 6px;border-radius:3px}</style>
</head>
<body>
<h1>agent-exec</h1>
<p>AIエージェントがマシン上のコマンドを自律的に発見・実行するためのHTTPサーバーです。</p>
<p><strong>URLとAPIキーを渡すだけで、エージェントが自分でドキュメントを読んで動きます。</strong></p>
<p class="human-banner"><a href="/skills">公開スキル一覧</a> &nbsp;|&nbsp; <a href="/api">/api</a> &nbsp;|&nbsp; <a href="/">English</a></p>

<h2>認証</h2>
<p><code>/api/*</code> および <code>/private/*</code> エンドポイントにはAPIキーが必要です：</p>
<pre>X-API-Key: &lt;key&gt;</pre>

<h2>使い方</h2>
<ol>
  <li><a href="/SKILL.md">GET /SKILL.md</a> — まずここを読む（自己説明ガイド）</li>
  <li><a href="/api/acl">GET /api/acl</a> — 実行可能なコマンド一覧を確認（認証必要）</li>
  <li><a href="/api/plugins">GET /api/plugins</a> — インストール済みプラグインを確認（認証必要）</li>
  <li>POST /api/exec — コマンドを実行（認証必要）</li>
</ol>

<h2>実行例</h2>
<pre>curl -X POST http://&lt;host&gt;/api/exec \\
  -H "X-API-Key: &lt;key&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{"args": ["aexec", "--version"]}'</pre>

<h2>利用可能なスキル</h2>
${items}

<hr>
<p><small><a href="/">English</a> | <a href="/api">/api</a></small></p>
</body></html>`)
}

function respondSkillsIndex(req, res, fmt) {
	const sfx = fmtToSuffix(fmt)
	const names = listSkills()
	const skills = names.map(n => `/skills/${n}/SKILL${sfx}`)
	const nav = buildNavigation(req, fmt, { parent: '/skills', index: '/SKILL', related: ['/api'] })

	const mdLines = names.map(n => `- [${n}](/skills/${n}/SKILL${sfx})`).join('\n')

	const md = `# SKILL: skills
# Description: Public skills index — browse available public skills on this agent-exec instance

## Overview

Public skills are available without authentication. Read each SKILL.md for usage details.

## Public Skills

${mdLines || '(none)'}
`
	serveMarkdown(req, res, md, {
		extraJson: { skills },
		nav,
	})
}

// Register /skills.html /skills.json /skills.md directly on the app.
// Root "/" is handled by routes/index.js as the runtime root guide.
router.app = (app) => {
	app.get('/ja',         (req, res) => respondIndexJa(req, res))
	app.get('/skills.html', (req, res) => respondIndex(req, res, 'html'))
	app.get('/skills.json', (req, res) => respondIndex(req, res, 'json'))
	app.get('/skills.md',   (req, res) => respondIndex(req, res, 'md'))
}

// GET /skills  /skills/index.html  /skills/index.json  /skills/index.md
router.get('/',           (req, res) => respondIndex(req, res, null))
router.get('/index.html', (req, res) => respondIndex(req, res, 'html'))
router.get('/index.json', (req, res) => respondIndex(req, res, 'json'))
router.get('/index.md',   (req, res) => respondIndex(req, res, 'md'))

// GET /skills/SKILL.md — documentation for the /skills namespace
router.get('/SKILL.:ext(md|html|json)', (req, res) => respondSkillsIndex(req, res, req.params.ext))

// GET /skills/:name/SKILL.md SKILL.json SKILL.html. Specific paths first.
router.get('/:name/SKILL.:ext(md|html|json)', (req, res) => respondSkill(req, res, req.params.name, req.params.ext))

// GET /skills/:name.html /skills/:name.json /skills/:name.md. Extension paths first.
router.get('/:name.html', (req, res) => respondSkill(req, res, req.params.name, 'html'))
router.get('/:name.json', (req, res) => respondSkill(req, res, req.params.name, 'json'))
router.get('/:name.md',   (req, res) => respondSkill(req, res, req.params.name, 'md'))

// GET /skills/:name. Default route last.
router.get('/:name',      (req, res) => respondSkill(req, res, req.params.name, null))

module.exports = router
