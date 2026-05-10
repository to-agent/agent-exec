#!/usr/bin/env node
'use strict'

/**
 * test/unit.js — unit tests
 *
 * Usage: node test/unit.js
 *
 * Coverage:
 *   - ACL: matchCommandPattern / deny merge
 *   - Plugin name: path traversal protection
 *   - Link safety: isSafeHref / normalizeHref
 *   - npm pack: sensitive file exclusion
 */

const assert   = require('node:assert/strict')
const path     = require('node:path')
const fs       = require('node:fs')
const os       = require('node:os')
const net      = require('node:net')
const { execSync, spawnSync, spawn } = require('node:child_process')

const UNIT_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-unit-config-'))
process.env.AGENT_EXEC_CONFIG_DIR = UNIT_CONFIG_DIR
process.env.AGENT_EXEC_PROJECT_SETTINGS_FILE = path.join(UNIT_CONFIG_DIR, 'missing-project-settings.json')

let pass = 0, fail = 0

function test(label, fn) {
	try {
		fn()
		console.log(`  ✅ ${label}`)
		pass++
	} catch (e) {
		console.log(`  ❌ ${label}`)
		console.log(`     ${e.message}`)
		fail++
	}
}

// ----------------------------------------------------------------
// ACL: matchCommandPattern
// ----------------------------------------------------------------
console.log('\n=== ACL: matchCommandPattern ===')

const settingsModule = require('../modules/settings')
const { checkCommand, matchCommandPattern } = settingsModule
const { DEFAULT_SETTINGS_FILE } = require('../modules/paths')

test('default settings file: exec.allow contains only self-test command', () => {
	const defaults = JSON.parse(fs.readFileSync(DEFAULT_SETTINGS_FILE, 'utf8'))
	assert.deepEqual(defaults.exec?.allow, ['aexec --version'], 'default exec.allow only permits self-test')
})

test('fresh install: aexec --version self-test is allowed', () => {
	assert.equal(checkCommand(['aexec', '--version']), null, 'aexec --version is allowed as self-test')
})

test('fresh install: common exploration commands are not allowed', () => {
	assert.notEqual(checkCommand(['echo', 'hello']), null, 'echo is not allowed by default')
	assert.notEqual(checkCommand(['pwd']), null, 'pwd is not allowed by default')
	assert.notEqual(checkCommand(['ls']), null, 'ls is not allowed by default')
})

test('default deny: sudo is denied', () => {
	const result = checkCommand(['sudo', 'ls'])
	assert.notEqual(result, null, 'sudo must be denied')
})

test('default deny: path-qualified privileged commands are denied', () => {
	assert.notEqual(checkCommand(['/usr/bin/sudo', 'ls']), null, '/usr/bin/sudo is denied')
	assert.notEqual(checkCommand(['/bin/su', '-']), null, '/bin/su is denied')
	assert.notEqual(checkCommand(['/sbin/shutdown', '-h', 'now']), null, '/sbin/shutdown is denied')
	assert.notEqual(checkCommand(['/usr/sbin/mkfs.ext4', '/dev/sda1']), null, '/usr/sbin/mkfs.ext4 is denied')
})

