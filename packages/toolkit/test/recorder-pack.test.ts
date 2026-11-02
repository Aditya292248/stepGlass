import { type CheckBundle, TraceEventSchema, Uuidv7Schema } from '@stepglass/schema'
import { describe, expect, it } from 'vitest'
import { createMemoryRecorder, defineToolPack } from '../src/index.js'
import { getWidget, SESSION_ID } from './fixtures/widget.js'

describe('createMemoryRecorder', () => {
	it('stamps base fields with a dense producer seq from 0 and sortable UUIDv7 IDs', () => {
		const fixed = new Date('2026-10-29T12:00:00Z')
		const rec = createMemoryRecorder({ sessionId: SESSION_ID, source: 'mcp', clock: () => fixed })
		for (let i = 0; i < 5; i++) {
			rec.emit({
				type: 'recording.gap',
				producerId: 'x',
				fromSeq: i,
				toSeq: i,
				reason: 'unknown',
				capture: { completeness: 'full' },
			})
		}
		const events = rec.events.map((e) => TraceEventSchema.parse(e))
		expect(events.map((e) => e.producer.seq)).toEqual([0, 1, 2, 3, 4])
		expect(new Set(events.map((e) => e.producer.id)).size).toBe(1)
		expect(events.every((e) => e.source === 'mcp' && e.sessionId === SESSION_ID)).toBe(true)
		expect(events.every((e) => e.occurredAt === '2026-10-29T12:00:00.000Z')).toBe(true)
		// Same millisecond, still strictly increasing.
		const ids = events.map((e) => e.id)
		expect([...ids].sort()).toEqual(ids)
		expect(new Set(ids).size).toBe(ids.length)
	})

	it('mints UUIDv7s that stay ordered when the clock steps back', () => {
		let t = 2_000
		const clock = () => {
			t -= 1
			return new Date(t)
		}
		const rec = createMemoryRecorder({ sessionId: SESSION_ID, clock })
		const ids = Array.from({ length: 10 }, () => rec.newId())
		for (const id of ids) Uuidv7Schema.parse(id)
		expect([...ids].sort()).toEqual(ids)
	})
})

const bundle: CheckBundle = {
	schemaVersion: 1,
	id: 'widget-policy',
	version: 1,
	checks: [
		{
			schemaVersion: 1,
			id: 'read-first',
			version: 1,
			title: 'Read the widget first',
			severity: 'warning',
			assert: { op: 'lit', value: true },
		},
	],
}

describe('defineToolPack', () => {
	const tool = getWidget(new Map())

	it('accepts a valid pack and freezes it', () => {
		const pack = defineToolPack({
			name: 'widgets',
			version: '1.0.0',
			tools: [tool],
			checks: [bundle],
		})
		expect(pack.tools).toEqual([tool])
		expect(Object.isFrozen(pack)).toBe(true)
	})

	it('rejects duplicate tool names', () => {
		expect(() => defineToolPack({ name: 'widgets', version: '1', tools: [tool, tool] })).toThrow(
			'duplicate tool "get_widget"',
		)
	})

	it('rejects a tool whose descriptor names another tool', () => {
		const renamed = { ...tool, name: 'get_gadget' }
		expect(() => defineToolPack({ name: 'widgets', version: '1', tools: [renamed] })).toThrow(
			'has a descriptor for "get_widget"',
		)
	})

	it('rejects invalid and duplicate check bundles, bad names and empty versions', () => {
		const bad = { ...bundle, checks: [] }
		expect(() =>
			defineToolPack({ name: 'widgets', version: '1', tools: [], checks: [bad] }),
		).toThrow()
		expect(() =>
			defineToolPack({ name: 'widgets', version: '1', tools: [], checks: [bundle, bundle] }),
		).toThrow('bundle IDs must be unique')
		expect(() => defineToolPack({ name: 'Widgets!', version: '1', tools: [] })).toThrow()
		expect(() => defineToolPack({ name: 'widgets', version: '', tools: [] })).toThrow('version')
	})
})
