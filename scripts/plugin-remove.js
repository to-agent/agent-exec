#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { USER_PLUGINS_DIR } = require('../modules/paths')
const { parseArgs } = require('../modules/parse-args')
const { cliName } = require('./cli-name')

const { params } = parseArgs(process.argv.slice(2))

const SAFE_PLUGIN_NAME = /^[a-z0-9][a-z0-9_-]*$/

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

if (params.help || params.h) {
	const bin = cliName()
	console.log(`
Usage: ${bin} plugin remove --name=<name> [--yes]

Remove a user plugin from ~/.to-agent/agent-exec/plugins/.
Run ${bin} restart after removal to fully unload runtime hooks/routes.

Options:
  --name=<name>  Plugin name to remove
  --yes          Skip confirmation prompt

Examples:
  ${bin} plugin remove --name=hermes
  ${bin} plugin remove --name=hermes --yes
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

async function main() {
	let name = params.name

	if (!name) {
		name = await prompt('Plugin name: ')
		if (!name) { console.error('Name is required.'); process.exit(1) }
	}

	validatePluginName(name)

	const pluginDir = path.join(USER_PLUGINS_DIR, name)

	if (!fs.existsSync(pluginDir)) {
		console.error(`Plugin not found: plugins/${name}/`)
		process.exit(1)
	}

	const yes = params.yes === true || params.yes === 'true'

	if (!process.stdin.isTTY && !yes) {
		console.error(`Non-TTY: use --yes to confirm removal of plugins/${name}/`)
		process.exit(1)
	}

	if (!yes) {
		const answer = await prompt(`Remove plugin: plugins/${name}/ ? [y/N]: `)
		if (!isYes(answer)) { console.error('Aborted.'); process.exit(1) }
	}

	fs.rmSync(pluginDir, { recursive: true, force: true })
	console.log(`Removed: ${pluginDir}`)
	console.log('Run: aexec restart  # fully unload runtime hooks/routes')
}

main()
