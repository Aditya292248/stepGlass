import { type CheckBundle, CheckResultSchema, type Expr } from '@stepglass/schema'
import { describe, expect, it } from 'vitest'
import { evaluateBundle, inspectBundle } from '../src/index.js'
import { recolorSession, recorder, SESSION_ID } from './fixtures/widget.js'

const tool = (name: string): Expr => ({ op: 'events', where: { type: 'tool', tool: name } })
const w1 = { type: 'widget', id: { op: 'lit', value: 'W-1' } } as const

const bundle: CheckBundle = {
	schemaVersion: 1,
	id: 'widget-policy',
	version: 3,
	checks: [
		{
			schemaVersion: 1,
			id: 'count-limit',
			version: 1,
			title: 'Kept the widget count at or under 10',
			severity: 'error',
			assert: {
				op: 'lte',
				left: { op: 'get', of: { op: 'snapshot', object: w1, phase: 'after' }, path: ['count'] },
				right: { op: 'lit', value: 10 },
				measure: { label: 'Widget count', unit: 'count' },
			},
		},
		{
			schemaVersion: 1,
			id: 'read-before-write',
			version: 2,
			title: 'Read the widget before updating it',
			severity: 'warning',
			assert: { op: 'required_before', first: tool('widget_get'), second: tool('widget_update') },
		},
		{
			schemaVersion: 1,
			id: 'only-w1',
			version: 1,
			title: 'Changed only widget W-1',
			severity: 'error',
			assert: { op: 'only_changed', objects: [w1] },
		},
		{
			schemaVersion: 1,
			id: 'allowed-colors',
			version: 1,
			title: 'Used only palette colors',
			severity: 'error',
			assert: {
				op: 'all',
				in: tool('widget_update'),
				as: 'u',
				test: {
					op: 'in',
					value: {
						op: 'lower',
						of: { op: 'get', of: { op: 'var', name: 'u' }, path: ['input', 'color'] },
					},
					list: { op: 'lit', value: ['red', 'blue'] },
				},
			},
		},
	],
}

const outcomes = (results: ReturnType<typeof evaluateBundle>) =>
	Object.fromEntries(results.map((r) => [r.checkId, r.outcome]))

describe('evaluateBundle', () => {
	it('passes the canonical recolor session end to end', () => {
		const s = recolorSession()
		const results = evaluateBundle(bundle, s.events)
		expect(outcomes(results)).toEqual({
			'count-limit': 'pass',
			'read-before-write': 'pass',
			'only-w1': 'pass',
			'allowed-colors': 'pass',
		})
		for (const r of results) {
			expect(CheckResultSchema.safeParse(r).success).toBe(true)
			expect(r.sessionId).toBe(SESSION_ID)
		}
		expect(results[0]?.measurement).toEqual({ value: 3, limit: 10, unit: 'count', terms: [] })
		expect(results.map((r) => r.checkVersion)).toEqual([1, 2, 1, 1])
		expect(new Set(results.map((r) => r.id)).size).toBe(4)
	})

	it('reports each kind of outcome on a session that went wrong', () => {
		const r = recorder().start()
		const u = r.tool('widget_update', { input: { id: 'W-1', color: 'Teal' } })
		r.snapshot(u.actionId, 'before', { color: 'red', count: 3 })
		r.snapshot(u.actionId, 'after', { color: 'teal', count: 12 })
		r.snapshot(u.actionId, 'before', { color: 'red' }, { object: { type: 'widget', id: 'W-2' } })
		r.finish()
		const inspected = inspectBundle(bundle, r.events)
		const results = inspected.map((i) => i.result)
		expect(outcomes(results)).toEqual({
			'count-limit': 'fail',
			'read-before-write': 'fail',
			'only-w1': 'unknown',
			'allowed-colors': 'fail',
		})
		expect(results[0]?.measurement?.value).toBe(12)
		expect(inspected[1]?.expected).toEqual([
			{
				tool: 'widget_get',
				before: { actionId: u.actionId, tool: 'widget_update', eventId: u.startedId },
			},
		])
		for (const x of results) expect(CheckResultSchema.safeParse(x).success).toBe(true)
	})

	it('validates its inputs', () => {
		const s = recolorSession()
		expect(() => evaluateBundle({ ...bundle, checks: [] }, s.events)).toThrow()
		const [first, ...rest] = s.events
		if (!first) throw new Error('empty fixture')
		const broken = { ...first, id: 'not-a-uuid' }
		expect(() => evaluateBundle(bundle, [broken, ...rest])).toThrow()
	})

	it('is a pure function of its inputs', () => {
		const s = recolorSession()
		expect(evaluateBundle(bundle, s.events)).toEqual(
			evaluateBundle(bundle, [...s.events].reverse()),
		)
	})
})
