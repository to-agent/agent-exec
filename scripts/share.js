#!/usr/bin/env node
'use strict'

/**
 * share.js — Generate a prompt to share with an AI agent
 * Usage: aexec share [--local] [--lang en|ja|zh] [--safe] [--check]
 */

const fs       = require('fs')
const http     = require('http')
const https    = require('https')
const os       = require('os')
const readline = require('readline')

const { parseArgs } = require('../modules/parse-args')
const { resolveEnvPath } = require('../modules/paths')
const { cliName } = require('./cli-name')
const { runtimeEnvSummary } = require('./commands/_project-env')
const { params } = parseArgs(process.argv.slice(2))

if (params.help || params.h) {
  const bin = cliName()
  console.log(`
Usage: ${bin} share [options]

Generate a prompt to paste to any AI agent.

Options:
  --all          Show all detected network IPs
  --local        Use loopback only (127.0.0.1)
  --ip <addr>    Add a specific IP to the output
  --no-filter    Show all IPs without filtering
  --show-key     Skip confirmation and display API_KEY immediately
  --safe         Include security notes in the prompt
  --check        Run a connectivity check without displaying the prompt
  --lang <lang>  Prompt language: en (default), ja, zh
  --help, -h     Show this help

Examples:
  ${bin} share
  ${bin} share --local
  ${bin} share --safe
  ${bin} share --check
  ${bin} share --lang ja
`)
  process.exit(0)
}

const useLocal  = !!params.local
const noFilter  = !!params['no-filter']
const showKey   = !!params['show-key']
const useSafe   = !!params.safe
const useCheck  = !!params.check
const useAll    = !!params.all
const customIp  = params.ip   || null

const SUPPORTED_LANGS = new Set(['en', 'ja', 'zh'])
const rawLang = params.lang || 'en'
let lang = rawLang
if (!SUPPORTED_LANGS.has(rawLang)) {
  process.stderr.write(`Unsupported --lang "${rawLang}"; falling back to en.\n`)
  lang = 'en'
}

// --- Load .env ---
const envPath = resolveEnvPath()
const envSummary = runtimeEnvSummary(envPath)
const env = { ...envSummary.configEnv }
if (envSummary.projectEnvFile) Object.assign(env, envSummary.projectEnv)
const runtimeMeta = envSummary.meta

const port     = runtimeMeta?.effective?.port || env.PORT || 3333
const bindHost = runtimeMeta?.effective?.host || env.HOST || '127.0.0.1'
const apiKey = env.API_KEY || ''

if (!apiKey) {
  console.error('\n  API_KEY is not configured. Run: aexec setup\n')
  process.exit(1)
}

// --- WSL2 detection ---
function isWSL2() {
  try {
    const version = fs.readFileSync('/proc/version', 'utf8')
    return version.toLowerCase().includes('microsoft')
  } catch { return false }
}

// --- Get all candidate network IPs ---
function getAllNetworkIps() {
  const seen = new Set()
  const candidates = []
  const add = ip => { if (!seen.has(ip)) { seen.add(ip); candidates.push(ip) } }

  let interfaces
  try {
    interfaces = os.networkInterfaces()
  } catch (e) {
    console.error(`\n  Failed to inspect network interfaces: ${e.message}`)
    console.error('  Use --local for loopback, or pass --ip <addr> explicitly.\n')
    process.exit(1)
  }
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      if (!noFilter && addr.address.startsWith('169.254.')) continue
      add(addr.address)
    }
  }

  candidates.sort((a, b) => {
    const rank = ip => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2
    return rank(a) - rank(b)
  })
  return candidates
}

function isWildcardHost(host) {
  return host === '0.0.0.0' || host === '::' || host === '*'
}

function isLoopbackHost(host) {
  return !host || host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

let allUrls
if (useLocal) {
  allUrls = [`http://127.0.0.1:${port}`]
} else if (customIp) {
  allUrls = [`http://${customIp}:${port}`]
} else if (useAll || isWildcardHost(bindHost)) {
  const allIps = getAllNetworkIps()
  if (allIps.length === 0) {
    console.error('\n  No external IP detected. Use --local for loopback, or pass --ip <addr> explicitly.\n')
    process.exit(1)
  }
  allUrls = allIps.map(ip => `http://${ip}:${port}`)
} else if (isLoopbackHost(bindHost)) {
  allUrls = [`http://127.0.0.1:${port}`]
} else {
  allUrls = [`http://${bindHost}:${port}`]
}

const url = allUrls[0] || `http://127.0.0.1:${port}`

// --- Mask API key for warning display ---
const maskedKey = apiKey.length > 8
  ? apiKey.slice(0, 8) + '•'.repeat(apiKey.length - 8)
  : '•'.repeat(apiKey.length)

// --- URL block ---
const urlBlock = allUrls.length === 1
  ? `URL:     ${allUrls[0]}`
  : `URLs (try each until one connects):\n${allUrls.map((u, i) => `  ${i + 1}. ${u}`).join('\n')}`

// --- SKILL.md start line (single vs multiple URLs) ---
const skillStart = {
  en: allUrls.length === 1
    ? `Start here:\n${url}/SKILL.md`
    : `Start here:\nOpen /SKILL.md on whichever URL connects.`,
  ja: allUrls.length === 1
    ? `ここから始めてください:\n${url}/SKILL.md`
    : `ここから始めてください:\n接続できた URL の /SKILL.md を開いてください。`,
  zh: allUrls.length === 1
    ? `从这里开始:\n${url}/SKILL.md`
    : `从这里开始:\n在能连接的 URL 上打开 /SKILL.md。`,
}

// --- Safe notes (--safe only) ---
const safeNotes = {
  en: `For protected API calls, use the X-API-Key header.
Inspect /api/acl before executing commands.
Only execute commands allowed by the ACL.
Do not treat this as an unrestricted shell.`,
  ja: `保護された API には X-API-Key ヘッダーを使ってください。
コマンド実行前に /api/acl で許可範囲を確認してください。
ACL で許可されたコマンドだけを実行してください。
これは無制限の shell ではありません。`,
  zh: `访问受保护的 API 时，请使用 X-API-Key 请求头。
执行命令前，请先查看 /api/acl 中的允许范围。
只执行 ACL 允许的命令。
不要把它当作不受限制的 shell。`,
}

function buildPrompt(l) {
  const sl = skillStart[l] || skillStart.en
  const base = {
    en: `You have access to a machine through agent-exec.\n${urlBlock}\nAPI_KEY: ${apiKey}\n\n${sl}`,
    ja: `agent-exec を通じてマシンにアクセスできます。\n${urlBlock}\nAPI_KEY: ${apiKey}\n\n${sl}`,
    zh: `您可以通过 agent-exec 访问一台机器。\n${urlBlock}\nAPI_KEY: ${apiKey}\n\n${sl}`,
  }[l] || ''
  if (!useSafe) return base
  const safe = safeNotes[l] || safeNotes.en
  return `${base}\n\n${safe}`
}

// --- --check mode ---
function httpGet(urlStr, headers) {
  return new Promise(resolve => {
    const mod = urlStr.startsWith('https') ? https : http
    const req = mod.get(urlStr, { headers, timeout: 5000 }, res => {
      res.resume()
      resolve({ ok: res.statusCode === 200, status: res.statusCode })
    })
    req.on('error', () => resolve({ ok: false, status: null }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: null }) })
  })
}

