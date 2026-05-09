#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const paths = require('../modules/paths')
const settings = require('../modules/settings')
const pluginControl = require('../modules/plugin-control')
const { cliName } = require('./cli-name')

function help() {
	const bin = cliName()
	console.log(`
Usage: ${bin} acl <subcommand> [options]

Manage exec.allow rules in the primary user settings file.

Subcommands:
  list                 Show effective exec ACL rules and sources
  add <rule>           Add an exec.allow rule to user settings
  remove <rule>        Remove an exec.allow rule from user settings
  remove --contains <text>
                       Remove user exec.allow rules containing text
  doctor               Warn about broad effective allow rules

Options:
  --yes                Confirm non-interactive changes
  --force              Allow broad rule changes in non-interactive use
  --contains <text>    Match user exec.allow rules by substring for remove
  --json               Print machine-readable output
  -h, --help           Show this help

Examples:
  ${bin} acl list
  ${bin} acl add "date"
  ${bin} acl add "codex *" --force --yes
  ${bin} acl remove "date" --yes
  ${bin} acl remove --contains "codex" --yes
  ${bin} acl doctor
`)
}

function readJsonFile(file, fallback = {}) {
	if (!fs.existsSync(file)) return fallback
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'))
	} catch (error) {
		throw new Error(`failed to read ${file}: ${error.message}`)
	}
}

function writeJsonFile(file, data) {
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
	settings._reset?.()
	pluginControl._reset?.()
}

function loadUserSettings() {
	const data = readJsonFile(paths.USER_SETTINGS_FILE, {})
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error(`${paths.USER_SETTINGS_FILE} must contain a JSON object`)
	}
	return data
}

function ensureExecArray(data, key) {
	if (!data.exec || typeof data.exec !== 'object' || Array.isArray(data.exec)) data.exec = {}
	if (!Array.isArray(data.exec[key])) data.exec[key] = []
	return data.exec[key]
}

function sourceData() {
	const sources = []
	const pushFile = (name, file) => {
		sources.push({ name, file, data: readJsonFile(file, {}) })
	}

	pushFile('default', paths.DEFAULT_SETTINGS_FILE)
	for (const entry of pluginControl.activePluginSources()) {
		sources.push({
			name: `plugin:${entry.name}`,
			file: path.join(entry.dir, 'settings.json'),
			data: entry.settings || {},
		})
	}
	pushFile('user', paths.USER_SETTINGS_FILE)
	pushFile('legacy-user-local', paths.USER_SETTINGS_LOCAL_FILE)
	pushFile('project-local', paths.PROJECT_SETTINGS_LOCAL_FILE)
	return sources
}

function effectiveRuleRows(kind) {
	const effective = settings.load()
	const rules = Array.isArray(effective.exec?.[kind]) ? effective.exec[kind] : []
	const sources = sourceData()
	return rules.map(rule => {
		const found = []
		for (const src of sources) {
			const srcRules = src.data?.exec?.[kind]
			if (Array.isArray(srcRules) && srcRules.includes(rule)) found.push(src.name)
		}
		return { rule, sources: found }
	})
}

function classifyRule(rule) {
	if (rule === '*') return 'allow-all'
	if (/^\/.*\/$/.test(rule)) return 'regexp'
	if (rule.includes('*')) return 'glob'
	return 'exact'
}

function isBroad(kind) {
	return kind === 'allow-all' || kind === 'glob' || kind === 'regexp'
}

function warningForRule(rule) {
	const kind = classifyRule(rule)
	if (kind === 'allow-all') return 'allows every command that is not denied'
	if (kind === 'regexp') return 'regexp allow rule; review the match scope carefully'
	if (kind === 'glob') return 'glob allow rule; review the argument scope carefully'
	return null
}

function ruleFromArgs(positional) {
	const rule = positional.join(' ').trim()
	if (!rule) throw new Error('missing ACL rule')
	return rule
}

function parseAclArgs(argv) {
	const params = {}
	const positional = []
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--') {
			positional.push(...argv.slice(i + 1))
			break
		}
		if (arg === '--yes') params.yes = true
		else if (arg === '--force') params.force = true
		else if (arg === '--contains') {
			const value = argv[++i]
			if (!value) throw new Error('--contains requires a value')
			params.contains = value
		}
		else if (arg.startsWith('--contains=')) {
			const value = arg.slice('--contains='.length)
			if (!value) throw new Error('--contains requires a value')
			params.contains = value
		}
		else if (arg === '--json') params.json = true
		else if (arg === '--help') params.help = true
		else if (arg === '-h') params.h = true
		else positional.push(arg)
	}
	return { params, positional }
}