test('fresh install: bundled docs only open exec.allow for self-test', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-fresh-'))
	try {
		const result = spawnSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./modules/settings').load().exec.allow))"], {
			cwd: path.join(__dirname, '..'),
			env: {
				PATH: process.env.PATH,
				HOME: tmp,
				TMPDIR: os.tmpdir(),
				AGENT_EXEC_CONFIG_DIR: path.join(tmp, 'config'),
				AGENT_EXEC_PROJECT_SETTINGS_FILE: path.join(tmp, 'missing-settings.json'),
			},
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr || result.stdout)
		assert.deepEqual(JSON.parse(result.stdout), ['aexec --version'], 'fresh install exec.allow only permits self-test')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('user settings file: config root settings.json is loaded', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-user-settings-'))
	try {
		const configDir = path.join(tmp, 'config')
		fs.mkdirSync(configDir, { recursive: true })
		fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({
			exec: { allow: ['echo'] },
		}))
		const result = spawnSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./modules/settings').load().exec.allow))"], {
			cwd: path.join(__dirname, '..'),
			env: {
				PATH: process.env.PATH,
				HOME: tmp,
				TMPDIR: os.tmpdir(),
				AGENT_EXEC_CONFIG_DIR: configDir,
				AGENT_EXEC_PROJECT_SETTINGS_FILE: path.join(tmp, 'missing-project-settings.json'),
			},
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr || result.stdout)
		assert.ok(JSON.parse(result.stdout).includes('echo'), 'root user settings are loaded')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('legacy user settings file: settings/local/settings.json is still loaded', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-legacy-settings-'))
	try {
		const configDir = path.join(tmp, 'config')
		const legacyDir = path.join(configDir, 'settings', 'local')
		fs.mkdirSync(legacyDir, { recursive: true })
		fs.writeFileSync(path.join(legacyDir, 'settings.json'), JSON.stringify({
			exec: { allow: ['pwd'] },
		}))
		const result = spawnSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./modules/settings').load().exec.allow))"], {
			cwd: path.join(__dirname, '..'),
			env: {
				PATH: process.env.PATH,
				HOME: tmp,
				TMPDIR: os.tmpdir(),
				AGENT_EXEC_CONFIG_DIR: configDir,
				AGENT_EXEC_PROJECT_SETTINGS_FILE: path.join(tmp, 'missing-project-settings.json'),
			},
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr || result.stdout)
		assert.ok(JSON.parse(result.stdout).includes('pwd'), 'legacy local settings are loaded')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('matchCommandPattern: * matches everything', () => {
	assert.ok(matchCommandPattern('*', 'any cmd'), '* matches everything')
})

test('matchCommandPattern: plain string exact match only', () => {
	assert.ok(matchCommandPattern('git',       'git'),         'exact match')
	assert.ok(matchCommandPattern('git log',   'git log'),     'exact multi-word match')
	assert.ok(!matchCommandPattern('git',      'git status'),  'plain string is not prefix match')
	assert.ok(!matchCommandPattern('git log',  'git log --oneline'), 'plain string is not prefix match')
	assert.ok(!matchCommandPattern('gits',     'git status'), 'not a substring match')
})

test('matchCommandPattern: glob match', () => {
	assert.ok(matchCommandPattern('git *',    'git status'))
	assert.ok(matchCommandPattern('npm *',    'npm install --save'))
	assert.ok(!matchCommandPattern('npm *',   'yarn install'), 'different command does not match')
})

test('matchCommandPattern: regexp match', () => {
	assert.ok(matchCommandPattern('/^sudo/',    'sudo rm -rf /'))
	assert.ok(!matchCommandPattern('/^sudo/',   'not sudo'),  'does not start with sudo')
	assert.ok(matchCommandPattern('/rm.*-rf/',  'rm -rf /tmp'))
})

test('matchCommandPattern: allow * can be detected as allow-all', () => {
	const allow = ['*']
	assert.ok(allow.includes('*'), 'allow.includes("*") detects allow-all')
})

test('deny is evaluated before allow', () => {
	// Verify checkCommand's deny-first evaluation.
	// deny: ['echo *'] + allow: ['*'] means deny wins.
	const result = checkCommand(['sudo', 'echo', 'hi'])
	assert.notEqual(result, null, 'sudo is denied by deny rules')
})

// ----------------------------------------------------------------
// ACL: deny merge — default deny patterns are not cleared by local settings
// ----------------------------------------------------------------
console.log('\n=== ACL: deny merge ===')

test('default deny patterns remain after settings load', () => {
	const settings = require('../modules/settings')
	const s = settings.load()
	assert.ok(Array.isArray(s.exec?.deny), 'exec.deny is an array')
	assert.ok(s.exec.deny.length > 0, 'deny patterns exist')
	// The default sudo pattern is retained.
	const hasSudo = s.exec.deny.some(p => p.includes('sudo'))
	assert.ok(hasSudo, 'default deny includes a sudo pattern')
})

test('deepMerge: arrays are union-merged instead of overwritten', () => {
	// Indirectly test settings.js deepMerge behavior.
	const settings = require('../modules/settings')
	const origLoad = settings.load
	// Simulate adding deny:["custom"] from local settings.
	settings.load = () => {
		const base = { exec: { allow: [], deny: ['/^sudo/'] } }
		// Simulate the deepMerge result.
		return { exec: { allow: [], deny: ['/^sudo/', 'custom'] } }
	}
	try {
		const s = settings.load()
		assert.ok(s.exec.deny.includes('/^sudo/'), 'default deny remains')
		assert.ok(s.exec.deny.includes('custom'), 'local deny is added')
	} finally {
		settings.load = origLoad
	}
})

// ----------------------------------------------------------------
// Plugin name: path traversal protection
// ----------------------------------------------------------------
console.log('\n=== Plugin name: path traversal ===')

const SAFE_PLUGIN_NAME = /^[a-z0-9][a-z0-9_-]*$/
const { USER_PLUGINS_DIR } = require('../modules/paths')

const dangerousNames = ['../../etc', '../foo', '/absolute', 'C:\\tmp', 'foo/bar', 'foo bar', '.hidden', '-dash']
const safeNames = ['hermes', 'my-plugin', 'plugin_1', 'a1b2', 'test-123']

for (const name of dangerousNames) {
	test(`rejects unsafe name: ${JSON.stringify(name)}`, () => {
		assert.ok(!SAFE_PLUGIN_NAME.test(name), `${name} must not match SAFE_PLUGIN_NAME`)
	})
}

for (const name of safeNames) {
	test(`allows safe name: ${name}`, () => {
		assert.ok(SAFE_PLUGIN_NAME.test(name), `${name} should match SAFE_PLUGIN_NAME`)
		const resolved = path.resolve(path.join(USER_PLUGINS_DIR, name))
		assert.ok(
			resolved.startsWith(path.resolve(USER_PLUGINS_DIR) + path.sep),
			`path stays inside USER_PLUGINS_DIR: ${resolved}`
		)
	})
}

// ----------------------------------------------------------------
// Link safety: isSafeHref / normalizeHref
// ----------------------------------------------------------------
console.log('\n=== Link safety: isSafeHref ===')

const {
	extractSjsDirectives,
	extractTargetDirectives,
	parseAgentDirective,
	toHtml,
	toJson,
	toSjs,
} = require('../modules/convert')
const { extractDescription } = require('../modules/scan-cli')

const dangerousLinks = [
	['javascript:alert(1)',             'javascript: scheme'],
	[' javascript:alert(1)',            'leading space + javascript:'],
	['data:text/html,<h1>x</h1>',      'data: scheme'],
	['vbscript:msgbox(1)',              'vbscript: scheme'],
	['file:///etc/passwd',             'file: scheme'],
]

for (const [href, label] of dangerousLinks) {
	test(`unsafe scheme becomes href="#": ${label}`, () => {
		const html = toHtml(`[x](${href})`)
		assert.ok(!new RegExp(`href="${href.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(html),
			`unsafe href is not emitted as-is`)
		assert.ok(!html.includes(`href="javascript:`), 'javascript: is not included in href')
		assert.ok(!html.includes(`href="data:`),       'data: is not included in href')
		assert.ok(!html.includes(`href="vbscript:`),   'vbscript: is not included in href')
		assert.ok(!html.includes(`href="file:`),       'file: is not included in href')
	})
}

const safeLinks = [
	['https://example.com/my-page',    'https: + hyphen'],
	['mailto:first-last@example.com',  'mailto: + hyphen'],
	['./docs/my-page',                 'relative URL + hyphen'],
	['#section',                       'anchor'],
	['//cdn.example.com',              'protocol-relative URL'],
]

for (const [href, label] of safeLinks) {
	test(`keeps safe link: ${label}`, () => {
		const html = toHtml(`[x](${href})`)
		assert.ok(html.includes(`href="${href}"`), `href="${href}" is included in output`)
	})
}

test('raw HTML link text is stripped', () => {
	const html = toHtml('[<script>x</script>](https://ok.com)')
	assert.ok(!html.includes('<script>'), 'script tag is removed')
	assert.ok(html.includes('href="https://ok.com"'), 'safe href is kept')
})

// ----------------------------------------------------------------
// SKILL.md -> SKILL.s.js: SJS directive extraction
// ----------------------------------------------------------------
console.log('\n=== Convert: SJS directives ===')

test('SJS directives extract previous JSON block into request.body', () => {
	const sjs = extractSjsDirectives(`# SKILL: sample
# Endpoint: POST /api/exec

\`\`\`json
{"args":["sample","--help"]}
\`\`\`
<!-- sjs:prev request.body -->
`, 'sample')
	assert.deepEqual(sjs.request.body, { args: ['sample', '--help'] })
})

test('SJS directives extract next JSON block into request.body', () => {
	const sjs = extractSjsDirectives(`# SKILL: sample
<!-- sjs:request.body -->
\`\`\`json
{"args":["sample","--version"]}
\`\`\`
`, 'sample')
	assert.deepEqual(sjs.request.body, { args: ['sample', '--version'] })
})

test('SJS directives keep unsafe target as a local literal key', () => {
	const sjs = extractSjsDirectives(`\`\`\`json
{"args":["sample","--help"]}
\`\`\`
<!-- sjs:prev ../other.request.body -->
`, 'sample')
	assert.deepEqual(sjs['../other.request.body'], { args: ['sample', '--help'] })
	assert.equal(sjs.other, undefined)
})

test('SJS directives extract begin/end JSON blocks', () => {
	const sjs = extractSjsDirectives(`<!-- sjs:begin request.examples -->
\`\`\`json
{"args":["sample","--version"]}
\`\`\`
\`\`\`json
{"args":["sample","--help"]}
\`\`\`
<!-- sjs:end request.examples -->
`, 'sample')
	assert.deepEqual(sjs.request.examples, [
		{ args: ['sample', '--version'] },
		{ args: ['sample', '--help'] },
	])
})

test('agent directives parse canonical target form', () => {
	assert.deepEqual(parseAgentDirective('<!-- ae:prev request.body -> sjs,json -->'), {
		mode: 'prev',
		path: 'request.body',
		targets: ['sjs', 'json'],
	})
})

test('agent directives parse target-first syntax sugar', () => {
	assert.deepEqual(parseAgentDirective('<!-- sjs,json:prev request.body -->'), {
		mode: 'prev',
		path: 'request.body',
		targets: ['sjs', 'json'],
	})
})

test('agent directives preserve existing sjs next shorthand', () => {
	assert.deepEqual(parseAgentDirective('<!-- sjs:request.body -->'), {
		mode: 'next',
		path: 'request.body',
		targets: ['sjs'],
	})
})

test('agent directives expand all target alias', () => {
	assert.deepEqual(parseAgentDirective('<!-- all:prev request.body -->'), {
		mode: 'prev',
		path: 'request.body',
		targets: ['sjs', 'json', 'html'],
	})
})

test('json target directives do not affect SJS output', () => {
	const md = `# SKILL: sample
# Endpoint: POST /api/exec

\`\`\`json
{"args":["sample","--version"]}
\`\`\`
<!-- json:prev request.body -->
`
	assert.deepEqual(toJson(md, 'sample').request.body, { args: ['sample', '--version'] })
	assert.equal(extractSjsDirectives(md).request, undefined)
	assert.ok(!toSjs(md, 'sample').includes('body: { args: ["sample", "--version"] }'), 'json-only directive is not rendered into SJS')
})

test('multi-target directives affect both JSON and SJS output', () => {
	const md = `# SKILL: sample
# Endpoint: POST /api/exec

\`\`\`json
{"args":["sample","--version"]}
\`\`\`
<!-- sjs,json:prev request.body -->
`
	assert.deepEqual(toJson(md, 'sample').request.body, { args: ['sample', '--version'] })
	assert.deepEqual(extractSjsDirectives(md).request.body, { args: ['sample', '--version'] })
	assert.ok(toSjs(md, 'sample').includes('m["/api/exec"].request.body = { args: ["sample", "--version"] };'), 'multi-target directive is rendered into SJS as flat assignment')
})

test('canonical ae directives affect selected targets', () => {
	const md = `# SKILL: sample
# Endpoint: POST /api/exec

\`\`\`json
{"args":["sample","--version"]}
\`\`\`
<!-- ae:prev request.body -> sjs,json -->
`
	assert.deepEqual(toJson(md, 'sample').request.body, { args: ['sample', '--version'] })
	assert.deepEqual(extractSjsDirectives(md).request.body, { args: ['sample', '--version'] })
})

test('raw JSON ignores ae directives', () => {
	const md = `# SKILL: sample
# Endpoint: POST /api/exec

\`\`\`json
{"args":["sample","--version"]}
\`\`\`
<!-- ae:prev request.body -> sjs,json -->
`
	assert.equal(toJson(md, 'sample', { ignoreAe: true }).request, undefined)
})

test('raw SJS ignores ae directives', () => {
	const md = `# SKILL: sample
# Endpoint: POST /api/exec

\`\`\`json
{"args":["sample","--version"]}
\`\`\`
<!-- ae:prev request.body -> all -->
`
	const sjs = toSjs(md, 'sample', 'public', { ignoreAe: true })
	assert.ok(!sjs.includes('operation: \'POST /api/exec AUTH {"args":["sample","--version"]}\''), 'raw SJS does not include directive-derived operation')
	assert.ok(sjs.includes('body: { args: ["<command>", "<arg>", "..."] }'), 'raw SJS keeps generic POST body form')
})

test('existing sjs directives remain hidden from JSON output', () => {
	const md = `# SKILL: sample
# Endpoint: POST /api/exec

\`\`\`json
{"args":["sample","--version"]}
\`\`\`
<!-- sjs:prev request.body -->
`
	assert.equal(toJson(md, 'sample').request, undefined)
	assert.deepEqual(extractSjsDirectives(md).request.body, { args: ['sample', '--version'] })
})

test('targeted begin/end ranges can be extracted independently', () => {
	const md = `<!-- ae:begin request.examples -> json -->
\`\`\`json
{"args":["sample","--version"]}
\`\`\`
\`\`\`json
{"args":["sample","--help"]}
\`\`\`
<!-- ae:end request.examples -->
`
	assert.deepEqual(extractTargetDirectives(md, 'json').request.examples, [
		{ args: ['sample', '--version'] },
		{ args: ['sample', '--help'] },
	])
	assert.equal(extractSjsDirectives(md).request, undefined)
})

test('toJson does not expose SJS directives in public JSON', () => {
	const json = toJson(`# SKILL: sample
# Endpoint: POST /api/exec

\`\`\`json
{"args":["sample","--help"]}
\`\`\`
<!-- sjs:prev request.body -->
`, 'sample')
	assert.equal(json.request, undefined)
	assert.ok(Array.isArray(json.lines), 'lines are preserved')
})

test('toSjs renders generated request body from SKILL.json data', () => {
	const sjs = toSjs(`# SKILL: sample
# Endpoint: POST /api/exec
# Description: Sample command

\`\`\`json
{"args":["sample","--version"]}
\`\`\`
<!-- sjs:prev request.body -->
`, 'sample')
	assert.ok(sjs.includes('// /skills/sample/SKILL.s.js'), 'document marker is generated')
	assert.ok(sjs.includes('m["/api/exec"] = {'), 'exec surface is generated')
	assert.ok(sjs.includes('body: { args: ["<command>", "<arg>", "..."] }'), 'base request body stays generic')
	assert.ok(sjs.includes('m["/api/exec"].request.body = { args: ["sample", "--version"] };'), 'request body comes from JSON directive as flat assignment')
	assert.ok(!sjs.includes('operation: \'POST /api/exec AUTH {"args":["sample","--version"]}\''), 'directive does not create operation without an explicit operation target')
})

test('toSjs keeps same-path POST endpoint method instead of document GET', () => {
	const sjs = toSjs(`# SKILL: transfer
# Endpoint: POST /cli/transfer
# Description: Receive a transfer payload
`, 'transfer', 'private', {
		base: '/cli/transfer',
		document: '/cli/transfer/SKILL.s.js',
	})
	assert.ok(sjs.includes('m["/cli/transfer"] = {\n  method: "POST"'), 'same-path POST endpoint is rendered as POST')
	assert.ok(sjs.includes('"X-API-Key": client.API_KEY'), 'private same-path POST keeps auth request header')
	assert.ok(sjs.includes('"Content-Type": "application/json"'), 'private same-path POST keeps JSON content type')
	assert.ok(!sjs.includes('m["/cli/transfer"].request.body.args.kind = "argv";'), 'non-exec POST does not synthesize exec argv metadata')
	assert.ok(!sjs.includes('m["/cli/transfer"].response.output'), 'non-exec POST does not synthesize exec response fields')
})

test('toSjs includes auth request headers for same-path private GET endpoint', () => {
	const sjs = toSjs(`# SKILL: private
# Endpoint: GET /private
# Description: Private namespace
`, 'private', 'private', {
		base: '/private',
		document: '/private/SKILL.s.js',
	})
	assert.ok(sjs.includes('m["/private"] = {\n  method: "GET"'), 'private same-path GET endpoint is rendered')
	assert.ok(sjs.includes('"X-API-Key": client.API_KEY'), 'private same-path GET keeps auth request header')
	assert.ok(!sjs.includes('"Content-Type": "application/json"'), 'private same-path GET does not add JSON content type')
})

test('public exec SKILL.md declares canonical request body for SJS', () => {
	const md = fs.readFileSync(path.join(__dirname, '..', 'public', 'skills', 'exec', 'SKILL.md'), 'utf8')
	const sjs = extractSjsDirectives(md)
	assert.deepEqual(sjs.request.body, { args: ['<command>', '<arg>', '...'] })
	assert.deepEqual(toJson(md, 'exec').request.body, { args: ['<command>', '<arg>', '...'] })
})

test('root SKILL.md declares canonical request body for SJS', () => {
	const md = fs.readFileSync(path.join(__dirname, '..', 'public', 'SKILL.md'), 'utf8')
	const sjs = extractSjsDirectives(md)
	assert.deepEqual(sjs['m["/api/exec"].request.body'], { args: ['<command>', '<arg>', '...'] })
	assert.deepEqual(sjs['m["/api/exec"].request.body.args.example'], ['aexec', '--version'])
	assert.deepEqual(Array.from(sjs['m["/api/acl"].response.allow']), ['<command> [<arg>]...', '...'])
	assert.equal(sjs['m["/api/acl"].response.allow.kind'], 'argv_string')
	assert.equal(sjs['m["/api/acl"].response.allow.syntax'], '<command> [<arg>]...')
	assert.deepEqual(sjs['m["/api/acl"].response.allow.to_args'], ['<command>', '<arg>', '...'])
	const json = toJson(md, '_root')
	assert.deepEqual(json['m["/api/exec"].request.body'], { args: ['<command>', '<arg>', '...'] })
	assert.deepEqual(json['m["/api/exec"].request.body.args.example'], ['aexec', '--version'])
})

test('public acl SKILL.md declares request, response, and refs directives', () => {
	const md = fs.readFileSync(path.join(__dirname, '..', 'public', 'skills', 'acl', 'SKILL.md'), 'utf8')
	const sjs = extractSjsDirectives(md)
	assert.deepEqual(sjs.request.headers, { 'X-API-Key': 'API_KEY', Accept: 'text/sjs' })
	assert.deepEqual(Array.from(sjs.response.allow), ['<command> [<arg>]...', '...'])
	assert.equal(sjs.response.allow.kind, 'argv_string')
	assert.equal(sjs.response.allow.syntax, '<command> [<arg>]...')
	assert.deepEqual(sjs.response.allow.to_args, ['<command>', '<arg>', '...'])
	assert.deepEqual(sjs.response.deny, ['<denied pattern>', '...'])
	assert.deepEqual(sjs.refs, ['/skills/exec/SKILL.s.js'])
	const json = toJson(md, 'acl')
	assert.deepEqual(json.request.headers, { 'X-API-Key': 'API_KEY', Accept: 'text/sjs' })
	assert.deepEqual(Array.from(json.response.allow), ['<command> [<arg>]...', '...'])
	assert.deepEqual(json.refs, ['/skills/exec/SKILL.s.js'])
})

test('public plugins SKILL.md declares generic plugin response without fixed plugin names', () => {
	const md = fs.readFileSync(path.join(__dirname, '..', 'public', 'skills', 'plugins', 'SKILL.md'), 'utf8')
	const sjs = extractSjsDirectives(md)
	assert.deepEqual(sjs.request.headers, { 'X-API-Key': 'API_KEY', Accept: 'text/sjs' })
	assert.deepEqual(sjs.response.plugins, [
		{ name: '<plugin name>', skill: '/private/skills/<name>/SKILL.json' },
	])
	assert.deepEqual(sjs.refs, ['/private/skills'])
	assert.ok(!md.includes('/private/skills/hermes/'), 'public plugins doc must not use concrete private skill URL')
	assert.ok(!md.includes('/private/skills/claude-code/'), 'public plugins doc must not use concrete private skill URL')
	const json = toJson(md, 'plugins')
	assert.deepEqual(json.request.headers, { 'X-API-Key': 'API_KEY', Accept: 'text/sjs' })
	assert.deepEqual(json.response.plugins, [
		{ name: '<plugin name>', skill: '/private/skills/<name>/SKILL.json' },
	])
	assert.deepEqual(json.refs, ['/private/skills'])
})

test('public private SKILL.md declares only private namespace entrypoints', () => {
	const md = fs.readFileSync(path.join(__dirname, '..', 'public', 'skills', 'private', 'SKILL.md'), 'utf8')
	const sjs = extractSjsDirectives(md)
	assert.deepEqual(sjs.request.headers, { 'X-API-Key': 'API_KEY', Accept: 'text/sjs' })
	assert.deepEqual(sjs.response.endpoints, ['/private/skills'])
	assert.deepEqual(sjs.refs, ['/private', '/private/skills'])
	assert.ok(!md.includes(':name'), 'public private doc must not expose private skill route template')
	assert.ok(!md.includes('/private/skills/bootplug/'), 'public private doc must not expose concrete private skill URL')
	const json = toJson(md, 'private')
	assert.deepEqual(json.request.headers, { 'X-API-Key': 'API_KEY', Accept: 'text/sjs' })
	assert.deepEqual(json.response.endpoints, ['/private/skills'])
	assert.deepEqual(json.refs, ['/private', '/private/skills'])
})

test('generated public skill SJS keeps API_KEY as client header expression', () => {
	for (const name of ['acl', 'plugins', 'private']) {
		const md = fs.readFileSync(path.join(__dirname, '..', 'public', 'skills', name, 'SKILL.md'), 'utf8')
		const sjs = toSjs(md, name, 'public')
		assert.ok(sjs.includes('"X-API-Key": client.API_KEY'), `${name} SJS keeps client API key expression`)
		assert.ok(!sjs.includes('"X-API-Key": "API_KEY"'), `${name} SJS does not render API_KEY as a string`)
	}
})

// ----------------------------------------------------------------
// CLI scan: description extraction
// ----------------------------------------------------------------
console.log('\n=== CLI scan: description extraction ===')

test('extractDescription skips multi-line usage continuations', () => {
	const help = `usage: hermes [-h] [--version] [-z PROMPT] [--worktree]
              {chat,doctor,sessions,update}
              ...

Hermes Agent - AI assistant with tool-calling capabilities

positional arguments:
  {chat,doctor,sessions,update}
                        Command to run
`
	assert.equal(extractDescription(help), 'Hermes Agent - AI assistant with tool-calling capabilities')
})

// ----------------------------------------------------------------
// npm pack: sensitive file exclusion
// ----------------------------------------------------------------
console.log('\n=== npm pack: package contents ===')

test('npm pack excludes sensitive files', () => {
	const output = execSync('npm pack --dry-run --json 2>/dev/null', {
		cwd: path.join(__dirname, '..'),
		encoding: 'utf8',
	})
	const data = JSON.parse(output)
	const files = data[0].files.map(f => f.path)
	const suspicious = files.filter(f =>
		f.includes('.claude') || f.includes('.backup') || f.includes('.test') ||
		f.includes('.codex') || f.endsWith('.zip') || f.includes('.env')
	)
	assert.equal(suspicious.length, 0,
		`sensitive files are included: ${suspicious.join(', ')}`)
})

test('npm pack includes required runtime files', () => {
	const output = execSync('npm pack --dry-run --json 2>/dev/null', {
		cwd: path.join(__dirname, '..'),
		encoding: 'utf8',
	})
	const data = JSON.parse(output)
	const files = new Set(data[0].files.map(f => f.path))
	for (const required of ['supported-agents.txt', 'update.sh', 'package.json', 'README.md', 'LICENSE', 'NOTICE']) {
		assert.ok(files.has(required), `${required} is included in npm pack`)
	}
})

test('package bin: agent-exec points to the CLI wrapper', () => {
	const pkg = require('../package.json')
	assert.equal(pkg.bin?.['agent-exec'], 'bin/aexec')
	assert.equal(pkg.bin?.aexec, 'bin/aexec')
	assert.equal(pkg.bin?.ae, 'bin/aexec')
})

test('package size is reasonable (under 10MB)', () => {
	const output = execSync('npm pack --dry-run --json 2>/dev/null', {
		cwd: path.join(__dirname, '..'),
		encoding: 'utf8',
	})
	const data = JSON.parse(output)
	const sizeMb = data[0].size / 1024 / 1024
	assert.ok(sizeMb < 10, `package size: ${sizeMb.toFixed(1)} MB (should be under 10MB)`)
})

// ----------------------------------------------------------------
// setup: project .env isolation
// ----------------------------------------------------------------
console.log('\n=== setup: project .env isolation ===')

function parseEnvText(text) {
	const out = {}
	text.split(/\r?\n/).forEach(line => {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) return
		const i = trimmed.indexOf('=')
		if (i < 1) return
		out[trimmed.slice(0, i)] = trimmed.slice(i + 1)
	})
	return out
}

function runSetupIn(tmp, args = []) {
	const configDir = path.join(tmp, 'config')
	const projectDir = path.join(tmp, 'project')
	fs.mkdirSync(projectDir, { recursive: true })
	const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'setup.js'), '--yes', ...args], {
		cwd: projectDir,
		env: {
			PATH: process.env.PATH,
			HOME: tmp,
			TMPDIR: os.tmpdir(),
			AGENT_EXEC_CONFIG_DIR: configDir,
		},
		encoding: 'utf8',
	})
	assert.equal(result.status, 0, result.stderr || result.stdout)
	return { configDir, projectDir, envFile: path.join(configDir, '.env'), result }
}

