#!/usr/bin/env node
'use strict'

/**
 * kill-port.js — best-effort port killer
 * Usage: node scripts/kill-port.js <port>
 *
 * There is no Node-standard, OS-independent API for "port -> PID".
 * Keep this script adapter-based and prefer kernel/proc data over shell tools.
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const port = parseInt(process.argv[2], 10) || 3333

function uniq(values) {
  return [...new Set(values.filter(n => Number.isInteger(n) && n > 0 && n !== process.pid))]
}

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (_) {
    return ''
  }
}

function pidsFromText(text) {
  const pids = []
  for (const m of text.matchAll(/\bpid=(\d+)\b/g)) pids.push(parseInt(m[1], 10))
  for (const m of text.matchAll(/(?:^|\s)(\d+)\/[^\s]+/g)) pids.push(parseInt(m[1], 10))
  return pids
}

function getViaLsof() {
  const out = run('lsof', ['-nP', '-tiTCP:' + port, '-sTCP:LISTEN'])
  return uniq(out.split(/\s+/).map(s => parseInt(s, 10)))
}

function getViaFuser() {
  const out = run('fuser', ['-n', 'tcp', String(port)])
  return uniq(out.split(/\s+/).map(s => parseInt(s, 10)))
}

function getViaSS() {
  const filtered = run('ss', ['-H', '-ltnp', `sport = :${port}`])
  const all = filtered || run('ss', ['-H', '-ltnp'])
  const lines = all.split('\n').filter(line => {
    const cols = line.trim().split(/\s+/)
    const local = cols[3] || ''
    return local.endsWith(`:${port}`) || local.endsWith(`.${port}`)
  })
  return uniq(pidsFromText(lines.join('\n')))
}

function getViaNetstat() {
  const out = run('netstat', ['-tlnp']) || run('netstat', ['-ano'])
  const lines = out.split('\n').filter(line => {
    const cols = line.trim().split(/\s+/)
    const local = cols[3] || cols[1] || ''
    return local.endsWith(`:${port}`) || local.endsWith(`.${port}`)
  })
  return uniq(pidsFromText(lines.join('\n')).concat(lines.map(line => {
    const last = line.trim().split(/\s+/).pop()
    return parseInt(last, 10)
  })))
}

function listeningInodesFromProc(file) {
  const inodes = new Set()
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch (_) { return inodes }
  const portHex = port.toString(16).toUpperCase().padStart(4, '0')
  for (const line of text.trim().split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/)
    const local = cols[1] || ''
    const state = cols[3] || ''
    const inode = cols[9]
    const localPort = local.split(':')[1]
    if (localPort === portHex && state === '0A' && inode) inodes.add(inode)
  }
  return inodes
}

function getViaLinuxProc() {
  const inodes = new Set([
    ...listeningInodesFromProc('/proc/net/tcp'),
    ...listeningInodesFromProc('/proc/net/tcp6'),
  ])
  if (inodes.size === 0) return []

  const pids = []
  let entries
  try { entries = fs.readdirSync('/proc') } catch (_) { return [] }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const pid = parseInt(entry, 10)
    const fdDir = path.join('/proc', entry, 'fd')
    let fds
    try { fds = fs.readdirSync(fdDir) } catch (_) { continue }
    for (const fd of fds) {
      let link
      try { link = fs.readlinkSync(path.join(fdDir, fd)) } catch (_) { continue }
      const m = link.match(/^socket:\[(\d+)\]$/)
      if (m && inodes.has(m[1])) {
        pids.push(pid)
        break
      }
    }
  }
  return uniq(pids)
}

function sleep(ms) {
  const data = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(data, 0, 0, ms)
}

function isRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (_) {
    return false
  }
}

function killPid(pid) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (e) {
    if (e.code === 'ESRCH') return true
    console.error(`Failed to signal PID ${pid}: ${e.message}`)
    return false
  }

  for (let i = 0; i < 10; i++) {
    if (!isRunning(pid)) {
      console.log(`Stopped process on port ${port} (PID: ${pid})`)
      return true
    }
    sleep(100)
  }

  try {
    process.kill(pid, 'SIGKILL')
    console.log(`Killed process on port ${port} (PID: ${pid})`)
    return true
  } catch (e) {
    if (e.code === 'ESRCH') return true
    console.error(`Failed to kill PID ${pid}: ${e.message}`)
    return false
  }
}

const pids = uniq([
  ...getViaLinuxProc(),
  ...getViaLsof(),
  ...getViaFuser(),
  ...getViaSS(),
  ...getViaNetstat(),
])

if (pids.length === 0) {
  console.log(`No process found on port ${port}`)
  process.exit(1)
}

const ok = pids.map(killPid).every(Boolean)
process.exit(ok ? 0 : 1)
