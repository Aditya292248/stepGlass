import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkManifest, checkSource } from './check.ts'
import { checkRepo } from './walk.ts'

describe('checkSource', () => {
	it('accepts generic core code', () => {
		const code = "import { z } from 'zod'\nexport const sortOrder = 'asc'\n"
		expect(checkSource('packages/schema/src/index.ts', code)).toEqual([])
	})

	it('rejects imports of connector and scenario packages', () => {
		const code = [
			"import { tools } from '@stepglass/connector-mail'",
			"export * from '@stepglass/scenario-demo'",
			"const m = await import('@stepglass/connector-x')",
		].join('\n')
		const lines = checkSource('apps/api/src/a.ts', code).map((v) => v.line)
		expect(lines).toEqual([1, 2, 3])
	})

	it('rejects relative imports that reach into connectors or scenarios', () => {
		const code = "import seed from '../../../scenarios/demo/seed.ts'"
		const [violation] = checkSource('apps/api/src/a.ts', code)
		expect(violation?.message).toContain('must not import')
	})

	it('allows relative imports inside the core', () => {
		const code = "import { x } from '../lib/x.ts'"
		expect(checkSource('apps/api/src/routes/a.ts', code)).toEqual([])
	})

	it('flags domain words, including plurals and other casing', () => {
		const violations = checkSource('apps/web/src/a.tsx', 'const label = "Refunds"\n// gmail\n')
		expect(violations.map((v) => v.line)).toEqual([1, 2])
	})
})

describe('checkManifest', () => {
	it('rejects core dependencies on connectors or scenarios', () => {
		const manifest = { dependencies: { zod: '^4', '@stepglass/connector-x': 'workspace:*' } }
		expect(checkManifest('apps/api/package.json', manifest)).toHaveLength(1)
	})
})

describe('checkRepo', () => {
	let root = ''
	afterEach(() => rm(root, { recursive: true, force: true }))

	it('scans core roots and ignores connectors, scenarios and node_modules', async () => {
		root = await mkdtemp(join(tmpdir(), 'boundaries-'))
		const files: Record<string, string> = {
			'packages/core/src/ok.ts': 'export const ok = 1\n',
			'packages/core/src/bad.ts': 'export const refundTotal = 1\n',
			'packages/core/node_modules/dep/index.js': 'refund\n',
			'connectors/mail/src/index.ts': 'export const refund = 1\n',
		}
		for (const [path, content] of Object.entries(files)) {
			await mkdir(join(root, path, '..'), { recursive: true })
			await writeFile(join(root, path), content)
		}
		const violations = await checkRepo(root)
		expect(violations.map((v) => v.file)).toEqual(['packages/core/src/bad.ts'])
	})
})
