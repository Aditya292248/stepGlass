import type { CheckBundle, ToolDescriptor } from '@stepglass/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from './fixtures.js'

let h: Harness

beforeAll(async () => {
	h = await createHarness()
})
afterAll(() => h.close())

const descriptor: ToolDescriptor = {
	schemaVersion: 1,
	tool: 'widget_get',
	version: 1,
	kind: 'read',
	title: 'Looked up widget {input.id|id}',
	fields: { 'input.id': { label: 'Widget', format: 'id' } },
	verification: 'none',
	capture: { input: 'full', output: 'full' },
}

const bundle: CheckBundle = {
	schemaVersion: 1,
	id: 'widget-policy',
	version: 1,
	checks: [
		{
			schemaVersion: 1,
			id: 'only-w1',
			version: 1,
			title: 'Changed only widget W-1',
			severity: 'error',
			assert: {
				op: 'only_changed',
				objects: [{ type: 'widget', id: { op: 'lit', value: 'W-1' } }],
			},
		},
	],
}

const resources = [
	{
		name: 'tool descriptors',
		url: (doc: ToolDescriptor) => `/v1/tool-descriptors/${doc.tool}/${doc.version}`,
		doc: descriptor,
		changed: { ...descriptor, title: 'Fetched widget {input.id|id}' },
	},
	{
		name: 'check bundles',
		url: (doc: CheckBundle) => `/v1/check-bundles/${doc.id}/${doc.version}`,
		doc: bundle,
		changed: { ...bundle, checks: bundle.checks.map((c) => ({ ...c, severity: 'warning' })) },
	},
] as const

describe.each(resources)('$name', ({ url, doc, changed }) => {
	// biome-ignore lint/suspicious/noExplicitAny: one table drives both document types
	const path = (d: unknown) => (url as (d: any) => string)(d)
	const put = (target: string, payload: unknown) =>
		h.app.inject({ method: 'PUT', url: target, payload: payload as object })

	it('404s before the first write', async () => {
		const res = await h.app.inject({ method: 'GET', url: path(doc) })
		expect(res.statusCode).toBe(404)
		expect(res.headers['content-type']).toMatch(/^application\/problem\+json/)
	})

	it('creates with 201, then serves the document', async () => {
		const res = await put(path(doc), doc)
		expect(res.statusCode).toBe(201)
		expect(res.json()).toEqual(doc)
		const got = await h.app.inject({ method: 'GET', url: path(doc) })
		expect(got.statusCode).toBe(200)
		expect(got.json()).toEqual(doc)
	})

	it('accepts an identical re-PUT with 200, whatever the key order', async () => {
		const reordered = Object.fromEntries(Object.entries(doc).reverse())
		const res = await put(path(doc), reordered)
		expect(res.statusCode).toBe(200)
	})

	it('refuses different content under the same version with 409 and keeps the original', async () => {
		const res = await put(path(doc), changed)
		expect(res.statusCode).toBe(409)
		expect(res.json()).toMatchObject({ status: 409, code: 'immutable_version' })
		const got = await h.app.inject({ method: 'GET', url: path(doc) })
		expect(got.json()).toEqual(doc)
	})

	it('stores the changed content as a new version', async () => {
		const next = { ...changed, version: 2 }
		expect((await put(path(next), next)).statusCode).toBe(201)
	})

	it('rejects a body whose key differs from the path', async () => {
		const res = await put(path({ ...doc, version: 7 }), doc)
		expect(res.statusCode).toBe(400)
		expect(res.json()).toMatchObject({ code: 'path_mismatch' })
	})

	it('validates the body and the path', async () => {
		const invalid = await put(path(doc), { ...doc, schemaVersion: 2 })
		expect(invalid.statusCode).toBe(400)
		expect(invalid.json()).toMatchObject({ code: 'validation_failed' })
		const badVersion = await h.app.inject({ method: 'GET', url: path({ ...doc, version: 0 }) })
		expect(badVersion.statusCode).toBe(400)
	})
})
