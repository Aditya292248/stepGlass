import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createTestDatabase, type TestDatabase } from './db.js'

let t: TestDatabase
let app: Awaited<ReturnType<typeof buildApp>>
let doc: {
	openapi: string
	paths: Record<string, Record<string, { security?: unknown; responses: object }>>
	components: { securitySchemes: Record<string, { scheme: string }> }
}
const served: string[] = []

beforeAll(async () => {
	t = await createTestDatabase()
	app = await buildApp({
		db: t.db,
		logger: false,
		// Record what Fastify actually registers, so an undocumented route fails this test.
		onRoute: (r) => {
			for (const method of [r.method].flat()) {
				if (method !== 'HEAD' && r.url !== '/openapi.json') {
					served.push(`${method} ${r.url.replace(/:(\w+)/g, '{$1}')}`)
				}
			}
		},
	})
	const res = await app.inject({ method: 'GET', url: '/openapi.json' })
	expect(res.statusCode).toBe(200)
	doc = res.json()
})
afterAll(async () => {
	await app.close()
	await t.drop()
})

describe('GET /openapi.json', () => {
	it('is an OpenAPI 3.1 document listing every route', () => {
		expect(doc.openapi).toMatch(/^3\.1\./)
		const documented = Object.entries(doc.paths).flatMap(([path, ops]) =>
			Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`),
		)
		expect(served).toHaveLength(10)
		expect(documented.sort()).toEqual([...served].sort())
	})

	it('describes ingestion with bearer auth and problem responses', () => {
		const op = doc.paths['/v1/sessions/events']?.post
		expect(op?.security).toEqual([{ sessionToken: [] }])
		expect(Object.keys(op?.responses ?? {})).toEqual(
			expect.arrayContaining(['200', '400', '401', '413']),
		)
		expect(doc.components.securitySchemes.sessionToken?.scheme).toBe('bearer')
	})
})
