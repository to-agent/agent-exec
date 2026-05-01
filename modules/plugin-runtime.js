'use strict'

/**
 * modules/plugin-runtime.js — load plugin index.js files and manage before/after hooks
 *
 * plugin.type:
 *   skill   → do not load index.js
 *   exec    → load index.js and expose api.exec only
 *   trusted → load index.js and expose api.exec + api.run
 *   system  → reserved in v1; startup error if explicitly enabled
 */

const fs       = require('fs')
const path     = require('path')
const express  = require('express')
const paths    = require('./paths')
const runner   = require('./runner')
const settings = require('./settings')
const pluginControl = require('./plugin-control')

const RESERVED_COMMANDS = new Set(['exec', 'acl', 'plugins', 'skills', 'private', 'ping', 'command'])
const VALID_TYPES       = new Set(['skill', 'exec', 'trusted', 'system'])
const VALID_INVOKES     = new Set(['exec', 'run'])

// ----------------------------------------------------------------
// Shared helpers used by both exec.js hook flow and plugin routes.
// ----------------------------------------------------------------

function validateArgs(args, label) {
	if (!Array.isArray(args) || args.length === 0) {
		const err = new Error(`${label}: args must be a non-empty array`)
		err.apiStatus = 400; err.apiCode = 'invalid_args'; throw err
	}
	if (!args.every(a => typeof a === 'string')) {
		const err = new Error(`${label}: args must be an array of strings`)
		err.apiStatus = 400; err.apiCode = 'invalid_args'; throw err
	}
	if (args[0].trim() === '') {
		const err = new Error(`${label}: command name cannot be empty`)
		err.apiStatus = 400; err.apiCode = 'invalid_args'; throw err
	}
}

async function execDirect(args, opts) {
	validateArgs(args, 'api.exec')
	const denied = settings.checkCommand(args)
	if (denied) {
		const err = new Error(denied)
		err.apiStatus = 403
		err.apiCode   = 'command_denied'
		throw err
	}
	const [cmd, ...cmdArgs] = args
	return runner.runBuffered(cmd, cmdArgs, opts?.timeoutMs)
}

async function runDirect(args, opts) {
	validateArgs(args, 'api.run')
	const [cmd, ...cmdArgs] = args
	return runner.runBuffered(cmd, cmdArgs, opts?.timeoutMs)
}

// Read the plugin's own settings.json, not the globally merged settings.
function readPluginSettings(pluginDir) {
	const p = path.join(pluginDir, 'settings.json')
	if (!fs.existsSync(p)) return {}
	try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return {} }
}

// List bundled and user sources separately so system plugin overrides can be detected.
function listPluginSources() {
	const sources = []
	for (const [dir, source] of [
		[paths.BUNDLED_PLUGINS_DIR, 'bundled'],
		[paths.USER_PLUGINS_DIR,    'user'],
	]) {
		if (!fs.existsSync(dir)) continue
		for (const name of fs.readdirSync(dir)) {
			const pluginDir = path.join(dir, name)
			try { if (!fs.statSync(pluginDir).isDirectory()) continue } catch { continue }
			sources.push({ name, dir: pluginDir, source })
		}
	}
	return sources
}

// Read the enabled allowlist for system plugins.
// Sources: env, user settings, legacy local settings, and project local settings.
function readSystemEnabled() {
	const enabled = new Set()

	// Environment variable: AGENT_EXEC_SYSTEM_PLUGINS=name1,name2
	const envVal = process.env.AGENT_EXEC_SYSTEM_PLUGINS
	if (envVal) envVal.split(',').map(s => s.trim()).filter(Boolean).forEach(n => enabled.add(n))

	// user/project settings
	for (const f of [paths.USER_SETTINGS_FILE, paths.USER_SETTINGS_LOCAL_FILE, paths.PROJECT_SETTINGS_LOCAL_FILE]) {
		try {
			if (!fs.existsSync(f)) continue
			const s = JSON.parse(fs.readFileSync(f, 'utf8'))
			const list = s?.plugins?.system?.enabled
			if (Array.isArray(list)) list.forEach(n => enabled.add(n))
		} catch {}
	}

	return enabled
}

// Sanitize request details by redacting apiKey and auth headers.
function sanitizeRequest(req) {
	const headers = { ...req.headers }
	if (headers['x-api-key'])     headers['x-api-key']     = '***'
	if (headers['authorization']) headers['authorization']  = '***'
	const query = { ...req.query }
	if (query.apiKey) query.apiKey = '***'
	return { method: req.method, path: req.path, query, ip: req.ip, headers }
}

// Build hook context.
function makeCtx(args, originalArgs, req, plugin) {
	return {
		args,
		originalArgs,
		request: sanitizeRequest(req),
		plugin: {
			name:     plugin.name,
			type:     plugin.type,
			command:  plugin.command,
			invoke:   plugin.invoke,
			settings: plugin.settings,
		},
	}
}

// Build plugin API. exec/run call the runner directly and do not loop through HTTP.
function makeApi(plugin, execDirect, runDirect) {
	const api = {
		exec: execDirect,
		fail: (status, code, message) => {
			const err = new Error(message || code || 'plugin error')
			err.apiStatus = status || 500
			err.apiCode   = code   || 'plugin_error'
			throw err
		},
	}
	if (plugin.type === 'trusted') {
		api.run = runDirect
	}
	return api
}