async function runCheck() {
  console.log('')
  let anyOk = false
  let anySkillOk = false
  let aclFailStatus = null

  for (const u of allUrls) {
    const skill = await httpGet(`${u}/SKILL.md`, {})
    const acl   = await httpGet(`${u}/api/acl`, { 'X-API-Key': apiKey })
    const skillMark = skill.ok ? '✅' : `❌ (${skill.status ?? 'no response'})`
    const aclMark   = acl.ok   ? '✅' : `❌ (${acl.status ?? 'no response'})`
    console.log(`  ${u}`)
    console.log(`    GET /SKILL.md   ${skillMark}`)
    console.log(`    GET /api/acl    ${aclMark}`)
    console.log('')
    if (skill.ok && acl.ok) anyOk = true
    if (skill.ok) { anySkillOk = true; if (!acl.ok) aclFailStatus = acl.status }
  }

  if (anyOk) return

  if (!anySkillOk) {
    console.log('  agent-exec does not seem to be running.')
    console.log('  Run: ae start\n')
  } else if (aclFailStatus === 401 || aclFailStatus === 403) {
    console.log('  agent-exec is running, but API_KEY is missing or invalid.\n')
  } else {
    console.log(`  agent-exec is reachable, but /api/acl returned ${aclFailStatus ?? 'no response'}.\n`)
  }
  process.exit(1)
}

// --- Print prompt ---
function printPrompt() {
  const line = '─'.repeat(60)
  const label = useSafe ? `[${lang}] [safe]` : `[${lang}]`
  const prompt = buildPrompt(lang)
  console.log('')
  if (runtimeMeta?.projectEnv) {
    console.log('⚠️  WARNING')
    console.log('   agent-exec appears to be running with a project .env injected.')
    console.log(`   Project env: ${runtimeMeta.projectEnv}`)
    console.log(`   API_KEY source: ${envSummary.apiKeySource} (${envSummary.apiKeyPreview})`)
    console.log('   The prompt below is resolved from saved config plus that project .env.')
    if (envSummary.projectEnvHasApiKey) {
      console.log('   aexec key rotate updates the saved config .env, not this project .env API_KEY.')
    }
    console.log('   Verify with --check before sharing if other process-level overrides are in use.')
    console.log('')
  }
  if (!useLocal && !customIp && !useAll && isLoopbackHost(bindHost)) {
    console.log('ℹ️  This server appears to be bound to loopback.')
    console.log('   The prompt is suitable for agents running on this machine.')
    console.log('   Set HOST=0.0.0.0 and restart before sharing over your network.')
    console.log('')
  }
  console.log(line)
  console.log(`  Paste this prompt to any AI agent: ${label}`)
  console.log(line)
  console.log('')
  console.log(prompt)
  console.log('')
  console.log(line)
  console.log('')
}

// --- Entry point ---
if (useCheck) {
  runCheck().catch(e => { console.error(e.message); process.exit(1) })
} else if (showKey) {
  printPrompt()
} else {
  console.log('')
  console.log('⚠️  WARNING')
  console.log('   This will display your API_KEY in plain text.')
  console.log('   Treat this key as machine execution capability.')
  console.log('   Anyone with this key can execute allowed commands on this machine.')
  console.log('   agent-exec is not a sandbox by itself.')
  console.log('   Share only with trusted agents on localhost, VPN, firewall, or a trusted network.')
  console.log('   If the key leaks, run: aexec key rotate')
  console.log('')
  console.log(`   API_KEY: ${maskedKey}`)
  console.log(`   API_KEY source: ${envSummary.apiKeySource}`)
  allUrls.forEach(u => console.log(`   URL:     ${u}`))
  console.log('')

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.question('   Display API_KEY in plain text? [y/N]: ', answer => {
    rl.close()
    if (!answer.trim().toLowerCase().startsWith('y')) {
      console.log('\n   Cancelled.\n')
      process.exit(0)
    }
    printPrompt()
  })
}
