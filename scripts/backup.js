#!/usr/bin/env node
'use strict'

const backup = require('../modules/backup')
const paths = require('../modules/paths')
const { parseArgs } = require('../modules/parse-args')
const { cliName } = require('./cli-name')

const { params } = parseArgs(process.argv.slice(2))

if (params.help || params.h) {
	const bin = cliName()
	console.log(`
Usage: ${bin} backup [options]

Create an agent-exec backup from ~/.to-agent/agent-exec.

By default the backup includes .env, settings, and user plugins.
The output file is written with mode 0600 because it may contain API_KEY.

Categories:
  all       env + settings + plugins (default)
  env       .env only
  settings  settings.json and settings/local/settings.json
  plugins   user plugins directory
  skills    alias for plugins

Options:
  --out <file>      Output file path
  --include <list>  Categories: all, env, settings, plugins (skills=plugins)
  --only <list>     Alias for --include
  --no-secrets      Exclude .env / API_KEY
  --json            Print machine-readable result

Examples:
  ${bin} backup
  ${bin} backup --include plugins
  ${bin} backup --include settings,plugins
  ${bin} backup --no-secrets
  ${bin} backup --out ./agent-exec-backup.json.gz

Notes:
  Backups may contain API_KEY. Keep them private.
  Use --no-secrets for shareable backups.
`)
	process.exit(0)
}

try {
	const includeSecrets = !params['no-secrets']
	const categories = backup.parseCategories(params.include || params.only)
	const out = params.out || params.output || backup.defaultBackupPath(paths.USER_CONFIG_DIR)
	const data = backup.buildBackup({ includeSecrets, categories })
	const file = backup.writeBackup(out, data)
	const files = data.entries.filter(e => e.type === 'file').length
	const dirs = data.entries.filter(e => e.type === 'dir').length

	if (params.json) {
		console.log(JSON.stringify({
			file,
			includeSecrets,
			categories: data.categories,
			files,
			dirs,
			skipped: data.skipped,
		}, null, 2))
	} else {
		console.log(`Backup written: ${file}`)
		console.log(`Entries: ${files} files, ${dirs} directories`)
		console.log(`Categories: ${data.categories.join(', ')}`)
		if (includeSecrets) {
			console.log('')
			console.log('⚠️  This backup includes .env / API_KEY. Keep it private.')
		}
		if (data.skipped.length) {
			console.log(`Skipped: ${data.skipped.length}`)
		}
	}
} catch (e) {
	console.error(e.message)
	process.exit(1)
}
