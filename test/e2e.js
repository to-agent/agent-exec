#!/usr/bin/env node
'use strict'

/**
 * test/e2e.js — isolated E2E tests
 *
 * Starts a dedicated test server on port 3334 with deterministic temporary settings.
 * Does not modify real user settings or real project local settings.
 *
 * Usage: node test/e2e.js
 */

const { spawn, spawnSync } = require('child_process')
const path      = require('path')
const fs        = require('fs')
const os        = require('os')
const backup    = require('../modules/backup')

const ROOT          = path.join(__dirname, '..')
const TEST_PORT     = process.env.TEST_PORT || '3334'
const TEST_KEY      = 'e2e-test-key-' + Math.random().toString(36).slice(2)
const BASE          = `http://127.0.0.1:${TEST_PORT}`
const FIXTURES_DIR  = path.join(__dirname, 'fixtures')

let serverProc = null
let runtimeDir = null
let testSettingsDir = null
let testPluginsDir = null
let testCacheDir = null
let testProjectSettingsFile = null
let pass = 0, fail = 0

// ----------------------------------------------------------------
// helpers
// ----------------------------------------------------------------

function chk(label, actual, expected, detail = '') {
	const ok = actual === expected
	const mark = ok ? '✅' : '❌'
	const pad = label.padEnd(60)
	if (ok) {
		console.log(`  ${mark} ${pad} [${actual}] ${String(detail).slice(0, 60)}`)
		pass++
	} else {
		console.log(`  ${mark} ${pad} [${actual}] expected=${expected} ${String(detail).slice(0, 60)}`)
		fail++
	}
	return ok
}

