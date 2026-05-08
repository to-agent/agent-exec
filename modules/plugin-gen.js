'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { flattenRefs } = require('./scan-cli')

// ---------------------------------------------------------------------------
// AI-assisted generation
// ---------------------------------------------------------------------------

const FILE_MARKER = '=== FILE:'
const FILE_MARKER_END = '==='

function commandArgs(cmd, args, fallback) {
	const suffix = Array.isArray(args) && args.length > 0 ? args : fallback
	return [cmd, ...suffix]
}

function jsonArgs(cmd, args, fallback) {
	return JSON.stringify({ args: commandArgs(cmd, args, fallback) })
}

function shellLine(cmd, args, fallback) {
	return commandArgs(cmd, args, fallback).join(' ')
}

function buildAiPrompt(name, cmd, scan) {
	const refs = flattenRefs(scan.commands)
	const helpLine = shellLine(cmd, scan.helpArgs, ['--help'])
	const helpJson = jsonArgs(cmd, scan.helpArgs, ['--help'])
	const versionJson = Array.isArray(scan.versionArgs) && scan.versionArgs.length > 0
		? `\n\`\`\`json\n${jsonArgs(cmd, scan.versionArgs, [])}\n\`\`\`\n`
		: ''

	// Build scanned help texts section
	const helpSections = [`--- ${helpLine} ---\n${scan.helpText.slice(0, 2000)}`]
	for (const ref of refs) {
		helpSections.push(`--- ${ref.args.join(' ')} --help ---\n${ref.helpText.slice(0, 800)}`)
	}

	// Build expected file list
	const expectedFiles = [
		'SKILL.md',
		'references/usage.md',
		...refs.map(r => `references/${r.filename}`)
	]

	return `You are generating plugin documentation for agent-exec.
agent-exec is an HTTP server that lets AI agents discover and execute CLI tools via HTTP.
Your output will be read by AI agents, not humans.

If you have web search capability, search for the official documentation of "${cmd}" first.
Use official docs as the primary source and the help text below as a supplement or fallback.
If web search is not available, use only the help text provided.

Rules:
- Be accurate. Do not invent flags or subcommands not shown in help or official docs.
- Description: one sentence, plain English.
- Key Commands: keep generated defaults aligned with ACL. Include detected help/version commands first. Broader examples require manual settings.json review.
- Agent Usage: explain the safest non-interactive command form for an AI agent.
- Known Gotchas: document stdin waits, interactive prompts, timeout risk, approval flags, resume/session support, or state that none are known from the provided docs.
- Each reference file: one-line description, key flags, 2-3 JSON usage examples.

Generate ALL of the following files for the "${cmd}" CLI (plugin name: "${name}"):
${expectedFiles.map(f => `  - ${f}`).join('\n')}

Output format — use this exact marker for each file, no extra text between files:
${FILE_MARKER} <filepath> ${FILE_MARKER_END}
<file content>

SKILL.md format:
# SKILL: ${name}
# Endpoint: POST /api/exec
# Description: <one sentence>

## Overview
Run \`${cmd}\` commands via \`POST /api/exec\`:
\`\`\`json
{"args": ["${cmd}", "<subcommand>", "<args...>"]}
\`\`\`

## Request
The first JSON block in this section is the canonical request body for converters.
Use the simplest documented safe command form.

Request body:

\`\`\`json
${helpJson}
\`\`\`
<!-- ae:prev request.body -> all -->

## Subcommands
- [<name>](references/<name>.md) — <description>

## Key Commands
Default generated ACL permits only detected help/version commands. Broader examples require manual settings.json review.
Use one JSON object per fenced block.

\`\`\`json
${helpJson}
\`\`\`
${versionJson}

## Agent Usage
- Prefer non-interactive commands when available.
- Check \`/api/acl\` before execution.
- Avoid long-running interactive commands unless the CLI documents a non-interactive mode.

## Known Gotchas
- Document stdin behavior, prompts, approval flags, and resume/session support if known.
- Do not assume unsupported flags.

## Full Reference
- [usage](references/usage.md) — Full \`${helpLine}\` output

## Notes
- Requires \`${cmd}\` to be installed

Reference file format (references/<name>.md):
# ${cmd} <subcommand>
<one-line description>

## Usage
\`\`\`json
{"args": ["${cmd}", "<subcommand>", "<arg>"]}
\`\`\`

## Key Flags
<flag list>

---
${helpSections.join('\n\n')}`
}

