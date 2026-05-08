#!/usr/bin/env node

/**
 * setup.js — initial agent-exec setup
 *
 * Usage: aexec setup
 *
 * - Initialize ~/.to-agent/agent-exec/
 * - Generate and store API_KEY in .env
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const readline = require('readline')
const { USER_CONFIG_DIR, USER_PLUGINS_DIR, USER_SETTINGS_FILE, USER_SETTINGS_LOCAL_FILE, resolveEnvPath } = require('./modules/paths')
const { parseArgs } = require('./modules/parse-args')

const { params } = parseArgs(process.argv.slice(2))
const hasHelp = Object.prototype.hasOwnProperty.call(params, 'help') || Object.prototype.hasOwnProperty.call(params, 'h')
const skip = params.skip === true || params.skip === 'true' || params.yes === true || params.yes === 'true' || !process.stdin.isTTY

function printHelp() {
  console.log(`
Usage: aexec setup [options]

Configure API key and server settings interactively.

Options:
  --yes              Non-interactive setup. Generate API_KEY if missing.
  --skip             Alias for --yes.
  --use-project-env  Refused by setup. Use \`aexec dev --use-project-env\`
                     for process-only development env injection.
  -h, --help         Show this help.

Creates or updates:
  ${USER_CONFIG_DIR}/.env
  ${USER_CONFIG_DIR}/settings.json
  ${USER_CONFIG_DIR}/plugins/

Notes:
  Non-interactive stdin behaves like --yes.

Examples:
  aexec setup
  aexec setup --yes
  aexec setup --skip
`)
}

if (hasHelp) {
  printHelp()
  process.exit(0)
}

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

async function main() {
  console.log('\nagent-exec setup\n')

  if (params['use-project-env'] === true || params['use-project-env'] === 'true') {
    console.error('setup does not import project .env files.')
    console.error('Use `aexec dev --use-project-env` for process-only development env injection.')
    process.exit(1)
  }

  // --- Initialize user config directories ---
  const settingsDir = path.dirname(USER_SETTINGS_FILE)
  const localSettingsDir = path.dirname(USER_SETTINGS_LOCAL_FILE)
  fs.mkdirSync(USER_PLUGINS_DIR, { recursive: true })
  fs.mkdirSync(settingsDir, { recursive: true })
  fs.mkdirSync(localSettingsDir, { recursive: true })
  console.log(`Config dir: ${USER_CONFIG_DIR}`)

  // --- Resolve .env destination ---
  // Setup always writes to ~/.to-agent/agent-exec/.env.
  const targetEnvPath = path.join(USER_CONFIG_DIR, '.env')

  // Existing .env values are loaded only from user config.
  // Project .env is never imported into persistent setup.
  const existing = readEnvFile(targetEnvPath)

  // --- Configure API_KEY ---
  if (existing.API_KEY) {
    console.log('API_KEY: already set (skipping)')
  } else if (skip) {
    existing.API_KEY = crypto.randomBytes(32).toString('hex')
    console.log(`API_KEY: ${existing.API_KEY}`)
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await new Promise(resolve => {
      rl.question('API_KEY (Enter to auto-generate): ', resolve)
    })
    rl.close()

    const apiKey = answer.trim() || crypto.randomBytes(32).toString('hex')
    existing.API_KEY = apiKey
    console.log(`API_KEY: ${apiKey}`)
  }

  // Default AGENT_EXEC_ENABLED setting
  if (!existing.AGENT_EXEC_ENABLED) {
    existing.AGENT_EXEC_ENABLED = 'true'
  }

  // --- Write .env ---
  const content = Object.entries(existing)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n'
  fs.writeFileSync(targetEnvPath, content, { mode: 0o600 })
  fs.chmodSync(targetEnvPath, 0o600)

  if (!fs.existsSync(USER_SETTINGS_FILE)) {
    const settings = {
      exec: {
        allow: ['aexec --version'],
      },
    }
    fs.writeFileSync(USER_SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
    try { fs.chmodSync(USER_SETTINGS_FILE, 0o600) } catch {}
    console.log(`settings saved: ${USER_SETTINGS_FILE}`)
  } else {
    console.log(`settings: already exists (${USER_SETTINGS_FILE})`)
  }

  console.log(`\n.env saved: ${targetEnvPath}`)
  console.log('\n⚠️  Security reminder:')
  console.log('  agent-exec provides the mechanism. Security depth is your responsibility.')
  console.log(`  Review ${USER_SETTINGS_FILE} and configure exec.allow / exec.deny`)
  console.log('  before exposing this server to any network.')
  console.log('  See README.md → Security Model for details.\n')
  console.log('Next step:')
  console.log('  aexec start\n')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
