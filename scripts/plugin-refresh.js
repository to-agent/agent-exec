#!/usr/bin/env node
'use strict'

const convert = require('../modules/convert')
const { parseArgs } = require('../modules/parse-args')
const { cliName } = require('./cli-name')
const { runDoctor } = require('./plugin-doctor')

const { params } = parseArgs(process.argv.slice(2))

if (params.help || params.h) {
	const bin = cliName()
	console.log(`
Usage: ${bin} plugin refresh [--strict]

Rebuild the SKILL cache for currently active plugins, then run plugin doctor.
This does not enable, disable, install, or remove plugins.

Options:
  --strict   Exit non-zero on doctor warnings as well as errors

Examples:
  ${bin} plugin refresh
  ${bin} restart  # required to load new runtime hooks/routes
`)
	process.exit(0)
}

try {
	convert.buildAllCache()
	console.log('Rebuilt SKILL cache for active plugins.')
	console.log('Note: runtime hook/route changes still require aexec restart.\n')
	const code = runDoctor({ strict: !!params.strict })
	process.exit(code)
} catch (e) {
	console.error(e.message)
	process.exit(1)
}
