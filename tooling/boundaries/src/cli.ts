import { fileURLToPath } from 'node:url'
import { checkRepo } from './walk.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const violations = await checkRepo(repoRoot)

for (const v of violations) {
	console.error(`${v.file}:${v.line}  ${v.message}`)
}
if (violations.length > 0) {
	console.error(
		`\n${violations.length} boundary violation(s). Domain code belongs in connectors/ or scenarios/.`,
	)
	process.exit(1)
}
