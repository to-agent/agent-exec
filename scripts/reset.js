#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const paths = require('../modules/paths')
const { parseArgs } = require('../modules/parse-args')
const { cliName } = require('./cli-name')

const { params } = parseArgs(process.argv.slice(2))

function timestamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '-',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('')
}

function printHelp() {
  const bin = cliName()
  console.log(`
Usage: ${bin} reset [options]

Reset the local agent-exec config to a fresh safe state.

By default, the current config directory is backed up before reset.

Options:
  --backup           Back up current config before reset (default)
  --no-backup        Remove current config without backup
  --yes              Confirm reset in non-interactive use
  --api-key <key>    Write this API_KEY to the fresh .env
  --keep-api-key     Reuse the current API_KEY if one exists
  --dry-run          Show what would happen without changing files
  --json             Print machine-readable result
  -h, --help         Show this help

Backup destination:
  ~/.to-agent/backups/agent-exec/reset-YYYYMMDD-HHMMSS/

Fresh config:
  ${paths.USER_CONFIG_DIR}/.env
  ${paths.USER_CONFIG_DIR}/settings.json
  ${paths.USER_CONFIG_DIR}/plugins/

Examples:
  ${bin} reset --yes
  ${bin} reset --yes --api-key test
  ${bin} reset --yes --keep-api-key
  ${bin} reset --dry-run
`)
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

function writeEnvFile(file, env) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const content = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
  fs.writeFileSync(file, content, { mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch {}
}

function defaultBackupRoot() {
  return path.join(os.homedir(), '.to-agent', 'backups', 'agent-exec')
}

function uniqueBackupDir(root) {
  const base = path.join(root, `reset-${timestamp()}`)
  if (!fs.existsSync(base)) return base
  for (let i = 1; i < 1000; i += 1) {
    const next = `${base}-${i}`
    if (!fs.existsSync(next)) return next
  }
  throw new Error(`could not allocate backup directory under ${root}`)
}

function isInteractive() {
  return process.stdin.isTTY && process.stdout.isTTY
}

function confirmOrExit({ dryRun, yes }) {
  if (dryRun || yes) return
  if (!isInteractive()) {
    throw new Error('refusing to reset without --yes in non-interactive mode')
  }
  console.error('Reset moves or removes the current config directory.')
  console.error('Re-run with --yes to confirm.')
  process.exit(1)
}

function stopServerIfRunning(dryRun, quiet = false) {
  if (dryRun) return false
  const originalLog = console.log
  try {
    if (quiet) console.log = () => {}
    return require('./commands/stop').run([], { exitOnNotRunning: false })
  } catch (error) {
    console.error(`Warning: stop failed: ${error.message}`)
    return false
  } finally {
    console.log = originalLog
  }
}

function createFreshConfig(apiKey) {
  fs.mkdirSync(paths.USER_PLUGINS_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(paths.USER_SETTINGS_FILE), { recursive: true })
  fs.mkdirSync(path.dirname(paths.USER_SETTINGS_LOCAL_FILE), { recursive: true })

  writeEnvFile(paths.resolveEnvPath(), {
    API_KEY: apiKey,
    AGENT_EXEC_ENABLED: 'true',
  })

  const settings = {
    exec: {
      allow: ['aexec --version'],
    },
  }
  fs.writeFileSync(paths.USER_SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
  try { fs.chmodSync(paths.USER_SETTINGS_FILE, 0o600) } catch {}
}

function keyPreview(value) {
  const key = String(value || '')
  if (!key) return '(missing)'
  if (key.length <= 8) return `${key.slice(0, 2)}...${key.slice(-2)}`
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

function main() {
  if (params.help || params.h) {
    printHelp()
    return
  }

  if (params['api-key'] && params['keep-api-key']) {
    throw new Error('use either --api-key or --keep-api-key, not both')
  }

  const dryRun = !!params['dry-run']
  const yes = !!params.yes
  const useBackup = params['no-backup'] ? false : true
  confirmOrExit({ dryRun, yes })

  const configDir = paths.USER_CONFIG_DIR
  const envFile = paths.resolveEnvPath()
  const currentEnv = readEnvFile(envFile)
  const nextApiKey = params['api-key']
    ? String(params['api-key'])
    : (params['keep-api-key'] && currentEnv.API_KEY
      ? currentEnv.API_KEY
      : crypto.randomBytes(32).toString('hex'))

  const backupRoot = defaultBackupRoot()
  const backupDir = useBackup && fs.existsSync(configDir) ? uniqueBackupDir(backupRoot) : null

  const result = {
    dryRun,
    configDir,
    stopped: false,
    backup: backupDir,
    backupEnabled: useBackup,
    apiKeyPreview: keyPreview(nextApiKey),
    freshAllow: ['aexec --version'],
  }

  if (!dryRun) {
    result.stopped = stopServerIfRunning(false, true)

    if (fs.existsSync(configDir)) {
      if (useBackup) {
        fs.mkdirSync(path.dirname(backupDir), { recursive: true })
        fs.renameSync(configDir, backupDir)
      } else {
        fs.rmSync(configDir, { recursive: true, force: true })
      }
    }

    createFreshConfig(nextApiKey)
  }

  if (params.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(dryRun ? 'agent-exec reset dry-run' : 'agent-exec reset complete')
  console.log('')
  console.log(`Config dir: ${configDir}`)
  if (useBackup) {
    console.log(`Backup: ${backupDir || '(no existing config to back up)'}`)
  } else {
    console.log('Backup: disabled by --no-backup')
  }
  console.log(`API_KEY: ${keyPreview(nextApiKey)}`)
  console.log('Fresh ACL: allow ["aexec --version"]')
  console.log('')
  console.log('Next:')
  console.log(`  ${cliName()} start --public`)
}

try {
  main()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
