#!/usr/bin/env node
'use strict'

const { parseArgs } = require('../modules/parse-args')
const { cliName } = require('./cli-name')
const { updatePluginPolicy } = require('./plugin-policy-lib')

const { params } = parseArgs(process.argv.slice(2))

if (params.help || params.h) {
	const bin = cliName()
	console.log(`
Usage: ${bin} plugin disable --name=<name>

Disable a plugin in local settings.
Disabled plugins are revoked from discovery and ACL immediately.
Restart is still recommended to fully unload runtime code.

Options:
  --name=<name>  Plugin name

Examples:
  ${bin} plugin disable --name=experimental-plugin
  ${bin} restart
`)
	process.exit(0)
}

const name = params.name
if (!name || typeof name !== 'string') {
	console.error('Error: --name=<name> is required')
	process.exit(1)
}

try {
	const { file } = updatePluginPolicy(name, 'disable')
	console.log(`Disabled plugin: ${name}`)
	console.log(`Updated: ${file}`)
	console.log('Revoked from discovery and ACL immediately.')
	console.log('Run: aexec restart  # fully unload runtime hooks/routes')
} catch (e) {
	console.error(e.message)
	process.exit(1)
}