function isYes(value) {
	return String(value || '').trim().toLowerCase() === 'y'
		|| String(value || '').trim().toLowerCase() === 'yes'
}

function askLine(prompt) {
	return new Promise(resolve => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
		rl.question(prompt, answer => {
			rl.close()
			resolve(answer)
		})
	})
}

async function confirmExact(action, rule, opts) {
	if (opts.yes) return
	if (!process.stdin.isTTY) throw new Error(`${action} requires --yes in non-interactive use`)
	const answer = await askLine(`${action} ACL rule "${rule}"? [y/N] `)
	if (!isYes(answer)) throw new Error('cancelled')
}

async function confirmContainsRemove(text, matches, opts) {
	if (!matches.length) return
	if (opts.yes) return
	if (!process.stdin.isTTY) throw new Error(`remove --contains "${text}" requires --yes in non-interactive use`)
	console.error(`Matched ${matches.length} exec.allow rule${matches.length === 1 ? '' : 's'}:\n`)
	for (const rule of matches) console.error(`  - ${rule}`)
	console.error('')
	const answer = await askLine('Remove these rules? [y/N] ')
	if (!isYes(answer)) throw new Error('cancelled')
}

async function confirmBroadAdd(rule, kind, opts) {
	if (opts.force && opts.yes) return
	if (!process.stdin.isTTY) {
		throw new Error(`broad ACL rule "${rule}" requires --force --yes in non-interactive use`)
	}
	console.error('Broad ACL allow rule detected:\n')
	console.error(`  ${rule}\n`)
	if (kind === 'allow-all') {
		console.error('This allows every command that is not denied.')
		console.error('To confirm, type the exact rule.')
		const answer = await askLine('> ')
		if (answer !== rule) throw new Error('cancelled')
		return
	}
	console.error('This may allow destructive, long-running, or interactive operations depending on the command.')
	const answer = await askLine('Add this broad ACL rule? [y/N] ')
	if (!isYes(answer)) throw new Error('cancelled')
}

function emitJson(value) {
	console.log(JSON.stringify(value, null, 2))
}

function fail(error, opts = {}) {
	if (opts.json) {
		emitJson({ ok: false, error: error.message || String(error) })
	} else {
		console.error(error.message || String(error))
	}
	process.exit(1)
}

function list(opts) {
	const allow = effectiveRuleRows('allow')
	const deny = effectiveRuleRows('deny')
	if (opts.json) return emitJson({ ok: true, allow, deny })

	console.log('exec.allow')
	if (!allow.length) console.log('  (none)')
	for (const row of allow) {
		console.log(`  - ${row.rule}`)
		console.log(`    sources: ${row.sources.join(', ') || 'unknown'}`)
	}
	console.log('')
	console.log('exec.deny')
	if (!deny.length) console.log('  (none)')
	for (const row of deny) {
		console.log(`  - ${row.rule}`)
		console.log(`    sources: ${row.sources.join(', ') || 'unknown'}`)
	}
}

async function add(rule, opts) {
	const kind = classifyRule(rule)
	if (isBroad(kind)) await confirmBroadAdd(rule, kind, opts)
	else await confirmExact('Add', rule, opts)

	const data = loadUserSettings()
	const allow = ensureExecArray(data, 'allow')
	const changed = !allow.includes(rule)
	if (changed) allow.push(rule)
	writeJsonFile(paths.USER_SETTINGS_FILE, data)

	const result = {
		ok: true,
		action: 'add',
		rule,
		kind,
		changed,
		file: paths.USER_SETTINGS_FILE,
		warning: warningForRule(rule),
	}
	if (opts.json) return emitJson(result)
	console.log(changed ? `Added exec.allow rule: ${rule}` : `Already present: ${rule}`)
	console.log(`Settings file: ${paths.USER_SETTINGS_FILE}`)
	if (result.warning) console.log(`Warning: ${result.warning}`)
}

