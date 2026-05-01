'use strict'

const fs = require('fs')
const path = require('path')
const paths = require('./paths')

const VALID_MODES = new Set(['auto', 'explicit'])
let _sourceSnapshot = null

function readJson(file) {
	if (!fs.existsSync(file)) return {}
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'))
	} catch (e) {
		throw new Error(`[plugin-control] failed to read ${file}: ${e.message}`)
	}
}

function mergePolicy(base, settings) {
	const plugins = settings.plugins || {}
	const next = {
		mode: base.mode,
		enabled: [...base.enabled],
		disabled: [...base.disabled],
	}
	if (plugins.mode !== undefined) next.mode = plugins.mode
	for (const key of ['enabled', 'disabled']) {
		if (plugins[key] === undefined) continue
		if (!Array.isArray(plugins[key]))
			throw new Error(`[plugin-control] plugins.${key} must be an array of plugin names`)
		for (const name of plugins[key]) {
			if (typeof name !== 'string' || name.trim() === '')
				throw new Error(`[plugin-control] plugins.${key} must be an array of non-empty strings`)
			if (!next[key].includes(name)) next[key].push(name)
		}
	}
	return next
}

function validatePolicy(policy) {
	if (!VALID_MODES.has(policy.mode))
		throw new Error('[plugin-control] plugins.mode must be "auto" or "explicit"')
	return policy
}

function readPluginPolicy() {
	let policy = { mode: 'auto', enabled: [], disabled: [] }
	for (const file of [
		paths.DEFAULT_SETTINGS_FILE,
		paths.USER_SETTINGS_FILE,
		paths.USER_SETTINGS_LOCAL_FILE,
		paths.PROJECT_SETTINGS_LOCAL_FILE,
	]) {
		policy = mergePolicy(policy, readJson(file))
	}
	return validatePolicy(policy)
}

function pluginStatus(name, policy = readPluginPolicy()) {
	if (policy.disabled.includes(name)) return { enabled: false, reason: 'disabled' }
	if (policy.mode === 'explicit' && !policy.enabled.includes(name))
		return { enabled: false, reason: 'not-enabled' }
	return { enabled: true, reason: policy.mode === 'explicit' ? 'enabled' : 'auto' }
}

function isPluginEnabled(name, policy = readPluginPolicy()) {
	return pluginStatus(name, policy).enabled
}

function effectivePluginSourceList(sources = paths.listPluginSources(), policy = readPluginPolicy()) {
	return sources.filter(entry => isPluginEnabled(entry.name, policy))
}

function effectivePluginSources(sources = paths.listPluginSources(), policy = readPluginPolicy()) {
	const map = new Map()
	for (const entry of effectivePluginSourceList(sources, policy)) {
		map.set(entry.name, entry)
	}
	return [...map.values()]
}

function effectivePluginMap(sources = paths.listPluginSources()) {
	const map = new Map()
	for (const { name, dir } of effectivePluginSources(sources)) {
		map.set(name, dir)
	}
	return map
}

function snapshotEntry(entry) {
	const stat = fs.statSync(entry.dir)
	const settingsPath = path.join(entry.dir, 'settings.json')
	let snapshotFd = null
	try { snapshotFd = fs.openSync(entry.dir, 'r') } catch {}
	return {
		...entry,
		snapshotFd,
		snapshotDev: stat.dev,
		snapshotIno: stat.ino,
		snapshotCtimeMs: stat.ctimeMs,
		snapshotMtimeMs: stat.mtimeMs,
		settings: fs.existsSync(settingsPath) ? readJson(settingsPath) : {},
	}
}

function freezePluginSources(sources = paths.listPluginSources()) {
	if (!_sourceSnapshot) _sourceSnapshot = effectivePluginSourceList(sources).map(snapshotEntry)
	return _sourceSnapshot
}

function isSnapshotSourceActive(entry, policy = readPluginPolicy()) {
	if (!entry || !fs.existsSync(entry.dir)) return false
	if (entry.snapshotDev !== undefined && entry.snapshotIno !== undefined) {
		const stat = fs.statSync(entry.dir)
		const original = entry.snapshotFd !== null && entry.snapshotFd !== undefined
			? fs.fstatSync(entry.snapshotFd)
			: entry
		if (stat.dev !== original.dev || stat.ino !== original.ino) return false
		if (stat.ctimeMs !== entry.snapshotCtimeMs || stat.mtimeMs !== entry.snapshotMtimeMs) return false
	}
	return isPluginEnabled(entry.name, policy)
}

function activePluginSourceList(sources) {
	const policy = readPluginPolicy()
	return freezePluginSources(sources).filter(entry => isSnapshotSourceActive(entry, policy))
}

function activePluginSources(sources) {
	const map = new Map()
	for (const entry of activePluginSourceList(sources)) {
		map.set(entry.name, entry)
	}
	return [...map.values()]
}

function activePluginMap() {
	const map = new Map()
	for (const { name, dir } of activePluginSources()) {
		map.set(name, dir)
	}
	return map
}

function isSnapshotPluginActive(name, dir) {
	const entry = freezePluginSources().find(s => s.name === name && s.dir === dir)
	if (!entry) return false
	return isSnapshotSourceActive(entry)
}

function _reset() {
	if (_sourceSnapshot) {
		for (const entry of _sourceSnapshot) {
			if (entry.snapshotFd !== null && entry.snapshotFd !== undefined) {
				try { fs.closeSync(entry.snapshotFd) } catch {}
			}
		}
	}
	_sourceSnapshot = null
}

module.exports = {
	readPluginPolicy,
	pluginStatus,
	isPluginEnabled,
	effectivePluginSourceList,
	effectivePluginSources,
	effectivePluginMap,
	freezePluginSources,
	activePluginSourceList,
	activePluginSources,
	activePluginMap,
	isSnapshotPluginActive,
	_reset,
}