async function request(url, { method = 'GET', headers = {}, body, redirect } = {}) {
	const opts = { method, headers }
	if (redirect) opts.redirect = redirect
	if (body) {
		opts.body = JSON.stringify(body)
		opts.headers['Content-Type'] = 'application/json'
	}
	const res = await fetch(url, opts)
	const text = await res.text()
	let json = null
	try { json = JSON.parse(text) } catch {}
	return { status: res.status, text, json, headers: res.headers }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function waitForServer(retries = 20) {
	for (let i = 0; i < retries; i++) {
		try {
			const r = await fetch(`${BASE}/ping`)
			if (r.status === 200) return true
		} catch {}
		await sleep(200)
	}
	throw new Error(`Server did not start on ${BASE}`)
}

// ----------------------------------------------------------------
// setup / teardown
// ----------------------------------------------------------------

function writeJson(file, data) {
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

function writePlugin(name, { command = `${name}-cmd`, routeValue = name } = {}) {
	const dir = path.join(testPluginsDir, name)
	fs.mkdirSync(dir, { recursive: true })
	writeJson(path.join(dir, 'settings.json'), {
		plugin: { type: 'exec', command, apiVersion: 1 },
		exec: { allow: [command] },
	})
	fs.writeFileSync(path.join(dir, 'SKILL.md'), `# SKILL: ${name}\n# Command: ${command}\n`)
	fs.writeFileSync(path.join(dir, 'index.js'), `'use strict'
module.exports = {
  routes(router) {
    router.get('/status', (req, res) => res.json({ plugin: '${name}', value: '${routeValue}' }))
  }
}
`)
}

function removePlugin(name) {
	fs.rmSync(path.join(testPluginsDir, name), { recursive: true, force: true })
}

function setupRuntime() {
	runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-e2e-'))
	testSettingsDir = path.join(runtimeDir, 'settings')
	testPluginsDir = path.join(runtimeDir, 'plugins')
	testCacheDir = path.join(runtimeDir, 'cache')
	testProjectSettingsFile = path.join(runtimeDir, 'project-settings.json')

	fs.mkdirSync(testSettingsDir, { recursive: true })
	fs.mkdirSync(testPluginsDir, { recursive: true })
	fs.copyFileSync(path.join(FIXTURES_DIR, 'settings.json'), path.join(testSettingsDir, 'settings.json'))
	writeJson(testProjectSettingsFile, {})

	writePlugin('bootplug', { command: 'bootplug-cmd', routeValue: 'boot' })
	writePlugin('gateplug', { command: 'gateplug-cmd', routeValue: 'gate' })
}

function teardownRuntime() {
	if (runtimeDir) fs.rmSync(runtimeDir, { recursive: true, force: true })
	runtimeDir = null
}

function startServer(extraEnv = {}) {
	serverProc = spawn('node', ['bin/www'], {
		cwd: ROOT,
		env: {
			...process.env,
			PORT:               TEST_PORT,
			HOST:               '127.0.0.1',
			API_KEY:            TEST_KEY,
			AGENT_EXEC_ENABLED: 'true',
			AGENT_EXEC_CONFIG_DIR: path.join(runtimeDir, 'config'),
			SETTINGS_DIR:       testSettingsDir,
			PLUGINS_DIR:        testPluginsDir,
			CACHE_DIR:          testCacheDir,
			AGENT_EXEC_PROJECT_SETTINGS_FILE: testProjectSettingsFile,
			LOG_LEVEL:          'warn',
			...extraEnv,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	serverProc.stderr.on('data', d => {
		const msg = d.toString().trim()
		if (msg) console.error(`  [server] ${msg}`)
	})
}

function stopServer() {
	if (serverProc) {
		serverProc.kill('SIGTERM')
		serverProc = null
	}
}

async function restartServer(extraEnv = {}) {
	stopServer()
	await sleep(500)
	startServer(extraEnv)
	await waitForServer()
}

// ----------------------------------------------------------------
// tests
// ----------------------------------------------------------------

async function runTests() {
	const K = TEST_KEY
	let r

	// --------------------------------------------------
	console.log('\n=== auth boundary ===')

	r = await request(`${BASE}/ping`)
	chk('GET /ping → 200', r.status, 200)

	r = await request(`${BASE}/private/skills/hermes/SKILL.md`)
	chk('GET /private/skills/:name/SKILL.md without auth -> 401', r.status, 401)

	r = await request(`${BASE}/private.md`)
	chk('GET /private.md without auth -> 401', r.status, 401)

	r = await request(`${BASE}/private.html`)
	chk('GET /private.html without auth -> 401', r.status, 401)

	r = await request(`${BASE}/private.json`)
	chk('GET /private.json without auth -> 401', r.status, 401)

	r = await request(`${BASE}/cli/SKILL.md`)
	chk('GET /cli/SKILL.md without auth -> 401', r.status, 401)

	{
		const res = await fetch(`${BASE}/api/exec`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{"args": [',
		})
		chk('POST /api/exec invalid JSON without auth -> 401 before parser', res.status, 401)
	}

	{
		const res = await fetch(`${BASE}/api/exec`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ args: ['echo', 'no-auth-large-body'], pad: 'x'.repeat(2 * 1024 * 1024) }),
		})
		chk('POST /api/exec oversized JSON without auth -> 401 before parser', res.status, 401)
	}

	r = await request(`${BASE}/api/acl`)
	chk('GET /api/acl without auth -> 401', r.status, 401)
	chk('GET /api/acl without auth defaults to JSON', r.headers.get('content-type')?.includes('application/json'), true)
	chk('GET /api/acl without auth JSON error', r.json?.error, 'unauthorized')
	chk('GET /api/acl without auth JSON hint mentions API_KEY', r.json?.hint?.includes('API_KEY'), true)
	chk('GET /api/acl without auth JSON skill suffix', r.json?.skill, '/SKILL.json')
	chk('GET /api/acl without auth JSON path is original URL', r.json?.path, '/api/acl')

	r = await request(`${BASE}/api/acl.md`)
	chk('GET /api/acl.md without auth -> 401', r.status, 401)
	chk('GET /api/acl.md without auth returns markdown', r.headers.get('content-type')?.includes('text/markdown'), true)
	chk('GET /api/acl.md without auth markdown body', r.text.startsWith('# 401 unauthorized'), true)

	r = await request(`${BASE}/api/acl.json`)
	chk('GET /api/acl.json without auth -> 401', r.status, 401)
	chk('GET /api/acl.json without auth returns JSON', r.headers.get('content-type')?.includes('application/json'), true)

	r = await request(`${BASE}/api/acl.html`)
	chk('GET /api/acl.html without auth -> 401', r.status, 401)
	chk('GET /api/acl.html without auth returns HTML', r.headers.get('content-type')?.includes('text/html'), true)

	r = await request(`${BASE}/api/acl`, { headers: { Accept: 'text/markdown' } })
	chk('GET /api/acl without auth honors Accept markdown', r.headers.get('content-type')?.includes('text/markdown'), true)

	r = await request(`${BASE}/api/acl`, { headers: { Accept: 'text/html' } })
	chk('GET /api/acl without auth honors Accept HTML', r.headers.get('content-type')?.includes('text/html'), true)

	r = await request(`${BASE}/private`)
	chk('GET /private without auth keeps markdown default', r.headers.get('content-type')?.includes('text/markdown'), true)

	{
		const res = await fetch(`${BASE}/api/exec`, {
			method: 'POST',
			headers: { 'X-API-Key': K, 'Content-Type': 'application/json' },
			body: '{"args": [',
		})
		chk('POST /api/exec invalid JSON with auth -> 400 parser error', res.status, 400)
	}

	r = await request(`${BASE}/api/exec`, { headers: { 'X-API-Key': K } })
	chk('GET /api/exec with auth -> 405', r.status, 405)
	chk('GET /api/exec advertises Allow: POST', r.headers.get('allow'), 'POST')
	chk('GET /api/exec explains POST JSON', r.json?.error, 'method_not_allowed')

	r = await request(`${BASE}/api/exec?cmd=echo%20query-string-exec`, { method: 'POST', headers: { 'X-API-Key': K }, body: {} })
	chk('POST /api/exec?cmd= does not execute query-string command', r.status, 400)
	chk('POST /api/exec?cmd= requires JSON args', r.json?.error, 'args array is required')

	r = await request(`${BASE}/api/exec?args=echo&args=query-string-exec`, { method: 'POST', headers: { 'X-API-Key': K }, body: {} })
	chk('POST /api/exec?args= does not execute query-string args', r.status, 400)
	chk('POST /api/exec?args= requires JSON args', r.json?.error, 'args array is required')

	const invalidExecBodies = [
		['POST /api/exec {} -> 400', {}, 'args array is required'],
		['POST /api/exec {cmd} -> 400', { cmd: 'aexec --version' }, 'unexpected request body field'],
		['POST /api/exec {command} -> 400', { command: 'aexec --version' }, 'unexpected request body field'],
		['POST /api/exec string args -> 400', { args: 'aexec --version' }, 'args array is required'],
		['POST /api/exec empty args -> 400', { args: [] }, 'args array is required'],
		['POST /api/exec blank command -> 400', { args: [''] }, 'command name cannot be empty'],
		['POST /api/exec non-string arg -> 400', { args: ['aexec', 123] }, 'args must be an array of strings'],
		['POST /api/exec env field -> 400', { args: ['aexec', '--version'], env: {} }, 'unexpected request body field'],
		['POST /api/exec cwd field -> 400', { args: ['aexec', '--version'], cwd: '/tmp' }, 'unexpected request body field'],
		['POST /api/exec shell field -> 400', { args: ['aexec', '--version'], shell: true }, 'unexpected request body field'],
	]
	for (const [label, body, error] of invalidExecBodies) {
		r = await request(`${BASE}/api/exec`, { method: 'POST', headers: { 'X-API-Key': K }, body })
		chk(label, r.status, 400)
		chk(`${label}: error`, r.json?.error, error)
	}

	r = await request(`${BASE}/api/exec/SKILL.md`)
	chk('GET /api/exec/SKILL.md without auth -> 200 public doc', r.status, 200)

	r = await request(`${BASE}/private.md`, { headers: { 'X-API-Key': K } })
	chk('GET /private.md with auth -> 200', r.status, 200)

	r = await request(`${BASE}/private/index.html`, { headers: { 'X-API-Key': K }, redirect: 'manual' })
	chk('GET /private/index.html with auth -> 200 without redirect', r.status, 200)

	r = await request(`${BASE}/private/index.md`, { headers: { 'X-API-Key': K }, redirect: 'manual' })
	chk('GET /private/index.md with auth -> 200 without redirect', r.status, 200)

	r = await request(`${BASE}/private/index.json`, { headers: { 'X-API-Key': K }, redirect: 'manual' })
	chk('GET /private/index.json with auth -> 200 without redirect', r.status, 200)

	r = await request(`${BASE}/api/index.html`, { redirect: 'manual' })
	chk('GET /api/index.html -> 200 without redirect', r.status, 200)

	r = await request(`${BASE}/api/index.html`, { method: 'HEAD', redirect: 'manual' })
	chk('HEAD /api/index.html -> 200 without redirect', r.status, 200)

	r = await request(`${BASE}/cli/index.html`, { headers: { 'X-API-Key': K }, redirect: 'manual' })
	chk('GET /cli/index.html with auth -> 200 without redirect', r.status, 200)

	r = await request(`${BASE}/private/skills.html`, { headers: { 'X-API-Key': K }, redirect: 'manual' })
	chk('GET /private/skills.html with auth -> 200 without redirect', r.status, 200)

	r = await request(`${BASE}/private/skills.md`, { headers: { 'X-API-Key': K }, redirect: 'manual' })
	chk('GET /private/skills.md with auth -> 200 without redirect', r.status, 200)

	r = await request(`${BASE}/private/skills.json`, { headers: { 'X-API-Key': K }, redirect: 'manual' })
	chk('GET /private/skills.json with auth -> 200 without redirect', r.status, 200)

	r = await request(`${BASE}/cli/SKILL.md`, { headers: { 'X-API-Key': K } })
	chk('GET /cli/SKILL.md with auth -> 200', r.status, 200)

	r = await request(`${BASE}/`)
	chk('GET / → 200', r.status, 200)
	chk('GET /: runtime index contains /SKILL.md', r.text.includes('/SKILL.md'), true)
	chk('GET /: runtime index does not contain GitHub link', !/github/i.test(r.text), true)

	r = await request(`${BASE}/SKILL.md`)
	chk('GET /SKILL.md → 200', r.status, 200)
	chk('GET /SKILL.md: root guide differs from compact /', r.text.includes('This is the root guide'), true)
	chk('GET /SKILL.md: no GitHub link', !/github/i.test(r.text), true)

	r = await request(`${BASE}/`, { headers: { Accept: 'text/html' } })
	chk('GET / HTML: root landing has agent start banner', r.text.includes('Agent? Start here'), true)

	r = await request(`${BASE}/SKILL.html?navigation=true`)
	chk('GET /SKILL.html?navigation=true: no self-start text', !r.text.includes('Start from'), true)
	chk('GET /SKILL.html?navigation=true: has navigation', r.text.includes('?navigation=true'), true)

	r = await request(`${BASE}/skills`, { headers: { Accept: 'text/html' } })
	chk('GET /skills HTML: public skills index only', r.text.includes('<h1>Public Skills</h1>'), true)
	chk('GET /skills HTML: no root agent start banner', !r.text.includes('Agent? Start here'), true)
	chk('GET /skills HTML: no private skills guide', !r.text.includes('Private Skills'), true)
	chk('GET /skills HTML: no human navigation banner', !r.text.includes('human-banner'), true)
	chk('GET /skills HTML: no language switch', !r.text.includes('href="/ja"'), true)
	chk('GET /skills HTML: no API nav link', !r.text.includes('href="/api"'), true)

	r = await request(`${BASE}/skills?navigation=true`)
	chk('GET /skills?navigation=true: has navigation', r.text.includes('## Navigation'), true)

	r = await request(`${BASE}/skills.json?navigation=true`)
	chk('GET /skills.json?navigation=true: has navigation', !!r.json?.navigation, true)

	r = await request(`${BASE}/skills.html?navigation=true`)
	chk('GET /skills.html?navigation=true: has navigation', r.text.includes('?navigation=true'), true)

	r = await request(`${BASE}/skills/bootplug`, { headers: { Accept: 'application/json' } })
	chk('GET /skills/:private-plugin → 404', r.status, 404)
	chk('GET /skills/:private-plugin does not expose private URL', !r.text.includes('/private/skills/bootplug'), true)

	// --------------------------------------------------
	console.log('\n=== agent-friendly 404 ===')

	r = await request(`${BASE}/missing.json`)
	chk('GET /missing.json → 404', r.status, 404)
	chk('404 JSON includes /SKILL.md entrypoint', r.json?.skill, '/SKILL.md')
	chk('404 JSON suggests ACL inspection', r.json?.suggest?.includes('GET /api/acl'), true)
	chk('404 JSON suggests exec surface', r.json?.suggest?.includes('POST /api/exec'), true)

	r = await request(`${BASE}/api/unknown`, { headers: { 'X-API-Key': K } })
	chk('GET /api/unknown with auth -> 404', r.status, 404)
	chk('API 404 defaults to JSON', r.headers.get('content-type')?.includes('application/json'), true)

	// --------------------------------------------------
	console.log('\n=== exec ACL (test setting: echo allowed) ===')

	r = await request(`${BASE}/api/exec`, { method: 'POST', headers: { 'X-API-Key': K }, body: { args: ['echo', 'hello'] } })
	chk('POST /api/exec {echo hello} → 200', r.status, 200, r.text.trim())

	r = await request(`${BASE}/api/exec`, { method: 'POST', headers: { 'X-API-Key': K }, body: { args: ['rm', '-rf', '/'] } })
	chk('POST /api/exec {rm -rf /} → 403', r.status, 403)

	r = await request(`${BASE}/api/exec`, { method: 'POST', headers: { 'X-API-Key': K }, body: { args: ['sudo', 'ls'] } })
	chk('POST /api/exec {sudo ls} → 403', r.status, 403)

	r = await request(`${BASE}/api/exec`, { method: 'POST', headers: { 'X-API-Key': K }, body: { args: ['git', 'status'] } })
	chk('POST /api/exec {git status} -> 403 (not allowed)', r.status, 403)

	r = await request(`${BASE}/api/exec?mode=stream`, { method: 'POST', headers: { 'X-API-Key': K }, body: { args: ['echo', 'stream-ok'] } })
	chk('POST /api/exec?mode=stream direct command → 200', r.status, 200, r.text.slice(0, 120))
	chk('stream direct command contains output', r.text.includes('stream-ok'), true)

	r = await request(`${BASE}/api/exec?mode=stream`, { method: 'POST', headers: { 'X-API-Key': K }, body: { args: ['bootplug-cmd'] } })
	chk('POST /api/exec?mode=stream plugin command → 400', r.status, 400)
	chk('stream plugin command returns explicit code', r.json?.code, 'stream_plugin_command_not_supported')

	{
		const auditPath = path.join(runtimeDir, 'config', 'audit.jsonl')
		await sleep(50)
		chk('local audit log exists', fs.existsSync(auditPath), true)
		const auditText = fs.readFileSync(auditPath, 'utf8')
		chk('local audit log does not contain raw API key', !auditText.includes(K), true)
		const events = auditText.trim().split(/\n+/).filter(Boolean).map(line => JSON.parse(line))
		chk('audit log records allowed exec', events.some(e => e.endpoint === '/api/exec' && e.aclDecision === 'allow' && e.argv?.[0] === 'echo'), true)
		chk('audit log records denied exec', events.some(e => e.endpoint === '/api/exec' && e.aclDecision === 'deny' && e.argv?.[0] === 'sudo'), true)
		chk('audit log stores stdout byte count, not body', events.some(e => e.stdoutBytes > 0 && e.output === undefined), true)
		chk('audit log records header auth source', events.some(e => e.authSource === 'header' && e.queryAuthUsed === false), true)
		chk('audit deny events include zero byte counts', events.some(e => e.aclDecision === 'deny' && e.stdoutBytes === 0 && e.stderrBytes === 0), true)
	}

	await restartServer({ AGENT_EXEC_MAX_OUTPUT_BYTES: '16', AGENT_EXEC_MAX_STREAM_BYTES: '16' })
	r = await request(`${BASE}/api/exec`, { method: 'POST', headers: { 'X-API-Key': K }, body: { args: ['echo', '012345678901234567890123456789'] } })
	chk('POST /api/exec over maxOutputBytes -> 413', r.status, 413)
	chk('max output response has explicit code', r.json?.code, 'max_output_exceeded')

	r = await request(`${BASE}/api/exec?mode=stream`, { method: 'POST', headers: { 'X-API-Key': K }, body: { args: ['echo', '012345678901234567890123456789'] } })
	chk('stream over maxStreamBytes returns limit marker', r.text.includes('maxStreamBytes') || r.text.includes('max_stream_output_exceeded'), true)
	await restartServer()

	await restartServer({ AGENT_EXEC_MAX_REQUEST_BODY_BYTES: '64' })
	{
		const res = await fetch(`${BASE}/api/exec`, {
			method: 'POST',
			headers: { 'X-API-Key': K, 'Content-Type': 'application/json' },
			body: JSON.stringify({ args: ['echo', 'body-limit'], pad: 'x'.repeat(200) }),
		})
		chk('POST /api/exec over maxRequestBodyBytes -> 413', res.status, 413)
	}
	await restartServer()

	r = await request(`${BASE}/api/acl?navigation=true`, { headers: { 'X-API-Key': K } })
	chk('GET /api/acl?navigation=true: JSON has navigation', !!r.json?.navigation, true)

	// --------------------------------------------------
	console.log('\n=== apiKey non-propagation ===')

	r = await request(`${BASE}/api/plugins?apiKey=${K}`, { headers: { 'X-API-Key': K, Accept: 'text/html' } })
	chk('HTML response does not contain apiKey', !r.text.includes(`apiKey=${K}`), true)

	r = await request(`${BASE}/api/plugins?apiKey=${K}`, { headers: { 'X-API-Key': K } })
	chk('Markdown response does not contain apiKey',   !r.text.includes(`apiKey=${K}`), true)

	r = await request(`${BASE}/api/plugins?apiKey=${K}`, { headers: { 'X-API-Key': K, Accept: 'application/json' } })
	chk('JSON response does not contain apiKey', !r.text.includes(`apiKey=${K}`), true)

	r = await request(`${BASE}/api/plugins?navigation=true`, { headers: { 'X-API-Key': K } })
	chk('GET /api/plugins?navigation=true: JSON has navigation', !!r.json?.navigation, true)

	r = await request(`${BASE}/api?navigation=true`)
	chk('GET /api?navigation=true: JSON has navigation', !!r.json?.navigation, true)

	r = await request(`${BASE}/api/SKILL.md?navigation=true`)
	chk('GET /api/SKILL.md?navigation=true: has navigation', r.text.includes('## Navigation'), true)

	r = await request(`${BASE}/api/exec/SKILL.md?navigation=true`)
	chk('GET /api/exec/SKILL.md?navigation=true: has navigation', r.text.includes('## Navigation'), true)

	r = await request(`${BASE}/api/plugins?format=md`, { headers: { 'X-API-Key': K } })
	chk('GET /api/plugins?format=md: returns markdown', r.text.startsWith('# Plugins'), true)

	r = await request(`${BASE}/private/skills?format=json`, { headers: { 'X-API-Key': K } })
	chk('GET /private/skills?format=json: returns JSON', Array.isArray(r.json?.skills), true)

	r = await request(`${BASE}/cli?navigation=true`, { headers: { 'X-API-Key': K } })
	chk('GET /cli?navigation=true: JSON has navigation', !!r.json?.navigation, true)

	r = await request(`${BASE}/cli/transfer/SKILL.md?navigation=true`, { headers: { 'X-API-Key': K } })
	chk('GET /cli/transfer/SKILL.md?navigation=true: has navigation', r.text.includes('## Navigation'), true)

	r = await request(`${BASE}/private.json?navigation=true`, { headers: { 'X-API-Key': K } })
	chk('GET /private.json?navigation=true: JSON has navigation', !!r.json?.navigation, true)

	r = await request(`${BASE}/private/skills.json?navigation=true`, { headers: { 'X-API-Key': K } })
	chk('GET /private/skills.json?navigation=true: JSON has navigation', !!r.json?.navigation, true)

		// Error responses must not include apiKey.
	r = await request(`${BASE}/api/exec?apiKey=${K}`, { method: 'POST', headers: { 'X-API-Key': K }, body: { args: ['git', 'log'] } })
	chk('error response does not contain apiKey', !r.text.includes(K), true)

	// --------------------------------------------------
	console.log('\n=== CORS ===')

	{
		const res = await fetch(`${BASE}/api/acl`, { headers: { 'X-API-Key': K, Origin: 'https://evil.com' } })
		const acao = res.headers.get('access-control-allow-origin')
		chk('CORS disabled by default', !acao, true, acao || '(none)')
	}

	// --------------------------------------------------
	console.log('\n=== authentication methods ===')

	r = await request(`${BASE}/api/plugins`, { headers: { 'X-API-Key': K } })
	chk('X-API-Key header -> 200', r.status, 200)
	chk('/api/plugins JSON: skill points to SKILL.json', r.json?.plugins?.every(p => p.skill?.endsWith('/SKILL.json')), true)
	chk('/api/plugins JSON: does not return extra format fields', r.json?.plugins?.every(p => !('skill_json' in p) && !('skill_html' in p)), true)

	r = await request(`${BASE}/api/plugins.md`, { headers: { 'X-API-Key': K } })
	chk('/api/plugins.md: skill points to SKILL.md', r.text.includes('/SKILL.md'), true)
	chk('/api/plugins.md: does not mix in SKILL.json', !r.text.includes('/SKILL.json'), true)

	r = await request(`${BASE}/api/plugins.html`, { headers: { 'X-API-Key': K } })
	chk('/api/plugins.html: skill points to SKILL.html', r.text.includes('/SKILL.html'), true)
	chk('/api/plugins.html: does not mix in SKILL.json', !r.text.includes('/SKILL.json'), true)

	r = await request(`${BASE}/api/plugins`, { headers: { Authorization: `Bearer ${K}` } })
	chk('Authorization: Bearer → 200', r.status, 200)

	r = await request(`${BASE}/api/plugins`, { headers: { 'X-API-Key': 'wrong-key' } })
	chk('wrong key -> 401', r.status, 401)

	r = await request(`${BASE}/api/plugins?apiKey=${K}`)
	chk('?apiKey= disabled by default -> 401', r.status, 401)

	await restartServer({ AGENT_EXEC_ALLOW_QUERY_API_KEY: 'true' })
	r = await request(`${BASE}/api/plugins?apiKey=${K}`)
	chk('AGENT_EXEC_ALLOW_QUERY_API_KEY=true allows ?apiKey= -> 200', r.status, 200)
	r = await request(`${BASE}/api/exec?apiKey=${K}`, { method: 'POST', body: { args: ['echo', 'query-auth'] } })
	chk('POST /api/exec?apiKey= with env -> 200', r.status, 200)
	{
		const auditPath = path.join(runtimeDir, 'config', 'audit.jsonl')
		await sleep(50)
		const auditText = fs.readFileSync(auditPath, 'utf8')
		const events = auditText.trim().split(/\n+/).filter(Boolean).map(line => JSON.parse(line))
		chk('audit log records query auth source', events.some(e => e.authSource === 'query' && e.queryAuthUsed === true && e.argv?.includes('query-auth')), true)
		chk('audit log redacts query auth raw key', !auditText.includes(K), true)
	}
	await restartServer()

	// --------------------------------------------------
	console.log('\n=== plugin lifecycle snapshot ===')

	r = await request(`${BASE}/api/command/bootplug/status`, { headers: { 'X-API-Key': K } })
	chk('startup plugin route → 200', r.status, 200, r.text)
	chk('startup plugin route value', r.json?.value, 'boot')

	r = await request(`${BASE}/private/skills/bootplug/SKILL.md`, { headers: { 'X-API-Key': K } })
	chk('startup plugin private SKILL → 200', r.status, 200)

	writePlugin('lateplug', { command: 'lateplug-cmd', routeValue: 'late' })
	await sleep(20)

	r = await request(`${BASE}/api/plugins`, { headers: { 'X-API-Key': K } })
	chk('plugin created after startup is hidden from /api/plugins', !r.text.includes('lateplug'), true)

	r = await request(`${BASE}/private/skills/lateplug/SKILL.md`, { headers: { 'X-API-Key': K } })
	chk('plugin created after startup private SKILL → 404', r.status, 404)

	r = await request(`${BASE}/api/command/lateplug/status`, { headers: { 'X-API-Key': K } })
	chk('plugin created after startup route → 404', r.status, 404)

	r = await request(`${BASE}/api/command/gateplug/status`, { headers: { 'X-API-Key': K } })
	chk('startup gate plugin route → 200', r.status, 200)

	writeJson(path.join(testSettingsDir, 'settings.json'), {
		exec: { allow: ['echo', 'echo *'] },
		plugins: { disabled: ['gateplug'] },
	})
	await sleep(20)

	r = await request(`${BASE}/api/plugins`, { headers: { 'X-API-Key': K } })
	chk('disabled startup plugin is hidden from /api/plugins', !r.text.includes('gateplug'), true)

	r = await request(`${BASE}/api/command/gateplug/status`, { headers: { 'X-API-Key': K } })
	chk('disabled startup plugin route gate → 404', r.status, 404)

	removePlugin('bootplug')
	await sleep(20)
	writePlugin('bootplug', { command: 'bootplug-new-cmd', routeValue: 'new' })
	await sleep(20)

	r = await request(`${BASE}/api/plugins`, { headers: { 'X-API-Key': K } })
	chk('deleted/recreated same-name plugin is hidden from /api/plugins', !r.text.includes('bootplug'), true)

	r = await request(`${BASE}/api/command/bootplug/status`, { headers: { 'X-API-Key': K } })
	chk('deleted/recreated same-name plugin route → 404', r.status, 404)

	r = await request(`${BASE}/api/acl`, { headers: { 'X-API-Key': K } })
	chk('deleted/recreated plugin new command is absent from ACL', !r.text.includes('bootplug-new-cmd'), true)

	// --------------------------------------------------
	console.log('\n=== remote transfer ===')

	const transferSrc = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-transfer-src-'))
	try {
		fs.mkdirSync(path.join(transferSrc, 'plugins', 'remoteplug'), { recursive: true })
		fs.writeFileSync(path.join(transferSrc, '.env'), 'API_KEY=remote-secret\n')
		fs.writeFileSync(path.join(transferSrc, 'plugins', 'remoteplug', 'SKILL.md'), '# remoteplug\n')
		const packed = backup.packTransferPayload(backup.buildBackup({ configDir: transferSrc }))

		r = await request(`${BASE}/api/transfer/SKILL.md`)
		chk('GET /api/transfer/SKILL.md → 404', r.status, 404)

		r = await request(`${BASE}/api/transfer`, {
			method: 'POST',
			headers: { 'X-API-Key': K },
			body: { ...packed, dryRun: true },
		})
		chk('POST /api/transfer → 404', r.status, 404)

		r = await request(`${BASE}/cli/transfer`, { method: 'POST', body: { ...packed, dryRun: true } })
		chk('POST /cli/transfer without auth -> 401', r.status, 401)

		r = await request(`${BASE}/cli/transfer`, {
			method: 'POST',
			headers: { 'X-API-Key': K },
			body: { ...packed, dryRun: true },
		})
		chk('POST /cli/transfer disabled by default -> 403', r.status, 403)

		await restartServer({ AGENT_EXEC_ALLOW_TRANSFER: 'true' })

		r = await request(`${BASE}/cli/transfer`, {
			method: 'POST',
			headers: { 'X-API-Key': K },
			body: { ...packed, dryRun: true },
		})
		chk('POST /cli/transfer dryRun → 200', r.status, 200)
		chk('dryRun does not write to destination', fs.existsSync(path.join(runtimeDir, 'config', 'plugins', 'remoteplug', 'SKILL.md')), false)

		const cli = spawnSync(process.execPath, [
			'scripts/transfer.js',
			'--from', transferSrc,
			'--to', `127.0.0.1:${TEST_PORT}`,
			'--apiKey', K,
			'--dry-run',
			'--json',
		], { cwd: ROOT, encoding: 'utf8' })
		chk('ae transfer CLI dry-run → exit 0', cli.status, 0, cli.stderr || cli.stdout)

		const backupFile = path.join(transferSrc, 'backup.json.gz')
		backup.writeBackup(backupFile, backup.buildBackup({ configDir: transferSrc }))
		const cliFromFile = spawnSync(process.execPath, [
			'scripts/transfer.js',
			'--from', backupFile,
			'--to', BASE,
			'--apiKey', K,
			'--dry-run',
			'--json',
		], { cwd: ROOT, encoding: 'utf8' })
		chk('ae transfer CLI --from backup file dry-run → exit 0', cliFromFile.status, 0, cliFromFile.stderr || cliFromFile.stdout)

		r = await request(`${BASE}/cli/transfer`, {
			method: 'POST',
			headers: { 'X-API-Key': K },
			body: { ...packed, confirm: true },
		})
		chk('POST /cli/transfer confirm → 200', r.status, 200)
		chk('transferred plugin SKILL exists in config dir', fs.existsSync(path.join(runtimeDir, 'config', 'plugins', 'remoteplug', 'SKILL.md')), true)
		chk('transferred .env exists in config dir', fs.existsSync(path.join(runtimeDir, 'config', '.env')), true)
	} finally {
		fs.rmSync(transferSrc, { recursive: true, force: true })
	}
}

// ----------------------------------------------------------------
// main
// ----------------------------------------------------------------

async function main() {
	setupRuntime()
	try {
		startServer()
		await waitForServer()
		console.log(`\nE2E target: ${BASE}  (isolated server)\n`)

		await runTests()
	} finally {
		stopServer()
		teardownRuntime()
	}

	console.log('\n' + '='.repeat(40))
	console.log(`  PASS: ${pass}  FAIL: ${fail}  TOTAL: ${pass + fail}`)
	console.log('='.repeat(40) + '\n')

	process.exit(fail > 0 ? 1 : 0)
}

main().catch(err => {
	stopServer()
	teardownRuntime()
	console.error('ERROR:', err.message)
	process.exit(1)
})
