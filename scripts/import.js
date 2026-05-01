#!/usr/bin/env node
'use strict'

const backup = require('../modules/backup')
const { parseArgs } = require('../modules/parse-args')
const { cliName } = require('./cli-name')

const { params, positional } = parseArgs(process.argv.slice(2))

if (params.help || params.h) {
	const bin = cliName()
	console.log(`
Usage: ${bin} import <backup-file> [options]

Restore an agent-exec backup into ~/.to-agent/agent-exec.

Existing files are overwritten only after a pre-import copy is stored under
~/.to-agent/agent-exec/backups/pre-import-*.

Categories:
  all       env + settings + plugins (default)
  env       .env only
  settings  settings.json and settings/local/settings.json
  plugins   user plugins directory
  skills    alias for plugins

Options:
  --yes             Confirm restore in non-interactive use
  --dry-run         Validate and show what would be restored
  --include <list>  Categories: all, env, settings, plugins (skills=plugins)
  --only <list>     Alias for --include
  --no-secrets      Skip .env even if the backup contains it
  --json            Print machine-readable result

Examples:
  ${bin} import ./agent-exec-backup.json.gz --yes
  ${bin} import ./agent-exec-backup.json.gz --dry-run
  ${bin} import ./agent-exec-backup.json.gz --only plugins --yes
  ${bin} import ./agent-exec-backup.json.gz --include settings,plugins --yes
  ${bin} import ./agent-exec-backup.json.gz --no-secrets --yes

Notes:
  Use --dry-run before importing into an active machine.
  Restart agent-exec after import to load runtime plugin changes.
`)
	process.exit(0)
}

try {
	const file = params.file || positional[0]
	if (!file) throw new Error('backup file is required')
	const dryRun = !!params['dry-run']
	const categories = backup.parseCategories(params.include || params.only)
	if (!dryRun && !params.yes && !process.stdin.isTTY) {
		throw new Error('refusing to import without --yes in non-interactive mode')
	}
	if (!dryRun && !params.yes && process.stdin.isTTY) {
		console.error('Import overwrites existing config files. Re-run with --yes to confirm.')
		process.exit(1)
	}

	const data = backup.readBackup(file)
	const result = backup.restoreBackup(data, {
		includeSecrets: !params['no-secrets'],
		categories,
		dryRun,
	})

	if (params.json) {
		console.log(JSON.stringify({
			dryRun,
			categories,
			restored: result.restored,
			skipped: result.skipped,
			overwritten: result.overwritten,
			preImportDir: result.preImportDir,
		}, null, 2))
	} else {
		console.log(dryRun ? 'Import dry-run OK.' : 'Import complete.')
		console.log(`Categories: ${categories.join(', ')}`)
		console.log(`Restored: ${result.restored.length}`)
		if (result.overwritten.length) {
			console.log(`Overwritten: ${result.overwritten.length}`)
			if (result.preImportDir) console.log(`Previous files copied to: ${result.preImportDir}`)
		}
		if (result.skipped.length) console.log(`Skipped: ${result.skipped.length}`)
		if (!dryRun) console.log('Restart agent-exec to reload runtime plugins and settings.')
	}
} catch (e) {
	console.error(e.message)
	process.exit(1)
}