function parseAiOutput(output) {
	const files = {}
	const regex = new RegExp(`${FILE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(.+?)\\s+${FILE_MARKER_END}`, 'g')
	const parts = output.split(regex)

	// parts: [before, filepath1, content1, filepath2, content2, ...]
	for (let i = 1; i < parts.length; i += 2) {
		const filepath = parts[i].trim()
		const content = (parts[i + 1] || '').trim()
		if (filepath && content) files[filepath] = content
	}
	return files
}

function enforceDetectedRequestDirective(content, cmd, scan) {
	const helpJson = jsonArgs(cmd, scan.helpArgs, ['--help'])
	const block = `## Request

The first JSON block in this section is the canonical request body for converters.

Request body:

\`\`\`json
${helpJson}
\`\`\`
<!-- ae:prev request.body -> all -->`

	const hasDirective = /<!--\s*(?:ae:prev\s+request\.body\s*->\s*(?:all|sjs)|sjs:prev\s+request\.body|sjs:request\.body)\s*-->/.test(content)
	if (!hasDirective) {
		if (/^##\s+Key Commands\b/m.test(content)) {
			return content.replace(/^##\s+Key Commands\b/m, `${block}\n\n## Key Commands`)
		}
		return `${content.trimEnd()}\n\n${block}\n`
	}

	return content.replace(
		/(##\s+Request[\s\S]*?```(?:json)?\s*\n)([\s\S]*?)(\n```[\s\S]*?<!--\s*(?:ae:prev\s+request\.body\s*->\s*(?:all|sjs)|sjs:prev\s+request\.body|sjs:request\.body)\s*-->)/,
		`$1${helpJson}$3`
	)
}

function runAi(aiTool, prompt) {
	try {
		const out = execFileSync(aiTool, [prompt], {
			encoding: 'utf8',
			timeout: 300000,
			stdio: ['pipe', 'pipe', 'pipe']
		})
		return out.trim()
	} catch (e) {
		const out = ((e.stdout || '') + (e.stderr || '')).trim()
		if (out) return out
		throw new Error(`${aiTool} failed: ${e.message}`)
	}
}

async function writeScannedPluginWithAi(pluginDir, name, cmd, scan, type, aiTool) {
	fs.mkdirSync(path.join(pluginDir, 'references'), { recursive: true })
	const refs = flattenRefs(scan.commands)
	const expectedFiles = [
		'SKILL.md',
		'references/usage.md',
		...refs.map(r => `references/${r.filename}`)
	]

	// 1. Build prompt and call AI (one shot)
	process.stdout.write(`  calling ${aiTool}...\n`)
	const prompt = buildAiPrompt(name, cmd, scan)
	const aiOutput = runAi(aiTool, prompt)

	// 2. Parse output into files
	const generated = parseAiOutput(aiOutput)
	if (generated['SKILL.md']) {
		generated['SKILL.md'] = enforceDetectedRequestDirective(generated['SKILL.md'], cmd, scan)
	}

	// 3. Write files with path traversal protection.
	const resolvedPluginDir = path.resolve(pluginDir)
	for (const [filepath, content] of Object.entries(generated)) {
		const fullPath = path.resolve(path.join(pluginDir, filepath))
		if (!fullPath.startsWith(resolvedPluginDir + path.sep)) {
			process.stderr.write(`  ✗ skipped unsafe path: ${filepath}\n`)
			continue
		}
		fs.mkdirSync(path.dirname(fullPath), { recursive: true })
		fs.writeFileSync(fullPath, content + '\n')
		process.stdout.write(`  wrote ${filepath}\n`)
	}

	// 4. Verify — report missing files
	const missing = expectedFiles.filter(f => !generated[f])
	if (missing.length > 0) {
		process.stdout.write(`\n  ⚠ Missing files (not generated by AI):\n`)
		for (const f of missing) {
			process.stdout.write(`    - ${f}\n`)
		}
		process.stdout.write(`  Falling back to scan-based generation for missing files...\n`)

		// Fallback: generate missing files from scan data
		if (missing.includes('SKILL.md')) {
			fs.writeFileSync(path.join(pluginDir, 'SKILL.md'), buildSkillMd(name, cmd, scan, type))
		}
		if (missing.includes('references/usage.md')) {
			fs.writeFileSync(path.join(pluginDir, 'references', 'usage.md'), buildRefMd([cmd], scan.description, scan.helpText))
		}
		for (const ref of refs) {
			if (missing.includes(`references/${ref.filename}`)) {
				fs.writeFileSync(path.join(pluginDir, 'references', ref.filename), buildRefMd(ref.args, ref.description, ref.helpText))
			}
		}
	}

	return refs
}

function buildSkillMd(name, cmd, scan, type) {
	const desc = scan.description || `${cmd} — describe what this plugin does`
	const helpLine = shellLine(cmd, scan.helpArgs, ['--help'])
	const helpJson = jsonArgs(cmd, scan.helpArgs, ['--help'])
	const versionJson = Array.isArray(scan.versionArgs) && scan.versionArgs.length > 0
		? `\n\`\`\`json\n${jsonArgs(cmd, scan.versionArgs, [])}\n\`\`\`\n`
		: ''

	let subcmdSection = ''
	if (scan.commands.length > 0) {
		const lines = []
		for (const c of scan.commands) {
			lines.push(`- [${c.name}](references/${c.name}.md) — ${c.description}`)
			for (const sub of c.commands) {
				lines.push(`  - [${c.name} ${sub.name}](references/${c.name}-${sub.name}.md) — ${sub.description}`)
			}
		}
		subcmdSection = `\n## Subcommands\n\n${lines.join('\n')}\n`
	}

	return `# SKILL: ${name}
# Endpoint: POST /api/exec
# Description: ${desc}

## Overview

Run \`${cmd}\` commands via \`POST /api/exec\`:

\`\`\`json
{"args": ["${cmd}", "<subcommand>", "<args...>"]}
\`\`\`

## Request

The first JSON block in this section is the canonical request body for converters.

Request body:

\`\`\`json
${helpJson}
\`\`\`
<!-- ae:prev request.body -> all -->
${subcmdSection}
## Key Commands

\`\`\`json
${helpJson}
\`\`\`
${versionJson}

## Agent Usage

- Prefer non-interactive flags if this CLI provides them.
- Check \`GET /api/acl\` before calling \`POST /api/exec\`.
- Avoid long-running interactive commands unless this CLI documents a non-interactive mode.
- If the command waits for stdin or confirmation, use documented non-interactive flags instead of interactive mode.

## Known Gotchas

- This file is generated from \`${helpLine}\`; verify important flags against official documentation.
- Do not assume approval, auto-yes, resume, or session flags unless they are documented in the reference files.

## Full Reference

- [usage](references/usage.md) — Full \`${helpLine}\` output

## Notes

- Requires \`${cmd}\` to be installed
${type === 'full' ? `- Install: see \`install.sh\` in this plugin` : ''}
`
}

function buildRefMd(args, description, helpText) {
	const title = args.join(' ')
	const desc = description ? `\n${description}\n` : ''
	return `# ${title}
${desc}
\`\`\`
${helpText.trimEnd()}
\`\`\`
`
}

/**
 * Write SKILL.md, references/, and return list of generated files.
 */
function writeScannedPlugin(pluginDir, name, cmd, scan, type) {
	fs.mkdirSync(path.join(pluginDir, 'references'), { recursive: true })

	fs.writeFileSync(path.join(pluginDir, 'SKILL.md'), buildSkillMd(name, cmd, scan, type))
	fs.writeFileSync(
		path.join(pluginDir, 'references', 'usage.md'),
		buildRefMd([cmd], scan.description, scan.helpText)
	)

	const refs = flattenRefs(scan.commands)
	for (const ref of refs) {
		fs.writeFileSync(
			path.join(pluginDir, 'references', ref.filename),
			buildRefMd(ref.args, ref.description, ref.helpText)
		)
	}

	return refs
}

module.exports = { buildSkillMd, buildRefMd, writeScannedPlugin, writeScannedPluginWithAi }
