#!/usr/bin/env node
'use strict'

/**
 * plugin-create.js — Generate a plugin skeleton
 *
 * Usage:
 *   aexec plugin create --name=hermes
 *   aexec plugin create --name=hermes --type=exec
 *   aexec plugin create --name=hermes --type=trusted --invoke=run
 *   aexec plugin create --name=claude-code --command=claude --type=skill
 *   aexec plugin create --from=claude
 *   aexec plugin create --from=claude --ai=claude
 *
 * Types:
 *   exec    (default) — SKILL.md + references/ + settings.json + install.sh + index.js
 *   skill             — SKILL.md + references/ + settings.json (no index.js)
 *   trusted           — same as exec, api.run available
 *   full              — [deprecated] alias for exec
 */

const fs = require('fs')
const path = require('path')
const { USER_PLUGINS_DIR } = require('../modules/paths')
const { parseArgs } = require('../modules/parse-args')
const { writeScannedPlugin, writeScannedPluginWithAi } = require('../modules/plugin-gen')
const { cliName } = require('./cli-name')

const { params } = parseArgs(process.argv.slice(2))
const silent = params.silent === true || params.silent === 'true' || params.quiet === true || params.quiet === 'true'

const SAFE_PLUGIN_NAME = /^[a-z0-9][a-z0-9_-]*$/
const VALID_TYPES = ['skill', 'exec', 'trusted']
const UNSAFE_COMMAND_CHARS = /[\s"'`$;&|<>()\[\]{}]/

function formatJson(value) {
	return JSON.stringify(value, null, 2) + '\n'
}

function printGeneratedSettings(pluginDir, settings) {
	if (silent) return
	console.log(`\nGenerated settings.json (review before restart):`)
	console.log(`  ${path.join(pluginDir, 'settings.json')}`)
	console.log(formatJson(settings))
	printAllowWarnings(settings)
}

function printAllowWarnings(settings) {
	const allow = settings.exec?.allow || []
	for (const rule of allow) {
		if (typeof rule !== 'string' || !rule.includes('*')) continue
		if (rule === '*') {
			console.log('⚠️  Generated rule "*" is a broad wildcard ACL rule.')
			console.log('   Review the plugin skill and command behavior before restart.')
			continue
		}
		console.log(`⚠️  Generated rule "${rule}" is a broad wildcard ACL rule.`)
		console.log('   Review the plugin skill and command behavior before restart.')
	}
}

function validatePluginName(name) {
	if (!SAFE_PLUGIN_NAME.test(name)) {
		console.error(`Invalid plugin name: "${name}". Use only lowercase letters, digits, hyphens, underscores (start with letter/digit).`)
		process.exit(1)
	}
	const resolved = path.resolve(path.join(USER_PLUGINS_DIR, name))
	if (!resolved.startsWith(path.resolve(USER_PLUGINS_DIR) + path.sep)) {
		console.error(`Path traversal detected in plugin name: "${name}"`)
		process.exit(1)
	}
}

function validateCommand(command) {
	if (!command || UNSAFE_COMMAND_CHARS.test(command)) {
		console.error(`Invalid command: "${command}". Use a single executable name or path without spaces or shell metacharacters.`)
		process.exit(1)
	}
}

if (params.help || params.h) {
	const bin = cliName()
	console.log(`
Usage: ${bin} plugin create [options]

Scaffold a plugin under ~/.to-agent/agent-exec/plugins/.
Run ${bin} restart after creating or editing plugins to load runtime hooks/routes.

Options:
  --name=<name>      Plugin name
  --command=<cmd>    Command name (default: same as --name or --from)
  --type=<type>      Plugin type: skill | exec | trusted  (default: exec)
  --invoke=<invoke>  exec | run  (trusted only, default: exec)
  --from=<cmd>       Auto-generate from CLI --help output
  --ai=<tool>        Use AI to generate documentation (e.g. --ai=claude)
  --silent, --quiet  Do not print generated settings.json contents
  -h, --help         Show this help

Generated ACL:
  Manual mode includes only "<cmd> --help" and "<cmd> --version".
  --from mode includes the detected help/version commands only.
  Add broader command rules manually after reviewing the generated skill.
  Review generated exec.allow rules before restart.

Types:
  exec     SKILL.md + references/ + settings.json + install.sh + index.js
  skill    SKILL.md + references/ + settings.json  (no index.js)
  trusted  Same as exec — api.run() available in hooks and routes
  full     Deprecated alias for exec

Examples:
  ${bin} plugin create --name=hermes
  ${bin} plugin create --name=claude-code --command=claude --type=skill
  ${bin} plugin create --name=sandbox --type=trusted --invoke=run
  ${bin} plugin create --from=claude
  ${bin} plugin create --from=claude --ai=claude
  ${bin} plugin create --from=claude --silent
`)
	process.exit(0)
}

async function prompt(question) {
	if (!process.stdin.isTTY) return ''
	const readline = require('readline')
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
	return new Promise(resolve => {
		let done = false
		const finish = ans => { if (!done) { done = true; rl.close(); resolve(ans) } }
		rl.question(question, ans => finish(ans.trim()))
		rl.on('close', () => finish(''))
	})
}

function isYes(answer) {
	return /^y(es)?$/i.test((answer || '').trim())
}

function defaultSelfDocAllow(command) {
	return [`${command} --help`, `${command} --version`]
}

function allowFromScan(command, scan) {
	const allow = []
	for (const args of [scan.helpArgs, scan.versionArgs]) {
		if (!Array.isArray(args) || args.length === 0) continue
		allow.push([command, ...args].join(' '))
	}
	return Array.from(new Set(allow))
}

// Build settings.json plugin block and minimal self-documenting exec.allow by plugin type.
function buildSettingsJson(type, command, invoke, allow = defaultSelfDocAllow(command)) {
	const comments = {
		"_": "ACL patterns — string: exact match / glob: 'cmd *' / regexp: '/pattern/'. deny is evaluated before allow.",
		"_security": [
			"generated ACL rules are intentionally narrow.",
			"manual mode permits only <cmd> --help and <cmd> --version.",
			"scan mode permits only detected help/version commands.",
			"do not add wildcard rules such as '*' or 'cmd *' unless the command is reviewed and intentionally trusted.",
			"run aexec plugin doctor before restart to detect broad wildcard rules.",
			"deny argument variants that bypass allow patterns.",
			"see default/settings.json for deny pattern examples.",
			"docs: https://to-agent.com/products/agent-exec/#acl"
		],
	}

	if (type === 'skill') {
		return {
			...comments,
			plugin: { type: 'skill', command },
			exec: { allow },
		}
	}

	if (type === 'exec') {
		return {
			...comments,
			plugin: { type: 'exec', command, apiVersion: 1, settings: {} },
			exec: { allow },
		}
	}

	// trusted
	return {
		...comments,
		plugin: { type: 'trusted', command, invoke, apiVersion: 1, settings: {} },
		exec: { allow },
	}
}

function buildIndexJs(name, command, type) {
	const runLine = type === 'trusted'
		? `  //   // api.exec(['cmd', ...args])  — ACL-checked execution\n  //   // api.run(['cmd', ...args])   — direct execution (this plugin is trusted)`
		: `  //   // api.exec(['cmd', ...args])  — ACL-checked execution`
	return `'use strict'
// ${name} plugin — agent-exec integration

module.exports = {
  // routes(router, api) {
  //   // Mounted at /api/command/${name}/*
${runLine}
  //   router.get('/status', async (req, res) => {
  //     res.json(await api.exec(['${command}', '--version']))
  //   })
  // },

  // async before(ctx, api) {
  //   // ctx.args, ctx.originalArgs, ctx.plugin, ctx.request
  //   return ctx.args  // return modified args, or undefined to keep original
  // },

  // async after(ctx, api) {
  //   // ctx.result contains the execution result
  //   return ctx.result  // return modified result, or undefined to keep original
  // },
}
`
}

async function main() {
	const from    = params.from    || null
	let   name    = params.name    || (from ? from : null)
	let   type    = params.type    || null
	const command = params.command || null
	let   invoke  = params.invoke  || 'exec'

	// --type=full: deprecated alias
	if (type === 'full') {
		console.warn('[deprecated] --type=full is deprecated. Use --type=exec.')
		type = 'exec'
	}

	// --ai validation
	const aiRaw = params.ai
	if (aiRaw === true) {
		console.error('Error: --ai requires a value. Example: --ai=claude')
		process.exit(1)
	}
	const aiTool = aiRaw || null

	if (!name) {
		name = await prompt('Plugin name: ')
		if (!name) { console.error('Name is required.'); process.exit(1) }
	}

	validatePluginName(name)

	// Ask for type only in manual interactive mode.
	if (!type && !from) {
		const t = await prompt('Type [skill/exec/trusted] (default: exec): ')
		if (['skill', 'exec', 'trusted'].includes(t)) type = t
	}
	if (!type) type = 'exec'

	// type validation
	if (!VALID_TYPES.includes(type)) {
		console.error(`--type must be one of: ${VALID_TYPES.join(', ')}`)
		process.exit(1)
	}

	// --invoke validation
	if (!['exec', 'run'].includes(invoke)) {
		console.error('--invoke must be "exec" or "run"')
		process.exit(1)
	}
	if (invoke === 'run' && type !== 'trusted') {
		console.error('--invoke=run is only valid with --type=trusted')
		process.exit(1)
	}

	if (from) {
		validateCommand(from)
		validateCommand(command || from)
		await runFromScan(name, type, from, command || from, invoke, aiTool)
	} else {
		validateCommand(command || name)
		await run(name, type, command || name, invoke)
	}
}

// ---------------------------------------------------------------------------
// --from: auto-generate from CLI --help
// ---------------------------------------------------------------------------

async function runFromScan(name, type, from, command, invoke, aiTool) {
	const { scanCli } = require('../modules/scan-cli')

	const pluginDir = path.join(USER_PLUGINS_DIR, name)

	if (fs.existsSync(pluginDir)) {
		if (!process.stdin.isTTY) {
			console.error(`Plugin already exists: plugins/${name}/`)
			process.exit(1)
		}
		const answer = await prompt(`Plugin already exists: plugins/${name}/ Overwrite? [y/N]: `)
		if (!isYes(answer)) { console.error('Aborted.'); process.exit(1) }
		fs.rmSync(pluginDir, { recursive: true, force: true })
	}

	console.log(`\nScanning \`${from} --help\` recursively...`)
	const scan = scanCli(from)
	if (!scan.helpText.trim()) {
		console.error(`No help output from command: ${from}`)
		console.error('Check that the command is installed and available on PATH.')
		process.exit(1)
	}

	// plugin-gen still uses skill/full; pass only whether JS runtime files are needed.
	const genType = type === 'skill' ? 'skill' : 'full'
	let refs
	if (aiTool) {
		console.log(`\nGenerating with ${aiTool}...`)
		refs = await writeScannedPluginWithAi(pluginDir, name, from, scan, genType, aiTool)
	} else {
		refs = writeScannedPlugin(pluginDir, name, from, scan, genType)
	}

	// ---- settings.json ----
	const settings = buildSettingsJson(type, command, invoke, allowFromScan(command, scan))
	fs.writeFileSync(
		path.join(pluginDir, 'settings.json'),
		formatJson(settings)
	)

	if (type !== 'skill') {
		// ---- install.sh ----
		fs.writeFileSync(path.join(pluginDir, 'install.sh'), `#!/bin/bash
# Install ${from}

set -e

if command -v ${from} &>/dev/null; then
  echo "${from} is already installed: $(${from} --version 2>/dev/null || echo 'unknown version')"
  exit 0
fi

echo "Installing ${from}..."
# TODO: add install command here
# npm install -g ${from}
# pip install ${from}

echo "Done. Verify with: ${from} --version"
`, { mode: 0o755 })

		// ---- index.js ----
		fs.writeFileSync(path.join(pluginDir, 'index.js'), buildIndexJs(name, command, type))
	}

	// ---- Summary ----
	const refFiles = ['usage.md', ...refs.map(r => r.filename)]
	console.log(`\nCreated plugin: ${pluginDir}/`)
	console.log('')
	const listed = type !== 'skill'
		? ['SKILL.md', ...refFiles.map(f => `references/${f}`), 'settings.json', 'install.sh', 'index.js']
		: ['SKILL.md', ...refFiles.map(f => `references/${f}`), 'settings.json']
	listed.forEach(f => console.log(`  ${pluginDir}/${f}`))
	printGeneratedSettings(pluginDir, settings)
	console.log('')
	console.log(`Next steps:`)
	console.log(`  1. Review ${pluginDir}/SKILL.md`)
	if (type !== 'skill') {
		console.log(`  2. Edit ${pluginDir}/install.sh`)
		console.log(`  3. Review ${pluginDir}/settings.json (plugin.command, exec.allow)`)
		console.log(`  4. aexec restart (or aexec dev during development)`)
	} else {
		console.log(`  2. Review ${pluginDir}/settings.json`)
		console.log(`  3. aexec restart (or aexec dev during development)`)
	}
}

// ---------------------------------------------------------------------------
// Manual template (no --from)
// ---------------------------------------------------------------------------

async function run(name, type, command, invoke) {
	const pluginDir = path.join(USER_PLUGINS_DIR, name)

	if (fs.existsSync(pluginDir)) {
		if (!process.stdin.isTTY) {
			console.error(`Plugin already exists: plugins/${name}/`)
			process.exit(1)
		}

		const answer = await prompt(`Plugin already exists: plugins/${name}/ Overwrite? [y/N]: `)
		if (!isYes(answer)) {
			console.error('Aborted.')
			process.exit(1)
		}

		fs.rmSync(pluginDir, { recursive: true, force: true })
	}

	// ---- Create directories ----
	fs.mkdirSync(path.join(pluginDir, 'references'), { recursive: true })

	// ---- SKILL.md ----
	fs.writeFileSync(path.join(pluginDir, 'SKILL.md'), `# SKILL: ${name}
# Endpoint: POST /api/exec
# Description: ${name} — describe what this plugin does

## Overview

Run \`${command}\` commands via \`POST /api/exec\`:

\`\`\`json
{"args": ["${command}", "<subcommand>", "<args...>"]}
\`\`\`

## Request

The first JSON block in this section is the canonical request body for converters.

Request body:

\`\`\`json
{"args": ["${command}", "--help"]}
\`\`\`
<!-- ae:prev request.body -> all -->

## Key Commands

\`\`\`json
{"args": ["${command}", "--version"]}
\`\`\`

\`\`\`json
{"args": ["${command}", "--help"]}
\`\`\`

## Agent Usage

- Prefer non-interactive flags if \`${command}\` provides them.
- Check \`GET /api/acl\` before calling \`POST /api/exec\`.
- Avoid long-running interactive commands unless the CLI documents a non-interactive mode.
- If the command waits for stdin or confirmation, use documented non-interactive flags instead of interactive mode.

## Known Gotchas

- Verify important flags against official documentation.
- Do not assume approval, auto-yes, resume, or session flags unless they are documented in the reference files.

## Detailed Documentation

- [usage](references/usage.md) — Full reference

## Notes

- Requires \`${command}\` to be installed
- Run \`${command} --version\` to verify installation
${type !== 'skill' ? `- Install: see \`install.sh\` in this plugin` : ''}
`)

	// ---- references/usage.md ----
	fs.writeFileSync(path.join(pluginDir, 'references', 'usage.md'), `# ${name} — Usage Reference

## Basic Usage

\`\`\`bash
${command} --version
${command} --help
\`\`\`

## Useful One-liners

\`\`\`json
{"args": ["${command}", "--version"]}
\`\`\`

\`\`\`json
{"args": ["${command}", "--help"]}
\`\`\`
`)

	// ---- settings.json ----
	const settings = buildSettingsJson(type, command, invoke)
	fs.writeFileSync(
		path.join(pluginDir, 'settings.json'),
		formatJson(settings)
	)

	if (type !== 'skill') {
		// ---- install.sh ----
		fs.writeFileSync(path.join(pluginDir, 'install.sh'), `#!/bin/bash
# Install ${command}

set -e

if command -v ${command} &>/dev/null; then
  echo "${command} is already installed: $(${command} --version 2>/dev/null || echo 'unknown version')"
  exit 0
fi

echo "Installing ${command}..."
# TODO: add install command here
# npm install -g ${command}
# pip install ${command}

echo "Done. Verify with: ${command} --version"
`, { mode: 0o755 })

		// ---- index.js ----
		fs.writeFileSync(path.join(pluginDir, 'index.js'), buildIndexJs(name, command, type))
	}

	// ---- Summary ----
	console.log(`\nCreated plugin: ${pluginDir}/`)
	console.log('')
	const files = type !== 'skill'
		? ['SKILL.md', 'references/usage.md', 'settings.json', 'install.sh', 'index.js']
		: ['SKILL.md', 'references/usage.md', 'settings.json']
	files.forEach(f => console.log(`  ${pluginDir}/${f}`))
	printGeneratedSettings(pluginDir, settings)
	console.log('')
	console.log(`Next steps:`)
	console.log(`  1. Edit ${pluginDir}/SKILL.md`)
	if (type !== 'skill') {
		console.log(`  2. Edit ${pluginDir}/install.sh`)
		console.log(`  3. Review ${pluginDir}/settings.json (plugin.command, exec.allow)`)
		console.log(`  4. aexec restart (or aexec dev during development)`)
	} else {
		console.log(`  2. Review ${pluginDir}/settings.json`)
		console.log(`  3. aexec restart (or aexec dev during development)`)
	}
}

main()
