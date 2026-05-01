#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const paths = require('../modules/paths')
const pluginControl = require('../modules/plugin-control')
const { parseArgs } = require('../modules/parse-args')
const { cliName } = require('./cli-name')

const RESERVED = new Set(['exec', 'acl', 'plugins', 'skills', 'private', 'ping', 'command'])
const VALID_TYPES = new Set(['skill', 'exec', 'trusted', 'system'])
const VALID_INVOKES = new Set(['exec', 'run'])

function readJson(file) {
	if (!fs.existsSync(file)) return { ok: true, data: {}, missing: true }
	try {
		return { ok: true, data: JSON.parse(fs.readFileSync(file, 'utf8')), missing: false }
	} catch (e) {
		return { ok: false, data: null, error: e.message, missing: false }
	}
}

function isExecutable(file) {
	try {
		fs.accessSync(file, fs.constants.X_OK)
		return true
	} catch {
		return false
	}
}

function commandExists(command) {
	if (!command || typeof command !== 'string') return false
	if (command.includes('/') || command.includes('\\')) return isExecutable(command)

	const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
	const exts = process.platform === 'win32'
		? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
		: ['']

	for (const dir of dirs) {
		for (const ext of exts) {
			if (isExecutable(path.join(dir, command + ext))) return true
		}
	}
	return false
}

function uniqueEffectiveSources(sources) {
	const map = new Map()
	for (const entry of sources) map.set(entry.name, entry)
	return [...map.values()]
}

function add(list, plugin, code, message) {
	list.push({ plugin, code, message })
}

function collectDoctor() {
	let policy
	try {
		policy = pluginControl.readPluginPolicy()
	} catch (e) {
		return {
			policy: null,
			plugins: [],
			errors: [{ plugin: null, code: 'invalid_policy', message: e.message }],
			warnings: [],
		}
	}

	const rawSources = paths.listPluginSources()
	const sources = uniqueEffectiveSources(rawSources)
	const errors = []
	const warnings = []
	const plugins = []
	const commandOwners = new Map()

	for (const entry of sources) {
		const settingsPath = path.join(entry.dir, 'settings.json')
		const indexPath = path.join(entry.dir, 'index.js')
		const skillPath = path.join(entry.dir, 'SKILL.md')
		const publicSkillPath = path.join(entry.dir, 'public', 'SKILL.md')
		const status = pluginControl.pluginStatus(entry.name, policy)
		const json = readJson(settingsPath)
		const summary = {
			name: entry.name,
			source: entry.source,
			dir: entry.dir,
			enabled: status.enabled,
			reason: status.reason,
			type: 'skill',
			command: null,
			invoke: 'exec',
			hasSettings: !json.missing,
			hasIndex: fs.existsSync(indexPath),
			hasSkill: fs.existsSync(skillPath),
			hasPublicSkill: fs.existsSync(publicSkillPath),
			commandAvailable: null,
		}

		if (!json.ok) {
			add(errors, entry.name, 'invalid_settings_json', `settings.json is invalid: ${json.error}`)
			plugins.push(summary)
			continue
		}
		if (json.missing) {
			add(warnings, entry.name, 'missing_settings_json', 'settings.json is missing; plugin is treated as skill-only')
		}

		const def = json.data?.plugin || {}
		const type = def.type || 'skill'
		const invoke = def.invoke || 'exec'
		const command = def.command || null
		summary.type = type
		summary.invoke = invoke
		summary.command = command

		if (!VALID_TYPES.has(type)) {
			add(errors, entry.name, 'unknown_type', `unknown plugin.type "${type}"`)
			plugins.push(summary)
			continue
		}

		if (type === 'system') {
			if (status.enabled) add(warnings, entry.name, 'system_reserved', 'system plugins are reserved in v1 and are not loaded')
			plugins.push(summary)
			continue
		}

		if (type === 'skill') {
			if (command) summary.commandAvailable = commandExists(command)
			if (command && !summary.commandAvailable) {
				add(warnings, entry.name, 'command_not_found', `metadata command "${command}" was not found on PATH`)
			}
			plugins.push(summary)
			continue
		}

		if (RESERVED.has(entry.name)) {
			add(errors, entry.name, 'reserved_name', `plugin name "${entry.name}" is reserved`)
		}
		if (!fs.existsSync(indexPath)) {
			add(warnings, entry.name, 'missing_index_js', `${type} plugin has no index.js and will be skipped`)
		}
		if (!command) {
			add(errors, entry.name, 'missing_command', `${type} plugin is missing plugin.command`)
		} else {
			summary.commandAvailable = commandExists(command)
			if (!summary.commandAvailable) {
				add(warnings, entry.name, 'command_not_found', `plugin.command "${command}" was not found on PATH`)
			}
			if (RESERVED.has(command)) {
				add(errors, entry.name, 'reserved_command', `plugin.command "${command}" is reserved`)
			}
			if (status.enabled) {
				if (commandOwners.has(command)) {
					add(errors, entry.name, 'duplicate_command', `plugin.command "${command}" conflicts with "${commandOwners.get(command)}"`)
				} else {
					commandOwners.set(command, entry.name)
				}
			}
		}

		const apiVersion = def.apiVersion || 1
		if (apiVersion !== 1) {
			add(errors, entry.name, 'unsupported_api_version', `apiVersion ${apiVersion} is not supported`)
		}
		if (!VALID_INVOKES.has(invoke)) {
			add(errors, entry.name, 'unknown_invoke', `unknown invoke "${invoke}"`)
		}
		if (invoke === 'run' && type !== 'trusted') {
			add(errors, entry.name, 'run_requires_trusted', 'invoke:"run" requires type:"trusted"')
		}

		plugins.push(summary)
	}

	const bundledSystem = new Set()
	for (const entry of rawSources) {
		const json = readJson(path.join(entry.dir, 'settings.json'))
		if (json.ok && json.data?.plugin?.type === 'system' && entry.source === 'bundled') {
			bundledSystem.add(entry.name)
		}
	}
	for (const entry of rawSources) {
		if (entry.source === 'user' && bundledSystem.has(entry.name)) {
			add(errors, entry.name, 'system_override', `user plugin overrides bundled system plugin "${entry.name}"`)
		}
	}

	return { policy, plugins, errors, warnings }
}

