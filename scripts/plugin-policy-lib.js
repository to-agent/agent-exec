'use strict'

const fs = require('fs')
const path = require('path')
const paths = require('../modules/paths')

function readSettings() {
	if (!fs.existsSync(paths.USER_SETTINGS_LOCAL_FILE)) return {}
	return JSON.parse(fs.readFileSync(paths.USER_SETTINGS_LOCAL_FILE, 'utf8'))
}

function writeSettings(settings) {
	fs.mkdirSync(path.dirname(paths.USER_SETTINGS_LOCAL_FILE), { recursive: true })
	fs.writeFileSync(paths.USER_SETTINGS_LOCAL_FILE, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
}

function ensurePlugins(settings) {
	if (!settings.plugins || typeof settings.plugins !== 'object' || Array.isArray(settings.plugins)) {
		settings.plugins = {}
	}
	if (!Array.isArray(settings.plugins.enabled)) settings.plugins.enabled = []
	if (!Array.isArray(settings.plugins.disabled)) settings.plugins.disabled = []
	return settings.plugins
}

function uniq(list) {
	return [...new Set(list.filter(v => typeof v === 'string' && v.trim() !== ''))]
}

function listInstalledPluginNames() {
	const map = new Map()
	for (const entry of paths.listPluginSources()) map.set(entry.name, entry)
	return new Set(map.keys())
}

function assertInstalled(name) {
	if (!listInstalledPluginNames().has(name)) {
		throw new Error(`Plugin not found: ${name}`)
	}
}

function updatePluginPolicy(name, action) {
	assertInstalled(name)
	const settings = readSettings()
	const plugins = ensurePlugins(settings)

	plugins.enabled = uniq(plugins.enabled)
	plugins.disabled = uniq(plugins.disabled)

	if (action === 'enable') {
		plugins.disabled = plugins.disabled.filter(v => v !== name)
		if (plugins.mode === 'explicit' && !plugins.enabled.includes(name)) {
			plugins.enabled.push(name)
		}
	} else if (action === 'disable') {
		plugins.enabled = plugins.enabled.filter(v => v !== name)
		if (!plugins.disabled.includes(name)) plugins.disabled.push(name)
	} else {
		throw new Error(`Unknown plugin policy action: ${action}`)
	}

	writeSettings(settings)
	return { settings, file: paths.USER_SETTINGS_LOCAL_FILE }
}

module.exports = {
	updatePluginPolicy,
	listInstalledPluginNames,
}
