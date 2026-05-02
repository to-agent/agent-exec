const fs = require('fs')
const paths = require('./paths')
const pluginControl = require('./plugin-control')

let _cache = null
let _cacheMtimes = {}
let _cacheSourcesKey = ''

function getMtimes(files) {
  const mtimes = {}
  for (const f of files) {
    try { mtimes[f] = fs.statSync(f).mtimeMs } catch { mtimes[f] = 0 }
  }
  return mtimes
}

function mtimesChanged(files) {
  const current = getMtimes(files)
  for (const f of files) {
    if (current[f] !== _cacheMtimes[f]) return true
  }
  return false
}

// Merge order:
//   default → active startup plugin snapshot → user settings → legacy local → project local.
function load() {
	const pluginSettings = pluginControl.activePluginSources().map(entry => entry.settings || {})
	const sources = [
    paths.DEFAULT_SETTINGS_FILE,
    paths.USER_SETTINGS_FILE,
    paths.USER_SETTINGS_LOCAL_FILE,
    paths.PROJECT_SETTINGS_LOCAL_FILE,
	]
	const pluginSourcesKey = pluginControl.activePluginSources()
		.map(entry => `${entry.name}:${entry.dir}:${entry.snapshotDev}:${entry.snapshotIno}`)
		.join('\0')
	const sourcesKey = sources.join('\0') + '\0plugins=' + pluginSourcesKey

	if (_cache && _cacheSourcesKey === sourcesKey && !mtimesChanged(sources)) return _cache

	let merged = {}
	for (const src of sources) {
    if (!fs.existsSync(src)) continue
    const data = JSON.parse(fs.readFileSync(src, 'utf8'))
    merged = deepMerge(merged, data)
    if (src === paths.DEFAULT_SETTINGS_FILE) {
      for (const data of pluginSettings) merged = deepMerge(merged, data)
    }
  }

	_cacheMtimes = getMtimes(sources)
	_cacheSourcesKey = sourcesKey
	_cache = merged
	return merged
}

function deepMerge(base, override) {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    if (Array.isArray(override[key])) {
      // Union merge: accumulate arrays so default deny patterns are never cleared by plugins.
      // Plugins add to allow/deny; local settings can add '*' to allow all.
      if (Array.isArray(base[key])) {
        const seen = new Set(base[key])
        const additions = override[key].filter(v => !seen.has(v))
        result[key] = [...base[key], ...additions]
      } else {
        result[key] = override[key]
      }
    } else if (typeof override[key] === 'object' && override[key] !== null) {
      result[key] = deepMerge(base[key] || {}, override[key])
    } else {
      result[key] = override[key]
    }
  }
  return result
}

function matchIpPattern(pattern, value) {
  return pattern === '*' || pattern === value
}

function checkIp(ip) {
  const { ip: ipConfig } = load()
  if (!ipConfig) return null
  const deny = ipConfig.deny || []
  const allow = ipConfig.allow || '*'
  if (Array.isArray(deny) && deny.some(p => matchIpPattern(p, ip))) return `IP ${ip} is denied`
  if (allow === '*') return null
  if (![].concat(allow).some(p => matchIpPattern(p, ip))) return `IP ${ip} is not allowed`
  return null
}

function matchCommandPattern(pattern, argsStr) {
  if (pattern === '*') return true
  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    try {
      return new RegExp(pattern.slice(1, -1)).test(argsStr)
    } catch {
      return false
    }
  }
  if (pattern.includes('*')) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp('^' + escaped).test(argsStr)
  }
  return argsStr === pattern
}

function checkCommand(args) {
  const { exec } = load()
  // Missing exec config means no execution is allowed.
  if (!exec) return `command not allowed: ${args.join(' ')}`

  // NOTE: ACL rules compare the submitted command and arguments before execution.
  // Execution itself uses execFile/spawn with argv, so agent-exec does not perform shell expansion.
  // Limitation: deny patterns using short flags (e.g. "rm -rf") may be bypassed
  // by equivalent long-form flags (e.g. "--recursive --force").
  // Use comprehensive regexp patterns in exec.deny to cover variants.
  const argsStr = args.join(' ')

  const deny = exec.deny || []
  if (Array.isArray(deny) && deny.some(p => matchCommandPattern(p, argsStr))) {
    return `command denied: ${argsStr}`
  }

  const allow = exec.allow || []
  // '*' in allow permits every command that did not match deny.
  if (Array.isArray(allow) && (allow.includes('*') || allow.some(p => matchCommandPattern(p, argsStr)))) {
    return null
  }

  return `command not allowed: ${argsStr}`
}

function _reset() {
	_cache = null
	_cacheMtimes = {}
	_cacheSourcesKey = ''
}

module.exports = { load, checkIp, checkCommand, matchCommandPattern, _reset }
