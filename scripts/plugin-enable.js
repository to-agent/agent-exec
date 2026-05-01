#!/usr/bin/env node
'use strict'

const { parseArgs } = require('../modules/parse-args')
const { cliName } = require('./cli-name')
const { updatePluginPolicy } = require('./plugin-policy-lib')

const { params } = parseArgs(process.argv.slice(2))

if (params.help || params.h) {
	const bin = cliName()
	console.log(`
Usage: ${bin} plugin enable --name=<name>

Enable a plugin in local settings.
In auto mode this removes the plugin from plugins.disabled.
In explicit mode this also adds the plugin to plugins.enabled.

Runtime hooks/routes and plugin ACL changes require restart after enabling.

Options:
  --name=<name>  Plugin name

Examples:
  ${bin} plugin enable --name=hermes
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
	const { settings, file } = updatePluginPolicy(name, 'enable')
	console.log(`Enabled plugin: ${name}`)
	console.log(`Updated: ${file}`)
	console.log(`mode=${settings.plugins?.mode || 'auto'}`)
	console.log('Run: aexec restart  # load runtime hooks/routes and plugin ACL changes')
} catch (e) {
	console.error(e.message)
	process.exit(1)
}