function printText(result) {
	const { policy, plugins, errors, warnings } = result
	if (policy) console.log(`\nPlugin doctor  mode=${policy.mode}\n`)
	else console.log('\nPlugin doctor\n')

	for (const p of plugins) {
		const state = p.enabled ? 'enabled' : `disabled:${p.reason}`
		const command = p.command ? ` command=${p.command}` : ''
		const available = p.commandAvailable === null ? '' : ` commandOnPath=${p.commandAvailable ? 'yes' : 'no'}`
		console.log(`  ${p.name.padEnd(20)} ${state.padEnd(18)} type=${p.type}${command}${available}`)
	}

	if (warnings.length) {
		console.log('\nWarnings:')
		for (const w of warnings) console.log(`  - ${w.plugin || '-'}: ${w.message}`)
	}
	if (errors.length) {
		console.log('\nErrors:')
		for (const e of errors) console.log(`  - ${e.plugin || '-'}: ${e.message}`)
	}

	console.log(`\nSummary: ${plugins.length} plugin(s), ${warnings.length} warning(s), ${errors.length} error(s)\n`)
}

function runDoctor(options = {}) {
	const result = collectDoctor()
	if (options.json) {
		console.log(JSON.stringify(result, null, 2))
	} else {
		printText(result)
	}
	const hasFailure = result.errors.length > 0 || (options.strict && result.warnings.length > 0)
	return hasFailure ? 1 : 0
}

function main() {
	const { params } = parseArgs(process.argv.slice(2))
	if (params.help || params.h) {
		const bin = cliName()
		console.log(`
Usage: ${bin} plugin doctor [--json] [--strict]

Check plugin policy, startup validation risks, command availability, and plugin files.
This command is read-only.

Options:
  --json     Print machine-readable JSON
  --strict   Exit non-zero on warnings as well as errors

Examples:
  ${bin} plugin doctor
  ${bin} plugin doctor --strict
`)
		process.exit(0)
	}

	process.exit(runDoctor({ json: !!params.json, strict: !!params.strict }))
}

if (require.main === module) main()

module.exports = {
	collectDoctor,
	runDoctor,
	commandExists,
}