// Loaded plugin cache.
let _loaded = null

function load() {
	if (_loaded) return _loaded

	const sources    = pluginControl.activePluginSourceList(listPluginSources())
	const commandMap = new Map()  // command → plugin name for duplicate detection
	const plugins    = []
	const systemEnabled = readSystemEnabled()

	// Abort if a user plugin overrides a bundled system plugin with the same name.
	const systemNames = new Set()
	for (const { name, dir, settings: snapshotSettings } of sources) {
		const s = snapshotSettings || readPluginSettings(dir)
		if (s?.plugin?.type === 'system') systemNames.add(name)
	}
	const nameCount = new Map()
	for (const { name } of sources) nameCount.set(name, (nameCount.get(name) || 0) + 1)
	for (const name of systemNames) {
		if ((nameCount.get(name) || 0) > 1)
			throw new Error(`[plugin-runtime] system plugin "${name}" is overridden by a user plugin — startup aborted`)
	}

	// Last source wins: user plugins override bundled plugins.
	const pluginMap = new Map()
	for (const entry of sources) pluginMap.set(entry.name, entry)

	for (const { name, dir, settings: snapshotSettings } of pluginMap.values()) {
		const raw  = snapshotSettings || readPluginSettings(dir)
		const def  = raw?.plugin || {}
		const type = def.type || 'skill'

		// Unknown types are startup errors.
		if (!VALID_TYPES.has(type))
			throw new Error(`[plugin-runtime] plugin "${name}" has unknown type "${type}" — must be skill | exec | trusted | system`)

		if (type === 'system') {
			if (systemEnabled.has(name))
				throw new Error(`[plugin-runtime] system plugin "${name}" is in enabled list but system plugins are not supported in v1`)
			continue
		}

		if (type === 'skill') continue

		// exec / trusted
	// Reserved name check: plugin.name becomes the /api/command/${name} prefix.
		if (RESERVED_COMMANDS.has(name))
			throw new Error(`[plugin-runtime] plugin "${name}" uses a reserved name — cannot be used as route prefix`)

		const indexPath = path.join(dir, 'index.js')
		if (!fs.existsSync(indexPath)) {
			console.warn(`[plugin-runtime] plugin "${name}" type="${type}" has no index.js — skipping`)
			continue
		}

		const command = def.command
		if (!command)
			throw new Error(`[plugin-runtime] plugin "${name}" type="${type}" is missing plugin.command`)

		if (RESERVED_COMMANDS.has(command))
			throw new Error(`[plugin-runtime] plugin "${name}" uses reserved command "${command}"`)
		if (commandMap.has(command))
			throw new Error(`[plugin-runtime] duplicate command "${command}": "${name}" conflicts with "${commandMap.get(command)}"`)

		// apiVersion validation
		const apiVersion = def.apiVersion || 1
		if (apiVersion !== 1)
			throw new Error(`[plugin-runtime] plugin "${name}" requires apiVersion ${apiVersion} but only v1 is supported`)

		// invoke validation
		const invoke = def.invoke || 'exec'
		if (!VALID_INVOKES.has(invoke))
			throw new Error(`[plugin-runtime] plugin "${name}" has unknown invoke "${invoke}" — must be exec | run`)
		if (invoke === 'run' && type !== 'trusted')
			throw new Error(`[plugin-runtime] plugin "${name}" uses invoke:"run" but type is "${type}" — only trusted plugins may use invoke:"run"`)

		let mod
		try { mod = require(indexPath) } catch (e) {
			throw new Error(`[plugin-runtime] failed to load "${name}/index.js": ${e.message}`)
		}

		// routes(router, api) is optional and mounts under /api/command/${name}/*.
		const pluginDef = { name, dir, type, command, invoke, apiVersion, settings: def.settings || {}, mod }
		let pluginRouter = null
		if (typeof mod.routes === 'function') {
			pluginRouter = express.Router()
			const api = makeApi(pluginDef, execDirect, runDirect)
			try { mod.routes(pluginRouter, api) } catch (e) {
				throw new Error(`[plugin-runtime] plugin "${name}" routes() threw: ${e.message}`)
			}
		}
		pluginDef.router = pluginRouter

		commandMap.set(command, name)
		plugins.push(pluginDef)
	}

	_loaded = plugins
	return plugins
}

// Return runtime plugins matching a command.
function getForCommand(command) {
	return load().filter(p =>
		p.command === command &&
		pluginControl.isSnapshotPluginActive(p.name, p.dir)
	)
}

// Mount plugin routes under /api/command/${name}; called once at startup.
function mountRoutes(app) {
	for (const plugin of load()) {
		if (!plugin.router) continue
		app.use(`/api/command/${plugin.name}`, (req, res, next) => {
			if (pluginControl.isSnapshotPluginActive(plugin.name, plugin.dir)) return next()
			return res.status(404).json({
				error: 'plugin not active',
				plugin: plugin.name,
				hint: 'Plugin changes require aexec restart to load new runtime code.',
			})
		}, plugin.router)
	}
}

// Reset caches for tests.
function _reset() {
	_loaded = null
	pluginControl._reset()
}

module.exports = {
	load,
	getForCommand,
	makeCtx,
	makeApi,
	sanitizeRequest,
	listPluginSources,
	readPluginSettings,
	validateArgs,
	execDirect,
	runDirect,
	mountRoutes,
	_reset,
}
