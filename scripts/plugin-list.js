#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const paths = require('../modules/paths')
const pluginControl = require('../modules/plugin-control')
const { parseArgs } = require('../modules/parse-args')
const { cliName } = require('./cli-name')

const { params } = parseArgs(process.argv.slice(2))

if (params.help || params.h) {
	const bin = cliName()
	console.log(`
Usage: ${bin} plugin list

List all installed plugins.

Shows bundled/user plugins after override resolution, including enabled state.

Examples:
  ${bin} plugin list
`)
	process.exit(0)
}

let policy
try {
	policy = pluginControl.readPluginPolicy()
} catch (e) {
	console.error(e.message)
	process.exit(1)
}

const pluginMap = new Map()
for (const entry of paths.listPluginSources()) {
	pluginMap.set(entry.name, entry)
}
const plugins = [...pluginMap.values()]

if (plugins.length === 0) {
	console.log('No plugins installed.')
	console.log('Run: aexec starterkit')
	process.exit(0)
}

console.log(`\nInstalled plugins (${plugins.length})  mode=${policy.mode}:\n`)
for (const { name, dir, source } of plugins) {
	const skillPath = path.join(dir, 'SKILL.md')
	const hasSkill = fs.existsSync(skillPath)
	const hasPublic = fs.existsSync(path.join(dir, 'public', 'SKILL.md'))
	const status = pluginControl.pluginStatus(name, policy)
	const tags = [
		status.enabled ? 'enabled' : `disabled:${status.reason}`,
		source,
		hasSkill ? 'private' : '',
		hasPublic ? 'public' : '',
	].filter(Boolean).join(', ')
	console.log(`  ${name.padEnd(20)} ${tags}`)
}
console.log('')
