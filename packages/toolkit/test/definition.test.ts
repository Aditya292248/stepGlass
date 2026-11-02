import type { ToolDescriptor } from '@stepglass/schema'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineTool, descriptor } from '../src/index.js'
import {
	getWidgetDescriptor,
	paintWidgetDescriptor,
	seed,
	setWidgetColorDescriptor,
	WidgetApi,
} from './fixtures/widget.js'

const store = seed()
const api = new WidgetApi()
const transaction = { store, read: () => null }
const readBack = { read: () => api.get('W-1'), expect: () => ({ color: 'blue' }) }
const input = z.object({ id: z.string(), color: z.string() })
const run = async () => ({ ok: true })

describe('descriptor()', () => {
	it('fills schemaVersion and validates', () => {
		expect(setWidgetColorDescriptor.schemaVersion).toBe(1)
		expect(() =>
			descriptor({ ...getWidgetDescriptor, kind: 'write', verification: 'in_transaction' }),
		).toThrow('a write tool must name its object')
	})
})

describe('definition-time checks', () => {
	it('makes missing or mismatched hooks a type error when the descriptor is literal', () => {
		const base = { name: 'set_widget_color', description: 'x', input, run }
		// @ts-expect-error an in_transaction write needs transaction hooks
		expect(() => defineTool({ ...base, descriptor: setWidgetColorDescriptor })).toThrow()
		expect(() =>
			// @ts-expect-error read_back hooks don't verify an in_transaction descriptor
			defineTool({ ...base, descriptor: setWidgetColorDescriptor, transaction, readBack }),
		).toThrow('not both')
		const paint = { ...base, name: 'paint_widget', descriptor: paintWidgetDescriptor }
		// @ts-expect-error a read_back write needs readBack hooks
		expect(() => defineTool({ ...paint, transaction })).toThrow('hooks verify "in_transaction"')
	})

	it('throws for a widened descriptor whose hooks do not match', () => {
		const widened: ToolDescriptor = setWidgetColorDescriptor
		const base = { name: 'set_widget_color', description: 'x', input, run, descriptor: widened }
		expect(() => defineTool(base)).toThrow(
			'descriptor.verification is "in_transaction" but the hooks verify "none"',
		)
		expect(() => defineTool({ ...base, readBack })).toThrow('the hooks verify "read_back"')
		expect(() => defineTool({ ...base, transaction })).not.toThrow()
	})

	it('only verifies writes', () => {
		const read: ToolDescriptor = { ...getWidgetDescriptor, verification: 'read_back' }
		expect(() =>
			defineTool({ name: 'get_widget', description: 'x', input, run, descriptor: read, readBack }),
		).toThrow('only writes are verified, not "read"')
	})

	it('requires the object ID to be a required field of the input or output schema', () => {
		const base = { name: 'set_widget_color', description: 'x', run, transaction }
		const d = setWidgetColorDescriptor
		const define = (i: z.ZodType, extra: object = {}) =>
			defineTool({ ...base, ...extra, input: i, descriptor: d })
		expect(() => define(z.object({ color: z.string() }))).toThrow('has no "id" key')
		expect(() => define(z.object({ id: z.string().optional() }))).toThrow('is optional')
		expect(() => define(z.string())).toThrow('is not inside a z.object() schema')
		const union = z.union([z.object({ id: z.string() }), z.object({ id: z.number() })])
		expect(() => define(union)).not.toThrow()
		expect(() => define(z.union([z.object({ id: z.string() }), z.object({})]))).toThrow(
			'has no "id" key',
		)

		const byOutput = {
			...d,
			title: 'Created {output.id}',
			object: { ...d.object, idPath: 'output.id', label: 'W' },
		}
		const create = (output?: z.ZodType<{ id: string }>) =>
			defineTool({
				...base,
				input,
				descriptor: byOutput,
				run: async () => ({ id: 'W-100' }),
				...(output ? { output } : {}),
			})
		expect(() => create()).toThrow('needs an output schema')
		expect(() => create(z.object({ id: z.string() }))).not.toThrow()
	})
})
