'use strict'

const SAFE_SJS_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/

function isSafeSjsPath(path) {
	return SAFE_SJS_PATH.test(path)
}

function memoRuleAssignment() {
	return `m.rule.memo = {
  purpose: "short state handoff across requests",
  carries: "goal, selected surface, last useful observation",
  echo: memo,
  behavior: "opaque echo; not interpreted or stored; keep small"
};`
}

function aclResponseAssignments() {
	return `m["/api/acl"].response.allow = ['<command> [<arg>]...', '...'];
m["/api/acl"].response.allow.kind = "argv_string";
m["/api/acl"].response.allow.syntax = '<command> [<arg>]...';
m["/api/acl"].response.allow.to_args = ['<command>', '<arg>', '...'];
m["/api/acl"].response.deny = ['<denied pattern>', '...'];`
}

function execResponseAssignments({ length = true, duration = true, stderr = true } = {}) {
	const lines = [
		`m["/api/exec"].response.output = '<stdout>';`,
	]
	if (length) lines.push('m["/api/exec"].response.length = 0;')
	lines.push('m["/api/exec"].response.exitCode = 0;')
	lines.push('m["/api/exec"].response.status = "done";')
	if (duration) lines.push('m["/api/exec"].response.duration = 0;')
	if (stderr) lines.push(`m["/api/exec"].response.stderr = '<stderr>';`)
	return lines.join('\n')
}

function aclSurface({ includeResponseValues = true } = {}) {
	return `m["/api/acl"] = {
  method: "GET",
  url: "/api/acl",
  document: "/api/acl/SKILL.s.js",
  request: {
    headers: {
      "X-API-Key": client.API_KEY,
      "Accept": "text/sjs"
    }
  },
  refs: [
    "/api/exec/SKILL.s.js"
  ]
};
${includeResponseValues ? aclResponseAssignments() : ''}`
}

function execSurface() {
	return `m["/api/exec"] = {
  method: "POST",
  url: "/api/exec",
  document: "/api/exec/SKILL.s.js",
  operation: 'POST /api/exec AUTH {"args":["aexec","--version"]}',
  request: {
    headers: {
      "X-API-Key": client.API_KEY,
      "Content-Type": "application/json",
      "Accept": "text/sjs"
    },
    body: { args: ["<command>", "<arg>", "..."] }
  },
  refs: [
    "/api/acl/SKILL.s.js"
  ]
};
m["/api/exec"].request.body.args.example = ["aexec", "--version"];
m["/api/exec"].request.body.args.kind = "argv";
m["/api/exec"].request.body.args.syntax = '<command> [<arg>]...';
${execResponseAssignments()}`
}

function rootSurface({ refs = ['/api/acl/SKILL.s.js', '/api/exec/SKILL.s.js'] } = {}) {
	const refLines = refs.map((ref, index) => `    ${JSON.stringify(ref)}${index === refs.length - 1 ? '' : ','}`).join('\n')
	return `m["/"] = {
  method: "GET",
  url: "/",
  document: "/SKILL.s.js",
  refs: [
${refLines}
  ]
};`
}

function rootSkillSjs() {
	return `// /SKILL.s.js
m.rule = {
  skill: "agent-exec",
  endpoint: "/",
  description: "Self-describing HTTP execution surface for AI agents"
};
${memoRuleAssignment()}

${rootSurface()}

${aclSurface()}

${execSurface()}
`
}

function rootIndexJs() {
	return `// /index.js
m.rule = {
  skill: "agent-exec",
  endpoint: "/",
  description: "AI-friendly host index. Read a skill document before execution."
};
${memoRuleAssignment()}

m["/"] = {
  method: "GET",
  url: "/",
  html: "/index.html",
  md: "/index.md",
  js: "/index.js",
  refs: [
    "/SKILL.s.js",
    "/SKILL.md",
    "/api/index.md",
    "/skills/index.md"
  ]
};
`
}

function rootIndexSjs() {
	return `// /index.s.js
m.rule = {
  skill: "agent-exec",
  endpoint: "/",
  description: "AI-friendly host index. Read a skill document before execution."
};
${memoRuleAssignment()}

${rootSurface({ refs: ['/SKILL.s.js'] })}
`
}

