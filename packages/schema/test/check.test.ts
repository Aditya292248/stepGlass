import { describe, expect, it } from 'vitest'
import {
	CHECK_OPERATORS,
	CheckBundleSchema,
	CheckResultSchema,
	ExprSchema,
	MAX_EXPR_DEPTH,
} from '../src/index.js'
import { bundle, passResult } from './fixtures/widget.js'

const lit = (value: unknown) => ({ op: 'lit', value })
const nest = (depth: number): unknown =>
	depth <= 1 ? lit(true) : { op: 'not', of: nest(depth - 1) }

describe('check definitions', () => {
	it('round-trips the widget bundle', () => {
		expect(CheckBundleSchema.parse(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle)
	})

	it('accepts a quantifier over a selector with inputMatches', () => {
		const e = {
			op: 'all',
			in: { op: 'events', where: { inputMatches: { op: 'var', name: 'action' } } },
			as: 'a',
			test: { op: 'in', value: { op: 'lower', of: { op: 'var', name: 'a' } }, list: lit(['x']) },
		}
		expect(ExprSchema.safeParse(e).success).toBe(true)
	})

	it('lists 24 distinct operators', () => {
		expect(new Set(CHECK_OPERATORS).size).toBe(24)
	})

	it('rejects unknown operators and code-shaped nodes', () => {
		expect(ExprSchema.safeParse({ op: 'eval', src: '1+1' }).success).toBe(false)
		expect(ExprSchema.safeParse({ ...lit(1), fn: 'x' }).success).toBe(false)
	})

	it(`rejects nesting deeper than ${MAX_EXPR_DEPTH}`, () => {
		expect(ExprSchema.safeParse(nest(MAX_EXPR_DEPTH)).success).toBe(true)
		expect(ExprSchema.safeParse(nest(MAX_EXPR_DEPTH + 1)).success).toBe(false)
	})

	it('rejects floats and oversized strings in literals', () => {
		expect(ExprSchema.safeParse(lit({ a: [1.5] })).success).toBe(false)
		expect(ExprSchema.safeParse(lit('x'.repeat(10_001))).success).toBe(false)
	})

	it('rejects a float in a measure term', () => {
		const e = {
			op: 'lt',
			left: lit(1),
			right: lit(2),
			measure: { label: 'n', unit: 'count', terms: [{ label: 't', value: lit(0.5) }] },
		}
		expect(ExprSchema.safeParse(e).success).toBe(false)
	})

	it('rejects duplicate check IDs in a bundle', () => {
		const [first] = bundle.checks
		expect(CheckBundleSchema.safeParse({ ...bundle, checks: [first, first] }).success).toBe(false)
	})
})

describe('check results', () => {
	it('round-trips', () => {
		expect(CheckResultSchema.parse(JSON.parse(JSON.stringify(passResult)))).toEqual(passResult)
	})

	it('rejects a pass without evidence, but allows fail/unknown without it', () => {
		const noEvidence = { ...passResult, reasons: [{ code: 'ok', message: 'ok', eventIds: [] }] }
		expect(CheckResultSchema.safeParse(noEvidence).success).toBe(false)
		expect(CheckResultSchema.safeParse({ ...noEvidence, outcome: 'unknown' }).success).toBe(true)
	})

	it('rejects a float measurement value', () => {
		const m = { ...passResult.measurement, value: 2.5 }
		expect(CheckResultSchema.safeParse({ ...passResult, measurement: m }).success).toBe(false)
	})
})
