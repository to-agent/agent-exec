'use strict'

const express       = require('express')
const router        = express.Router()
const settings      = require('../../modules/settings')
const runner        = require('../../modules/runner')
const pluginRuntime = require('../../modules/plugin-runtime')
const audit         = require('../../modules/audit')
const { validateArgs, execDirect, runDirect } = pluginRuntime
const { attachSkillRoutes, detectFormat, sendFormatted } = require('../../modules/respond')
const { execSjs } = require('../../modules/sjs')

router.path = '/api/exec'

// GET /api/exec/SKILL.md .html .json — documentation
attachSkillRoutes(router, { skipSjs: true })

function serveExecSjs(req, res) {
	res.type('text/sjs').send(execSjs())
}

router.get('/SKILL.s.js', serveExecSjs)
router.get('/SKILL.sjs', serveExecSjs)

function sendExecError(req, res, status, body) {
	if (detectFormat(req, null, 'json') === 'sjs') {
		return sendFormatted(res, status, {
			error: body.code || body.error || body.message || 'execution_error',
			path: (req.originalUrl || req.path || '/api/exec').split('?')[0],
			fields: body.fields,
		})
	}
	const out = { ...body }
	if (Number(status) === 400 || Number(status) === 405) {
		out.request = {
			body: { args: ['<command>', '<arg>', '...'] },
		}
		out.document = '/api/exec/SKILL.s.js'
	}
	return res.status(status).json(out)
}

