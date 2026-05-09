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

function createPluginWithCli(name, { command, type = 'exec' }) {
	const result = spawnSync(process.execPath, [
		path.join(ROOT, 'scripts', 'plugin-create.js'),
		`--name=${name}`,
		`--command=${command}`,
		`--type=${type}`,
		'--silent',
	], {
		cwd: ROOT,
		env: {
			...process.env,
			AGENT_EXEC_CONFIG_DIR: path.join(runtimeDir, 'config'),
			PLUGINS_DIR: testPluginsDir,
		},
		encoding: 'utf8',
	})
	if (result.status !== 0) {
		throw new Error(`plugin-create failed for ${name}: ${result.stderr || result.stdout}`)
	}
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
	createPluginWithCli('createdacl', { command: 'printf', type: 'exec' })
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

	r = await request(`${BASE}/private/skills/bootplug/SKILL.md`)
	chk('GET /private/skills/:name/SKILL.md without auth -> 401', r.status, 401)

	r = await request(`${BASE}/private/skills/bootplug/SKILL.raw.json`)
	chk('GET /private/skills/:name/SKILL.raw.json without auth -> 401', r.status, 401)

	r = await request(`${BASE}/private/skills`)
	chk('GET /private/skills without auth -> 401', r.status, 401)

	r = await request(`${BASE}/private/skills.json`)
	chk('GET /private/skills.json without auth -> 401', r.status, 401)

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

	r = await request(`${BASE}/api/acl/SKILL.s.js`)
	chk('GET /api/acl/SKILL.s.js without auth -> 200 public doc', r.status, 200)
	chk('GET /api/acl/SKILL.s.js without auth returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /api/acl/SKILL.s.js without auth exposes ACL URL key', r.text.includes('m["/api/acl"] = {'), true)
	chk('GET /api/acl/SKILL.s.js without auth includes SJS Accept header', r.text.includes('"Accept": "text/sjs"'), true)
	chk('GET /api/acl/SKILL.s.js without auth explains memo echo', r.text.includes('echo: memo'), true)
	chk('GET /api/acl/SKILL.s.js without auth does not include example branch', !r.text.includes('example:'), true)

	r = await request(`${BASE}/api/acl/skill.sjs`)
	chk('GET /api/acl/skill.sjs without auth -> 200 public doc', r.status, 200)
	chk('GET /api/acl/skill.sjs without auth returns document, not recovery', !r.text.includes('m.error'), true)
	chk('GET /api/acl/skill.sjs without auth marks ACL document', r.text.includes('// /api/acl/SKILL.s.js'), true)

	r = await request(`${BASE}/api/exec/SKILL.s.js`)
	chk('GET /api/exec/SKILL.s.js without auth -> 200 public doc', r.status, 200)
	chk('GET /api/exec/SKILL.s.js without auth returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /api/exec/SKILL.s.js without auth exposes exec URL key', r.text.includes('m["/api/exec"] = {'), true)
	chk('GET /api/exec/SKILL.s.js without auth explains memo echo', r.text.includes('echo: memo'), true)

	r = await request(`${BASE}/api/exec/skill.sjs`)
	chk('GET /api/exec/skill.sjs without auth -> 200 public doc', r.status, 200)
	chk('GET /api/exec/skill.sjs without auth returns document, not recovery', !r.text.includes('m.error'), true)
	chk('GET /api/exec/skill.sjs without auth marks exec document', r.text.includes('// /api/exec/SKILL.s.js'), true)

	r = await request(`${BASE}/api/acl`, { headers: { Accept: 'text/sjs' } })
	chk('GET /api/acl without auth honors Accept SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /api/acl without auth SJS result records 401', r.text.includes('status: 401'), true)
	chk('GET /api/acl without auth SJS result keeps path', r.text.includes('path: "/api/acl"'), true)
	chk('GET /api/acl without auth SJS links ACL surface', r.text.includes('document: "/api/acl/SKILL.s.js"'), true)
	chk('GET /api/acl without auth SJS explains memo echo', r.text.includes('echo: memo'), true)
	chk('GET /api/acl without auth SJS has no example branch', !r.text.includes('example:'), true)

	r = await request(`${BASE}/api/exec`, { method: 'POST', headers: { Accept: 'text/sjs' }, body: { args: ['aexec', '--version'] } })
	chk('POST /api/exec without auth honors Accept SJS before parser', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('POST /api/exec without auth SJS result records 401', r.text.includes('status: 401'), true)
	chk('POST /api/exec without auth SJS result keeps path', r.text.includes('path: "/api/exec"'), true)
	chk('POST /api/exec without auth SJS keeps retry example', r.text.includes('m["/api/exec"].request.body.args.example = ["aexec", "--version"];'), true)
	chk('POST /api/exec without auth SJS marks args as argv', r.text.includes('m["/api/exec"].request.body.args.kind = "argv";'), true)
	chk('POST /api/exec without auth SJS keeps request body args path', r.text.includes('body: {\n      args: ["<command>", "<arg>", "..."]'), true)

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

	r = await request(`${BASE}/api/acl/SKILL.s.js`, { headers: { 'X-API-Key': K } })
	chk('GET /api/acl/SKILL.s.js with auth -> 200', r.status, 200)
	chk('GET /api/acl/SKILL.s.js with auth returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /api/acl/SKILL.s.js does not expose configured allow list', !r.text.includes('allow: ["echo hello"]'), true)
	chk('GET /api/acl/SKILL.s.js describes allow response values', r.text.includes("'<command> [<arg>]...'"), true)
	chk('GET /api/acl/SKILL.s.js keeps response values flat', r.text.includes('m["/api/acl"].response.allow = [\'<command> [<arg>]...\', \'...\'];'), true)
	chk('GET /api/acl/SKILL.s.js marks allow as argv string', r.text.includes('m["/api/acl"].response.allow.kind = "argv_string";'), true)
	chk('GET /api/acl/SKILL.s.js maps allow item to args', r.text.includes('m["/api/acl"].response.allow.to_args = [\'<command>\', \'<arg>\', \'...\'];'), true)
	chk('GET /api/acl/SKILL.s.js keeps deny hint flat', r.text.includes('m["/api/acl"].response.deny = [\'<denied pattern>\', \'...\'];'), true)
	chk('GET /api/acl/SKILL.s.js has no duplicate response name object', !r.text.includes('m["/api/acl"].response = { allow, deny };'), true)
	chk('GET /api/acl/SKILL.s.js has no nested response allow hint', !r.text.includes('response = { allow: ['), true)
	chk('GET /api/acl/SKILL.s.js includes API key header form', r.text.includes('"X-API-Key": client.API_KEY'), true)
	chk('GET /api/acl/SKILL.s.js includes SJS Accept header', r.text.includes('"Accept": "text/sjs"'), true)
	chk('GET /api/acl/SKILL.s.js explains memo echo', r.text.includes('echo: memo'), true)
	chk('GET /api/acl/SKILL.s.js links to exec skill sjs', r.text.includes('document: "/api/exec/SKILL.s.js"'), true)
	chk('GET /api/acl/SKILL.s.js marks current document', r.text.includes('// /api/acl/SKILL.s.js'), true)
	chk('GET /api/acl/SKILL.s.js exposes ACL URL key', r.text.includes('m["/api/acl"] = {'), true)
	chk('GET /api/acl/SKILL.s.js exposes exec URL key', r.text.includes('m["/api/exec"] = {'), true)
	chk('GET /api/acl/SKILL.s.js has no document_suffix rule', !r.text.includes('document_suffix'), true)
	chk('GET /api/acl/SKILL.s.js has no example branch', !r.text.includes('example:'), true)
	chk('GET /api/acl/SKILL.s.js has no links block', !r.text.includes('links: {'), true)

	r = await request(`${BASE}/api/exec/SKILL.s.js`, { headers: { 'X-API-Key': K } })
	chk('GET /api/exec/SKILL.s.js with auth -> 200', r.status, 200)
	chk('GET /api/exec/SKILL.s.js with auth returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /api/exec/SKILL.s.js explains args-only body', r.text.includes('body must contain only args'), true)
	chk('GET /api/exec/SKILL.s.js includes JSON header form', r.text.includes('"Content-Type": "application/json"'), true)
	chk('GET /api/exec/SKILL.s.js includes SJS Accept header', r.text.includes('"Accept": "text/sjs"'), true)
	chk('GET /api/exec/SKILL.s.js explains memo echo', r.text.includes('echo: memo'), true)
	chk('GET /api/exec/SKILL.s.js includes request body args path', r.text.includes('body: { args: ["<command>", "<arg>", "..."] }'), true)
	chk('GET /api/exec/SKILL.s.js includes request body args example', r.text.includes('m["/api/exec"].request.body.args.example = ["aexec", "--version"];'), true)
	chk('GET /api/exec/SKILL.s.js marks request body args as argv', r.text.includes('m["/api/exec"].request.body.args.kind = "argv";'), true)
	chk('GET /api/exec/SKILL.s.js includes argv syntax', r.text.includes("m[\"/api/exec\"].request.body.args.syntax = '<command> [<arg>]...';"), true)
	chk('GET /api/exec/SKILL.s.js includes direct operation line', r.text.includes('operation: \'POST /api/exec AUTH {"args":["aexec","--version"]}\''), true)
	chk('GET /api/exec/SKILL.s.js keeps response output flat', r.text.includes('m["/api/exec"].response.output = \'<stdout>\';'), true)
	chk('GET /api/exec/SKILL.s.js keeps response status flat', r.text.includes('m["/api/exec"].response.status = "done";'), true)
	chk('GET /api/exec/SKILL.s.js has no duplicate response name object', !r.text.includes('m["/api/exec"].response = { output, length, exitCode, status, duration, stderr };'), true)
	chk('GET /api/exec/SKILL.s.js has no double-quoted stdout hint', !r.text.includes('"<stdout>"'), true)
	chk('GET /api/exec/SKILL.s.js has no nested response output hint', !r.text.includes('response = { output: '), true)
	chk('GET /api/exec/SKILL.s.js exposes exec URL key', r.text.includes('m["/api/exec"] = {'), true)
	chk('GET /api/exec/SKILL.s.js has no policy branch', !r.text.includes('m.policy'), true)
	chk('GET /api/exec/SKILL.s.js has no document_suffix rule', !r.text.includes('document_suffix'), true)
	chk('GET /api/exec/SKILL.s.js marks current document', r.text.includes('// /api/exec/SKILL.s.js'), true)
	chk('GET /api/exec/SKILL.s.js exposes ACL URL key', r.text.includes('m["/api/acl"] = {'), true)
	chk('GET /api/exec/SKILL.s.js has no example branch', !r.text.includes('example:'), true)
	chk('GET /api/exec/SKILL.s.js has no links block', !r.text.includes('links: {'), true)

	r = await request(`${BASE}/api/exec/SKILL.s.js`, { method: 'POST', headers: { 'X-API-Key': K }, body: { args: ['aexec', '--version'] } })
	chk('POST /api/exec/SKILL.s.js returns SJS fallback', r.status, 200)
	chk('POST /api/exec/SKILL.s.js fallback records document_post', r.text.includes('reason: "document_post"'), true)
	chk('POST /api/exec/SKILL.s.js fallback records 405', r.text.includes('status: 405'), true)
	chk('POST /api/exec/SKILL.s.js fallback points to exec runtime with POST', r.text.includes('method: "POST"') && r.text.includes('url: "/api/exec"'), true)
	chk('POST /api/exec/SKILL.s.js fallback includes exec request form', r.text.includes('"Content-Type": "application/json"') && r.text.includes('args: ["<command>", "<arg>", "..."]'), true)
	chk('POST /api/exec/SKILL.s.js fallback inserts canonical exec surface', r.text.includes('m["/api/exec"] = {') && r.text.includes('operation: \'POST /api/exec AUTH {"args":["aexec","--version"]}\''), true)
	chk('POST /api/exec/SKILL.s.js fallback keeps exec details flat', r.text.includes('m["/api/exec"].request.body.args.example = ["aexec", "--version"];') && r.text.includes('m["/api/exec"].response.output = \'<stdout>\';'), true)

	r = await request(`${BASE}/api/exec/SKILL.raw.json`)
	chk('GET /api/exec/SKILL.raw.json without auth -> 200 public raw doc', r.status, 200)
	chk('GET /api/exec/SKILL.raw.json ignores ae request directive', r.json?.request, undefined)

	r = await request(`${BASE}/api/exec/SKILL.raw.s.js`)
	chk('GET /api/exec/SKILL.raw.s.js without auth -> 200 public raw doc', r.status, 200)
	chk('GET /api/exec/SKILL.raw.s.js returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /api/exec/SKILL.raw.s.js uses raw document marker', r.text.includes('// /api/exec/SKILL.raw.s.js'), true)
	chk('GET /api/exec/SKILL.raw.s.js ignores ae operation directive', !r.text.includes('operation:'), true)

	r = await request(`${BASE}/api/exec?cmd=echo%20query-string-exec`, { method: 'POST', headers: { 'X-API-Key': K }, body: {} })
	chk('POST /api/exec?cmd= does not execute query-string command', r.status, 400)
	chk('POST /api/exec?cmd= requires JSON args', r.json?.error, 'args array is required')
	chk('POST /api/exec?cmd= returns request.body fallback', r.json?.request?.body?.args?.[0], '<command>')
	chk('POST /api/exec?cmd= returns exec SJS document', r.json?.document, '/api/exec/SKILL.s.js')

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
		chk(`${label}: request.body fallback`, r.json?.request?.body?.args?.[0], '<command>')
		chk(`${label}: exec SJS document`, r.json?.document, '/api/exec/SKILL.s.js')
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

	r = await request(`${BASE}/index.html`, { redirect: 'manual' })
	chk('GET /index.html -> 200 without redirect', r.status, 200)
	chk('GET /index.html links public index formats', r.text.includes('/index.md') && r.text.includes('/index.js'), true)
	chk('GET /index.html hides SJS index format', !r.text.includes('/index.s.js'), true)
	chk('GET /index.html does not link experimental ASM index', !r.text.includes('/index.s.js.asm'), true)

	r = await request(`${BASE}/index.md`, { redirect: 'manual' })
	chk('GET /index.md -> 200 without redirect', r.status, 200)
	chk('GET /index.md is markdown', r.headers.get('content-type')?.includes('text/markdown'), true)
	chk('GET /index.md points to root skill', r.text.includes('GET /SKILL.md'), true)

	r = await request(`${BASE}/index.js`, { redirect: 'manual' })
	chk('GET /index.js -> 200 without redirect', r.status, 200)
	chk('GET /index.js is javascript', r.headers.get('content-type')?.includes('javascript'), true)
	chk('GET /index.js points to SJS', r.text.includes('"/SKILL.s.js"'), true)
	chk('GET /index.js points to API index', r.text.includes('"/api/index.md"'), true)
	chk('GET /index.js keeps refs without links block', !r.text.includes('links: {') && r.text.includes('refs: ['), true)
	chk('GET /index.js stays host-index scoped', !r.text.includes('m["/api"] = {'), true)
	chk('GET /index.js lists SJS before MD', r.text.indexOf('"/SKILL.s.js"') < r.text.indexOf('"/SKILL.md"'), true)

	r = await request(`${BASE}/index.sjs`, { redirect: 'manual' })
	chk('GET /index.sjs alias -> 200 without redirect', r.status, 200)
	chk('GET /index.sjs alias returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /index.sjs alias points to SJS', r.text.includes('"/SKILL.s.js"'), true)
	chk('GET /index.sjs alias stays thin host index', !r.text.includes('"/api/acl/SKILL.s.js"') && !r.text.includes('"/api/exec/SKILL.s.js"') && !r.text.includes('"/skills/SKILL.s.js"'), true)
	chk('GET /index.sjs alias does not embed ACL surface', !r.text.includes('m["/api/acl"] = {'), true)
	chk('GET /index.sjs alias does not embed exec surface', !r.text.includes('m["/api/exec"] = {'), true)
	chk('GET /index.sjs alias omits markdown fallbacks', !r.text.includes('"/SKILL.md"') && !r.text.includes('"/api/index.md"') && !r.text.includes('"/skills/index.md"'), true)
	chk('GET /index.s.js explains memo echo', r.text.includes('echo: memo'), true)
	chk('GET /index.s.js has no links block', !r.text.includes('links: {'), true)

	r = await request(`${BASE}/index.s.js`, { redirect: 'manual' })
	chk('GET /index.s.js -> 200 without redirect', r.status, 200)
	chk('GET /index.s.js returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /index.s.js points to SJS', r.text.includes('"/SKILL.s.js"'), true)
	chk('GET /index.s.js stays thin host index', !r.text.includes('"/api/acl/SKILL.s.js"') && !r.text.includes('"/api/exec/SKILL.s.js"'), true)
	chk('GET /index.s.js does not embed runtime surfaces', !r.text.includes('m["/api/acl"] = {') && !r.text.includes('m["/api/exec"] = {'), true)
	chk('GET /index.s.js does not expose sibling index formats', !r.text.includes('sjs: "/index.s.js"') && !r.text.includes('asm: "/index.s.js.asm"'), true)

	r = await request(`${BASE}/SKILL.md`)
	chk('GET /SKILL.md → 200', r.status, 200)
	chk('GET /SKILL.md: root guide differs from compact /', r.text.includes('This is the root guide'), true)
	chk('GET /SKILL.md: no GitHub link', !/github/i.test(r.text), true)
	chk('GET /SKILL.md: explains SJS memo echo target', r.text.includes('appears as `m.memo`'), true)
	chk('GET /SKILL.md: includes root ae directive', r.text.includes('<!-- ae:prev m["/"] -> all -->'), true)
	chk('GET /SKILL.md: includes ACL ae directive', r.text.includes('<!-- ae:prev m["/api/acl"] -> all -->'), true)
	chk('GET /SKILL.md: includes exec request body ae directive', r.text.includes('<!-- ae:prev m["/api/exec"].request.body -> all -->'), true)
	chk('GET /SKILL.md: includes exec args example ae directive', r.text.includes('<!-- ae:prev m["/api/exec"].request.body.args.example -> all -->'), true)

	r = await request(`${BASE}/SKILL`, { headers: { Accept: 'text/sjs' } })
	chk('GET /SKILL with Accept SJS returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /SKILL with Accept SJS uses root marker', r.text.includes('// /SKILL.s.js'), true)

	r = await request(`${BASE}/`, { headers: { Accept: 'text/sjs' } })
	chk('GET / with Accept SJS returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET / with Accept SJS uses index marker', r.text.includes('// /index.s.js'), true)

	r = await request(`${BASE}/SKILL.raw.json`)
	chk('GET /SKILL.raw.json → 200', r.status, 200)
	chk('GET /SKILL.raw.json ignores ae request directive', r.json?.request, undefined)

	r = await request(`${BASE}/SKILL.raw.s.js`)
	chk('GET /SKILL.raw.s.js → 200', r.status, 200)
	chk('GET /SKILL.raw.s.js returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /SKILL.raw.s.js uses raw document marker', r.text.includes('// /SKILL.raw.s.js'), true)
	chk('GET /SKILL.raw.s.js ignores ae operation directive', !r.text.includes('operation: \'POST /api/exec AUTH {"args":["aexec","--version"]}\''), true)

	r = await request(`${BASE}/SKILL.s.js`)
	chk('GET /SKILL.s.js → 200', r.status, 200)
	chk('GET /SKILL.s.js: returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /SKILL.s.js: exposes root URL key', r.text.includes('m["/"] = {'), true)
	chk('GET /SKILL.s.js: exposes ACL URL key', r.text.includes('m["/api/acl"] = {'), true)
	chk('GET /SKILL.s.js: exposes exec URL key', r.text.includes('m["/api/exec"] = {'), true)
	chk('GET /SKILL.s.js: includes API key header form', r.text.includes('"X-API-Key": client.API_KEY'), true)
	chk('GET /SKILL.s.js: includes SJS Accept header', r.text.includes('"Accept": "text/sjs"'), true)
	chk('GET /SKILL.s.js: explains memo echo', r.text.includes('echo: memo'), true)
	chk('GET /SKILL.s.js: includes request body args path', r.text.includes('body: { args: ["<command>", "<arg>", "..."] }'), true)
	chk('GET /SKILL.s.js: includes request body args example', r.text.includes('m["/api/exec"].request.body.args.example = ["aexec", "--version"];'), true)
	chk('GET /SKILL.s.js: marks request body args as argv', r.text.includes('m["/api/exec"].request.body.args.kind = "argv";'), true)
	chk('GET /SKILL.s.js: includes argv syntax', r.text.includes("m[\"/api/exec\"].request.body.args.syntax = '<command> [<arg>]...';"), true)
	chk('GET /SKILL.s.js: includes direct exec operation line', r.text.includes('operation: \'POST /api/exec AUTH {"args":["aexec","--version"]}\''), true)
	chk('GET /SKILL.s.js: keeps ACL response values flat', r.text.includes('m["/api/acl"].response.allow = [\'<command> [<arg>]...\', \'...\'];'), true)
	chk('GET /SKILL.s.js: maps ACL allow to exec args', r.text.includes('m["/api/acl"].response.allow.to_args = [\'<command>\', \'<arg>\', \'...\'];'), true)
	chk('GET /SKILL.s.js: keeps exec response values flat', r.text.includes('m["/api/exec"].response.output = \'<stdout>\';'), true)
	chk('GET /SKILL.s.js: has no duplicate response name objects', !r.text.includes('m["/api/acl"].response = { allow, deny };') && !r.text.includes('m["/api/exec"].response = { output, length, exitCode, status, duration, stderr };'), true)
	chk('GET /SKILL.s.js: has no nested response hints', !r.text.includes('response = { allow: [') && !r.text.includes('response = { output: '), true)
	chk('GET /SKILL.s.js: uses direct document marker', r.text.includes('// /SKILL.s.js'), true)
	chk('GET /SKILL.s.js: links to ACL document', r.text.includes('"/api/acl/SKILL.s.js"'), true)
	chk('GET /SKILL.s.js: links to exec document', r.text.includes('"/api/exec/SKILL.s.js"'), true)
	chk('GET /SKILL.s.js: has no document_suffix rule', !r.text.includes('document_suffix'), true)
	chk('GET /SKILL.s.js: has no example branch', !r.text.includes('example:'), true)
	chk('GET /SKILL.s.js: has no links block', !r.text.includes('links: {'), true)
	chk('GET /SKILL.s.js: byte-key block is omitted', !r.text.includes('/* byte-key'), true)

	r = await request(`${BASE}/SKILL.sjs`)
	chk('GET /SKILL.sjs alias → 200', r.status, 200)
	chk('GET /SKILL.sjs alias uses .s.js document marker', r.text.includes('// /SKILL.s.js'), true)

	r = await request(`${BASE}/api/SKILL.s.js`)
	chk('GET /api/SKILL.s.js → 200', r.status, 200)
	chk('GET /api/SKILL.s.js returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /api/SKILL.s.js uses API document marker', r.text.includes('// /api/SKILL.s.js'), true)
	chk('GET /api/SKILL.s.js is document, not recovery', !r.text.includes('m.result = {'), true)
	chk('GET /api/SKILL.s.js uses API namespace surface', r.text.includes('m["/api"] = {'), true)
	chk('GET /api/SKILL.s.js does not synthesize root surface', !r.text.includes('m["/"] = {'), true)

	r = await request(`${BASE}/api/plugins/SKILL.s.js`)
	chk('GET /api/plugins/SKILL.s.js → 200', r.status, 200)
	chk('GET /api/plugins/SKILL.s.js returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /api/plugins/SKILL.s.js uses plugins document marker', r.text.includes('// /api/plugins/SKILL.s.js'), true)
	chk('GET /api/plugins/SKILL.s.js is document, not recovery', !r.text.includes('m.result = {'), true)

	r = await request(`${BASE}/private/SKILL.s.js`, { headers: { 'X-API-Key': K } })
	chk('GET /private/SKILL.s.js with auth → 200', r.status, 200)
	chk('GET /private/SKILL.s.js returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /private/SKILL.s.js uses private document marker', r.text.includes('// /private/SKILL.s.js'), true)
	chk('GET /private/SKILL.s.js is document, not recovery', !r.text.includes('m.result = {'), true)
	chk('GET /private/SKILL.s.js uses private namespace surface', r.text.includes('m["/private"] = {'), true)
	chk('GET /private/SKILL.s.js includes auth request header', r.text.includes('"X-API-Key": client.API_KEY'), true)
	chk('GET /private/SKILL.s.js does not synthesize root surface', !r.text.includes('m["/"] = {'), true)

	r = await request(`${BASE}/cli/SKILL.s.js`, { headers: { 'X-API-Key': K } })
	chk('GET /cli/SKILL.s.js with auth → 200', r.status, 200)
	chk('GET /cli/SKILL.s.js returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /cli/SKILL.s.js uses CLI namespace surface', r.text.includes('m["/cli"] = {'), true)
	chk('GET /cli/SKILL.s.js includes auth request header', r.text.includes('"X-API-Key": client.API_KEY'), true)
	chk('GET /cli/SKILL.s.js does not synthesize root surface', !r.text.includes('m["/"] = {'), true)

	r = await request(`${BASE}/cli/transfer/SKILL.s.js`, { headers: { 'X-API-Key': K } })
	chk('GET /cli/transfer/SKILL.s.js with auth → 200', r.status, 200)
	chk('GET /cli/transfer/SKILL.s.js returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /cli/transfer/SKILL.s.js keeps transfer method POST', r.text.includes('m["/cli/transfer"] = {\n  method: "POST"'), true)
	chk('GET /cli/transfer/SKILL.s.js includes auth request header', r.text.includes('"X-API-Key": client.API_KEY'), true)
	chk('GET /cli/transfer/SKILL.s.js does not synthesize exec argv form', !r.text.includes('m["/cli/transfer"].request.body.args.kind'), true)

	r = await request(`${BASE}/SKILL.s.js.asm`)
	chk('GET /SKILL.s.js.asm experimental variant removed', r.status, 404)

	r = await request(`${BASE}/SKILL.s.js.flat`)
	chk('GET /SKILL.s.js.flat experimental variant removed', r.status, 404)

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
	chk('GET /skills.json?navigation=true: lists private namespace skill', r.json?.skills?.some(s => s.name === 'private'), true)
	chk('GET /skills.json?navigation=true: does not list private plugin by name', !r.text.includes('bootplug'), true)
	chk('GET /skills.json?navigation=true: does not expose private plugin skill URL', !r.text.includes('/private/skills/bootplug'), true)

	r = await request(`${BASE}/skills.html?navigation=true`)
	chk('GET /skills.html?navigation=true: has navigation', r.text.includes('?navigation=true'), true)

	r = await request(`${BASE}/skills/SKILL.s.js`)
	chk('GET /skills/SKILL.s.js → 200', r.status, 200)
	chk('GET /skills/SKILL.s.js returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /skills/SKILL.s.js uses skills namespace marker', r.text.includes('// /skills/SKILL.s.js'), true)
	chk('GET /skills/SKILL.s.js is document, not recovery', !r.text.includes('m.result = {'), true)

	r = await request(`${BASE}/skills/acl/SKILL.json`)
	chk('GET /skills/acl/SKILL.json keeps base metadata', r.json?.skill, 'acl')
	chk('GET /skills/acl/SKILL.json keeps endpoint metadata', r.json?.endpoint, 'GET /api/acl')
	chk('GET /skills/acl/SKILL.json keeps markdown lines', Array.isArray(r.json?.lines), true)
	chk('GET /skills/acl/SKILL.json exposes ae request directive', r.json?.request?.headers?.['X-API-Key'], 'API_KEY')
	chk('GET /skills/acl/SKILL.json exposes ae response directive', r.json?.response?.allow?.[0], '<command> [<arg>]...')
	chk('GET /skills/acl/SKILL.json exposes ae refs directive', r.json?.refs?.[0], '/skills/exec/SKILL.s.js')

	r = await request(`${BASE}/skills/plugins/SKILL.json`)
	chk('GET /skills/plugins/SKILL.json keeps base metadata', r.json?.skill, 'plugins')
	chk('GET /skills/plugins/SKILL.json keeps endpoint metadata', r.json?.endpoint, 'GET /api/plugins')
	chk('GET /skills/plugins/SKILL.json keeps markdown lines', Array.isArray(r.json?.lines), true)
	chk('GET /skills/plugins/SKILL.json exposes ae request directive', r.json?.request?.headers?.['X-API-Key'], 'API_KEY')
	chk('GET /skills/plugins/SKILL.json exposes ae response directive', r.json?.response?.plugins?.[0]?.name, '<plugin name>')
	chk('GET /skills/plugins/SKILL.json exposes ae refs directive', r.json?.refs?.[0], '/private/skills')
	chk('GET /skills/plugins/SKILL.json avoids concrete private plugin example', !r.text.includes('/private/skills/hermes/'), true)

	r = await request(`${BASE}/skills/private/SKILL.json`)
	chk('GET /skills/private/SKILL.json keeps base metadata', r.json?.skill, 'private')
	chk('GET /skills/private/SKILL.json keeps endpoint metadata', r.json?.endpoint, 'GET /private')
	chk('GET /skills/private/SKILL.json keeps markdown lines', Array.isArray(r.json?.lines), true)
	chk('GET /skills/private/SKILL.json exposes ae request directive', r.json?.request?.headers?.['X-API-Key'], 'API_KEY')
	chk('GET /skills/private/SKILL.json exposes ae response directive', r.json?.response?.endpoints?.[0], '/private/skills')
	chk('GET /skills/private/SKILL.json exposes ae refs directive', r.json?.refs?.[0], '/private')
	chk('GET /skills/private/SKILL.json does not expose private skill route template', !r.text.includes(':name'), true)
	chk('GET /skills/private/SKILL.json does not expose concrete private plugin URL', !r.text.includes('/private/skills/bootplug'), true)

	r = await request(`${BASE}/skills/private/SKILL.md`)
	chk('GET /skills/private/SKILL.md points to private skills index', r.text.includes('/private/skills'), true)
	chk('GET /skills/private/SKILL.md does not expose private skill route template', !r.text.includes(':name'), true)
	chk('GET /skills/private/SKILL.md does not expose concrete private plugin URL', !r.text.includes('/private/skills/bootplug'), true)

	r = await request(`${BASE}/skills/exec/SKILL.s.js`)
	chk('GET /skills/exec/SKILL.s.js → 200', r.status, 200)
	chk('GET /skills/exec/SKILL.s.js returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /skills/exec/SKILL.s.js uses exec document marker', r.text.includes('// /skills/exec/SKILL.s.js'), true)
	chk('GET /skills/exec/SKILL.s.js exposes exec surface', r.text.includes('m["/api/exec"] = {'), true)
	chk('GET /skills/exec/SKILL.s.js keeps generic exec body', r.text.includes('body: { args: ["<command>", "<arg>", "..."] }'), true)

	r = await request(`${BASE}/skills/exec/SKILL.raw.json`)
	chk('GET /skills/exec/SKILL.raw.json → 200', r.status, 200)
	chk('GET /skills/exec/SKILL.raw.json ignores ae request directive', r.json?.request, undefined)

	r = await request(`${BASE}/skills/exec/SKILL.raw.s.js`)
	chk('GET /skills/exec/SKILL.raw.s.js → 200', r.status, 200)
	chk('GET /skills/exec/SKILL.raw.s.js returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /skills/exec/SKILL.raw.s.js uses raw document marker', r.text.includes('// /skills/exec/SKILL.raw.s.js'), true)
	chk('GET /skills/exec/SKILL.raw.s.js ignores ae operation directive', !r.text.includes('operation:'), true)

	r = await request(`${BASE}/skills/exec/SKILL.md`)
	chk('GET /skills/exec/SKILL.md includes ae request body directive', r.text.includes('<!-- ae:prev request.body -> all -->'), true)
	chk('GET /skills/exec/SKILL.md labels request body', r.text.includes('Request body:'), true)

	r = await request(`${BASE}/skills/exec/SKILL.sjs`)
	chk('GET /skills/exec/SKILL.sjs alias → 200', r.status, 200)
	chk('GET /skills/exec/SKILL.sjs alias uses .s.js marker', r.text.includes('// /skills/exec/SKILL.s.js'), true)

	r = await request(`${BASE}/private/skills/SKILL.s.js`, { headers: { 'X-API-Key': K } })
	chk('GET /private/skills/SKILL.s.js with auth → 200', r.status, 200)
	chk('GET /private/skills/SKILL.s.js returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /private/skills/SKILL.s.js uses private skills marker', r.text.includes('// /private/skills/SKILL.s.js'), true)
	chk('GET /private/skills/SKILL.s.js includes auth request header', r.text.includes('"X-API-Key": client.API_KEY'), true)
	chk('GET /private/skills/SKILL.s.js is document, not recovery', !r.text.includes('m.result = {'), true)

	r = await request(`${BASE}/private/skills/bootplug/SKILL.s.js`, { headers: { 'X-API-Key': K } })
	chk('GET /private/skills/:name/SKILL.s.js with auth → 200', r.status, 200)
	chk('GET /private/skills/:name/SKILL.s.js returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /private/skills/:name/SKILL.s.js uses plugin marker', r.text.includes('// /private/skills/bootplug/SKILL.s.js'), true)
	chk('GET /private/skills/:name/SKILL.s.js is document, not recovery', !r.text.includes('m.result = {'), true)

	r = await request(`${BASE}/skills/bootplug`, { headers: { Accept: 'application/json' } })
	chk('GET /skills/:private-plugin → 404', r.status, 404)
	chk('GET /skills/:private-plugin does not expose private URL', !r.text.includes('/private/skills/bootplug'), true)

	// --------------------------------------------------
	console.log('\n=== agent-friendly 404 ===')

	r = await request(`${BASE}/missing`)
	chk('GET /missing → 404', r.status, 404)
	chk('404 default format is JSON', r.headers.get('content-type')?.includes('application/json'), true)
	chk('404 JSON default uses JSON SKILL entrypoint', r.json?.skill, '/SKILL.json')
	chk('404 JSON default exposes SJS recovery entrypoint', r.json?.sjs, '/SKILL.s.js')
	chk('404 JSON default suggests SJS recovery first', r.json?.suggest?.[0], 'GET /SKILL.s.js')
	chk('404 JSON default also suggests JSON recovery', r.json?.suggest?.includes('GET /SKILL.json'), true)

	r = await request(`${BASE}/missing.md`)
	chk('GET /missing.md → 404', r.status, 404)
	chk('404 explicit markdown remains markdown', r.headers.get('content-type')?.includes('text/markdown'), true)
	chk('404 explicit markdown reads markdown skill', r.text.includes('Read /SKILL.md first'), true)
	chk('404 explicit markdown suggests MD recovery first', r.text.includes('GET /SKILL.md'), true)

	r = await request(`${BASE}/missing.json`)
	chk('GET /missing.json → 404', r.status, 404)
	chk('404 JSON uses JSON SKILL entrypoint', r.json?.skill, '/SKILL.json')
	chk('404 JSON exposes SJS recovery entrypoint', r.json?.sjs, '/SKILL.s.js')
	chk('404 JSON suggests SJS recovery first', r.json?.suggest?.[0], 'GET /SKILL.s.js')
	chk('404 JSON suggests ACL inspection', r.json?.suggest?.includes('GET /api/acl'), true)
	chk('404 JSON suggests exec surface', r.json?.suggest?.includes('POST /api/exec'), true)

	r = await request(`${BASE}/missing.html`)
	chk('GET /missing.html → 404', r.status, 404)
	chk('404 explicit HTML remains HTML', r.headers.get('content-type')?.includes('text/html'), true)
	chk('404 explicit HTML links HTML skill', r.text.includes('href="/SKILL.html"'), true)
	chk('404 explicit HTML suggests HTML recovery first', r.text.includes('GET /SKILL.html'), true)

	r = await request(`${BASE}/missing`, { headers: { Accept: 'text/html' } })
	chk('GET /missing with browser/html Accept → 404', r.status, 404)
	chk('404 browser/html Accept returns HTML', r.headers.get('content-type')?.includes('text/html'), true)
	chk('404 browser/html Accept links HTML skill', r.text.includes('href="/SKILL.html"'), true)

	r = await request(`${BASE}/missing.s.js`)
	chk('GET /missing.s.js returns SJS fallback', r.status, 200)
	chk('404 .s.js returns text/sjs', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('404 .s.js records 404 result', r.text.includes('status: 404'), true)
	chk('404 .s.js falls back to root SJS document', r.text.includes('url: "/SKILL.s.js"'), true)
	chk('404 .s.js includes SJS Accept header', r.text.includes('"Accept": "text/sjs"'), true)

	r = await request(`${BASE}/missing`, { headers: { Accept: 'text/sjs' } })
	chk('GET /missing with Accept SJS returns SJS fallback', r.status, 200)
	chk('404 Accept SJS returns text/sjs', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('404 Accept SJS falls back to root SJS document', r.text.includes('url: "/SKILL.s.js"'), true)

	r = await request(`${BASE}/api/unknown`, { headers: { 'X-API-Key': K } })
	chk('GET /api/unknown with auth -> 404', r.status, 404)
	chk('API 404 without explicit format returns curl text', r.headers.get('content-type')?.includes('text/plain'), true)
	chk('API 404 curl text includes API_KEY header', r.text.includes('X-API-Key: <API_KEY>'), true)
	r = await request(`${BASE}/api/unknown.json`, { headers: { 'X-API-Key': K } })
	chk('GET /api/unknown.json with auth -> 404', r.status, 404)
	chk('API 404 .json returns JSON', r.headers.get('content-type')?.includes('application/json'), true)
	chk('API 404 JSON includes curl list', Array.isArray(r.json?.curl), true)
	r = await request(`${BASE}/api/unknown.md`, { headers: { 'X-API-Key': K } })
	chk('GET /api/unknown.md with auth -> 404', r.status, 404)
	chk('API 404 .md returns markdown', r.headers.get('content-type')?.includes('text/markdown'), true)
	r = await request(`${BASE}/api/unknown.html`, { headers: { 'X-API-Key': K } })
	chk('GET /api/unknown.html with auth -> 404', r.status, 404)
	chk('API 404 .html returns HTML', r.headers.get('content-type')?.includes('text/html'), true)

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

	r = await request(`${BASE}/api/exec`, { method: 'POST', headers: { 'X-API-Key': K, Accept: 'text/sjs' }, body: { args: ['git', 'status'] } })
	chk('POST /api/exec denied with Accept SJS -> 200 fallback', r.status, 200)
	chk('POST /api/exec denied with Accept SJS returns text/sjs', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('POST /api/exec denied with Accept SJS records 403 result', r.text.includes('status: 403'), true)
	chk('POST /api/exec denied with Accept SJS explains memo echo', r.text.includes('echo: memo'), true)
	chk('POST /api/exec denied with Accept SJS links ACL surface', r.text.includes('document: "/api/acl/SKILL.s.js"'), true)
	chk('POST /api/exec denied with Accept SJS points to allow response', r.text.includes("m[\"/api/acl\"].response.allow = ['<command> [<arg>]...', '...'];"), true)

	r = await request(`${BASE}/api/exec`, { method: 'POST', headers: { 'X-API-Key': K, Accept: 'text/sjs' }, body: { command: 'echo agent exec ok' } })
	chk('POST /api/exec {command} with Accept SJS -> 200 fallback', r.status, 200)
	chk('POST /api/exec {command} with Accept SJS records field', r.text.includes('field: "command"'), true)
	chk('POST /api/exec {command} with Accept SJS keeps retry example', r.text.includes('m["/api/exec"].request.body.args.example = ["aexec", "--version"];'), true)
	chk('POST /api/exec {command} with Accept SJS marks args as argv', r.text.includes('m["/api/exec"].request.body.args.kind = "argv";'), true)

	r = await request(`${BASE}/api/exec`, { headers: { 'X-API-Key': K, Accept: 'text/sjs' } })
	chk('GET /api/exec with Accept SJS -> 200 fallback', r.status, 200)
	chk('GET /api/exec with Accept SJS records 405', r.text.includes('status: 405'), true)
	chk('GET /api/exec with Accept SJS says POST method', r.text.includes('method: "POST"'), true)
	chk('GET /api/exec with Accept SJS keeps method top-level only', !r.text.includes('request: {\n    method: "POST"'), true)

	r = await request(`${BASE}/api/nope`, { headers: { 'X-API-Key': K, Accept: 'text/sjs' } })
	chk('GET /api/nope with Accept SJS -> 200 fallback', r.status, 200)
	chk('GET /api/nope with Accept SJS records 404', r.text.includes('status: 404'), true)
	chk('GET /api/nope with Accept SJS points root skill', r.text.includes('document: "/SKILL.s.js"'), true)

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

	r = await request(`${BASE}/api/acl`, { headers: { 'X-API-Key': K, Accept: 'text/sjs' } })
	chk('GET /api/acl with auth Accept SJS returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /api/acl with auth Accept SJS includes actual allow assignment', r.text.includes('m["/api/acl"].response.allow = ['), true)
	chk('GET /api/acl with auth Accept SJS includes configured allow command', r.text.includes('"echo *"'), true)
	chk('GET /api/acl with auth Accept SJS has one allow assignment', (r.text.match(/m\["\/api\/acl"\]\.response\.allow =/g) || []).length, 1)
	chk('GET /api/acl with auth Accept SJS keeps allow-to-args mapping', r.text.includes('m["/api/acl"].response.allow.to_args = [\'<command>\', \'<arg>\', \'...\'];'), true)

	r = await request(`${BASE}/api/plugins`, { headers: { 'X-API-Key': K, Accept: 'text/sjs' } })
	chk('GET /api/plugins with auth Accept SJS returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /api/plugins with auth Accept SJS exposes plugin response', r.text.includes('m["/api/plugins"].response.plugins = ['), true)

	r = await request(`${BASE}/api`, { headers: { Accept: 'text/sjs' } })
	chk('GET /api with Accept SJS returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /api with Accept SJS uses API document marker', r.text.includes('// /api/SKILL.s.js'), true)

	r = await request(`${BASE}/skills`, { headers: { Accept: 'text/sjs' } })
	chk('GET /skills with Accept SJS returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /skills with Accept SJS uses skills document marker', r.text.includes('// /skills/SKILL.s.js'), true)

	r = await request(`${BASE}/private`, { headers: { 'X-API-Key': K, Accept: 'text/sjs' } })
	chk('GET /private with auth Accept SJS returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /private with auth Accept SJS uses private document marker', r.text.includes('// /private/SKILL.s.js'), true)

	r = await request(`${BASE}/private/skills`, { headers: { 'X-API-Key': K, Accept: 'text/sjs' } })
	chk('GET /private/skills with auth Accept SJS returns SJS', r.headers.get('content-type')?.includes('text/sjs'), true)
	chk('GET /private/skills with auth Accept SJS uses private skills marker', r.text.includes('// /private/skills/SKILL.s.js'), true)

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
	chk('GET /private/skills?format=json: reveals private skill after auth', r.text.includes('/private/skills/bootplug/SKILL.json'), true)

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
	console.log('\n=== memo echo ===')

	r = await request(`${BASE}/SKILL.s.js?memo=acl_ok`)
	chk('GET /SKILL.s.js?memo: SJS has m.memo near top', r.text.indexOf('m.memo = "acl_ok";') > -1 && r.text.indexOf('m.memo = "acl_ok";') < r.text.indexOf('m.rule'), true)

	r = await request(`${BASE}/index.s.js?memo=index-note`)
	chk('GET /index.s.js?memo: SJS index has m.memo near top', r.text.indexOf('m.memo = "index-note";') > -1 && r.text.indexOf('m.memo = "index-note";') < r.text.indexOf('m.rule'), true)

	r = await request(`${BASE}/index.json?memo=index-json-note`)
	chk('GET /index.json?memo: JSON index memo echoed', r.json?.memo, 'index-json-note')

	r = await request(`${BASE}/SKILL.md?memo=md-note`)
	chk('GET /SKILL.md?memo: markdown memo is visible at top', r.text.startsWith('> agent-exec memo: `md-note`'), true)

	r = await request(`${BASE}/index.html?memo=html-note`)
	chk('GET /index.html?memo: html memo is visible near body start', r.text.includes('<body><p><small>agent-exec memo:'), true)

	r = await request(`${BASE}/index.html?memo=${encodeURIComponent('<script>alert(1)</script>')}`)
	chk('GET /index.html?memo: html memo escapes script tag', r.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true)
	chk('GET /index.html?memo: html memo does not emit raw script tag', !r.text.includes('<script>alert(1)</script>'), true)

	r = await request(`${BASE}/api/acl?memo=json-note`, { headers: { 'X-API-Key': K } })
	chk('GET /api/acl?memo: JSON memo echoed', r.json?.memo, 'json-note')

	r = await request(`${BASE}/api/acl`, { headers: { 'X-API-Key': K, 'X-Agent-Memo': 'header-note' } })
	chk('GET /api/acl with X-Agent-Memo: JSON memo echoed', r.json?.memo, 'header-note')

	r = await request(`${BASE}/api/exec`, { method: 'POST', headers: { 'X-API-Key': K }, body: { args: ['aexec', '--version'], memo: 'body-note' } })
	chk('POST /api/exec body.memo: still executes', r.status, 200)
	chk('POST /api/exec body.memo: JSON memo echoed', r.json?.memo, 'body-note')

	r = await request(`${BASE}/api/acl?memo=need-auth`)
	chk('GET /api/acl without auth: status remains 401', r.status, 401)
	chk('GET /api/acl without auth: JSON memo echoed', r.json?.memo, 'need-auth')

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

	r = await request(`${BASE}/private/skills/bootplug/SKILL.raw.json`, { headers: { 'X-API-Key': K } })
	chk('startup plugin private raw JSON SKILL → 200', r.status, 200)
	chk('startup plugin private raw JSON keeps lines', Array.isArray(r.json?.lines), true)

	r = await request(`${BASE}/private/skills/createdacl/SKILL.md`, { headers: { 'X-API-Key': K } })
	chk('plugin-create generated private SKILL → 200', r.status, 200)
	chk('plugin-create generated SKILL points to /api/exec', r.text.includes('POST /api/exec'), true)

	r = await request(`${BASE}/api/acl`, { headers: { 'X-API-Key': K } })
	chk('plugin-create generated ACL allows help', r.json?.allow?.includes('printf --help'), true)
	chk('plugin-create generated ACL allows version', r.json?.allow?.includes('printf --version'), true)
	chk('plugin-create generated ACL has no broad printf glob', r.json?.allow?.includes('printf *'), false)

	r = await request(`${BASE}/api/exec`, {
		method: 'POST',
		headers: { 'X-API-Key': K },
		body: { args: ['printf', 'unexpected'] },
	})
	chk('plugin-create generated plugin denies unreviewed args', r.status, 403)

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
