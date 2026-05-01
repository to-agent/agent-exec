'use strict'

const path = require('path')
const os = require('os')

function resolveTilde(p) {
	if (!p) return p
	return p.replace(/^~/, os.homedir())
}

const PACKAGE_DIR = path.join(__dirname, '..')
const WWW_PATH = path.join(PACKAGE_DIR, 'bin', 'www')
const USER_CONFIG_DIR = resolveTilde(
	process.env.AGENT_EXEC_CONFIG_DIR || path.join(os.homedir(), '.to-agent', 'agent-exec')
)
const PID_FILE = path.join(USER_CONFIG_DIR, 'agent-exec.pid')
const PID_META_FILE = path.join(USER_CONFIG_DIR, 'agent-exec.pid.json')
const ENV_FILE = path.join(USER_CONFIG_DIR, '.env')

module.exports = { PACKAGE_DIR, WWW_PATH, USER_CONFIG_DIR, PID_FILE, PID_META_FILE, ENV_FILE }
