import {
	type CheckDefinition,
	CheckResultSchema,
	type Expr,
	type JsonValue,
	MeasurementSchema,
} from '@stepglass/schema'
import { describe, expect, it } from 'vitest'
import { diffPaths, evaluateCheck, indexTrace } from '../src/index.js'
import { id, recolorSession, recorder } from './fixtures/widget.js'

const lit = (value: JsonValue): Expr => ({ op: 'lit', value })
const check = (assert: Expr): CheckDefinition => ({
	schemaVersion: 1,
	id: 'widget-scope',
	version: 1,
	title: 'Changed only widget W-1',
	severity: 'error',
	assert,
})
const onlyW1 = check({ op: 'only_changed', objects: [{ type: 'widget', id: lit('W-1') }] })
const run = (def: CheckDefinition, events: Parameters<typeof indexTrace>[0]) => {
	const result = evaluateCheck(def, indexTrace(events))
	expect(CheckResultSchema.safeParse(result).success).toBe(true)
	return { ...result, codes: result.reasons.map((r) => r.code) }
}
const w2 = { object: { type: 'widget', id: 'W-2' } }

describe('diffPaths', () => {
	it('lists changed leaf paths, added and removed keys, and whole arrays', () => {
		const before = { color: 'red', size: { w: 1, h: 2 }, tags: ['a'], gone: 1 }
		const after = { color: 'red', size: { w: 1, h: 3 }, tags: ['a', 'b'], added: true }
		expect(diffPaths(before, after)).toEqual(['added', 'gone', 'size.h', 'tags'])
		expect(diffPaths(before, before)).toEqual([])
	})

	it('ignores computed fields and their subtrees', () => {
		const before = { color: 'red', meta: { rev: 1, at: 'x' } }
		const after = { color: 'red', meta: { rev: 2, at: 'y' } }
		expect(diffPaths(before, after, ['meta'])).toEqual([])
		expect(diffPaths(before, after, ['meta.rev'])).toEqual(['meta.at'])
	})
})

describe('only_changed', () => {
	it('passes when only the allowed object changed, citing its snapshots', () => {
		const s = recolorSession()
		const result = run(onlyW1, s.events)
		expect(result.outcome).toBe('pass')
		expect(result.reasons[0]?.eventIds).toEqual(expect.arrayContaining([s.before, s.after]))
	})

	it('fails and lists an extra change with its paths', () => {
		const r = recorder().start()
		const u = r.tool('widget_update')
		r.snapshot(u.actionId, 'before', { color: 'red', count: 3 })
		r.snapshot(u.actionId, 'after', { color: 'blue', count: 3 })
		const b2 = r.snapshot(u.actionId, 'before', { color: 'red', count: 1 }, w2)
		const a2 = r.snapshot(u.actionId, 'after', { color: 'green', count: 2 }, w2)
		r.finish()
		const result = run(onlyW1, r.events)
		expect(result.outcome).toBe('fail')
		expect(result.reasons).toEqual([
			{
				code: 'unexpected_change',
				message: 'widget W-2 changed outside the allowed objects: color, count.',
				eventIds: [b2, a2],
			},
		])
	})

	it('an unlisted object that was read but not changed is fine', () => {
		const r = recorder().start()
		const u = r.tool('widget_update')
		r.snapshot(u.actionId, 'before', { color: 'red' })
		r.snapshot(u.actionId, 'after', { color: 'blue' })
		r.snapshot(u.actionId, 'before', { color: 'red' }, w2)
		r.snapshot(u.actionId, 'after', { color: 'red' }, w2)
		r.finish()
		expect(run(onlyW1, r.events).outcome).toBe('pass')
	})

	it('computed fields do not count as a change', () => {
		const r = recorder().start()
		const u = r.tool('widget_update')
		const computed = { ...w2, computedFields: ['rev'] }
		r.snapshot(u.actionId, 'before', { color: 'red', rev: 1 }, computed)
		r.snapshot(u.actionId, 'after', { color: 'red', rev: 2 }, computed)
		r.finish()
		expect(run(onlyW1, r.events).outcome).toBe('pass')
	})

	it('a missing snapshot of an unlisted object is unknown', () => {
		const r = recorder().start()
		const u = r.tool('widget_update')
		r.snapshot(u.actionId, 'before', { color: 'red' }, w2)
		r.finish()
		const result = run(onlyW1, r.events)
		expect(result.outcome).toBe('unknown')
		expect(result.codes).toEqual(['missing_snapshot'])
		expect(result.reasons[0]?.message).toContain('No after snapshot of widget W-2')
	})

	it('no snapshots at all is unknown, not a pass', () => {
		const r = recorder().start()
		r.tool('widget_update')
		r.finish()
		const result = run(onlyW1, r.events)
		expect(result.outcome).toBe('unknown')
		expect(result.codes).toEqual(['no_snapshots'])
	})

	it('an incomplete recording is unknown unless it already shows a violation', () => {
		const s = recolorSession()
		const open = s.events.slice(0, -1)
		const result = run(onlyW1, open)
		expect(result.outcome).toBe('unknown')
		expect(result.codes).toEqual(['incomplete_recording'])
	})

	it('unverified evidence for an unlisted object cannot pass', () => {
		const r = recorder().start()
		const u = r.tool('widget_update')
		r.snapshot(u.actionId, 'before', { color: 'red' })
		r.snapshot(u.actionId, 'after', { color: 'blue' })
		const reported = { ...w2, source: 'tool_reported' } as const
		r.snapshot(u.actionId, 'before', { color: 'red' }, reported)
		r.snapshot(u.actionId, 'after', { color: 'red' }, { ...reported, id: id(901) })
		r.finish()
		const result = run(onlyW1, r.events)
		expect(result.outcome).toBe('unknown')
		expect(result.codes).toEqual(['unverified_evidence'])
	})
})