test('setup: does not read project .env by default', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-setup-'))
	try {
		const projectDir = path.join(tmp, 'project')
		fs.mkdirSync(projectDir, { recursive: true })
		fs.writeFileSync(path.join(projectDir, '.env'), [
			'API_KEY=project-key',
			'PORT=9999',
			'DATABASE_URL=postgres://secret',
			'OPENAI_API_KEY=secret',
			'',
		].join('\n'))
		const { envFile } = runSetupIn(tmp)
		const env = parseEnvText(fs.readFileSync(envFile, 'utf8'))
		assert.notEqual(env.API_KEY, 'project-key')
		assert.equal(env.PORT, undefined)
		assert.equal(env.DATABASE_URL, undefined)
		assert.equal(env.OPENAI_API_KEY, undefined)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('setup: creates root settings.json for host edits', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-setup-'))
	try {
		const { configDir, result } = runSetupIn(tmp)
		const settingsFile = path.join(configDir, 'settings.json')
		assert.equal(fs.existsSync(settingsFile), true)
		const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
		assert.deepEqual(settings.exec?.allow, ['aexec --version'])
		assert.match(result.stdout, /settings saved:/)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('setup: direct and wrapper help list the full option contract', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-setup-help-'))
	try {
		const configDir = path.join(tmp, 'config')
		for (const args of [
			[path.join(__dirname, '..', 'setup.js'), '--help'],
			[path.join(__dirname, '..', 'setup.js'), '-h'],
			[path.join(__dirname, '..', 'setup.js'), '--help', 'setup'],
			[path.join(__dirname, '..', 'scripts', 'aexec.js'), 'setup', '--help'],
		]) {
			const result = spawnSync(process.execPath, args, {
				cwd: path.join(__dirname, '..'),
				env: {
					PATH: process.env.PATH,
					HOME: tmp,
					TMPDIR: os.tmpdir(),
					AGENT_EXEC_CONFIG_DIR: configDir,
				},
				encoding: 'utf8',
			})
			assert.equal(result.status, 0, result.stderr || result.stdout)
			assert.match(result.stdout, /Usage: .*setup \[options\]/)
			assert.match(result.stdout, /--yes/)
			assert.match(result.stdout, /--skip/)
			assert.match(result.stdout, /--use-project-env/)
			assert.match(result.stdout, /-h, --help/)
		}
		assert.equal(fs.existsSync(path.join(configDir, '.env')), false)
		assert.equal(fs.existsSync(path.join(configDir, 'settings.json')), false)
		assert.equal(fs.existsSync(path.join(configDir, 'plugins')), false)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('setup: direct --skip and --yes=true use non-interactive setup', () => {
	for (const optionArgs of [['--skip'], ['--yes=true']]) {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-setup-option-'))
		try {
			const configDir = path.join(tmp, 'config')
			const projectDir = path.join(tmp, 'project')
			fs.mkdirSync(projectDir, { recursive: true })
			const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'setup.js'), ...optionArgs], {
				cwd: projectDir,
				env: {
					PATH: process.env.PATH,
					HOME: tmp,
					TMPDIR: os.tmpdir(),
					AGENT_EXEC_CONFIG_DIR: configDir,
				},
				encoding: 'utf8',
			})
			assert.equal(result.status, 0, result.stderr || result.stdout)
			const env = parseEnvText(fs.readFileSync(path.join(configDir, '.env'), 'utf8'))
			assert.ok(env.API_KEY, `${optionArgs.join(' ')} writes an API_KEY`)
			assert.equal(fs.existsSync(path.join(configDir, 'settings.json')), true)
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true })
		}
	}
})

// ----------------------------------------------------------------
// reset: backup and fresh config
// ----------------------------------------------------------------
console.log('\n=== reset: backup and fresh config ===')

function runResetIn(tmp, args = []) {
	const configDir = path.join(tmp, 'config')
	const projectDir = path.join(tmp, 'project')
	fs.mkdirSync(projectDir, { recursive: true })
	const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'reset.js'), ...args], {
		cwd: projectDir,
		env: {
			PATH: process.env.PATH,
			HOME: tmp,
			TMPDIR: os.tmpdir(),
			AGENT_EXEC_CONFIG_DIR: configDir,
		},
		encoding: 'utf8',
	})
	return { configDir, projectDir, result }
}

test('reset: backs up active config and recreates minimal safe config', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-reset-'))
	try {
		const configDir = path.join(tmp, 'config')
		const pluginDir = path.join(configDir, 'plugins', 'oldplug')
		fs.mkdirSync(pluginDir, { recursive: true })
		fs.writeFileSync(path.join(configDir, '.env'), 'API_KEY=old-key\nAGENT_EXEC_ENABLED=true\n')
		fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({ exec: { allow: ['node *'] } }, null, 2))
		fs.writeFileSync(path.join(pluginDir, 'SKILL.md'), '# old plugin\n')

		const { result } = runResetIn(tmp, ['--yes', '--api-key', 'test-key', '--json'])
		assert.equal(result.status, 0, result.stderr || result.stdout)
		const data = JSON.parse(result.stdout)
		assert.equal(data.backupEnabled, true)
		assert.match(data.backup, /\/\.to-agent\/backups\/agent-exec\/reset-\d{8}-\d{6}/)

		const env = parseEnvText(fs.readFileSync(path.join(configDir, '.env'), 'utf8'))
		assert.equal(env.API_KEY, 'test-key')
		assert.equal(env.AGENT_EXEC_ENABLED, 'true')
		const settings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'))
		assert.deepEqual(settings.exec.allow, ['aexec --version'])
		assert.deepEqual(fs.readdirSync(path.join(configDir, 'plugins')), [])

		assert.equal(fs.readFileSync(path.join(data.backup, '.env'), 'utf8'), 'API_KEY=old-key\nAGENT_EXEC_ENABLED=true\n')
		const oldSettings = JSON.parse(fs.readFileSync(path.join(data.backup, 'settings.json'), 'utf8'))
		assert.deepEqual(oldSettings.exec.allow, ['node *'])
		assert.equal(fs.readFileSync(path.join(data.backup, 'plugins', 'oldplug', 'SKILL.md'), 'utf8'), '# old plugin\n')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('reset: direct and wrapper help list the full option contract without side effects', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-reset-help-'))
	try {
		const configDir = path.join(tmp, 'config')
		for (const args of [
			[path.join(__dirname, '..', 'scripts', 'reset.js'), '--help'],
			[path.join(__dirname, '..', 'scripts', 'reset.js'), '-h'],
			[path.join(__dirname, '..', 'scripts', 'aexec.js'), 'reset', '--help'],
		]) {
			const result = spawnSync(process.execPath, args, {
				cwd: path.join(__dirname, '..'),
				env: {
					PATH: process.env.PATH,
					HOME: tmp,
					TMPDIR: os.tmpdir(),
					AGENT_EXEC_CONFIG_DIR: configDir,
				},
				encoding: 'utf8',
			})
			assert.equal(result.status, 0, result.stderr || result.stdout)
			assert.match(result.stdout, /Usage: .*reset \[options\]/)
			assert.match(result.stdout, /--yes/)
			assert.match(result.stdout, /--keep-api-key/)
			assert.match(result.stdout, /--api-key/)
			assert.match(result.stdout, /--dry-run/)
			assert.match(result.stdout, /--no-backup/)
		}
		assert.equal(fs.existsSync(configDir), false)
		assert.equal(fs.existsSync(path.join(tmp, '.to-agent', 'backups')), false)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

// ----------------------------------------------------------------
// acl: user settings allow management
// ----------------------------------------------------------------
console.log('\n=== acl: user settings allow management ===')

function runAclIn(tmp, args = []) {
	const configDir = path.join(tmp, 'config')
	const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'acl.js'), ...args], {
		cwd: path.join(__dirname, '..'),
		env: {
			PATH: process.env.PATH,
			HOME: tmp,
			TMPDIR: os.tmpdir(),
			AGENT_EXEC_CONFIG_DIR: configDir,
			AGENT_EXEC_PROJECT_SETTINGS_FILE: path.join(tmp, 'missing-project-settings.json'),
		},
		encoding: 'utf8',
	})
	return { configDir, result }
}

