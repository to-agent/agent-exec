/**
 * modules/paths.js — central path management
 *
 * Priority:
 *   .env          : ~/.to-agent/agent-exec/.env
 *   settings     : AGENT_EXEC_SETTINGS_FILE env → ~/.to-agent/agent-exec/settings.json
 *   settings/local: SETTINGS_DIR env → ~/.to-agent/agent-exec/settings/local/
 *   plugins/      : PLUGINS_DIR env  → ~/.to-agent/agent-exec/plugins/
 */

const os = require('os')
const path = require('path')
const fs = require('fs')

const PACKAGE_DIR = path.join(__dirname, '..')

function resolveTilde(p) {
  if (!p) return p
  return p.replace(/^~/, os.homedir())
}

// User config directory.
const USER_CONFIG_DIR = resolveTilde(
  process.env.AGENT_EXEC_CONFIG_DIR || path.join(os.homedir(), '.to-agent', 'agent-exec')
)

// Bundled plugins shipped with the package.
const BUNDLED_PLUGINS_DIR = path.join(PACKAGE_DIR, 'plugins')

// User plugins.
const USER_PLUGINS_DIR = resolveTilde(
  process.env.PLUGINS_DIR || path.join(USER_CONFIG_DIR, 'plugins')
)

// Default settings shipped with the package.
const DEFAULT_SETTINGS_FILE = path.join(PACKAGE_DIR, 'settings', 'default', 'settings.json')

// Primary user settings file. This is the normal file admins edit.
const USER_SETTINGS_FILE = resolveTilde(
  process.env.AGENT_EXEC_SETTINGS_FILE || path.join(USER_CONFIG_DIR, 'settings.json')
)

// Project-local settings for development overrides.
const PROJECT_SETTINGS_LOCAL_FILE = resolveTilde(
  process.env.AGENT_EXEC_PROJECT_SETTINGS_FILE || path.join(PACKAGE_DIR, 'settings', 'local', 'settings.json')
)

// Legacy/advanced user-local settings.
const USER_SETTINGS_LOCAL_FILE = resolveTilde(
  process.env.SETTINGS_DIR
    ? path.join(resolveTilde(process.env.SETTINGS_DIR), 'settings.json')
    : path.join(USER_CONFIG_DIR, 'settings', 'local', 'settings.json')
)

// Conversion cache for rendered public/private SKILL files.
const CACHE_DIR = resolveTilde(
  process.env.CACHE_DIR || path.join(USER_CONFIG_DIR, 'cache')
)

// Resolve .env path. Runtime reads only the user config .env.
// Project .env is injected into process env by aexec dev --use-project-env.
function resolveEnvPath() {
  if (process.env.AGENT_EXEC_ENV_FILE) return resolveTilde(process.env.AGENT_EXEC_ENV_FILE)
  return path.join(USER_CONFIG_DIR, '.env')
}

// List plugins from both directories. User plugins can override by name.
function listPlugins() {
  const map = new Map()

  for (const dir of [module.exports.BUNDLED_PLUGINS_DIR, module.exports.USER_PLUGINS_DIR]) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      const pluginDir = path.join(dir, name)
      if (!fs.statSync(pluginDir).isDirectory()) continue
      map.set(name, pluginDir) // user plugin wins
    }
  }

  return map // Map<name, absolutePath>
}

module.exports = {
  PACKAGE_DIR,
  USER_CONFIG_DIR,
  BUNDLED_PLUGINS_DIR,
  USER_PLUGINS_DIR,
  DEFAULT_SETTINGS_FILE,
  USER_SETTINGS_FILE,
  PROJECT_SETTINGS_LOCAL_FILE,
  USER_SETTINGS_LOCAL_FILE,
  CACHE_DIR,
  resolveEnvPath,
  listPlugins,
  listPluginSources,
}

// Keep bundled/user sources separate for system plugin override detection.
function listPluginSources() {
  const sources = []
  for (const [dir, source] of [
    [module.exports.BUNDLED_PLUGINS_DIR, 'bundled'],
    [module.exports.USER_PLUGINS_DIR,    'user'],
  ]) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      const pluginDir = path.join(dir, name)
      try { if (!fs.statSync(pluginDir).isDirectory()) continue } catch { continue }
      sources.push({ name, dir: pluginDir, source })
    }
  }
  return sources
}
