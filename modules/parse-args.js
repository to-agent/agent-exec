'use strict'

/**
 * Parse CLI arguments supporting both --key=value and --key value forms.
 *
 * Returns:
 *   params     — { key: value | true }
 *   positional — non-flag arguments
 *
 * Rules:
 *   --key=value  → params.key = 'value'
 *   --key value  → params.key = 'value'  (only if next arg doesn't start with '-')
 *   --key        → params.key = true      (next arg starts with '-' or absent)
 *   -x           → params.x   = true
 */
function parseArgs(argv) {
  const params = {}
  const positional = []
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    const long = a.match(/^--(\w[\w-]*)(?:=(.*))?$/)
    if (long) {
      const key = long[1]
      if (long[2] !== undefined) {
        params[key] = long[2]
      } else {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('-')) {
          params[key] = next
          i++
        } else {
          params[key] = true
        }
      }
    } else if (a.match(/^-(\w)$/)) {
      params[a[1]] = true
    } else {
      positional.push(a)
    }
    i++
  }
  return { params, positional }
}

module.exports = { parseArgs }