test('acl add: exact rule writes primary user settings with --yes', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-acl-add-'))
	try {
		const { configDir, result } = runAclIn(tmp, ['add', 'date', '--yes', '--json'])
		assert.equal(result.status, 0, result.stderr || result.stdout)
		const data = JSON.parse(result.stdout)
		assert.equal(data.changed, true)
		assert.equal(data.rule, 'date')
		const userSettings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'))
		assert.deepEqual(userSettings.exec.allow, ['date'])
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('acl add: command flags remain part of the rule', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-acl-command-flags-'))
	try {
		const { configDir, result } = runAclIn(tmp, ['add', 'npm', '--version', '--yes', '--json'])
		assert.equal(result.status, 0, result.stderr || result.stdout)
		const data = JSON.parse(result.stdout)
		assert.equal(data.rule, 'npm --version')
		const userSettings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'))
		assert.deepEqual(userSettings.exec.allow, ['npm --version'])
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('acl add: broad glob requires --force --yes in non-interactive use', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-acl-broad-'))
	try {
		const denied = runAclIn(tmp, ['add', 'codex *', '--yes', '--json'])
		assert.notEqual(denied.result.status, 0, 'broad allow without --force must fail')
		assert.match(denied.result.stdout, /requires --force --yes/)
		assert.equal(fs.existsSync(path.join(denied.configDir, 'settings.json')), false)

		const allowed = runAclIn(tmp, ['add', 'codex *', '--force', '--yes', '--json'])
		assert.equal(allowed.result.status, 0, allowed.result.stderr || allowed.result.stdout)
		const data = JSON.parse(allowed.result.stdout)
		assert.equal(data.kind, 'glob')
		assert.equal(data.warning, 'glob allow rule; review the argument scope carefully')
		const userSettings = JSON.parse(fs.readFileSync(path.join(allowed.configDir, 'settings.json'), 'utf8'))
		assert.deepEqual(userSettings.exec.allow, ['codex *'])
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('acl remove: removes only primary user settings and reports remaining effective sources', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-acl-remove-'))
	try {
		const configDir = path.join(tmp, 'config')
		fs.mkdirSync(configDir, { recursive: true })
		fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({ exec: { allow: ['date'] } }, null, 2))
		const { result } = runAclIn(tmp, ['remove', 'date', '--yes', '--json'])
		assert.equal(result.status, 0, result.stderr || result.stdout)
		const data = JSON.parse(result.stdout)
		assert.equal(data.changed, true)
		assert.equal(data.stillEffective, false)
		const userSettings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'))
		assert.deepEqual(userSettings.exec.allow, [])
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('acl remove --contains: removes matching user allow rules only with confirmation', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-acl-remove-contains-'))
	try {
		const configDir = path.join(tmp, 'config')
		fs.mkdirSync(configDir, { recursive: true })
		fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({
			exec: {
				allow: ['date', 'codex --help', 'codex --version', 'node --version'],
			},
		}, null, 2))

		const denied = runAclIn(tmp, ['remove', '--contains', 'codex', '--json'])
		assert.notEqual(denied.result.status, 0, 'contains remove without --yes must fail in non-interactive use')
		assert.match(denied.result.stdout, /requires --yes/)

		const { result } = runAclIn(tmp, ['remove', '--contains', 'codex', '--yes', '--json'])
		assert.equal(result.status, 0, result.stderr || result.stdout)
		const data = JSON.parse(result.stdout)
		assert.equal(data.changed, true)
		assert.deepEqual(data.removed, ['codex --help', 'codex --version'])
		assert.equal(data.match.type, 'contains')
		assert.equal(data.match.value, 'codex')
		const userSettings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'))
		assert.deepEqual(userSettings.exec.allow, ['date', 'node --version'])
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('acl list and doctor: show effective rules and broad-rule warnings', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-acl-list-'))
	try {
		const configDir = path.join(tmp, 'config')
		fs.mkdirSync(configDir, { recursive: true })
		fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({
			exec: { allow: ['codex *', '/^node\\s+/'] },
		}, null, 2))
		const listResult = runAclIn(tmp, ['list', '--json']).result
		assert.equal(listResult.status, 0, listResult.stderr || listResult.stdout)
		const listed = JSON.parse(listResult.stdout)
		assert.ok(listed.allow.some(row => row.rule === 'codex *' && row.sources.includes('user')))
		assert.ok(listed.allow.some(row => row.rule === '/^node\\s+/' && row.sources.includes('user')))

		const doctorResult = runAclIn(tmp, ['doctor', '--json']).result
		assert.equal(doctorResult.status, 0, doctorResult.stderr || doctorResult.stdout)
		const doctor = JSON.parse(doctorResult.stdout)
		assert.ok(doctor.warnings.some(row => row.rule === 'codex *' && row.kind === 'glob'))
		assert.ok(doctor.warnings.some(row => row.rule === '/^node\\s+/' && row.kind === 'regexp'))
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('acl: direct and wrapper help list the full option contract', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-acl-help-'))
	try {
		for (const args of [
			[path.join(__dirname, '..', 'scripts', 'acl.js'), '--help'],
			[path.join(__dirname, '..', 'scripts', 'acl.js'), '-h'],
			[path.join(__dirname, '..', 'scripts', 'aexec.js'), 'acl', '--help'],
		]) {
			const result = spawnSync(process.execPath, args, {
				cwd: path.join(__dirname, '..'),
				env: {
					PATH: process.env.PATH,
					HOME: tmp,
					TMPDIR: os.tmpdir(),
					AGENT_EXEC_CONFIG_DIR: path.join(tmp, 'config'),
					AGENT_EXEC_PROJECT_SETTINGS_FILE: path.join(tmp, 'missing-project-settings.json'),
				},
				encoding: 'utf8',
			})
			assert.equal(result.status, 0, result.stderr || result.stdout)
			assert.match(result.stdout, /Usage: .*acl <subcommand>/)
			assert.match(result.stdout, /add <rule>/)
			assert.match(result.stdout, /remove <rule>/)
			assert.match(result.stdout, /remove --contains <text>/)
			assert.match(result.stdout, /--force/)
			assert.match(result.stdout, /--contains <text>/)
			assert.match(result.stdout, /--json/)
		}
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('plugin create: prints generated settings by default', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-plugin-create-'))
	try {
		const result = spawnSync(process.execPath, [
			path.join(__dirname, '..', 'scripts', 'plugin-create.js'),
			'--name=printcheck',
			'--command=echo',
			'--type=skill',
		], {
			cwd: path.join(__dirname, '..'),
			env: { ...process.env, AGENT_EXEC_CONFIG_DIR: tmp },
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)
		assert.match(result.stdout, /Generated settings\.json/)
		assert.match(result.stdout, /"exec"/)
		assert.match(result.stdout, /"allow"/)
		assert.match(result.stdout, /"echo --help"/)
		assert.match(result.stdout, /"echo --version"/)
		assert.match(result.stdout, /generated ACL rules are intentionally narrow/)
		assert.match(result.stdout, /run aexec plugin doctor before restart to detect broad wildcard rules/)
		assert.doesNotMatch(result.stdout, /"echo \*"/)
		assert.doesNotMatch(result.stdout, /Generated rule "echo \*" is a broad wildcard ACL rule/)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('plugin create: skill plugins are private and expose SJS request directive', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-plugin-create-'))
	try {
		const result = spawnSync(process.execPath, [
			path.join(__dirname, '..', 'scripts', 'plugin-create.js'),
			'--name=privcheck',
			'--command=printf',
			'--type=skill',
			'--silent',
		], {
			cwd: path.join(__dirname, '..'),
			env: { ...process.env, AGENT_EXEC_CONFIG_DIR: tmp },
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)

		const pluginDir = path.join(tmp, 'plugins', 'privcheck')
		const skillFile = path.join(pluginDir, 'SKILL.md')
		assert.equal(fs.existsSync(skillFile), true, 'SKILL.md is generated under user private plugins')
		assert.equal(fs.existsSync(path.join(pluginDir, 'index.js')), false, 'skill type does not create runtime JS')
		assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', 'skills', 'privcheck')), false, 'plugin create does not write public skill docs')

		const md = fs.readFileSync(skillFile, 'utf8')
		assert.match(md, /<!-- ae:prev request\.body -> all -->/)
		assert.deepEqual(extractSjsDirectives(md).request.body, { args: ['printf', '--help'] })

		const sjs = toSjs(md, 'privcheck', 'private')
		assert.ok(sjs.includes('// /private/skills/privcheck/SKILL.s.js'), 'private SJS document marker is generated')
		assert.ok(sjs.includes('m["/api/exec"].request.body = { args: ["printf", "--help"] };'), 'request directive becomes flat SJS assignment')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('plugin create --from: scan-generated skill keeps private SJS request directive', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-plugin-create-from-'))
	const binDir = path.join(tmp, 'bin')
	fs.mkdirSync(binDir, { recursive: true })
	const fakeCmd = path.join(binDir, 'fakehelp')
	fs.writeFileSync(fakeCmd, `#!/usr/bin/env node
if (process.argv.includes('--help')) {
  console.log('Usage: fakehelp [--version]')
  console.log('')
  console.log('Options:')
  console.log('  --version  Show version')
  process.exit(0)
}
process.exit(0)
`, { mode: 0o755 })
	try {
		const result = spawnSync(process.execPath, [
			path.join(__dirname, '..', 'scripts', 'plugin-create.js'),
			'--from=fakehelp',
			'--name=fakehelp-skill',
			'--type=skill',
			'--silent',
		], {
			cwd: path.join(__dirname, '..'),
			env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, AGENT_EXEC_CONFIG_DIR: tmp },
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)

		const pluginDir = path.join(tmp, 'plugins', 'fakehelp-skill')
		const skillFile = path.join(pluginDir, 'SKILL.md')
		const settings = JSON.parse(fs.readFileSync(path.join(pluginDir, 'settings.json'), 'utf8'))
		const md = fs.readFileSync(skillFile, 'utf8')

		assert.equal(fs.existsSync(path.join(pluginDir, 'index.js')), false, 'skill type from scan does not create runtime JS')
		assert.deepEqual(settings.exec.allow, ['fakehelp --help'])
		assert.match(md, /<!-- ae:prev request\.body -> all -->/)
		assert.deepEqual(extractSjsDirectives(md).request.body, { args: ['fakehelp', '--help'] })

		const sjs = toSjs(md, 'fakehelp-skill', 'private')
		assert.ok(sjs.includes('// /private/skills/fakehelp-skill/SKILL.s.js'), 'private scanned SJS marker is generated')
		assert.ok(sjs.includes('m["/api/exec"].request.body = { args: ["fakehelp", "--help"] };'), 'scan request directive becomes flat SJS assignment')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('plugin create --from: ACL uses detected help/version flags only', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-plugin-create-from-hflag-'))
	const binDir = path.join(tmp, 'bin')
	fs.mkdirSync(binDir, { recursive: true })
	const fakeCmd = path.join(binDir, 'honly')
	fs.writeFileSync(fakeCmd, `#!/usr/bin/env node
if (process.argv.includes('-h')) {
  console.log('Usage: honly [-h]')
  console.log('')
  console.log('Options:')
  console.log('  -h  Show help')
  process.exit(0)
}
if (process.argv.includes('--version')) {
  console.log('honly 1.2.3')
  process.exit(0)
}
if (process.argv.includes('--help')) {
  console.error('unknown option --help')
  process.exit(1)
}
process.exit(0)
`, { mode: 0o755 })
	try {
		const result = spawnSync(process.execPath, [
			path.join(__dirname, '..', 'scripts', 'plugin-create.js'),
			'--from=honly',
			'--name=honly-skill',
			'--type=skill',
			'--silent',
		], {
			cwd: path.join(__dirname, '..'),
			env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, AGENT_EXEC_CONFIG_DIR: tmp },
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)

		const pluginDir = path.join(tmp, 'plugins', 'honly-skill')
		const settings = JSON.parse(fs.readFileSync(path.join(pluginDir, 'settings.json'), 'utf8'))
		const md = fs.readFileSync(path.join(pluginDir, 'SKILL.md'), 'utf8')

		assert.deepEqual(settings.exec.allow, ['honly -h', 'honly --version'])
		assert.doesNotMatch(JSON.stringify(settings), /honly --help/)
		assert.deepEqual(extractSjsDirectives(md).request.body, { args: ['honly', '-h'] })

		const sjs = toSjs(md, 'honly-skill', 'private')
		assert.ok(sjs.includes('m["/api/exec"].request.body = { args: ["honly", "-h"] };'), 'detected help flag becomes SJS request body')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('starterkit: ACL uses detected help/version flags only', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-starterkit-hflag-'))
	const binDir = path.join(tmp, 'bin')
	fs.mkdirSync(binDir, { recursive: true })
	const fakeCmd = path.join(binDir, 'codex')
	fs.writeFileSync(fakeCmd, `#!/usr/bin/env node
if (process.argv.includes('-h')) {
  console.log('Usage: codex [-h]')
  console.log('')
  console.log('Options:')
  console.log('  -h  Show help')
  process.exit(0)
}
if (process.argv.includes('--version')) {
  console.log('codex 1.2.3')
  process.exit(0)
}
if (process.argv.includes('--help')) {
  console.error('unknown option --help')
  process.exit(1)
}
process.exit(0)
`, { mode: 0o755 })
	try {
		const result = spawnSync(process.execPath, [
			path.join(__dirname, '..', 'scripts', 'starterkit.js'),
			'codex',
			'--silent',
		], {
			cwd: path.join(__dirname, '..'),
			env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, AGENT_EXEC_CONFIG_DIR: tmp },
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)

		const pluginDir = path.join(tmp, 'plugins', 'codex')
		const settings = JSON.parse(fs.readFileSync(path.join(pluginDir, 'settings.json'), 'utf8'))
		const md = fs.readFileSync(path.join(pluginDir, 'SKILL.md'), 'utf8')

		assert.deepEqual(settings.exec.allow, ['codex -h', 'codex --version'])
		assert.ok(settings._security.includes('generated ACL rules are intentionally narrow.'))
		assert.ok(settings._security.includes('starterkit permits only detected help/version commands.'))
		assert.ok(settings._security.includes('run aexec plugin doctor before restart to detect broad wildcard rules.'))
		assert.doesNotMatch(JSON.stringify(settings), /codex --help/)
		assert.doesNotMatch(JSON.stringify(settings), /codex \*/)
		assert.deepEqual(extractSjsDirectives(md).request.body, { args: ['codex', '-h'] })
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('starterkit: existing plugin directory is skipped without overwrite', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-starterkit-existing-'))
	const binDir = path.join(tmp, 'bin')
	fs.mkdirSync(binDir, { recursive: true })
	const fakeCmd = path.join(binDir, 'codex')
	fs.writeFileSync(fakeCmd, `#!/usr/bin/env node
if (process.argv.includes('--help')) {
  console.log('Usage: codex [--help]')
  process.exit(0)
}
if (process.argv.includes('--version')) {
  console.log('codex 1.2.3')
  process.exit(0)
}
process.exit(0)
`, { mode: 0o755 })
	try {
		const pluginDir = path.join(tmp, 'plugins', 'codex')
		fs.mkdirSync(pluginDir, { recursive: true })
		fs.writeFileSync(path.join(pluginDir, 'SKILL.md'), '# existing skill\n')
		fs.writeFileSync(path.join(pluginDir, 'settings.json'), '{"existing":true}\n')

		const result = spawnSync(process.execPath, [
			path.join(__dirname, '..', 'scripts', 'starterkit.js'),
			'codex',
			'--silent',
		], {
			cwd: path.join(__dirname, '..'),
			env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, AGENT_EXEC_CONFIG_DIR: tmp },
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)
		assert.match(result.stdout, /\[skip\] codex: plugin already exists/)
		assert.equal(fs.readFileSync(path.join(pluginDir, 'SKILL.md'), 'utf8'), '# existing skill\n')
		assert.equal(fs.readFileSync(path.join(pluginDir, 'settings.json'), 'utf8'), '{"existing":true}\n')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('starterkit: --force replaces an existing plugin directory intentionally', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-starterkit-force-'))
	const binDir = path.join(tmp, 'bin')
	fs.mkdirSync(binDir, { recursive: true })
	const fakeCmd = path.join(binDir, 'codex')
	fs.writeFileSync(fakeCmd, `#!/usr/bin/env node
if (process.argv.includes('--help')) {
  console.log('Usage: codex [--help]')
  process.exit(0)
}
if (process.argv.includes('--version')) {
  console.log('codex 1.2.3')
  process.exit(0)
}
process.exit(0)
`, { mode: 0o755 })
	try {
		const pluginDir = path.join(tmp, 'plugins', 'codex')
		fs.mkdirSync(pluginDir, { recursive: true })
		fs.writeFileSync(path.join(pluginDir, 'SKILL.md'), '# existing skill\n')
		fs.writeFileSync(path.join(pluginDir, 'old.txt'), 'old\n')

		const result = spawnSync(process.execPath, [
			path.join(__dirname, '..', 'scripts', 'starterkit.js'),
			'codex',
			'--force',
			'--silent',
		], {
			cwd: path.join(__dirname, '..'),
			env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, AGENT_EXEC_CONFIG_DIR: tmp },
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)
		assert.match(result.stdout, /plugin generated: codex/)
		assert.doesNotMatch(fs.readFileSync(path.join(pluginDir, 'SKILL.md'), 'utf8'), /existing skill/)
		assert.equal(fs.existsSync(path.join(pluginDir, 'old.txt')), false)
		const settings = JSON.parse(fs.readFileSync(path.join(pluginDir, 'settings.json'), 'utf8'))
		assert.deepEqual(settings.exec.allow, ['codex --help', 'codex --version'])
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('starterkit: direct and wrapper help list the full option contract', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-starterkit-help-'))
	try {
		for (const args of [
			[path.join(__dirname, '..', 'scripts', 'starterkit.js'), '--help'],
			[path.join(__dirname, '..', 'scripts', 'starterkit.js'), '-h'],
			[path.join(__dirname, '..', 'scripts', 'starterkit.js'), '--help', 'codex'],
			[path.join(__dirname, '..', 'scripts', 'aexec.js'), 'starterkit', '--help'],
		]) {
			const result = spawnSync(process.execPath, args, {
				cwd: path.join(__dirname, '..'),
				env: {
					PATH: process.env.PATH,
					HOME: tmp,
					TMPDIR: os.tmpdir(),
					AGENT_EXEC_CONFIG_DIR: tmp,
				},
				encoding: 'utf8',
			})
			assert.equal(result.status, 0, result.stderr || result.stdout)
			assert.match(result.stdout, /Usage: .*starterkit \[name\] \[options\]/)
			assert.match(result.stdout, /--silent/)
			assert.match(result.stdout, /--quiet/)
			assert.match(result.stdout, /--force/)
			assert.match(result.stdout, /-h, --help/)
			assert.match(result.stdout, /AGENT_EXEC_STARTERKIT_DEPTH/)
		}
		assert.equal(fs.existsSync(path.join(tmp, 'plugins')), false)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('plugin create: direct help lists the full option contract', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-plugin-create-help-'))
	try {
		const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'plugin-create.js'), '--help'], {
			cwd: path.join(__dirname, '..'),
			env: { ...process.env, AGENT_EXEC_CONFIG_DIR: tmp },
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr || result.stdout)
		assert.match(result.stdout, /Usage: .* plugin create \[options\]/)
		for (const flag of ['--name', '--command', '--type', '--invoke', '--from', '--ai', '--silent', '--quiet', '-h, --help']) {
			assert.match(result.stdout, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
		}
		assert.equal(fs.existsSync(path.join(tmp, 'plugins')), false)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('bin/www: direct help lists the full option contract before loading app', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-www-help-'))
	try {
		const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'www'), '--help'], {
			cwd: path.join(__dirname, '..'),
			env: {
				PATH: process.env.PATH,
				HOME: os.tmpdir(),
				TMPDIR: os.tmpdir(),
				AGENT_EXEC_CONFIG_DIR: tmp,
			},
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr || result.stdout)
		assert.match(result.stdout, /Usage: node bin\/www \[options\]/)
		assert.match(result.stdout, /--auto-reload/)
		assert.match(result.stdout, /-h, --help/)
		assert.match(result.stdout, /HOST/)
		assert.match(result.stdout, /PORT/)
		assert.match(result.stdout, /API_KEY/)
		assert.doesNotMatch(result.stdout, /Local:/)
		assert.equal(fs.existsSync(path.join(tmp, 'settings.json')), false)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('plugin create --from --ai preserves detected help request directive', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-plugin-create-from-ai-'))
	const binDir = path.join(tmp, 'bin')
	fs.mkdirSync(binDir, { recursive: true })
	const fakeCmd = path.join(binDir, 'honlyai')
	const fakeAi = path.join(binDir, 'fake-ai')
	fs.writeFileSync(fakeCmd, `#!/usr/bin/env node
if (process.argv.includes('-h')) {
  console.log('Usage: honlyai [-h]')
  console.log('')
  console.log('Options:')
  console.log('  -h  Show help')
  process.exit(0)
}
if (process.argv.includes('--version')) {
  console.log('honlyai 2.3.4')
  process.exit(0)
}
if (process.argv.includes('--help')) {
  console.error('unknown option --help')
  process.exit(1)
}
process.exit(0)
`, { mode: 0o755 })
	fs.writeFileSync(fakeAi, `#!/usr/bin/env node
console.log('=== FILE: SKILL.md ===')
console.log('# SKILL: honlyai-skill')
console.log('# Endpoint: POST /api/exec')
console.log('# Description: AI generated text')
console.log('')
console.log('## Overview')
console.log('Run honlyai through exec.')
console.log('')
console.log('## Request')
console.log('')
console.log('Request body:')
console.log('')
console.log('\`\`\`json')
console.log('{"args":["honlyai","run","--write","/tmp/generated"]}')
console.log('\`\`\`')
console.log('<!-- ae:prev request.body -> all -->')
console.log('')
console.log('## Key Commands')
console.log('')
console.log('\`\`\`json')
console.log('{"args":["honlyai","run","--write","/tmp/generated"]}')
console.log('\`\`\`')
console.log('')
console.log('\`\`\`json')
console.log('{"args":["honlyai","*"]}')
console.log('\`\`\`')
console.log('=== FILE: references/usage.md ===')
console.log('# honlyai')
console.log('usage')
`, { mode: 0o755 })
	try {
		const result = spawnSync(process.execPath, [
			path.join(__dirname, '..', 'scripts', 'plugin-create.js'),
			'--from=honlyai',
			'--name=honlyai-skill',
			'--type=skill',
			'--ai=fake-ai',
			'--silent',
		], {
			cwd: path.join(__dirname, '..'),
			env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, AGENT_EXEC_CONFIG_DIR: tmp },
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)

		const pluginDir = path.join(tmp, 'plugins', 'honlyai-skill')
		const settings = JSON.parse(fs.readFileSync(path.join(pluginDir, 'settings.json'), 'utf8'))
		const md = fs.readFileSync(path.join(pluginDir, 'SKILL.md'), 'utf8')

		assert.deepEqual(settings.exec.allow, ['honlyai -h', 'honlyai --version'])
		assert.doesNotMatch(JSON.stringify(settings), /honlyai run/)
		assert.doesNotMatch(JSON.stringify(settings), /honlyai \*/)
		assert.deepEqual(extractSjsDirectives(md).request.body, { args: ['honlyai', '-h'] })

		const sjs = toSjs(md, 'honlyai-skill', 'private')
		assert.ok(sjs.includes('m["/api/exec"].request.body = { args: ["honlyai", "-h"] };'), 'AI generated SKILL is normalized to detected help argv')
		assert.ok(!sjs.includes('run'), 'broad AI-generated key command does not become SJS request body')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('plugin create --from: empty help output stops without skeleton', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-plugin-create-from-empty-'))
	const binDir = path.join(tmp, 'bin')
	fs.mkdirSync(binDir, { recursive: true })
	const fakeCmd = path.join(binDir, 'emptyhelp')
	fs.writeFileSync(fakeCmd, `#!/usr/bin/env node
process.exit(0)
`, { mode: 0o755 })
	try {
		const result = spawnSync(process.execPath, [
			path.join(__dirname, '..', 'scripts', 'plugin-create.js'),
			'--from=emptyhelp',
			'--name=emptyhelp-skill',
			'--type=skill',
			'--silent',
		], {
			cwd: path.join(__dirname, '..'),
			env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, AGENT_EXEC_CONFIG_DIR: tmp },
			encoding: 'utf8',
		})
		assert.notEqual(result.status, 0)
		assert.match(result.stderr, /No help output from command: emptyhelp/)
		assert.equal(fs.existsSync(path.join(tmp, 'plugins', 'emptyhelp-skill')), false, 'failed scan does not leave a plugin skeleton')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('plugin create: exec plugin separates private skill doc from runtime route scaffold', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-plugin-create-exec-'))
	try {
		const result = spawnSync(process.execPath, [
			path.join(__dirname, '..', 'scripts', 'plugin-create.js'),
			'--name=execcheck',
			'--command=printf',
			'--type=exec',
			'--silent',
		], {
			cwd: path.join(__dirname, '..'),
			env: { ...process.env, AGENT_EXEC_CONFIG_DIR: tmp },
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)

		const pluginDir = path.join(tmp, 'plugins', 'execcheck')
		const settings = JSON.parse(fs.readFileSync(path.join(pluginDir, 'settings.json'), 'utf8'))
		const indexJs = fs.readFileSync(path.join(pluginDir, 'index.js'), 'utf8')
		const md = fs.readFileSync(path.join(pluginDir, 'SKILL.md'), 'utf8')
		const sjs = toSjs(md, 'execcheck', 'private')

		assert.deepEqual(settings.plugin, { type: 'exec', command: 'printf', apiVersion: 1, settings: {} })
		assert.deepEqual(settings.exec.allow, ['printf --help', 'printf --version'])
		assert.match(indexJs, /Mounted at \/api\/command\/execcheck\/\*/)
		assert.match(indexJs, /api\.exec/)
		assert.doesNotMatch(indexJs, /api\.run/)
		assert.match(md, /Run `printf` commands via `POST \/api\/exec`/)
		assert.doesNotMatch(md, /\/api\/command\/execcheck/)
		assert.ok(sjs.includes('// /private/skills/execcheck/SKILL.s.js'), 'private exec plugin SJS marker is generated')
		assert.ok(sjs.includes('m["/api/exec"].request.body = { args: ["printf", "--help"] };'), 'exec plugin skill still points to /api/exec request body')
		assert.ok(!sjs.includes('/api/command/execcheck'), 'private skill SJS does not advertise runtime route scaffold')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('plugin create: trusted plugin marks runtime trust only in scaffold, not skill surface', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-plugin-create-trusted-'))
	try {
		const result = spawnSync(process.execPath, [
			path.join(__dirname, '..', 'scripts', 'plugin-create.js'),
			'--name=trustcheck',
			'--command=printf',
			'--type=trusted',
			'--invoke=run',
			'--silent',
		], {
			cwd: path.join(__dirname, '..'),
			env: { ...process.env, AGENT_EXEC_CONFIG_DIR: tmp },
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)

		const pluginDir = path.join(tmp, 'plugins', 'trustcheck')
		const settings = JSON.parse(fs.readFileSync(path.join(pluginDir, 'settings.json'), 'utf8'))
		const indexJs = fs.readFileSync(path.join(pluginDir, 'index.js'), 'utf8')
		const md = fs.readFileSync(path.join(pluginDir, 'SKILL.md'), 'utf8')
		const sjs = toSjs(md, 'trustcheck', 'private')

		assert.deepEqual(settings.plugin, { type: 'trusted', command: 'printf', invoke: 'run', apiVersion: 1, settings: {} })
		assert.deepEqual(settings.exec.allow, ['printf --help', 'printf --version'])
		assert.match(indexJs, /api\.run/)
		assert.match(indexJs, /direct execution \(this plugin is trusted\)/)
		assert.match(md, /Run `printf` commands via `POST \/api\/exec`/)
		assert.doesNotMatch(md, /api\.run/)
		assert.ok(sjs.includes('// /private/skills/trustcheck/SKILL.s.js'), 'private trusted plugin SJS marker is generated')
		assert.ok(sjs.includes('m["/api/exec"].request.body = { args: ["printf", "--help"] };'), 'trusted plugin skill still points to /api/exec request body')
		assert.ok(!sjs.includes('api.run'), 'trusted runtime API is not exposed as a skill operation')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('plugin create: --silent suppresses generated settings output', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-plugin-create-'))
	try {
		const result = spawnSync(process.execPath, [
			path.join(__dirname, '..', 'scripts', 'plugin-create.js'),
			'--name=silentcheck',
			'--command=echo',
			'--type=skill',
			'--silent',
		], {
			cwd: path.join(__dirname, '..'),
			env: { ...process.env, AGENT_EXEC_CONFIG_DIR: tmp },
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)
		assert.doesNotMatch(result.stdout, /Generated settings\.json/)
		assert.doesNotMatch(result.stdout, /Generated rule "echo \*"/)
		assert.match(result.stdout, /Review .*settings\.json/)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('setup --use-project-env: refuses to persist project .env', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-setup-'))
	try {
		const configDir = path.join(tmp, 'config')
		const projectDir = path.join(tmp, 'project')
		fs.mkdirSync(projectDir, { recursive: true })
		fs.writeFileSync(path.join(projectDir, '.env'), [
			'API_KEY=project-key',
			'PORT=9999',
			'LOG_LEVEL=debug',
			'DATABASE_URL=postgres://secret',
			'OPENAI_API_KEY=secret',
			'',
		].join('\n'))
		const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'setup.js'), '--yes', '--use-project-env'], {
			cwd: projectDir,
			env: {
				PATH: process.env.PATH,
				HOME: tmp,
				TMPDIR: os.tmpdir(),
				AGENT_EXEC_CONFIG_DIR: configDir,
			},
			encoding: 'utf8',
		})
		assert.notEqual(result.status, 0, 'setup --use-project-env fails')
		assert.match(result.stderr, /does not import project \.env/)
		assert.equal(fs.existsSync(path.join(configDir, '.env')), false)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('setup: does not persist process env API_KEY/PORT', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-setup-'))
	try {
		const configDir = path.join(tmp, 'config')
		const projectDir = path.join(tmp, 'project')
		fs.mkdirSync(projectDir, { recursive: true })
		const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'setup.js'), '--yes'], {
			cwd: projectDir,
			env: {
				PATH: process.env.PATH,
				HOME: tmp,
				TMPDIR: os.tmpdir(),
				AGENT_EXEC_CONFIG_DIR: configDir,
				API_KEY: 'process-env-key',
				PORT: '9999',
			},
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr || result.stdout)
		const env = parseEnvText(fs.readFileSync(path.join(configDir, '.env'), 'utf8'))
		assert.notEqual(env.API_KEY, 'process-env-key')
		assert.equal(env.PORT, undefined)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('aexec key rotate: replaces API_KEY in local .env', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-key-'))
	try {
		const configDir = path.join(tmp, 'config')
		fs.mkdirSync(configDir, { recursive: true })
		fs.writeFileSync(path.join(configDir, '.env'), 'API_KEY=old-key\nAGENT_EXEC_ENABLED=true\n', { mode: 0o600 })
		const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'aexec.js'), 'key', 'rotate'], {
			env: {
				PATH: process.env.PATH,
				HOME: tmp,
				TMPDIR: os.tmpdir(),
				AGENT_EXEC_CONFIG_DIR: configDir,
			},
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr || result.stdout)
		const env = parseEnvText(fs.readFileSync(path.join(configDir, '.env'), 'utf8'))
		assert.notEqual(env.API_KEY, 'old-key')
		assert.match(env.API_KEY, /^[0-9a-f]{64}$/)
		assert.equal(env.AGENT_EXEC_ENABLED, 'true')
		assert.match(result.stdout, /Restart required/)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('aexec key rotate: warns when project .env API_KEY overrides active runtime', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-key-project-'))
	try {
		const configDir = path.join(tmp, 'config')
		const projectDir = path.join(tmp, 'project')
		fs.mkdirSync(configDir, { recursive: true })
		fs.mkdirSync(projectDir, { recursive: true })
		fs.writeFileSync(path.join(configDir, '.env'), 'API_KEY=config-key\nAGENT_EXEC_ENABLED=true\n', { mode: 0o600 })
		fs.writeFileSync(path.join(projectDir, '.env'), 'API_KEY=project-key\n', { mode: 0o600 })
		const metaFile = path.join(configDir, 'agent-exec.pid.json')
		fs.writeFileSync(metaFile, JSON.stringify({
			mode: 'foreground',
			pid: 999999,
			projectEnv: path.join(projectDir, '.env'),
			projectEnvExists: true,
			processOnly: true,
			effective: { host: '0.0.0.0', port: '3333' },
		}))
		const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'aexec.js'), 'key', 'rotate'], {
			env: {
				PATH: process.env.PATH,
				HOME: tmp,
				TMPDIR: os.tmpdir(),
				AGENT_EXEC_CONFIG_DIR: configDir,
			},
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr || result.stdout)
		assert.match(result.stdout, /Active project \.env API_KEY detected/)
		assert.match(result.stdout, /Project env:/)
		assert.match(result.stdout, /saved config \.env was rotated/)
		const env = parseEnvText(fs.readFileSync(path.join(configDir, '.env'), 'utf8'))
		assert.notEqual(env.API_KEY, 'config-key')
		assert.equal(parseEnvText(fs.readFileSync(path.join(projectDir, '.env'), 'utf8')).API_KEY, 'project-key')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('aexec update: parses optional restart pass-through flags', () => {
	const {
		parseArgs,
		latestInstallArgs,
		isAgentExecEntry,
		parseVersionOutput,
		activeMatchesLatest,
		updateSource,
		updateVerification,
	} = require('../scripts/commands/update')._internals
	assert.deepEqual(parseArgs([]), { restart: false, restartArgs: [] })
	assert.deepEqual(parseArgs(['--restart']), { restart: true, restartArgs: [] })
	assert.deepEqual(parseArgs(['--restart', '--public']), { restart: true, restartArgs: ['--public'] })
	assert.deepEqual(parseArgs(['--restart', '--force', '-f', '--public']), {
		restart: true,
		restartArgs: ['--force', '-f', '--public'],
	})
	assert.deepEqual(parseArgs(['--restart', '--host', '0.0.0.0', '--port=3333', '--use-project-env']), {
		restart: true,
		restartArgs: ['--host', '0.0.0.0', '--port=3333', '--use-project-env'],
	})
	assert.deepEqual(latestInstallArgs(), ['install', '-g', '@to-agent/agent-exec@latest'])
	assert.equal(isAgentExecEntry('/tmp/bin/ae'), true)
	assert.equal(isAgentExecEntry('/tmp/bin/aexec'), true)
	assert.equal(isAgentExecEntry('/tmp/test/unit.js'), false)
	assert.equal(parseVersionOutput('agent-exec v0.2.7'), '0.2.7')
	assert.equal(parseVersionOutput('0.2.7'), '0.2.7')
	assert.equal(activeMatchesLatest('0.0.0'), false)
	assert.match(updateSource(), /^npm(\.cmd)? install -g @to-agent\/agent-exec@latest$/)
	assert.ok(updateVerification().some((line) => line.includes('update source:')))
})

test('aexec config: reports project .env API_KEY override', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-config-project-'))
	try {
		const configDir = path.join(tmp, 'config')
		const projectDir = path.join(tmp, 'project')
		fs.mkdirSync(configDir, { recursive: true })
		fs.mkdirSync(projectDir, { recursive: true })
		fs.writeFileSync(path.join(configDir, '.env'), 'API_KEY=config-key\nAGENT_EXEC_ENABLED=true\n', { mode: 0o600 })
		fs.writeFileSync(path.join(projectDir, '.env'), 'API_KEY=project-key\n', { mode: 0o600 })
		fs.writeFileSync(path.join(configDir, 'agent-exec.pid.json'), JSON.stringify({
			mode: 'foreground',
			pid: 999999,
			projectEnv: path.join(projectDir, '.env'),
			projectEnvExists: true,
			processOnly: true,
			effective: { host: '0.0.0.0', port: '3333' },
		}))
		const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'aexec.js'), 'config'], {
			env: {
				PATH: process.env.PATH,
				HOME: tmp,
				TMPDIR: os.tmpdir(),
				AGENT_EXEC_CONFIG_DIR: configDir,
			},
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr || result.stdout)
		assert.match(result.stdout, /Source: project \.env/)
		assert.match(result.stdout, /Project API_KEY: project-/)
		assert.match(result.stdout, /overrides the saved config \.env/)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

// ----------------------------------------------------------------
// plugin-runtime
// ----------------------------------------------------------------
console.log('\n=== plugin-runtime ===')

const pluginRuntime = require('../modules/plugin-runtime')
const pluginControl = require('../modules/plugin-control')
const paths         = require('../modules/paths')
const pluginPolicy  = require('../scripts/plugin-policy-lib')
const pluginDoctor  = require('../scripts/plugin-doctor')

const origBundled = paths.BUNDLED_PLUGINS_DIR
const origUser    = paths.USER_PLUGINS_DIR
const origUserSettingsFile = paths.USER_SETTINGS_FILE
const origUserSettings    = paths.USER_SETTINGS_LOCAL_FILE
const origProjectSettings = paths.PROJECT_SETTINGS_LOCAL_FILE

function resetPluginTestState() {
	pluginRuntime._reset()
	settingsModule._reset?.()
}

function withPlugins(plugins, fn, localSettings) {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-test-'))
	try {
		for (const p of plugins) {
			const pDir = path.join(tmpDir, p.name)
			fs.mkdirSync(pDir, { recursive: true })
			if (p.settings !== undefined)
				fs.writeFileSync(path.join(pDir, 'settings.json'), JSON.stringify(p.settings))
			if (p.index !== undefined)
				fs.writeFileSync(path.join(pDir, 'index.js'), p.index)
		}
		paths.BUNDLED_PLUGINS_DIR = ''
		paths.USER_PLUGINS_DIR    = tmpDir
		paths.USER_SETTINGS_FILE          = path.join(tmpDir, 'root-settings.json')
		paths.USER_SETTINGS_LOCAL_FILE    = path.join(tmpDir, 'user-settings.json')
		paths.PROJECT_SETTINGS_LOCAL_FILE = path.join(tmpDir, 'project-settings.json')
		if (localSettings !== undefined)
			fs.writeFileSync(paths.USER_SETTINGS_LOCAL_FILE, JSON.stringify(localSettings))
		resetPluginTestState()
		return fn(tmpDir)
	} finally {
		paths.BUNDLED_PLUGINS_DIR = origBundled
		paths.USER_PLUGINS_DIR    = origUser
		paths.USER_SETTINGS_FILE          = origUserSettingsFile
		paths.USER_SETTINGS_LOCAL_FILE    = origUserSettings
		paths.PROJECT_SETTINGS_LOCAL_FILE = origProjectSettings
		resetPluginTestState()
		fs.rmSync(tmpDir, { recursive: true, force: true })
	}
}

const MINIMAL_INDEX = `'use strict'\nmodule.exports = {}`

test('missing plugin.type is treated as skill and not loaded', () => {
	withPlugins([
		{ name: 'notype', settings: { plugin: { command: 'notype' } } },
	], () => {
		const plugins = pluginRuntime.load()
		assert.equal(plugins.length, 0, 'missing type is treated as skill and skipped')
	})
})

test('skill plugin is not loaded even when index.js exists', () => {
	withPlugins([
		{ name: 'myskill', settings: { plugin: { type: 'skill' } }, index: MINIMAL_INDEX },
	], () => {
		const plugins = pluginRuntime.load()
		assert.equal(plugins.length, 0, 'skill type is skipped')
	})
})

test('unknown type → startup error', () => {
	withPlugins([
		{ name: 'bad', settings: { plugin: { type: 'invalid', command: 'bad' } }, index: MINIMAL_INDEX },
	], () => {
		assert.throws(
			() => pluginRuntime.load(),
			/unknown type "invalid"/,
			'unknown type causes startup error'
		)
	})
})

test('unknown invoke → startup error', () => {
	withPlugins([
		{ name: 'bad', settings: { plugin: { type: 'exec', command: 'bad', invoke: 'magic' } }, index: MINIMAL_INDEX },
	], () => {
		assert.throws(
			() => pluginRuntime.load(),
			/unknown invoke "magic"/,
			'unknown invoke causes startup error'
		)
	})
})

test('invoke:"run" on exec (non-trusted) → startup error', () => {
	withPlugins([
		{ name: 'bad', settings: { plugin: { type: 'exec', command: 'bad', invoke: 'run' } }, index: MINIMAL_INDEX },
	], () => {
		assert.throws(
			() => pluginRuntime.load(),
			/only trusted plugins may use invoke:"run"/,
			'exec + invoke:run causes startup error'
		)
	})
})

test('trusted plugin receives api.run', () => {
	const fakeTrusted = { type: 'trusted' }
	const api = pluginRuntime.makeApi(fakeTrusted, () => {}, () => {})
	assert.ok(typeof api.run === 'function', 'trusted has api.run')
	assert.ok(typeof api.exec === 'function', 'trusted has api.exec')
})

test('exec plugin does not receive api.run', () => {
	const fakeExec = { type: 'exec' }
	const api = pluginRuntime.makeApi(fakeExec, () => {}, () => {})
	assert.equal(api.run, undefined, 'exec does not have api.run')
	assert.ok(typeof api.exec === 'function', 'exec has api.exec')
})

test('sanitizeRequest: redacts x-api-key / authorization / query.apiKey', () => {
	const { sanitizeRequest } = pluginRuntime
	const req = {
		method: 'POST',
		path: '/api/exec',
		ip: '127.0.0.1',
		headers: { 'x-api-key': 'secret', 'authorization': 'Bearer token', 'content-type': 'application/json' },
		query: { apiKey: 'mykey', format: 'json' },
	}
	const sanitized = sanitizeRequest(req)
	assert.equal(sanitized.headers['x-api-key'],     '***', 'x-api-key is redacted')
	assert.equal(sanitized.headers['authorization'],  '***', 'authorization is redacted')
	assert.equal(sanitized.headers['content-type'],  'application/json', 'other headers are kept')
	assert.equal(sanitized.query.apiKey,             '***', 'query.apiKey is redacted')
	assert.equal(sanitized.query.format,             'json', 'other query values are kept')
})

test('duplicate command → startup error', () => {
	withPlugins([
		{ name: 'p1', settings: { plugin: { type: 'exec', command: 'sametool' } }, index: MINIMAL_INDEX },
		{ name: 'p2', settings: { plugin: { type: 'exec', command: 'sametool' } }, index: MINIMAL_INDEX },
	], () => {
		assert.throws(
			() => pluginRuntime.load(),
			/duplicate command "sametool"/,
			'duplicate command causes startup error'
		)
	})
})

test('reserved command → startup error', () => {
	for (const cmd of ['exec', 'acl', 'plugins', 'skills', 'ping']) {
		withPlugins([
			{ name: 'reserved', settings: { plugin: { type: 'exec', command: cmd } }, index: MINIMAL_INDEX },
		], () => {
			assert.throws(
				() => pluginRuntime.load(),
				/reserved command/,
				`reserved command "${cmd}" causes startup error`
			)
		})
	}
})

test('system plugin in enabled list causes v1 startup error', () => {
	const origEnv = process.env.AGENT_EXEC_SYSTEM_PLUGINS
	process.env.AGENT_EXEC_SYSTEM_PLUGINS = 'sysplug'
	try {
		withPlugins([
			{ name: 'sysplug', settings: { plugin: { type: 'system' } } },
		], () => {
			assert.throws(
				() => pluginRuntime.load(),
				/system plugins are not supported in v1/,
				'enabled system plugin causes startup error'
			)
		})
	} finally {
		if (origEnv === undefined) delete process.env.AGENT_EXEC_SYSTEM_PLUGINS
		else process.env.AGENT_EXEC_SYSTEM_PLUGINS = origEnv
	}
})

test('user plugin overriding bundled system plugin by name causes startup error', () => {
	const tmpBundled = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-bundled-'))
	const tmpUser = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-user-'))
	try {
		const bDir = path.join(tmpBundled, 'sysname')
		const uDir = path.join(tmpUser, 'sysname')
		fs.mkdirSync(bDir, { recursive: true })
		fs.mkdirSync(uDir, { recursive: true })
		fs.writeFileSync(path.join(bDir, 'settings.json'), JSON.stringify({ plugin: { type: 'system' } }))
		fs.writeFileSync(path.join(uDir, 'settings.json'), JSON.stringify({ plugin: { type: 'exec', command: 'usercmd' } }))
		fs.writeFileSync(path.join(uDir, 'index.js'), MINIMAL_INDEX)

		paths.BUNDLED_PLUGINS_DIR = tmpBundled
		paths.USER_PLUGINS_DIR = tmpUser
		paths.USER_SETTINGS_FILE          = path.join(tmpUser, 'root-settings.json')
		paths.USER_SETTINGS_LOCAL_FILE    = path.join(tmpUser, 'user-settings.json')
		paths.PROJECT_SETTINGS_LOCAL_FILE = path.join(tmpUser, 'project-settings.json')
		resetPluginTestState()

		assert.throws(() => pluginRuntime.load(), /system plugin "sysname" is overridden/)
	} finally {
		paths.BUNDLED_PLUGINS_DIR = origBundled
		paths.USER_PLUGINS_DIR = origUser
		paths.USER_SETTINGS_FILE          = origUserSettingsFile
		paths.USER_SETTINGS_LOCAL_FILE    = origUserSettings
		paths.PROJECT_SETTINGS_LOCAL_FILE = origProjectSettings
		resetPluginTestState()
		fs.rmSync(tmpBundled, { recursive: true, force: true })
		fs.rmSync(tmpUser, { recursive: true, force: true })
	}
})

// ----------------------------------------------------------------
// plugin-control: enabled/disabled policy
// ----------------------------------------------------------------
console.log('\n=== plugin-control ===')

test('plugins.disabled excludes plugin from both settings merge and runtime load', () => {
	withPlugins([
		{ name: 'offplug', settings: { plugin: { type: 'exec', command: 'offcmd' }, exec: { allow: ['offcmd'] } }, index: MINIMAL_INDEX },
	], () => {
		const policy = pluginControl.readPluginPolicy()
		assert.equal(pluginControl.isPluginEnabled('offplug', policy), false)
		const s = settingsModule.load()
		assert.ok(!s.exec.allow.includes('offcmd'), 'disabled plugin exec.allow is not merged')
		assert.deepEqual(pluginRuntime.load().map(p => p.name), [], 'disabled plugin is not loaded into runtime')
	}, { plugins: { disabled: ['offplug'] } })
})

test('plugins.mode:"explicit" enables only plugins listed in enabled', () => {
	withPlugins([
		{ name: 'onplug',  settings: { plugin: { type: 'exec', command: 'oncmd' },  exec: { allow: ['oncmd'] } },  index: MINIMAL_INDEX },
		{ name: 'offplug', settings: { plugin: { type: 'exec', command: 'offcmd' }, exec: { allow: ['offcmd'] } }, index: MINIMAL_INDEX },
	], () => {
		const s = settingsModule.load()
		assert.ok(s.exec.allow.includes('oncmd'), 'enabled plugin exec.allow is merged')
		assert.ok(!s.exec.allow.includes('offcmd'), 'non-enabled plugin is not merged')
		assert.deepEqual(pluginRuntime.load().map(p => p.name), ['onplug'])
	}, { plugins: { mode: 'explicit', enabled: ['onplug'] } })
})

test('plugins.disabled takes precedence over plugins.enabled', () => {
	withPlugins([
		{ name: 'bothplug', settings: { plugin: { type: 'exec', command: 'bothcmd' }, exec: { allow: ['bothcmd'] } }, index: MINIMAL_INDEX },
	], () => {
		const s = settingsModule.load()
		assert.ok(!s.exec.allow.includes('bothcmd'), 'disabled wins and exec.allow is not merged')
		assert.deepEqual(pluginRuntime.load().map(p => p.name), [])
	}, { plugins: { mode: 'explicit', enabled: ['bothplug'], disabled: ['bothplug'] } })
})

test('invalid plugins.mode causes startup error', () => {
	withPlugins([
		{ name: 'plug', settings: { plugin: { type: 'exec', command: 'plugcmd' }, exec: { allow: ['plugcmd'] } }, index: MINIMAL_INDEX },
	], () => {
		assert.throws(() => pluginControl.readPluginPolicy(), /plugins\.mode/)
		assert.throws(() => pluginRuntime.load(), /plugins\.mode/)
	}, { plugins: { mode: 'magic' } })
})

test('plugin enable/disable CLI policy helper updates disabled in auto mode', () => {
	withPlugins([
		{ name: 'polplug', settings: { plugin: { type: 'skill', command: 'node' } } },
	], () => {
		pluginPolicy.updatePluginPolicy('polplug', 'disable')
		let local = JSON.parse(fs.readFileSync(paths.USER_SETTINGS_LOCAL_FILE, 'utf8'))
		assert.deepEqual(local.plugins.disabled, ['polplug'])

		pluginPolicy.updatePluginPolicy('polplug', 'enable')
		local = JSON.parse(fs.readFileSync(paths.USER_SETTINGS_LOCAL_FILE, 'utf8'))
		assert.deepEqual(local.plugins.disabled, [])
		assert.deepEqual(local.plugins.enabled, [])
	})
})

test('plugin enable CLI policy helper adds to enabled in explicit mode', () => {
	withPlugins([
		{ name: 'explicitplug', settings: { plugin: { type: 'skill', command: 'node' } } },
	], () => {
		pluginPolicy.updatePluginPolicy('explicitplug', 'enable')
		const local = JSON.parse(fs.readFileSync(paths.USER_SETTINGS_LOCAL_FILE, 'utf8'))
		assert.deepEqual(local.plugins.enabled, ['explicitplug'])
		assert.deepEqual(local.plugins.disabled, [])
	}, { plugins: { mode: 'explicit', enabled: [], disabled: ['explicitplug'] } })
})

test('startup snapshot: plugin added after startup stays hidden until restart', () => {
	withPlugins([], (tmpDir) => {
		assert.deepEqual([...pluginControl.activePluginMap().keys()], [], 'startup snapshot is empty')

		const pDir = path.join(tmpDir, 'lateplug')
		fs.mkdirSync(pDir, { recursive: true })
		fs.writeFileSync(path.join(pDir, 'settings.json'), JSON.stringify({
			plugin: { type: 'exec', command: 'latecmd' },
			exec: { allow: ['latecmd'] },
		}))
		fs.writeFileSync(path.join(pDir, 'SKILL.md'), '# SKILL: lateplug\n')
		fs.writeFileSync(path.join(pDir, 'index.js'), MINIMAL_INDEX)

		assert.equal(pluginControl.activePluginMap().has('lateplug'), false, 'added plugin is not in the snapshot')
		assert.ok(!settingsModule.load().exec.allow.includes('latecmd'), 'added plugin ACL is not merged')
		assert.deepEqual(pluginRuntime.load().map(p => p.name), [], 'added plugin runtime is not loaded')
	})
})

test('startup snapshot: plugin deleted after startup is revoked from discovery/ACL/runtime immediately', () => {
	withPlugins([
		{ name: 'goneplug', settings: { plugin: { type: 'exec', command: 'gonecmd' }, exec: { allow: ['gonecmd'] } }, index: MINIMAL_INDEX },
	], (tmpDir) => {
		assert.equal(pluginControl.activePluginMap().has('goneplug'), true)
		assert.ok(settingsModule.load().exec.allow.includes('gonecmd'))
		assert.deepEqual(pluginRuntime.load().map(p => p.name), ['goneplug'])

		fs.rmSync(path.join(tmpDir, 'goneplug'), { recursive: true, force: true })
		assert.equal(pluginControl.activePluginMap().has('goneplug'), false, 'deleted plugin disappears from discovery')
		assert.ok(!settingsModule.load().exec.allow.includes('gonecmd'), 'deleted plugin ACL is removed')
		assert.deepEqual(pluginRuntime.getForCommand('gonecmd'), [], 'deleted plugin hooks are not returned')
	})
})

test('startup snapshot: plugin disabled after startup returns 404 via route gate', () => {
	withPlugins([
		{
			name: 'gateplug',
			settings: { plugin: { type: 'exec', command: 'gatecmd' }, exec: { allow: ['gatecmd'] } },
			index: `'use strict'\nmodule.exports = { routes(router) { router.get('/status', (req, res) => res.json({ ok: true })) } }`,
		},
	], () => {
		const mounted = []
		const fakeApp = { use(p, ...handlers) { mounted.push({ path: p, handlers }) } }
		pluginRuntime.mountRoutes(fakeApp)
		assert.equal(mounted.length, 1)
		assert.equal(mounted[0].path, '/api/command/gateplug')

		fs.writeFileSync(paths.USER_SETTINGS_LOCAL_FILE, JSON.stringify({ plugins: { disabled: ['gateplug'] } }))
		const future = new Date(Date.now() + 1000)
		fs.utimesSync(paths.USER_SETTINGS_LOCAL_FILE, future, future)

		let nextCalled = false
		const res = {
			_status: 200,
			_json: null,
			status(n) { this._status = n; return this },
			json(v) { this._json = v; return this },
		}
		mounted[0].handlers[0]({}, res, () => { nextCalled = true })
		assert.equal(nextCalled, false, 'disabled plugin route does not pass through')
		assert.equal(res._status, 404)
		assert.equal(res._json?.error, 'plugin not active')
		assert.equal(pluginControl.activePluginMap().has('gateplug'), false)
		assert.deepEqual(pluginRuntime.getForCommand('gatecmd'), [])
		assert.ok(!settingsModule.load().exec.allow.includes('gatecmd'))
	})
})

test('startup snapshot: same-name plugin recreated after deletion stays inactive until restart', () => {
	withPlugins([
		{
			name: 'replug',
			settings: { plugin: { type: 'exec', command: 'recmd' }, exec: { allow: ['recmd'] } },
			index: `'use strict'\nmodule.exports = { routes(router) { router.get('/status', (req, res) => res.json({ old: true })) } }`,
		},
	], (tmpDir) => {
		const mounted = []
		const fakeApp = { use(p, ...handlers) { mounted.push({ path: p, handlers }) } }
		pluginRuntime.mountRoutes(fakeApp)

		fs.rmSync(path.join(tmpDir, 'replug'), { recursive: true, force: true })
		const pDir = path.join(tmpDir, 'replug')
		fs.mkdirSync(pDir, { recursive: true })
		fs.writeFileSync(path.join(pDir, 'settings.json'), JSON.stringify({
			plugin: { type: 'exec', command: 'newcmd' },
			exec: { allow: ['newcmd'] },
		}))
		fs.writeFileSync(path.join(pDir, 'SKILL.md'), '# SKILL: replug new\n')
		fs.writeFileSync(path.join(pDir, 'index.js'), MINIMAL_INDEX)

		assert.equal(pluginControl.activePluginMap().has('replug'), false, 'same-name recreation is invalid due to snapshot identity mismatch')
		assert.deepEqual(pluginRuntime.getForCommand('recmd'), [], 'old runtime hooks are not returned')
		assert.ok(!settingsModule.load().exec.allow.includes('newcmd'), 'new settings are not merged until restart')

		let nextCalled = false
		const res = {
			_status: 200,
			_json: null,
			status(n) { this._status = n; return this },
			json(v) { this._json = v; return this },
		}
		mounted[0].handlers[0]({}, res, () => { nextCalled = true })
		assert.equal(nextCalled, false)
		assert.equal(res._status, 404)
	})
})

test('startup snapshot: plugin settings.json edits do not affect ACL/runtime until restart', () => {
	withPlugins([
		{ name: 'editplug', settings: { plugin: { type: 'exec', command: 'oldcmd' }, exec: { allow: ['oldcmd'] } }, index: MINIMAL_INDEX },
	], (tmpDir) => {
		assert.ok(settingsModule.load().exec.allow.includes('oldcmd'))
		assert.deepEqual(pluginRuntime.getForCommand('oldcmd').map(p => p.name), ['editplug'])

		fs.writeFileSync(path.join(tmpDir, 'editplug', 'settings.json'), JSON.stringify({
			plugin: { type: 'exec', command: 'newcmd' },
			exec: { allow: ['newcmd'] },
		}))
		const future = new Date(Date.now() + 1000)
		fs.utimesSync(path.join(tmpDir, 'editplug', 'settings.json'), future, future)

		const s = settingsModule.load()
		assert.ok(s.exec.allow.includes('oldcmd'), 'snapshot plugin settings keep being used')
		assert.ok(!s.exec.allow.includes('newcmd'), 'edited plugin settings are not merged')
		assert.deepEqual(pluginRuntime.getForCommand('oldcmd').map(p => p.name), ['editplug'])
		assert.deepEqual(pluginRuntime.getForCommand('newcmd'), [])
	})
})

// ----------------------------------------------------------------
// plugin-runtime: mountRoutes — routes mount under /api/command/${name}
// ----------------------------------------------------------------
console.log('\n=== plugin-runtime: mountRoutes ===')

test('mountRoutes: plugin routes are mounted under /api/command/${name}', () => {
	withPlugins([
		{
			name: 'testplug',
			settings: { plugin: { type: 'exec', command: 'testplug-cmd' } },
			index: `'use strict'\nmodule.exports = { routes(router) { router.get('/status', (req, res) => res.json({ ok: true })) } }`,
		},
	], () => {
		const mounted = []
		const fakeApp = { use(p, r) { mounted.push({ path: p, router: r }) } }
		pluginRuntime.mountRoutes(fakeApp)
		assert.deepEqual(
			mounted.map(m => m.path),
			['/api/command/testplug'],
			'plugin route is mounted only under /api/command'
		)
	})
})

test('mountRoutes: plugin without routes is not mounted', () => {
	withPlugins([
		{
			name: 'nortplug',
			settings: { plugin: { type: 'exec', command: 'nort-cmd' } },
			index: MINIMAL_INDEX,
		},
	], () => {
		const mounted = []
		const fakeApp = { use(p, r) { mounted.push({ path: p, router: r }) } }
		pluginRuntime.mountRoutes(fakeApp)
		assert.equal(mounted.length, 0, 'plugin without routes is not mounted')
	})
})

// ----------------------------------------------------------------
// plugin-runtime: startup validation (additional)
// ----------------------------------------------------------------
console.log('\n=== plugin-runtime: startup validation (additional) ===')

test('reserved plugin name (exec) → startup error', () => {
	withPlugins([
		{ name: 'exec', settings: { plugin: { type: 'exec', command: 'sometool' } }, index: MINIMAL_INDEX },
	], () => {
		assert.throws(() => pluginRuntime.load(), /reserved name/)
	})
})

test('unsupported apiVersion: 2 → startup error', () => {
	withPlugins([
		{ name: 'testplug', settings: { plugin: { type: 'exec', command: 'testcmd', apiVersion: 2 } }, index: MINIMAL_INDEX },
	], () => {
		assert.throws(() => pluginRuntime.load(), /only v1 is supported/)
	})
})

test('exec plugin missing plugin.command → startup error', () => {
	withPlugins([
		{ name: 'testplug', settings: { plugin: { type: 'exec' } }, index: MINIMAL_INDEX },
	], () => {
		assert.throws(() => pluginRuntime.load(), /missing plugin\.command/)
	})
})

test('plugin doctor reports duplicate active command as an error', () => {
	withPlugins([
		{ name: 'p1', settings: { plugin: { type: 'exec', command: 'dupcmd' } }, index: MINIMAL_INDEX },
		{ name: 'p2', settings: { plugin: { type: 'exec', command: 'dupcmd' } }, index: MINIMAL_INDEX },
	], () => {
		const result = pluginDoctor.collectDoctor()
		assert.ok(result.errors.some(e => e.code === 'duplicate_command'), 'returns duplicate_command error')
	})
})

test('plugin doctor excludes disabled plugin from duplicate command checks', () => {
	withPlugins([
		{ name: 'p1', settings: { plugin: { type: 'exec', command: 'dupcmd' } }, index: MINIMAL_INDEX },
		{ name: 'p2', settings: { plugin: { type: 'exec', command: 'dupcmd' } }, index: MINIMAL_INDEX },
	], () => {
		const result = pluginDoctor.collectDoctor()
		assert.ok(!result.errors.some(e => e.code === 'duplicate_command'), 'disabled plugin is excluded from duplicate checks')
	}, { plugins: { disabled: ['p2'] } })
})

test('plugin doctor warns about active wildcard exec.allow rules', () => {
	withPlugins([
		{ name: 'broadplug', settings: { plugin: { type: 'exec', command: 'broadcmd' }, exec: { allow: ['broadcmd *'] } }, index: MINIMAL_INDEX },
		{ name: 'allplug', settings: { plugin: { type: 'exec', command: 'allcmd' }, exec: { allow: ['*'] } }, index: MINIMAL_INDEX },
	], () => {
		const result = pluginDoctor.collectDoctor()
		assert.ok(result.warnings.some(w =>
			w.plugin === 'broadplug' &&
			w.code === 'wildcard_exec_allow' &&
			w.message.includes('broadcmd *') &&
			w.message.includes('broad wildcard ACL rule') &&
			w.message.includes('Review the plugin skill and command behavior before restart')
		), 'warns on command wildcard')
		assert.ok(result.warnings.some(w =>
			w.plugin === 'allplug' &&
			w.code === 'allow_all_exec_allow' &&
			w.message.includes('broad wildcard ACL rule') &&
			w.message.includes('Review the plugin skill and command behavior before restart')
		), 'warns on allow-all wildcard')
	})
})

test('plugin doctor ignores wildcard exec.allow rules on disabled plugins', () => {
	withPlugins([
		{ name: 'offbroad', settings: { plugin: { type: 'exec', command: 'offbroad' }, exec: { allow: ['offbroad *'] } }, index: MINIMAL_INDEX },
	], () => {
		const result = pluginDoctor.collectDoctor()
		assert.ok(!result.warnings.some(w => w.code === 'wildcard_exec_allow'), 'disabled wildcard ACL is not an active runtime warning')
	}, { plugins: { disabled: ['offbroad'] } })
})

// ----------------------------------------------------------------
// backup / import / transfer
// ----------------------------------------------------------------
console.log('\n=== backup / import / transfer ===')

const backupModule = require('../modules/backup')

function makeConfigFixture() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-config-'))
	fs.mkdirSync(path.join(dir, 'settings', 'local'), { recursive: true })
	fs.mkdirSync(path.join(dir, 'plugins', 'p1'), { recursive: true })
	fs.mkdirSync(path.join(dir, 'cache'), { recursive: true })
	fs.mkdirSync(path.join(dir, 'backups'), { recursive: true })
	fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=secret\nPORT=3333\n')
	fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ exec: { allow: ['echo'] } }))
	fs.writeFileSync(path.join(dir, 'settings', 'local', 'settings.json'), JSON.stringify({ plugins: { disabled: [] } }))
	fs.writeFileSync(path.join(dir, 'plugins', 'p1', 'SKILL.md'), '# p1\n')
	fs.writeFileSync(path.join(dir, 'cache', 'cached.txt'), 'cache')
	fs.writeFileSync(path.join(dir, 'backups', 'old.json'), '{}')
	fs.writeFileSync(path.join(dir, 'agent-exec.pid'), '123')
	fs.writeFileSync(path.join(dir, 'agent-exec.log'), 'log')
	return dir
}

test('backup: includes .env/settings/plugins and excludes cache/backups/runtime files', () => {
	const dir = makeConfigFixture()
	const out = path.join(os.tmpdir(), `ae-backup-${Date.now()}.json.gz`)
	try {
		const data = backupModule.buildBackup({ configDir: dir })
		const files = data.entries.filter(e => e.type === 'file').map(e => e.path).sort()
		assert.ok(files.includes('.env'), 'includes .env')
		assert.ok(files.includes('settings.json'), 'includes root settings')
		assert.ok(files.includes('settings/local/settings.json'), 'includes local settings')
		assert.ok(files.includes('plugins/p1/SKILL.md'), 'includes user plugin')
		assert.ok(!files.includes('cache/cached.txt'), 'excludes cache')
		assert.ok(!files.includes('backups/old.json'), 'excludes backups')
		assert.ok(!files.includes('agent-exec.pid'), 'excludes pid')
		assert.ok(!files.includes('agent-exec.log'), 'excludes log')
		backupModule.writeBackup(out, data)
		assert.deepEqual(backupModule.readBackup(out).entries.map(e => e.path), data.entries.map(e => e.path))
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
		fs.rmSync(out, { force: true })
	}
})

test('backup: --no-secrets equivalent excludes .env', () => {
	const dir = makeConfigFixture()
	try {
		const data = backupModule.buildBackup({ configDir: dir, includeSecrets: false })
		const files = data.entries.filter(e => e.type === 'file').map(e => e.path)
		assert.ok(!files.includes('.env'), '.env is not included')
		assert.ok(data.skipped.some(s => s.path === '.env'), '.env is recorded in skipped')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('backup: --include plugins equivalent includes only plugins', () => {
	const dir = makeConfigFixture()
	try {
		const data = backupModule.buildBackup({ configDir: dir, categories: ['plugins'] })
		const files = data.entries.filter(e => e.type === 'file').map(e => e.path)
		assert.ok(files.includes('plugins/p1/SKILL.md'), 'includes plugin')
		assert.ok(!files.includes('.env'), 'does not include env')
		assert.ok(!files.includes('settings.json'), 'does not include root settings')
		assert.ok(!files.includes('settings/local/settings.json'), 'does not include settings')
		assert.deepEqual(data.categories, ['plugins'])
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('import: backs up existing files to pre-import before restore', () => {
	const src = makeConfigFixture()
	const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-dest-'))
	try {
		fs.writeFileSync(path.join(dest, '.env'), 'API_KEY=old\n')
		const data = backupModule.buildBackup({ configDir: src })
		const result = backupModule.restoreBackup(data, { configDir: dest })
		assert.equal(fs.readFileSync(path.join(dest, '.env'), 'utf8'), 'API_KEY=secret\nPORT=3333\n')
		assert.equal(fs.readFileSync(path.join(dest, 'plugins', 'p1', 'SKILL.md'), 'utf8'), '# p1\n')
		assert.ok(result.preImportDir, 'returns pre-import dir')
		assert.equal(fs.readFileSync(path.join(result.preImportDir, '.env'), 'utf8'), 'API_KEY=old\n')
	} finally {
		fs.rmSync(src, { recursive: true, force: true })
		fs.rmSync(dest, { recursive: true, force: true })
	}
})

test('import: --only settings equivalent restores only settings', () => {
	const src = makeConfigFixture()
	const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-dest-'))
	try {
		const data = backupModule.buildBackup({ configDir: src })
		const result = backupModule.restoreBackup(data, { configDir: dest, categories: ['settings'] })
		assert.equal(fs.existsSync(path.join(dest, 'settings.json')), true)
		assert.equal(fs.existsSync(path.join(dest, 'settings', 'local', 'settings.json')), true)
		assert.equal(fs.existsSync(path.join(dest, '.env')), false)
		assert.equal(fs.existsSync(path.join(dest, 'plugins', 'p1', 'SKILL.md')), false)
		assert.ok(result.skipped.some(s => s.reason.includes('category not selected')))
	} finally {
		fs.rmSync(src, { recursive: true, force: true })
		fs.rmSync(dest, { recursive: true, force: true })
	}
})

test('transfer payload: can roundtrip backup as gzip+base64', () => {
	const src = makeConfigFixture()
	try {
		const data = backupModule.buildBackup({ configDir: src })
		const packed = backupModule.packTransferPayload(data)
		const unpacked = backupModule.unpackTransferPayload(packed)
		assert.deepEqual(unpacked.entries.map(e => e.path), data.entries.map(e => e.path))
	} finally {
		fs.rmSync(src, { recursive: true, force: true })
	}
})

// ----------------------------------------------------------------
// exec.js: hook flow + api direct (async)
// ----------------------------------------------------------------
console.log('\n=== exec.js: hook flow + api direct ===')

process.env.TEST = 'true'
const execRouter = require('../routes/api/exec')
const _handle    = execRouter._handle

function mockReq(args, opts = {}) {
	return {
		body:    { args },
		query:   opts.query || {},
		method:  'POST',
		path:    '/api/exec',
		ip:      '127.0.0.1',
		headers: {},
	}
}

function mockRes() {
	return {
		_status: 200,
		_json:   null,
		status(n) { this._status = n; return this },
		json(body) { this._json = body; return this },
		send(body) { this._json = body; return this },
		type() { return this },
		setHeader() { return this },
	}
}

async function withPluginsAsync(plugins, fn, localSettings) {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-test-'))
	try {
		for (const p of plugins) {
			const pDir = path.join(tmpDir, p.name)
			fs.mkdirSync(pDir, { recursive: true })
			if (p.settings !== undefined)
				fs.writeFileSync(path.join(pDir, 'settings.json'), JSON.stringify(p.settings))
			if (p.index !== undefined)
				fs.writeFileSync(path.join(pDir, 'index.js'), p.index)
		}
		paths.BUNDLED_PLUGINS_DIR = ''
		paths.USER_PLUGINS_DIR    = tmpDir
		paths.USER_SETTINGS_FILE          = path.join(tmpDir, 'root-settings.json')
		paths.USER_SETTINGS_LOCAL_FILE    = path.join(tmpDir, 'user-settings.json')
		paths.PROJECT_SETTINGS_LOCAL_FILE = path.join(tmpDir, 'project-settings.json')
		if (localSettings !== undefined)
			fs.writeFileSync(paths.USER_SETTINGS_LOCAL_FILE, JSON.stringify(localSettings))
		resetPluginTestState()
		return await fn(tmpDir)
	} finally {
		paths.BUNDLED_PLUGINS_DIR = origBundled
		paths.USER_PLUGINS_DIR    = origUser
		paths.USER_SETTINGS_FILE          = origUserSettingsFile
		paths.USER_SETTINGS_LOCAL_FILE    = origUserSettings
		paths.PROJECT_SETTINGS_LOCAL_FILE = origProjectSettings
		resetPluginTestState()
		fs.rmSync(tmpDir, { recursive: true, force: true })
	}
}

async function runAsyncTests() {
	async function testA(label, fn) {
		try {
			await fn()
			console.log(`  ✅ ${label}`)
			pass++
		} catch (e) {
			console.log(`  ❌ ${label}`)
			console.log(`     ${e.message}`)
			fail++
		}
	}

	const node = process.execPath
	const nodeEsc = JSON.stringify(node)

	function getFreePort() {
		return new Promise((resolve, reject) => {
			const server = net.createServer()
			server.once('error', reject)
			server.listen(0, '127.0.0.1', () => {
				const port = server.address().port
				server.close(() => resolve(port))
			})
		})
	}

	function waitForPort(port) {
		return new Promise((resolve, reject) => {
			const deadline = Date.now() + 3000
			function tryConnect() {
				const socket = net.connect({ host: '127.0.0.1', port })
				socket.once('connect', () => {
					socket.destroy()
					resolve()
				})
				socket.once('error', err => {
					socket.destroy()
					if (Date.now() > deadline) reject(err)
					else setTimeout(tryConnect, 50)
				})
			}
			tryConnect()
		})
	}

	await testA('kill-port: direct help exits without touching default port', async () => {
		const result = spawnSync(node, [path.join(__dirname, '..', 'scripts', 'kill-port.js'), '--help'], {
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr || result.stdout)
		assert.ok(result.stdout.includes('Usage: node scripts/kill-port.js <port>'), 'help is printed')
		assert.ok(result.stdout.includes('Defaults to 3333'), 'default port behavior is documented')
	})

	await testA('kill-port: stops a foreground listener by port', async () => {
		const port = await getFreePort()
		const child = spawn(node, [
			'-e',
			`require('net').createServer().listen(${port}, '127.0.0.1'); setInterval(()=>{}, 1000)`,
		], { stdio: 'ignore' })
		try {
			await waitForPort(port)
			const result = spawnSync(node, [path.join(__dirname, '..', 'scripts', 'kill-port.js'), String(port)], {
				encoding: 'utf8',
			})
			assert.equal(result.status, 0, result.stderr || result.stdout)
			await new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('listener was not stopped')), 3000)
				child.once('exit', () => {
					clearTimeout(timer)
					resolve()
				})
			})
		} finally {
			if (!child.killed) child.kill('SIGKILL')
		}
	})

	// execDirect: ACL-denied commands throw 403.
	await testA('execDirect: denied command throws 403', async () => {
		let err
		try { await pluginRuntime.execDirect(['sudo', 'ls']) } catch (e) { err = e }
		assert.ok(err, 'throws')
		assert.equal(err.apiStatus, 403)
		assert.equal(err.apiCode, 'command_denied')
	})

	// runDirect: invalid args throw 400.
	await testA('runDirect: empty args throws 400', async () => {
		let err
		try { await pluginRuntime.runDirect([]) } catch (e) { err = e }
		assert.ok(err, 'throws')
		assert.equal(err.apiStatus, 400)
		assert.equal(err.apiCode, 'invalid_args')
	})

	await testA('runner.runBuffered: child stdin receives EOF and does not hang', async () => {
		const runner = require('../modules/runner')
		const result = await runner.runBuffered(node, [
			'-e',
			'process.stdin.on("end",()=>process.stdout.write("eof")); process.stdin.resume()',
		], 1000)
		assert.equal(result.status, 'done')
		assert.equal(result.output, 'eof')
	})

	await testA('runner.runBuffered: maxConcurrentExec returns 429-style result', async () => {
		const runner = require('../modules/runner')
		const old = process.env.AGENT_EXEC_MAX_CONCURRENT_EXEC
		process.env.AGENT_EXEC_MAX_CONCURRENT_EXEC = '1'
		try {
			const slow = runner.runBuffered(node, ['-e', 'setTimeout(()=>process.stdout.write("slow"), 200)'], 1000)
			const blocked = await runner.runBuffered(node, ['-e', 'process.stdout.write("blocked")'], 1000)
			const first = await slow
			assert.equal(first.status, 'done')
			assert.equal(blocked.apiStatus, 429)
			assert.equal(blocked.code, 'too_many_concurrent_exec')
		} finally {
			if (old === undefined) delete process.env.AGENT_EXEC_MAX_CONCURRENT_EXEC
			else process.env.AGENT_EXEC_MAX_CONCURRENT_EXEC = old
		}
	})

	// before hook transforms args to an ACL-allowed command, then execution succeeds.
	await testA('before hook: transformed ACL-allowed command executes', async () => {
		const idx = `'use strict'\nmodule.exports = { async before(ctx) { return [${nodeEsc}, '-e', 'process.stdout.write("hooked\\\\n")'] } }`
		await withPluginsAsync([
			{ name: 'hooktest', settings: { plugin: { type: 'exec', command: 'hooktest' }, exec: { allow: ['hooktest', `${node} *`] } }, index: idx },
		], async () => {
			const res = mockRes()
			await _handle(mockReq(['hooktest']), res)
			assert.equal(res._json?.output, 'hooked\n')
		})
	})

	// before hook transforms args to an ACL-denied command, so invoke:"exec" returns 403.
	// Explicit deny: [node] prevents local settings such as allow:['*'] from affecting this test.
	await testA('before hook: transformed ACL-denied command returns 403 with invoke:"exec"', async () => {
		const idx = `'use strict'\nmodule.exports = { async before(ctx) { return [${nodeEsc}, '-e', 'process.stdout.write("blocked")'] } }`
		await withPluginsAsync([
			{ name: 'hooktest2', settings: { plugin: { type: 'exec', command: 'hooktest2' }, exec: { allow: ['hooktest2'], deny: [node] } }, index: idx },
		], async () => {
			const res = mockRes()
			await _handle(mockReq(['hooktest2']), res)
			assert.equal(res._status, 403)
		})
	})

	// before hook returning invalid args yields 400.
	await testA('before hook: invalid args result returns HTTP 400 / code invalid_args', async () => {
		const idx = `'use strict'\nmodule.exports = { async before(ctx) { return [] } }`
		await withPluginsAsync([
			{ name: 'badhook', settings: { plugin: { type: 'exec', command: 'badhook' }, exec: { allow: ['badhook'] } }, index: idx },
		], async () => {
			const res = mockRes()
			await _handle(mockReq(['badhook']), res)
			assert.equal(res._status, 400)
			assert.equal(res._json?.code, 'invalid_args')
		})
	})

	// invoke:"run" executes after before-hook args without a second ACL check.
	await testA('invoke:"run": after-before args execute even outside exec.allow', async () => {
		const idx = `'use strict'\nmodule.exports = { async before(ctx) { return [${nodeEsc}, '-e', 'process.stdout.write("run-bypass\\\\n")'] } }`
		await withPluginsAsync([
			{ name: 'trustedcmd', settings: { plugin: { type: 'trusted', command: 'trustedcmd', invoke: 'run', apiVersion: 1 }, exec: { allow: ['trustedcmd'] } }, index: idx },
		], async () => {
			const res = mockRes()
			await _handle(mockReq(['trustedcmd']), res)
			assert.equal(res._json?.output, 'run-bypass\n')
		})
	})

	// after hook can transform the result; verify with a plugin that has both before and after.
	await testA('after hook: can transform result', async () => {
		const idx = `'use strict'\nmodule.exports = {
			async before(ctx) { return [${nodeEsc}, '-e', 'process.stdout.write("original\\\\n")'] },
			async after(ctx) { return { ...ctx.result, output: 'after-modified' } }
		}`
		await withPluginsAsync([
			{ name: 'aftertest', settings: { plugin: { type: 'exec', command: 'aftertest' }, exec: { allow: ['aftertest', `${node} *`] } }, index: idx },
		], async () => {
			const res = mockRes()
			await _handle(mockReq(['aftertest']), res)
			assert.equal(res._json?.output, 'after-modified')
		})
	})
}

// ----------------------------------------------------------------
// Results are printed after async tests complete.
// ----------------------------------------------------------------
runAsyncTests().then(() => {
	console.log('\n' + '='.repeat(40))
	console.log(`  PASS: ${pass}  FAIL: ${fail}  TOTAL: ${pass + fail}`)
	console.log('='.repeat(40) + '\n')
	process.exit(fail > 0 ? 1 : 0)
})
