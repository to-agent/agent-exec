'use strict'

const fs = require('fs')
const paths = require('../../modules/paths')
const { cliName } = require('../cli-name')
const { runtimeEnvSummary } = require('./_project-env')

function exists(file) {
	return fs.existsSync(file) ? 'exists' : 'missing'
}

module.exports = {
	help() {
		const bin = cliName()
		console.log(`
Usage: ${bin} config

Show configuration files and reload behavior.

Policy, execution limit, and audit settings are reloaded automatically.
Startup settings and plugin runtime changes require restart.

Examples:
  ${bin} config
`)
	},

	run() {
		const envFile = paths.resolveEnvPath()
		const envSummary = runtimeEnvSummary(envFile)
		const meta = envSummary.meta
		console.log('agent-exec config\n')
		console.log(`Config dir:       ${paths.USER_CONFIG_DIR}`)
		console.log(`Env file:         ${envFile} (${exists(envFile)})`)
		console.log(`Settings file:    ${paths.USER_SETTINGS_FILE} (${exists(paths.USER_SETTINGS_FILE)})`)
		console.log(`Legacy settings:  ${paths.USER_SETTINGS_LOCAL_FILE} (${exists(paths.USER_SETTINGS_LOCAL_FILE)})`)
		console.log(`Plugins dir:      ${paths.USER_PLUGINS_DIR} (${exists(paths.USER_PLUGINS_DIR)})`)
		console.log(`Default settings: ${paths.DEFAULT_SETTINGS_FILE}`)
		console.log('')
		console.log('API key:')
		console.log(`  Source: ${envSummary.apiKeySource}`)
		console.log(`  Effective: ${envSummary.apiKeyPreview}`)
		console.log(`  Config .env: ${envSummary.configApiKeyPreview}`)
		if (envSummary.projectEnvFile) {
			console.log(`  Project .env: ${envSummary.projectEnvFile} (${exists(envSummary.projectEnvFile)})`)
			console.log(`  Project API_KEY: ${envSummary.projectApiKeyPreview}`)
		}
		if (envSummary.projectEnvHasApiKey) {
			console.log('  Warning: project .env API_KEY overrides the saved config .env for the running process/share prompt.')
		}
		if (meta) {
			console.log('')
			console.log('Runtime:')
			console.log(`  Mode: ${meta.mode || 'unknown'}`)
			if (meta.pid) console.log(`  PID: ${meta.pid}`)
			if (meta.effective) console.log(`  Endpoint: http://${meta.effective.host || '127.0.0.1'}:${meta.effective.port || '3333'}`)
			if (meta.projectEnv) console.log(`  Project env: ${meta.projectEnv}`)
		}
		console.log('')
		console.log('Reload behavior:')
		console.log('  Auto without restart:')
		console.log('    - exec.allow / exec.deny')
		console.log('    - ip.allow / ip.deny')
		console.log('    - timeoutMs / maxOutputBytes / maxStreamBytes')
		console.log('    - maxConcurrentExec / killGraceMs')
		console.log('    - audit.enabled / audit.file')
		console.log('')
		console.log('  Restart required:')
		console.log('    - .env / API_KEY / HOST / PORT')
		console.log('    - AGENT_EXEC_ENABLED / AGENT_EXEC_ALLOW_QUERY_API_KEY')
		console.log('    - maxRequestBodyBytes / rateLimit')
		console.log('    - plugin create / enable / runtime settings edits')
		console.log('    - restart is recommended after plugin remove / disable to fully unload runtime code')
		console.log('')
		console.log('There is no top-level refresh command:')
		console.log('  settings policy reloads automatically; plugin/runtime changes require restart.')
		console.log('')
		console.log('After editing restart-required settings, run:')
		console.log(`  ${cliName()} restart`)
	},
}