function aclSjs() {
	return `// /api/acl/SKILL.s.js
m.rule = {
  skill: "api/acl",
  endpoint: "/api/acl",
  description: "Allowed and denied commands",
  request: {
    headers: {
      "X-API-Key": client.API_KEY,
      "Accept": "text/sjs"
    }
  },
  command_rule: "plain string allow is exact; do not append subcommands or flags unless the full command is allowed"
};
${memoRuleAssignment()}

${aclSurface()}

${execSurface()}
`
}

function execSjs() {
	return `// /api/exec/SKILL.s.js
m.rule = {
  skill: "api/exec",
  endpoint: "/api/exec",
  request_rule: "body must contain only args; no cmd, command, shell, env, or cwd",
  command_rule: "plain string allow is exact; do not append subcommands or flags unless the full command is allowed"
};
${memoRuleAssignment()}

${execSurface()}

${aclSurface()}
`
}

function aclRuntimeSjs({ allow = [], deny = [] } = {}) {
	return `// /api/acl
m.rule = {
  skill: "api/acl",
  endpoint: "/api/acl",
  description: "Allowed and denied commands"
};
${memoRuleAssignment()}

${aclSurface({ includeResponseValues: false })}
m["/api/acl"].response.allow = ${renderSjsValue(allow)};
m["/api/acl"].response.allow.kind = "argv_string";
m["/api/acl"].response.allow.syntax = '<command> [<arg>]...';
m["/api/acl"].response.allow.to_args = ['<command>', '<arg>', '...'];
m["/api/acl"].response.deny = ${renderSjsValue(deny)};

${execSurface()}
`
}

function pluginsRuntimeSjs({ plugins = [] } = {}) {
	return `// /api/plugins
m.rule = {
  skill: "api/plugins",
  endpoint: "/api/plugins",
  description: "Active plugin documentation links"
};
${memoRuleAssignment()}

m["/api/plugins"] = {
  method: "GET",
  url: "/api/plugins",
  document: "/api/plugins/SKILL.s.js",
  request: {
    headers: {
      "X-API-Key": client.API_KEY,
      "Accept": "text/sjs"
    }
  },
  refs: [
    "/private/skills/SKILL.s.js",
    "/api/acl/SKILL.s.js"
  ]
};
m["/api/plugins"].response.plugins = ${renderSjsValue(plugins)};
`
}

function parseEndpoint(endpoint) {
	const match = String(endpoint || '').trim().match(/^([A-Z]+)\s+(\S+)$/)
	if (!match) return { method: 'GET', url: '/' }
	return { method: match[1], url: match[2] }
}

function renderSjsValue(value) {
	if (value === undefined) return 'undefined'
	if (value === null) return 'null'
	if (typeof value === 'string') return JSON.stringify(value)
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	if (Array.isArray(value)) return `[${value.map(renderSjsValue).join(', ')}]`
	if (typeof value === 'object') {
		const entries = Object.entries(value).map(([key, val]) => {
			const renderedKey = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)
			return `${renderedKey}: ${renderSjsValue(val)}`
		})
		return `{ ${entries.join(', ')} }`
	}
	return JSON.stringify(String(value))
}

function renderSjsHeaderValue(key, value) {
	if (String(key).toLowerCase() === 'x-api-key' && value === 'API_KEY') return 'client.API_KEY'
	if (String(key).toLowerCase() === 'x-api-key' && value === 'client.API_KEY') return 'client.API_KEY'
	return renderSjsValue(value)
}

function renderSjsHeaders(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return renderSjsValue(value)
	const entries = Object.entries(value).map(([key, val]) =>
		`${JSON.stringify(key)}: ${renderSjsHeaderValue(key, val)}`
	)
	return `{ ${entries.join(', ')} }`
}

