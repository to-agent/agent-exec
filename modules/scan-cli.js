'use strict'

const { execFileSync } = require('child_process')

// Try common help flags in order; return first non-empty output
function runHelp(cmdArgs) {
  const base = cmdArgs[0]
  const rest = cmdArgs.slice(1)

  const attempts = [
    [...rest, '--help'],
    [...rest, '-h'],
    [...rest, 'help'],
    [...rest, '-?'],
    [...rest, '-help'],
    [...rest, '/?'],
    [...rest, '--usage'],
  ]

  // Also try "cmd help <sub>" form (git-style: git help log)
  if (rest.length > 0) {
    attempts.push(['help', ...rest])
  }

  for (const args of attempts) {
    try {
      const out = execFileSync(base, args, {
        timeout: 5000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      })
      if (out.trim()) return out
    } catch (e) {
      const combined = (e.stdout || '') + (e.stderr || '')
      if (combined.trim()) return combined
    }
  }
  return ''
}

function extractUsage(helpText) {
  const m = helpText.match(/^[Uu]sage:\s*(.+)$/m)
  return m ? m[1].trim() : ''
}

function extractDescription(helpText) {
  const lines = helpText.split('\n')
  const descLines = []
  let pastUsage = false
  let inDesc = false

  const isUsageContinuation = (s) => /^or:/i.test(s) || /^usage:/i.test(s)
  const isSectionHeader = (s) => /^(Options?|Arguments?|Commands?|Subcommands?|Flags?|Examples?|Global\s)/i.test(s)

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^[Uu]sage:/.test(trimmed)) { pastUsage = true; continue }
    if (!pastUsage) continue
    if (isUsageContinuation(trimmed)) continue  // skip "or: ..." lines
    if (isSectionHeader(trimmed)) break
    if (trimmed === '') {
      if (inDesc) break
      continue
    }
    descLines.push(trimmed)
    inDesc = true
  }

  if (descLines.length > 0) return descLines.join(' ').trim()

  // Fallback: first meaningful line that is not a Usage/flag/section header
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^[Uu]sage:/.test(trimmed)) continue
    if (isUsageContinuation(trimmed)) continue
    if (isSectionHeader(trimmed)) break
    if (trimmed.startsWith('-')) continue
    if (trimmed.length > 8) return trimmed
  }

  return ''
}

function parseCommands(helpText) {
  const lines = helpText.split('\n')
  const commands = []
  let inSection = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Match section headers that contain subcommand listings:
    // "Commands:", "Available Commands:", "Management Commands:", "COMMANDS:",
    // "positional arguments:" (Python argparse), "Subcommands:", etc.
    if (/\b(commands?|subcommands?|positional\s+arguments?)\b/i.test(trimmed) && trimmed.endsWith(':')) {
      inSection = true
      continue
    }

    if (!inSection) continue

    // Stop at any non-indented section header that is NOT a commands section
    if (trimmed.endsWith(':') && !/^\s/.test(line) && !/\b(commands?|subcommands?|positional\s+arguments?)\b/i.test(trimmed)) {
      inSection = false
      continue
    }

    // Command lines: 1–8 spaces indent, must not start with '-'
    if (!/^\s{1,8}\S/.test(line)) continue
    const content = line.trimStart()
    if (content.startsWith('-')) continue

    const rawName = content.split(/\s/)[0]
    const name = rawName.split('|')[0] // handle "update|upgrade" aliases
    // Valid command names: alphanumeric + hyphens/underscores
    if (!name || name === 'help' || !/^[\w][\w-]*$/.test(name)) continue

    // Require double-space separator between name part and description
    // This rejects example lines like "  claude mcp add --flag value"
    const descMatch = content.match(/\s{2,}(.+)$/)
    if (!descMatch) continue

    commands.push({ name, description: descMatch[1].trim() })
  }

  return commands
}

function scanNode(cmdArgs, maxDepth, currentDepth) {
  const helpText = runHelp(cmdArgs)
  const description = extractDescription(helpText)
  const usage = extractUsage(helpText)

  const commands = []
  if (currentDepth < maxDepth) {
    for (const sub of parseCommands(helpText)) {
      const subArgs = [...cmdArgs, sub.name]
      process.stdout.write(`  scanning: ${subArgs.join(' ')} ...\n`)
      const subNode = scanNode(subArgs, maxDepth, currentDepth + 1)
      commands.push({
        name: sub.name,
        args: subArgs,
        description: subNode.description || sub.description,
        usage: subNode.usage,
        helpText: subNode.helpText,
        commands: subNode.commands
      })
    }
  }

  return { helpText, description, usage, commands }
}

/**
 * Scan a CLI tool recursively via --help / -h.
 * Returns a tree: { helpText, description, usage, commands[] }
 */
function scanCli(cmd, maxDepth = 2) {
  return scanNode([cmd], maxDepth, 0)
}

/**
 * Flatten the command tree into a list of reference file entries.
 * { filename, args, description, helpText }
 */
function flattenRefs(commands, prefix = '') {
  const refs = []
  for (const cmd of commands) {
    const key = prefix ? `${prefix}-${cmd.name}` : cmd.name
    refs.push({ filename: `${key}.md`, args: cmd.args, description: cmd.description, helpText: cmd.helpText })
    if (cmd.commands.length > 0) {
      refs.push(...flattenRefs(cmd.commands, key))
    }
  }
  return refs
}

module.exports = { scanCli, flattenRefs }