async function remove(rule, opts) {
	await confirmExact('Remove', rule, opts)
	const data = loadUserSettings()
	const allow = ensureExecArray(data, 'allow')
	const before = allow.length
	data.exec.allow = allow.filter(item => item !== rule)
	const changed = data.exec.allow.length !== before
	writeJsonFile(paths.USER_SETTINGS_FILE, data)

	const effective = effectiveRuleRows('allow').find(row => row.rule === rule)
	const result = {
		ok: true,
		action: 'remove',
		rule,
		changed,
		file: paths.USER_SETTINGS_FILE,
		stillEffective: !!effective,
		effectiveSources: effective?.sources || [],
	}
	if (opts.json) return emitJson(result)
	if (changed) console.log(`Removed exec.allow rule from user settings: ${rule}`)
	else console.log(`Rule was not present in user settings: ${rule}`)
	if (effective) {
		console.log(`Still effective from: ${effective.sources.join(', ') || 'unknown'}`)
	}
	console.log(`Settings file: ${paths.USER_SETTINGS_FILE}`)
}

async function removeContains(text, opts) {
	const needle = String(text || '').trim()
	if (!needle) throw new Error('--contains requires a non-empty value')
	const data = loadUserSettings()
	const allow = ensureExecArray(data, 'allow')
	const matches = allow.filter(rule => String(rule).includes(needle))
	await confirmContainsRemove(needle, matches, opts)
	if (matches.length) {
		const removeSet = new Set(matches)
		data.exec.allow = allow.filter(rule => !removeSet.has(rule))
		writeJsonFile(paths.USER_SETTINGS_FILE, data)
	}

	const stillEffective = matches.length
		? effectiveRuleRows('allow')
			.filter(row => matches.includes(row.rule))
			.map(row => ({ rule: row.rule, sources: row.sources }))
		: []
	const result = {
		ok: true,
		action: 'remove',
		match: {
			type: 'contains',
			value: needle,
		},
		changed: matches.length > 0,
		removed: matches,
		file: paths.USER_SETTINGS_FILE,
		stillEffective: stillEffective.length > 0,
		effective: stillEffective,
	}
	if (opts.json) return emitJson(result)
	if (matches.length) {
		console.log(`Removed ${matches.length} exec.allow rule${matches.length === 1 ? '' : 's'} from user settings:`)
		for (const rule of matches) console.log(`  - ${rule}`)
	} else {
		console.log(`No user exec.allow rules contained: ${needle}`)
	}
	if (stillEffective.length) {
		console.log('Still effective:')
		for (const row of stillEffective) {
			console.log(`  - ${row.rule}`)
			console.log(`    sources: ${row.sources.join(', ') || 'unknown'}`)
		}
	}
	console.log(`Settings file: ${paths.USER_SETTINGS_FILE}`)
}

function doctor(opts) {
	const allow = effectiveRuleRows('allow')
	const warnings = []
	for (const row of allow) {
		const warning = warningForRule(row.rule)
		if (!warning) continue
		warnings.push({
			rule: row.rule,
			kind: classifyRule(row.rule),
			warning,
			sources: row.sources,
		})
	}
	if (opts.json) return emitJson({ ok: true, warnings })
	if (!warnings.length) {
		console.log('No ACL warnings found.')
		return
	}
	console.log('ACL warnings')
	for (const item of warnings) {
		console.log(`  - ${item.rule}`)
		console.log(`    ${item.warning}`)
		console.log(`    sources: ${item.sources.join(', ') || 'unknown'}`)
	}
}

async function main(argv) {
	const { params, positional } = parseAclArgs(argv)
	const opts = {
		yes: !!params.yes,
		force: !!params.force,
		json: !!params.json,
		contains: params.contains,
	}
	const [command, ...rest] = positional
	if (!command || command === 'help' || params.help || params.h) return help()
	if (command === 'list') return list(opts)
	if (command === 'doctor') return doctor(opts)
	if (command === 'add') return add(ruleFromArgs(rest), opts)
	if (command === 'remove' || command === 'rm') {
		if (opts.contains !== undefined) {
			if (rest.length) throw new Error('remove --contains cannot be combined with a positional rule')
			return removeContains(opts.contains, opts)
		}
		return remove(ruleFromArgs(rest), opts)
	}
	if (opts.contains !== undefined) throw new Error('--contains is only supported with remove')
	throw new Error(`unknown acl subcommand: ${command}`)
}

main(process.argv.slice(2)).catch(error => fail(error, {
	json: process.argv.includes('--json'),
}))
