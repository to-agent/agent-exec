const express = require('express')
const router = express.Router()
const backup = require('../../modules/backup')
const { attachSkillRoutes } = require('../../modules/respond')

router.path = '/cli/transfer'

attachSkillRoutes(router)

router.post('/', (req, res) => {
	try {
		if (process.env.AGENT_EXEC_ALLOW_TRANSFER !== 'true') {
			return res.status(403).json({
				error: 'transfer is disabled',
				code: 'transfer_disabled',
				hint: 'Remote transfer must be explicitly enabled on the destination machine.',
			})
		}

		const dryRun = !!req.body?.dryRun
		if (!dryRun && req.body?.confirm !== true) {
			return res.status(400).json({
				error: 'confirmation required',
				code: 'confirm_required',
				hint: 'Set confirm:true, or use ae transfer --yes',
			})
		}

		const data = backup.unpackTransferPayload(req.body)
		const result = backup.restoreBackup(data, {
			dryRun,
			includeSecrets: req.body?.includeSecrets !== false,
			categories: req.body?.categories,
		})

		res.json({
			status: dryRun ? 'dry-run' : 'done',
			restored: result.restored.length,
			skipped: result.skipped.length,
			overwritten: result.overwritten.length,
			preImportDir: result.preImportDir,
			includeSecrets: req.body?.includeSecrets !== false,
			categories: backup.parseCategories(req.body?.categories),
		})
	} catch (e) {
		res.status(400).json({
			error: e.message,
			code: 'transfer_failed',
		})
	}
})

module.exports = router
