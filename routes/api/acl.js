const express = require('express')
const router = express.Router()
const settings = require('../../modules/settings')
const { detectFormat, serveMarkdown, attachSkillRoutes, buildNavigation } = require('../../modules/respond')
const { aclSjs, aclRuntimeSjs } = require('../../modules/sjs')

router.path = '/api/acl'

// GET /api/acl/SKILL.md .html .json
attachSkillRoutes(router, { skipSjs: true })

function serveAclSjs(req, res) {
	res.type('text/sjs').send(aclSjs())
}

router.get('/SKILL.s.js', serveAclSjs)
router.get('/SKILL.sjs', serveAclSjs)

router.get('/', (req, res) => {
	const { exec } = settings.load()
	const allow = exec?.allow || []
	const deny  = exec?.deny  || []

	const fmt = detectFormat(req, null, 'json')
	const nav = buildNavigation(req, fmt, { parent: '/api', index: '/SKILL', related: ['/api/plugins', '/api/exec/SKILL.md'] })

	if (fmt === 'sjs') {
		return res.type('text/sjs').send(aclRuntimeSjs({ allow, deny }))
	}

	if (fmt === 'json') {
		const body = { allow, deny }
		if (nav) body.navigation = nav
		return res.json(body)
	}

	const allowLines = allow.map(p => `- \`${p}\``).join('\n')
	const denyLines  = deny.map(p =>  `- \`${p}\``).join('\n')
	const md = `# ACL

## Allow

${allowLines || '(none)'}

## Deny

${denyLines || '(none)'}
`
	serveMarkdown(req, res, md, { nav })
})

module.exports = router
