#!/usr/bin/env node

/**
 * starterkit.js — Starter Kit for agent-exec
 *
 * Reads supported-agents.txt, detects installed AI agents,
 * and auto-generates plugins/:name/ from --help output.
 *
 * Usage:
 *   aexec starterkit           # all agents
 *   aexec starterkit hermes    # specific agent
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SUPPORTED_AGENTS_FILE = path.join(ROOT, 'supported-agents.txt')
const { USER_PLUGINS_DIR } = require('../modules/paths')
const { parseArgs } = require('../modules/parse-args')
const { scanCli } = require('../modules/scan-cli')
const { writeScannedPlugin } = require('../modules/plugin-gen')

const parsed = parseArgs(process.argv.slice(2))
const params = parsed.params
const positional = [...parsed.positional]
const hasHelp = Object.prototype.hasOwnProperty.call(params, 'help') || Object.prototype.hasOwnProperty.call(params, 'h')

// parseArgs supports --key value for options with values. starterkit flags are
// booleans, so recover the common `starterkit --silent codex` shape here.
if (typeof params.silent === 'string' && !['true', 'false'].includes(params.silent)) {
  positional.unshift(params.silent)
  params.silent = true
}
if (typeof params.quiet === 'string' && !['true', 'false'].includes(params.quiet)) {
  positional.unshift(params.quiet)
  params.quiet = true
}

const silent = params.silent === true || params.silent === 'true' || params.quiet === true || params.quiet === 'true'
const force = params.force === true || params.force === 'true'
const SAFE_PLUGIN_NAME = /^[a-z0-9][a-z0-9_-]*$/
const UNSAFE_COMMAND_CHARS = /[\s"'`$;&|<>()\[\]{}]/

function printHelp() {
  console.log(`
Usage: aexec starterkit [name] [options]

Auto-detect installed AI tools and generate plugins for each.
Recommended for first-time setup.

Arguments:
  name  Optional supported agent command or plugin name.

Options:
  --silent           Do not print generated settings.json contents.
  --quiet            Alias for --silent.
  --force            Replace an existing generated plugin directory.
  -h, --help         Show this help.

Environment:
  AGENT_EXEC_STARTERKIT_DEPTH=<n>  Help scan depth. Default: 0.

Generated ACL:
  Starter Kit writes detected help/version commands to each plugin settings.json.
  It does not generate "<cmd> *"; add broader command patterns manually after review.
  Review generated exec.allow rules before restart.

Examples:
  aexec starterkit
  aexec starterkit --silent
  aexec starterkit hermes
  aexec starterkit codex
  aexec starterkit codex --silent
  aexec starterkit codex --force
`)
}

if (hasHelp) {
  printHelp()
  process.exit(0)
}

function formatJson(value) {
  return JSON.stringify(value, null, 2) + '\n'
}

function printGeneratedSettings(pluginDir, settings) {
  if (silent) return
  console.log(`\n    settings.json adds ACL rules. Review before restart:`)
  console.log(`    ${path.join(pluginDir, 'settings.json')}`)
  console.log(formatJson(settings).split('\n').map(line => line ? `    ${line}` : '').join('\n'))
  printAllowWarnings(settings)
}

function printAllowWarnings(settings) {
  const allow = settings.exec?.allow || []
  for (const rule of allow) {
    if (typeof rule !== 'string' || !rule.includes('*')) continue
    if (rule === '*') {
      console.log('    ⚠️  Generated rule "*" is a broad wildcard ACL rule.')
      console.log('       Review the plugin skill and command behavior before restart.')
      continue
    }
    console.log(`    ⚠️  Generated rule "${rule}" is a broad wildcard ACL rule.`)
    console.log('       Review the plugin skill and command behavior before restart.')
  }
}

function allowFromScan(command, scan) {
  const allow = []
  for (const args of [scan.helpArgs, scan.versionArgs]) {
    if (!Array.isArray(args) || args.length === 0) continue
    allow.push([command, ...args].join(' '))
  }
  return Array.from(new Set(allow))
}

function loadSupportedAgents() {
  if (!fs.existsSync(SUPPORTED_AGENTS_FILE)) {
    console.log('supported-agents.txt not found. Skipping Starter Kit.')
    process.exit(0)
  }

  return fs.readFileSync(SUPPORTED_AGENTS_FILE, 'utf8')
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .map(line => {
      const [command, plugin] = line.trim().split(/\s+/)
      return { command, plugin: plugin || command }
    })
}

function commandExists(command) {
  const pathValue = process.env.PATH || ''
  const dirs = pathValue.split(path.delimiter).filter(Boolean)
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, process.platform === 'win32' && !path.extname(command) ? command + ext : command)
      try {
        fs.accessSync(file, fs.constants.X_OK)
        return true
      } catch (_) {}
    }
  }
  return false
}

function generatePlugin(agent) {
  const { command, plugin } = agent
  if (!command || UNSAFE_COMMAND_CHARS.test(command)) {
    console.log(`  [skip] ${plugin || '(unknown)'}: unsafe command name`)
    return false
  }
  if (!SAFE_PLUGIN_NAME.test(plugin)) {
    console.log(`  [skip] ${plugin}: invalid plugin name`)
    return false
  }
  const pluginDir = path.join(USER_PLUGINS_DIR, plugin)
  const resolvedPluginDir = path.resolve(pluginDir)
  if (!resolvedPluginDir.startsWith(path.resolve(USER_PLUGINS_DIR) + path.sep)) {
    console.log(`  [skip] ${plugin}: unsafe plugin path`)
    return false
  }
  if (fs.existsSync(pluginDir)) {
    if (!force) {
      console.log(`  [skip] ${plugin}: plugin already exists; use --force to replace it intentionally`)
      return false
    }
    fs.rmSync(pluginDir, { recursive: true, force: true })
  }

  const depth = Number.parseInt(process.env.AGENT_EXEC_STARTERKIT_DEPTH || '0', 10)
  const scan = scanCli(command, Number.isFinite(depth) && depth >= 0 ? depth : 0)
  if (!scan.helpText.trim()) {
    console.log(`  [skip] ${plugin}: no help output`)
    return false
  }

  writeScannedPlugin(pluginDir, plugin, command, scan, 'skill')

  // settings.json
  const allow = allowFromScan(command, scan)
  const settings = {
    "_": "Starter Kit generated skill plugin. Default ACL rules only permit detected help/version commands. Add broader patterns manually after review.",
    "_security": [
      "generated ACL rules are intentionally narrow.",
      "starterkit permits only detected help/version commands.",
      "do not add wildcard rules such as '*' or 'cmd *' unless the command is reviewed and intentionally trusted.",
      "run aexec plugin doctor before restart to detect broad wildcard rules.",
      "docs: https://to-agent.com/products/agent-exec/#acl"
    ],
    plugin: { type: 'skill', command },
    exec: { allow },
  }
  fs.writeFileSync(
    path.join(pluginDir, 'settings.json'),
    formatJson(settings)
  )
  printGeneratedSettings(pluginDir, settings)

  return true
}

// --- Main ---
const agents = loadSupportedAgents()
const target = positional[0] || null

const targets = target
  ? agents.filter(a => a.command === target || a.plugin === target)
  : agents

if (targets.length === 0) {
  console.log(`No agent found: ${target}`)
  process.exit(1)
}

console.log('\nStarter Kit — detecting installed AI agents...\n')

for (const agent of targets) {
  if (!commandExists(agent.command)) {
    console.log(`  ✗ ${agent.command.padEnd(12)} not found`)
    continue
  }

  console.log(`  ✓ ${agent.command.padEnd(12)} scanning...`)
  const ok = generatePlugin(agent)
  if (ok) console.log(`    → plugin generated: ${agent.plugin}`)
}

console.log('\nDone. Generated plugins are not active yet.')
console.log('Review generated settings.json files before restart; they add only detected help/version exec.allow rules.')
console.log('Apply after review:')
console.log('  aexec restart\n')
