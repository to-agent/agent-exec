#!/usr/bin/env node
'use strict'

const commands = {
	setup:      require('./commands/setup'),
	start:      require('./commands/start'),
	stop:       require('./commands/stop'),
	restart:    require('./commands/restart'),
	status:     require('./commands/status'),
	config:     require('./commands/config'),
	dev:        require('./commands/dev'),
	starterkit: require('./commands/starterkit'),
	plugin:     require('./commands/plugin'),
	acl:        require('./commands/acl'),
	key:        require('./commands/key'),
	share:      require('./commands/share'),
	backup:     require('./commands/backup'),
	reset:      require('./commands/reset'),
	import:     require('./commands/import'),
	transfer:   require('./commands/transfer'),
	update:     require('./commands/update'),
	version:    require('./commands/version'),
}
const { cliName } = require('./cli-name')

function help() {
	const bin = cliName()
	console.log(`
Usage: ${bin} <command>

Commands:
  setup            Configure API key and settings
  starterkit       Auto-detect AI tools and generate plugins
  start            Start the server (background)
  start -f         Start the server (foreground)
  stop             Stop the server
  stop --force     Force kill process on port
  restart          Restart the server
  status           Show server status
  config           Show config files and reload behavior
  dev              Start with auto-restart (nodemon)
  plugin           Manage plugins (list / create / remove / enable / disable / doctor / refresh)
  acl              Manage exec.allow rules
  key              Rotate the local API key
  share            Show prompt to paste to an AI agent
  update           Update to latest version
  reset            Back up and recreate local config
  version          Show version

Options:
  -h, --help       Show this help
  -v, --version    Show version

Examples:
  ${bin} setup
  ${bin} start
  ${bin} start -f --public
  ${bin} share --ip 192.0.2.10
  ${bin} start --use-project-env
  ${bin} share
  ${bin} acl add "date"
  ${bin} acl list
  ${bin} key rotate
  ${bin} reset --yes
  ${bin} plugin create --name=mytool --command=mytool

Run '${bin} <command> --help' for details.
`)
}

const [,, name = 'help', ...args] = process.argv

if (name === '--help' || name === '-h' || name === 'help') {
	help()
	process.exit(0)
}

if (name === '--version' || name === '-v') {
	commands.version.run()
	process.exit(0)
}

const cmd = commands[name]
if (!cmd) {
	console.error(`Unknown command: ${name}`)
	help()
	process.exit(1)
}

if (args[0] === '--help' || args[0] === '-h') {
	cmd.help()
	process.exit(0)
}

cmd.run(args)