function parseExplicitMSurfacePath(target) {
	const match = String(target || '').match(/^m\s*\[\s*(["'])(.*?)\1\s*\](?:\.(.*))?$/)
	if (!match) return null
	return {
		surface: match[2],
		path: match[3] || '',
	}
}

function renderSjsPath(path) {
	if (!path) return ''
	if (!isSafeSjsPath(path)) return `[${JSON.stringify(path)}]`
	return path.split('.').map(part => `.${part}`).join('')
}

function normalizeSjsAssignment(entry, localSurface) {
	const explicit = parseExplicitMSurfacePath(entry.path)
	if (explicit) {
		return {
			surface: explicit.surface,
			path: explicit.path,
			value: entry.value,
		}
	}
	return {
		surface: localSurface,
		path: entry.path,
		value: entry.value,
	}
}

function renderSjsAssignment(assignment) {
	const target = `m[${JSON.stringify(assignment.surface)}]${renderSjsPath(assignment.path)}`
	const renderedValue = assignment.path === 'request.headers'
		? renderSjsHeaders(assignment.value)
		: renderSjsValue(assignment.value)
	return `${target} = ${renderedValue};`
}

function collectSjsAssignments(entries, localSurface) {
	return entries
		.map(entry => normalizeSjsAssignment(entry, localSurface))
		.filter(entry => entry.surface)
}

function renderSurfaceAssignments(assignments, surface, emitted) {
	const lines = []
	const surfaceAssignments = assignments
		.filter(assignment => assignment.surface === surface)
		.sort((a, b) => {
			if (!a.path && b.path) return -1
			if (a.path && !b.path) return 1
			return 0
		})
	for (const assignment of surfaceAssignments) {
		if (assignment.surface !== surface) continue
		lines.push(renderSjsAssignment(assignment))
		emitted.add(assignment)
	}
	return lines.length ? `${lines.join('\n')}\n` : ''
}

function renderRemainingAssignments(assignments, emitted) {
	const lines = []
	const surfaces = []
	for (const assignment of assignments) {
		if (emitted.has(assignment)) continue
		if (!surfaces.includes(assignment.surface)) surfaces.push(assignment.surface)
	}
	for (const surface of surfaces) {
		const surfaceAssignments = assignments
			.filter(assignment => !emitted.has(assignment) && assignment.surface === surface)
			.sort((a, b) => {
				if (!a.path && b.path) return -1
				if (a.path && !b.path) return 1
				return 0
			})
		for (const assignment of surfaceAssignments) {
			lines.push(renderSjsAssignment(assignment))
			emitted.add(assignment)
		}
	}
	return lines.length ? `${lines.join('\n')}\n` : ''
}

function endpointDocument(url) {
	if (url === '/api/acl') return '/api/acl/SKILL.s.js'
	if (url === '/api/exec') return '/api/exec/SKILL.s.js'
	return undefined
}

function endpointRefs(url) {
	if (url === '/api/acl') return ['/api/exec/SKILL.s.js']
	if (url === '/api/exec') return ['/api/acl/SKILL.s.js']
	return ['/api/acl/SKILL.s.js', '/api/exec/SKILL.s.js']
}

function endpointNeedsAuth(url, visibility) {
	if (visibility === 'private') return true
	if (String(url || '').startsWith('/api/') && url !== '/api') return true
	return false
}

function isExecEndpoint(url) {
	return url === '/api/exec'
}

function renderRefs(refs, indent = '  ') {
	if (!Array.isArray(refs) || refs.length === 0) return `${indent}refs: []`
	return [
		`${indent}refs: [`,
		...refs.map((ref, index) => `${indent}  ${JSON.stringify(ref)}${index === refs.length - 1 ? '' : ','}`),
		`${indent}]`,
	].join('\n')
}

function renderRequest(method, body, { includeAuth = true, includeBody = method === 'POST' } = {}) {
	const headers = []
	if (includeAuth) headers.push('      "X-API-Key": client.API_KEY')
	if (method === 'POST') headers.push('      "Content-Type": "application/json"')
	headers.push('      "Accept": "text/sjs"')
	const lines = [
		'  request: {',
		'    headers: {',
		...headers.map((header, index) => `${header}${index === headers.length - 1 ? '' : ','}`),
		'    }',
	]
	if (includeBody) {
		lines[lines.length - 1] += ','
		lines.push(`    body: ${renderSjsValue(body)}`)
	}
	lines.push('  }')
	return lines.join('\n')
}

function renderSurfaceBlock({ surface, method = 'GET', url, document, refs, requestBlock }) {
	const lines = [
		`m[${JSON.stringify(surface)}] = {`,
		`  method: ${JSON.stringify(method)},`,
		`  url: ${JSON.stringify(url)},`,
	]
	if (document) lines.push(`  document: ${JSON.stringify(document)},`)
	if (requestBlock) {
		lines.push(`${requestBlock},`)
	}
	lines.push(renderRefs(refs))
	lines.push('};')
	return lines.join('\n')
}

function buildGeneratedSkillSjs({
	document,
	skill,
	endpoint,
	description,
	base,
	visibility,
	directiveEntries = [],
} = {}) {
	const { method, url } = parseEndpoint(endpoint)
	const apiDocument = endpointDocument(url)
	const refs = endpointRefs(url)
	const assignments = collectSjsAssignments(directiveEntries, url)
	const emittedAssignments = new Set()
	const baseAssignments = renderSurfaceAssignments(assignments, base, emittedAssignments)
	const renderUrlBlock = url !== base
	const urlAssignments = renderUrlBlock ? renderSurfaceAssignments(assignments, url, emittedAssignments) : ''
	const remainingAssignments = renderRemainingAssignments(assignments, emittedAssignments)
	const needsAuth = endpointNeedsAuth(url, visibility)
	const defaultBody = isExecEndpoint(url) ? { args: ['<command>', '<arg>', '...'] } : undefined
	const requestBlock = (needsAuth || method === 'POST')
		? renderRequest(method, defaultBody, {
			includeAuth: needsAuth,
			includeBody: method === 'POST' && defaultBody !== undefined,
		})
		: ''
	const baseMethod = renderUrlBlock ? 'GET' : method
	const baseRequestBlock = renderUrlBlock ? '' : requestBlock

	return `// ${document}
m.rule = {
  skill: ${JSON.stringify(skill)},
  endpoint: ${JSON.stringify(endpoint || `${method} ${url}`)},
  description: ${JSON.stringify(description || '')}
};
${memoRuleAssignment()}

${renderSurfaceBlock({ surface: base, method: baseMethod, url: base, document, refs, requestBlock: baseRequestBlock })}
${baseAssignments}

${renderUrlBlock ? `
${renderSurfaceBlock({ surface: url, method, url, document: apiDocument, refs, requestBlock })}
${urlAssignments}
` : ''}${method === 'POST' && isExecEndpoint(url) ? `m[${JSON.stringify(url)}].request.body.args.kind = "argv";
m[${JSON.stringify(url)}].request.body.args.syntax = '<command> [<arg>]...';
m[${JSON.stringify(url)}].response.output = '<stdout>';
m[${JSON.stringify(url)}].response.exitCode = 0;
m[${JSON.stringify(url)}].response.status = "done";
` : ''}
${remainingAssignments}
`
}

function sjsResult(status, reason, reqPath, extra = {}) {
	const lines = [
		'm.result = {',
		`  status: ${Number(status) || 500},`,
		'  type: "fallback",',
		`  reason: ${JSON.stringify(reason || 'error')},`,
		`  path: ${JSON.stringify(reqPath || '')}`,
	]
	for (const [key, value] of Object.entries(extra)) {
		if (value === undefined || value === null) continue
		lines[lines.length - 1] += ','
		lines.push(`  ${key}: ${JSON.stringify(value)}`)
	}
	lines.push('};')
	return lines.join('\n')
}

function sjsExecRetrySurface({ method, response } = {}) {
	return `m["/api/exec"] = {
  method: "POST",
  url: "/api/exec",
  request: {
    headers: {
      "X-API-Key": client.API_KEY,
      "Content-Type": "application/json",
      "Accept": "text/sjs"
    },
    body: {
      args: ["<command>", "<arg>", "..."]
    }
  }
};

m["/api/exec"].request.body.args.example = ["aexec", "--version"];
m["/api/exec"].request.body.args.kind = "argv";
m["/api/exec"].request.body.args.syntax = '<command> [<arg>]...';
${response ? `${execResponseAssignments({ length: false, duration: false, stderr: false })}
` : ''}`
}

function sjsFallback(method, url, document, refs) {
	const lines = [
		'm.fallback = {',
		`  method: ${JSON.stringify(method || 'GET')},`,
		`  url: ${JSON.stringify(url || '/')}`,
	]
	if (document) {
		lines[lines.length - 1] += ','
		lines.push(`  document: ${JSON.stringify(document)}`)
	}
	if (Array.isArray(refs) && refs.length) {
		lines[lines.length - 1] += ','
		lines.push('  refs: [')
		refs.forEach((ref, index) => {
			const suffix = index === refs.length - 1 ? '' : ','
			lines.push(`    ${JSON.stringify(ref)}${suffix}`)
		})
		lines.push('  ]')
	}
	lines.push('};')
	return lines.join('\n')
}

function sjsAclRetrySurface({ response = false } = {}) {
	return `m["/api/acl"] = {
  method: "GET",
  url: "/api/acl",
  document: "/api/acl/SKILL.s.js",
  request: {
    headers: {
      "X-API-Key": client.API_KEY,
      "Accept": "text/sjs"
    }
  }
};
${response ? `
${aclResponseAssignments()}
` : ''}`
}

function sjsRootRetrySurface() {
	return rootSurface()
}

function normalizeSjsReason(error) {
	if (error === 'unauthorized') return 'auth_required'
	if (error === 'not found') return 'not_found'
	return error || 'error'
}

function buildSjsErrorBody(status, { error, path: reqPath, fields } = {}) {
	const code = Number(status) || 500
	const reason = normalizeSjsReason(error)
	const p = reqPath || ''
	const firstField = Array.isArray(fields) ? fields[0] : undefined
	const result = sjsResult(code, reason, p, firstField ? { field: firstField } : {})
	let body

	if (code === 403) {
		body = `${result}

${sjsFallback('GET', '/api/acl', '/api/acl/SKILL.s.js')}

${sjsAclRetrySurface({ response: true })}`
	} else if (code === 404) {
		body = `${result}

${sjsFallback('GET', '/', '/SKILL.s.js')}

${sjsRootRetrySurface()}

${sjsAclRetrySurface()}`
	} else if (code === 405) {
		body = `${result}

${sjsFallback('POST', '/api/exec', '/api/exec/SKILL.s.js')}

${sjsExecRetrySurface({ method: true })}`
	} else if (code === 401 && p.includes('/api/acl')) {
		body = `${result}

${sjsFallback('GET', '/api/acl', '/api/acl/SKILL.s.js')}

${sjsAclRetrySurface()}`
	} else if (code === 400 && reason === 'unexpected request body field') {
		body = `${result}

${sjsFallback('POST', '/api/exec', '/api/exec/SKILL.s.js')}

${sjsExecRetrySurface()}`
	} else if (code === 400 || code === 401) {
		body = `${result}

${sjsFallback('POST', '/api/exec', '/api/exec/SKILL.s.js')}

${sjsExecRetrySurface({ response: code === 400 })}`
	} else {
		body = `${result}

${sjsFallback('GET', '/', '/SKILL.s.js')}

${sjsRootRetrySurface()}`
	}

	return `// recovery
${memoRuleAssignment()}

${body}
`
}

function buildSjsDocumentPostFallback(reqPath) {
	return `// recovery
${memoRuleAssignment()}

${sjsFallback('POST', '/api/exec', '/api/exec/SKILL.s.js', ['/api/acl/SKILL.s.js'])}

${sjsExecRetrySurface()}
`
}

module.exports = {
	isSafeSjsPath,
	memoRuleAssignment,
	aclResponseAssignments,
	execResponseAssignments,
	aclSurface,
	execSurface,
	rootSurface,
	rootSkillSjs,
	rootIndexJs,
	rootIndexSjs,
	aclSjs,
	execSjs,
	aclRuntimeSjs,
	pluginsRuntimeSjs,
	parseEndpoint,
	renderSjsValue,
	renderSjsAssignment,
	buildGeneratedSkillSjs,
	sjsResult,
	sjsExecRetrySurface,
	sjsFallback,
	sjsAclRetrySurface,
	sjsRootRetrySurface,
	buildSjsErrorBody,
	buildSjsDocumentPostFallback,
}