describe('measured comparisons', () => {
	const order = (qty: number, r: ReturnType<typeof recorder>) =>
		r.tool('widget_order', { input: { qty, cost: qty * 250 } })
	const orders: Expr = { op: 'events', where: { tool: 'widget_order' } }
	const qtyOf = (i: number): Expr => ({ op: 'get', of: orders, path: [String(i), 'input', 'qty'] })
	const totalQty = (limit: number): CheckDefinition =>
		check({
			op: 'lte',
			left: { op: 'sum', of: orders, field: ['input', 'qty'] },
			right: lit(limit),
			measure: {
				label: 'Widgets ordered',
				unit: 'count',
				terms: [
					{ label: 'First order', value: qtyOf(0) },
					{ label: 'Second order', value: qtyOf(1) },
				],
			},
		})
	const session = () => {
		const r = recorder().start()
		order(3, r)
		order(4, r)
		r.finish()
		return r.events
	}

	it('reports value, limit and terms that add up to the value', () => {
		const result = run(totalQty(10), session())
		expect(result.outcome).toBe('pass')
		expect(result.measurement).toEqual({
			value: 7,
			limit: 10,
			unit: 'count',
			terms: [
				{ label: 'First order', value: 3 },
				{ label: 'Second order', value: 4 },
			],
		})
		const m = result.measurement
		expect(m?.terms.reduce((a, t) => a + t.value, 0)).toBe(m?.value)
		expect(MeasurementSchema.safeParse(m).success).toBe(true)
	})

	it('keeps the gauge on a fail, so the UI can show by how much', () => {
		const result = run(totalQty(5), session())
		expect(result.outcome).toBe('fail')
		expect(result.measurement?.value).toBe(7)
		expect(result.measurement?.limit).toBe(5)
	})

	it('carries currency for minor-unit amounts', () => {
		const spend = check({
			op: 'lt',
			left: { op: 'sum', of: orders, field: ['input', 'cost'] },
			right: lit(5_000),
			measure: { label: 'Order cost', unit: 'currency_minor', currency: 'EUR' },
		})
		expect(run(spend, session()).measurement).toEqual({
			value: 1_750,
			limit: 5_000,
			unit: 'currency_minor',
			currency: 'EUR',
			terms: [],
		})
	})

	it('omits the gauge when a number is unknown', () => {
		const r = recorder().start()
		order(3, r)
		r.finish()
		// The second term reads an order that does not exist.
		const result = run(totalQty(10), r.events)
		expect(result.outcome).toBe('pass')
		expect(result.measurement).toBeUndefined()
	})
})
