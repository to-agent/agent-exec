'use strict'

const fs = require('fs')
const path = require('path')
const { PACKAGE_DIR, USER_CONFIG_DIR, ENV_FILE } = require('../aexec-paths')
const { cliName } = require('../cli-name')
const { run } = require('./_run')
const { projectEnvInfo, warnProjectEnv, buildRuntimeEnv, writeRuntimeMeta, clearRuntimeMeta } = require('./_project-env')

module.exports = {
	help() {
		const bin = cliName()
		const configDir = USER_CONFIG_DIR
		console.log(`
Usage: ${bin} dev [--use-project-env]

Start server with auto-restart on code, settings, and plugin file changes (nodemon).

Options:
  --use-project-env  Load current directory .env into the dev process only.

Environment:
  Runtime config is loaded from:
    ${ENV_FILE}
  With --use-project-env, current directory .env is merged into the dev process only.
  Config directory:
    ${configDir}

Examples:
  ${bin} dev
  ${bin} dev --use-project-env
`)
	},

	run(args = []) {
		const userPluginsDir = path.join(USER_CONFIG_DIR, 'plugins')
		const userSettingsDir = path.join(USER_CONFIG_DIR, 'settings')
		fs.mkdirSync(userPluginsDir, { recursive: true })
		fs.mkdirSync(userSettingsDir, { recursive: true })

		const projectEnv = projectEnvInfo(args)
		warnProjectEnv(projectEnv)
		const env = buildRuntimeEnv(projectEnv)
		if (projectEnv.enabled) {
			writeRuntimeMeta({
				mode: 'dev',
				pid: process.pid,
				projectEnv: projectEnv.exists ? projectEnv.file : null,
				projectEnvExists: projectEnv.exists,
				processOnly: true,
				effective: {
					port: env.PORT || '3333',
					host: env.HOST || '127.0.0.1',
				},
			})
		}

		try {
			run('npx', [
				'nodemon',
				'--watch', '.',
				'--watch', userPluginsDir,
				'--watch', userSettingsDir,
				'--watch', ENV_FILE,
				'--ignore', path.join(USER_CONFIG_DIR, 'cache'),
				'--ignore', path.join(USER_CONFIG_DIR, 'agent-exec.log'),
				'--ignore', path.join(USER_CONFIG_DIR, 'agent-exec.pid'),
				'--ext', 'js,json,env,md',
				'./bin/www',
			], {
				cwd: PACKAGE_DIR,
				env,
			})
		} finally {
			if (projectEnv.enabled) clearRuntimeMeta()
		}
	},
}