async function handle(req, res) {
	const bodyKeys = Object.keys(req.body || {})
	const unexpected = bodyKeys.filter(k => k !== 'args' && k !== 'memo')
	if (unexpected.length) {
		return sendExecError(req, res, 400, {
			error: 'unexpected request body field',
			fields: unexpected,
			hint: '{"args": ["cmd", "arg1", "arg2"]}',
		})
	}

	let args = req.body?.args

	if (!Array.isArray(args) || args.length === 0)
		return sendExecError(req, res, 400, { error: 'args array is required', hint: '{"args": ["cmd", "arg1", "arg2"]}' })

	if (!args.every(a => typeof a === 'string'))
		return sendExecError(req, res, 400, { error: 'args must be an array of strings' })

	if (args[0].trim() === '')
		return sendExecError(req, res, 400, { error: 'command name cannot be empty' })

	// Original args are always ACL-checked.
	const denied = settings.checkCommand(args)
	if (denied) {
		audit.execEvent(req, {
			mode: req.query.mode || 'buffered',
			argv: args,
			cwd: process.cwd(),
			plugin: null,
			aclDecision: 'deny',
			denialReason: denied,
			durationMs: 0,
			stdoutBytes: 0,
			stderrBytes: 0,
		})
		return sendExecError(req, res, 403, { error: denied })
	}

	const format = req.query.format || 'json'
	const mode   = req.query.mode   || 'buffered'

	// Resolve the command-scoped plugin. Duplicate commands are rejected at startup.
	const originalArgs   = [...args]
	const matchedPlugins = pluginRuntime.getForCommand(args[0])
	const plugin         = matchedPlugins[0] || null

	// stream mode is direct-command only. Plugin commands may depend on hooks,
	// invoke policy, or route-specific logic, so streaming must be implemented
	// explicitly by the plugin route instead of being applied here implicitly.
	if (mode === 'stream') {
		if (plugin) {
			audit.execEvent(req, {
				mode,
				argv: args,
				cwd: process.cwd(),
				plugin: plugin.name,
				aclDecision: 'deny',
				denialReason: 'stream_plugin_command_not_supported',
				durationMs: 0,
				stdoutBytes: 0,
				stderrBytes: 0,
			})
			return sendExecError(req, res, 400, {
				error: 'stream mode is not supported for plugin commands',
				code: 'stream_plugin_command_not_supported',
				hint: 'Use buffered mode for this command, or a plugin-specific /api/command route if it supports streaming.',
			})
		}
		const [command, ...commandArgs] = args
		audit.execEvent(req, {
			mode,
			argv: args,
			cwd: process.cwd(),
			plugin: null,
			aclDecision: 'allow',
			event: 'stream_start',
			durationMs: 0,
			stdoutBytes: 0,
			stderrBytes: 0,
		})
		return runner.runStream(command, commandArgs, format, res)
	}

	// before hook
	if (plugin && typeof plugin.mod.before === 'function') {
		try {
			const api = pluginRuntime.makeApi(plugin, execDirect, runDirect)
			const ctx = pluginRuntime.makeCtx(args, originalArgs, req, plugin)
			const result = await plugin.mod.before(ctx, api)
			if (Array.isArray(result)) args = result
			else if (result && Array.isArray(result.args)) args = result.args
			// Validate args returned by before hook.
			validateArgs(args, 'before hook result')
		} catch (e) {
			audit.execEvent(req, {
				mode,
				argv: args,
				cwd: process.cwd(),
				plugin: plugin.name,
				aclDecision: 'plugin_error',
				denialReason: e.apiCode || 'plugin_before_error',
				durationMs: 0,
				stdoutBytes: 0,
				stderrBytes: 0,
			})
			return sendExecError(req, res, e.apiStatus || 500, { error: e.message, code: e.apiCode || 'plugin_before_error' })
		}
	}

	// Execute.
	let result
	if (plugin) {
		if (plugin.invoke === 'run') {
			// trusted + invoke:"run" runs directly without an additional ACL check.
			const [cmd, ...cmdArgs] = args
			result = await runner.runBuffered(cmd, cmdArgs)
		} else {
			// invoke:"exec" rechecks ACL after hook-transformed args.
			const deniedAfter = settings.checkCommand(args)
			if (deniedAfter) {
				audit.execEvent(req, {
					mode,
					argv: args,
					cwd: process.cwd(),
					plugin: plugin.name,
					aclDecision: 'deny',
					denialReason: deniedAfter,
					durationMs: 0,
					stdoutBytes: 0,
					stderrBytes: 0,
				})
				return sendExecError(req, res, 403, { error: deniedAfter })
			}
			const [cmd, ...cmdArgs] = args
			result = await runner.runBuffered(cmd, cmdArgs)
		}
	} else {
		// No plugin: original args already passed ACL, run as-is.
		const [cmd, ...cmdArgs] = args
		result = await runner.runBuffered(cmd, cmdArgs)
	}

	// after hook
	if (plugin && typeof plugin.mod.after === 'function') {
		try {
			const api = pluginRuntime.makeApi(plugin, execDirect, runDirect)
			const ctx = pluginRuntime.makeCtx(args, originalArgs, req, plugin)
			ctx.result = result
			const modified = await plugin.mod.after(ctx, api)
			if (modified !== undefined && modified !== null) result = modified
		} catch (e) {
			audit.execEvent(req, {
				mode,
				argv: args,
				cwd: process.cwd(),
				plugin: plugin.name,
				aclDecision: 'plugin_error',
				denialReason: e.apiCode || 'plugin_after_error',
				durationMs: result?.duration || 0,
				stdoutBytes: audit.bytes(result?.output),
				stderrBytes: audit.bytes(result?.stderr),
			})
			return sendExecError(req, res, e.apiStatus || 500, { error: e.message, code: e.apiCode || 'plugin_after_error' })
		}
	}

	audit.execEvent(req, {
		mode,
		argv: args,
		cwd: process.cwd(),
		plugin: plugin ? plugin.name : null,
		aclDecision: result.apiStatus ? 'resource_limit' : 'allow',
		denialReason: result.apiStatus ? (result.code || result.message || 'execution_error') : undefined,
		exitCode: result.exitCode ?? null,
		durationMs: result.duration || 0,
		stdoutBytes: audit.bytes(result.output),
		stderrBytes: audit.bytes(result.stderr),
	})

	if (format !== 'json') {
		res.type('text/plain')
		if (result.apiStatus) return res.status(result.apiStatus).send(result.message || result.error || 'execution error')
		if (result.enoent) return res.status(500).send(result.message || 'command not found')
		return res.send(result.output || result.stderr || '')
	}

	if (result.apiStatus) return sendExecError(req, res, result.apiStatus, result)
	res.json(result)
}

router.post('/', handle)
router.get('/', (req, res) => {
	res.setHeader('Allow', 'POST')
	return sendExecError(req, res, 405, {
		error: 'method_not_allowed',
		message: 'Use POST /api/exec with a JSON body.',
	})
})

module.exports = router

if (process.env.TEST === 'true') {
	router.get('/', handle)
	module.exports._handle = handle
}
