'use strict'

const fs = require('fs')
const path = require('path')
const { ENV_FILE, PID_META_FILE } = require('../aexec-paths')

function readEnvFile(file) {
	const env = {}
	if (!fs.existsSync(file)) return env
	fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) return
		const i = trimmed.indexOf('=')
		if (i < 1) return
		const key = trimmed.slice(0, i).trim()
		let value = trimmed.slice(i + 1).trim()
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) value = value.slice(1, -1)
		env[key] = value
	})
	return env
}

function keyPreview(key) {
	if (!key) return 'none'
	const s = String(key)
	return s.length > 8 ? `${s.slice(0, 8)}...` : `${s.slice(0, 2)}...`
}

function runtimeEnvSummary(envFile = ENV_FILE) {
	const configEnv = readEnvFile(envFile)
	const meta = readRuntimeMeta()
	const projectEnvFile = meta?.projectEnv || null
	const projectEnv = projectEnvFile ? readEnvFile(projectEnvFile) : {}
	const projectEnvHasApiKey = !!projectEnv.API_KEY
	let apiKey = configEnv.API_KEY || ''
	let apiKeySource = apiKey ? 'config .env' : 'missing'
	if (projectEnvHasApiKey) {
		apiKey = projectEnv.API_KEY
		apiKeySource = 'project .env'
	}
	return {
		meta,
		envFile,
		configEnv,
		projectEnv,
		projectEnvFile,
		projectEnvHasApiKey,
		apiKey,
		apiKeySource,
		apiKeyPreview: keyPreview(apiKey),
		configApiKeyPreview: keyPreview(configEnv.API_KEY),
		projectApiKeyPreview: keyPreview(projectEnv.API_KEY),
	}
}

function projectEnvInfo(args = []) {
	if (!args.includes('--use-project-env')) {
		return { enabled: false, env: {}, file: null, exists: false }
	}
	const file = path.join(process.cwd(), '.env')
	const exists = fs.existsSync(file)
	return {
		enabled: true,
		env: exists ? readEnvFile(file) : {},
		file,
		exists,
	}
}

function warnProjectEnv(info) {
	if (!info.enabled) return
	if (info.exists) {
		console.log('⚠️  Using project .env for this process only:')
		console.log(`   ${info.file}`)
		console.log('   It is not saved to ~/.to-agent/agent-exec/.env.\n')
	} else {
		console.log(`⚠️  --use-project-env was set, but no project .env was found: ${info.file}\n`)
	}
}

function buildRuntimeEnv(info = { enabled: false, env: {}, file: null, exists: false }) {
	const env = {
		...process.env,
		...readEnvFile(ENV_FILE),
	}
	if (info.enabled) {
		Object.assign(env, info.env)
		env.AGENT_EXEC_PROJECT_ENV_MODE = 'true'
		if (info.exists) env.AGENT_EXEC_PROJECT_ENV_FILE = info.file
		else delete env.AGENT_EXEC_PROJECT_ENV_FILE
	}
	return env
}

function writeRuntimeMeta(meta) {
	fs.writeFileSync(PID_META_FILE, JSON.stringify({
		...meta,
		updatedAt: new Date().toISOString(),
	}, null, 2) + '\n', { mode: 0o600 })
	try { fs.chmodSync(PID_META_FILE, 0o600) } catch (_) {}
}

function readRuntimeMeta() {
	try {
		if (!fs.existsSync(PID_META_FILE)) return null
		return JSON.parse(fs.readFileSync(PID_META_FILE, 'utf8'))
	} catch (_) {
		return null
	}
}

function clearRuntimeMeta() {
	fs.rmSync(PID_META_FILE, { force: true })
}

module.exports = {
	readEnvFile,
	keyPreview,
	runtimeEnvSummary,
	projectEnvInfo,
	warnProjectEnv,
	buildRuntimeEnv,
	writeRuntimeMeta,
	readRuntimeMeta,
	clearRuntimeMeta,
}
