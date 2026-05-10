#!/usr/bin/env node
'use strict'

const major = Number.parseInt(process.versions.node.split('.')[0], 10)

if (Number.isFinite(major) && major >= 20) process.exit(0)

console.error('Error: agent-exec requires Node.js 20 or newer.')
console.error(`Current Node.js: ${process.version}`)
console.error('')
console.error('Reason:')
console.error('  agent-exec currently uses marked@18 for Markdown rendering,')
console.error('  and marked@18 requires Node.js 20 or newer.')
console.error('')
console.error('Next step:')
console.error('  Install Node.js 20 or newer using your OS/package-manager-supported path,')
console.error('  then run this install command again.')
console.error('')
console.error('Verify before retrying:')
console.error('  node --version')
console.error('  npm --version')

process.exit(1)
