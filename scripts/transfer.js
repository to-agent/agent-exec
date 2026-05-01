#!/usr/bin/env node
'use strict'

const http = require('http')
const https = require('https')
const os = require('os')
const path = require('path')

const backup = require('../modules/backup')
const paths = require('../modules/paths')
const { parseArgs } = require('../modules/parse-args')
const { cliName } = require('./cli-name')

const { params } = parseArgs(process.argv.slice(2))

function expandPath(p) {
	if (!p) return p
	if (p === '~') return os.homedir()
	if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
	return p
}

function isLikelyUrlTarget(v) {
	return /^https?:\/\//i.test(v) || /^[a-zA-Z0-9_.-]+(?::\d+)?(?:\/.*)?$/.test(v) || /^\[[^\]]+\](?::\d+)?(?:\/.*)?$/.test(v)
}

function normalizeTarget(to) {
	if (!to) throw new Error('--to is required')
	if (/^https?:\/\//i.test(to)) return to
	if (!isLikelyUrlTarget(to)) throw new Error('--to must be an agent-exec URL or host[:port]')

	const hasPort = /^\[[^\]]+\]:\d+/.test(to) || /^[^/]+:\d+/.test(to)
	const [authority, ...rest] = to.split('/')
	const pathPart = rest.length ? '/' + rest.join('/') : ''
	return `http://${authority}${hasPort ? '' : ':3333'}${pathPart}`
}

function transferEndpoint(to) {
	const u = new URL(normalizeTarget(to))
	if (!/^https?:$/.test(u.protocol)) throw new Error('--to must be http:// or https://')
	if (u.pathname === '/' || u.pathname === '') {
		u.pathname = '/cli/transfer'
	} else if (!u.pathname.endsWith('/cli/transfer')) {
		u.pathname = u.pathname.replace(/\/$/, '') + '/cli/transfer'
	}
	u.search = ''
	u.hash = ''
	return u
}

function postJson(url, apiKey, body) {
	return new Promise((resolve, reject) => {
		const data = Buffer.from(JSON.stringify(body), 'utf8')
		const mod = url.protocol === 'https:' ? https : http
		const req = mod.request(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': data.length,
				'X-API-Key': apiKey,
			},
			timeout: 30000,
		}, res => {
			let text = ''
			res.setEncoding('utf8')
			res.on('data', chunk => { text += chunk })
			res.on('end', () => {
				let json = null
				try { json = JSON.parse(text) } catch {}
				resolve({ status: res.statusCode, text, json })
			})
		})
		req.on('error', reject)
		req.on('timeout', () => {
			req.destroy(new Error('transfer request timed out'))
		})
		req.end(data)
	})
}

if (params.help || params.h) {
	const bin = cliName()
	console.log(`
Usage: ${bin} transfer --from <config-dir> --to <agent-exec-url> --apiKey <key> [options]

Transfer local agent-exec config to a remote agent-exec machine.

The destination must be a running agent-exec server. The API key is the
destination machine's API key.
If --from is omitted, ~/.to-agent/agent-exec is backed up and transferred.
If --from points to a file, it is treated as an existing ae backup file.
If --to omits the scheme, http:// is used. If it omits the port, :3333 is used.

Categories:
  all       env + settings + plugins (default)
  env       .env only
  settings  settings.json and settings/local/settings.json
  plugins   user plugins directory
  skills    alias for plugins

Options:
  --from <path>     Source config dir or backup file (default: ~/.to-agent/agent-exec)
  --to <url|host>   Destination URL or host[:port]
  --apiKey <key>    Destination API key
  --api-key <key>   Same as --apiKey
  --yes             Confirm remote restore
  --dry-run         Validate on the destination without writing
  --include <list>  Categories: all, env, settings, plugins (skills=plugins)
  --only <list>     Alias for --include
  --no-secrets      Skip .env / API_KEY
  --json            Print machine-readable result

Examples:
  ${bin} transfer --from ~/.to-agent/agent-exec --to http://192.168.1.20:3333 --apiKey test --dry-run
  ${bin} transfer --to 192.168.1.20 --apiKey test --only plugins --dry-run
  ${bin} transfer --to 192.168.1.20 --apiKey test --dry-run
  ${bin} transfer --from ./agent-exec-backup.json.gz --to 192.168.1.20:3333 --apiKey test --yes
  ${bin} transfer --from ~/.to-agent/agent-exec --to http://192.168.1.20:3333 --apiKey test --yes

Notes:
  --apiKey is always the destination machine's API key.
  Use --no-secrets if you do not want to overwrite the destination .env.
  Restart agent-exec on the destination after a confirmed transfer.
`)
	process.exit(0)
}

async function main() {
	const from = path.resolve(expandPath(params.from || paths.USER_CONFIG_DIR))
	if (!params.to) throw new Error('--to is required')
	const apiKey = params.apiKey || params['api-key']
	if (!apiKey) throw new Error('--apiKey is required')

	const dryRun = !!params['dry-run']
	const categories = backup.parseCategories(params.include || params.only)
	if (!dryRun && !params.yes && !process.stdin.isTTY) {
		throw new Error('refusing to transfer without --yes in non-interactive mode')
	}
	if (!dryRun && !params.yes && process.stdin.isTTY) {
		console.error('Remote transfer overwrites destination config files. Re-run with --yes to confirm.')
		process.exit(1)
	}

	const endpoint = transferEndpoint(params.to)
	const st = require('fs').statSync(from)
	const data = st.isFile()
		? backup.readBackup(from)
		: backup.buildBackup({
			configDir: from,
			includeSecrets: !params['no-secrets'],
			categories,
		})
	const packed = backup.packTransferPayload(data)
	const body = {
		...packed,
		dryRun,
		confirm: !!params.yes,
		includeSecrets: !params['no-secrets'],
		categories,
	}

	const result = await postJson(endpoint, apiKey, body)
	if (result.status < 200 || result.status >= 300) {
		const msg = result.json?.error || result.text || `HTTP ${result.status}`
		throw new Error(`remote transfer failed (${result.status}): ${msg}`)
	}

	if (params.json) {
		console.log(JSON.stringify({
			from,
			to: endpoint.toString(),
			dryRun,
			includeSecrets: !params['no-secrets'],
			categories,
			remote: result.json,
		}, null, 2))
		return
	}

	console.log(dryRun ? 'Remote transfer dry-run OK.' : 'Remote transfer complete.')
	console.log(`From: ${from}`)
	console.log(`To:   ${endpoint.toString()}`)
	console.log(`Categories: ${categories.join(', ')}`)
	console.log(`Restored: ${result.json?.restored ?? '?'}`)
	console.log(`Skipped: ${result.json?.skipped ?? '?'}`)
	console.log(`Overwritten: ${result.json?.overwritten ?? '?'}`)
	if (result.json?.preImportDir) console.log(`Remote pre-import copy: ${result.json.preImportDir}`)
	if (!dryRun) console.log('Restart agent-exec on the destination machine to load transferred runtime plugins and settings.')
}

main().catch(e => {
	console.error(e.message)
	process.exit(1)
})
