import type { Expr, JsonValue } from '@stepglass/schema'
import { ExprSchema } from '@stepglass/schema'
import { describe, expect, it } from 'vitest'
import {
	EMPTY_CONTEXT,
	type EvalContext,
	evaluate,
	known,
	type Res,
	res,
	UNKNOWN,
} from '../src/index.js'

const lit = (value: JsonValue): Expr => ({ op: 'lit', value })
const v = (name: string): Expr => ({ op: 'var', name })
const U: typeof UNKNOWN = UNKNOWN

const ctxWith = (vars: Record<string, Res>): EvalContext => ({
	vars: new Map(Object.entries(vars)),
})
const run = (e: Expr, ctx: EvalContext = EMPTY_CONTEXT) => evaluate(ExprSchema.parse(e), ctx)
const value = (e: Expr, ctx?: EvalContext) => run(e, ctx).value
const codes = (r: Res) => r.reasons.map((x) => x.code)

const missing: Expr = { op: 'get', of: lit({ a: 1 }), path: ['b'] }
const widget = known({ id: 'W-1', color: 'Red', count: 3, tags: ['a', 'b'], owner: null }, ['e1'])

describe('values and fields', () => {
	it('lit and var', () => {
		expect(value(lit(5))).toBe(5)
		expect(value(v('w'), ctxWith({ w: widget }))).toEqual(widget.value)
	})

	it('an unbound variable is unknown, not false', () => {
		const r = run(v('nope'))
		expect(r.value).toBe(U)
		expect(codes(r)).toEqual(['unbound_variable'])
	})

	it('get follows paths and array indices, citing the source', () => {
		const ctx = ctxWith({ w: widget })
		const r = run({ op: 'get', of: v('w'), path: ['tags', '1'] }, ctx)
		expect(r.value).toBe('b')
		expect(r.eventIds).toEqual(['e1'])
		expect(value({ op: 'get', of: v('w'), path: ['owner'] }, ctx)).toBeNull()
	})

	it('a missing path is unknown, never null or false', () => {
		const r = run(missing)
		expect(r.value).toBe(U)
		expect(codes(r)).toEqual(['missing_field'])
		expect(value({ op: 'get', of: lit({ a: [1] }), path: ['a', '5'] })).toBe(U)
		expect(value({ op: 'get', of: lit({ a: 'x' }), path: ['a', 'length'] })).toBe(U)
	})
})

describe('list and string operators', () => {
	it('count and sum', () => {
		expect(value({ op: 'count', of: lit([1, 2, 3]) })).toBe(3)
		const rows = lit([{ n: 2 }, { n: 5 }, { n: -1 }])
		expect(value({ op: 'sum', of: rows, field: ['n'] })).toBe(6)
		expect(value({ op: 'sum', of: lit([]), field: ['n'] })).toBe(0)
	})

	it('sum is integer-only and overflow-safe', () => {
		const ctx = ctxWith({
			floats: known([{ n: 1.5 }]),
			big: known([{ n: Number.MAX_SAFE_INTEGER }, { n: 1 }]),
			unsafe: known([{ n: 2 ** 60 }]),
		})
		expect(codes(run({ op: 'sum', of: v('floats'), field: ['n'] }, ctx))).toEqual(['non_integer'])
		expect(codes(run({ op: 'sum', of: v('big'), field: ['n'] }, ctx))).toEqual(['unsafe_integer'])
		expect(codes(run({ op: 'sum', of: v('unsafe'), field: ['n'] }, ctx))).toEqual([
			'unsafe_integer',
		])
		expect(value({ op: 'sum', of: lit([{ n: 1 }, {}]), field: ['n'] })).toBe(U)
	})

	it('count and sum of a non-list are type errors', () => {
		expect(codes(run({ op: 'count', of: lit(3) }))).toEqual(['type_mismatch'])
		expect(codes(run({ op: 'sum', of: lit('x'), field: ['n'] }))).toEqual(['type_mismatch'])
	})

	it('lower and email_domain map over strings and lists', () => {
		expect(value({ op: 'lower', of: lit('ReD') })).toBe('red')
		expect(value({ op: 'lower', of: lit(['A', 'b']) })).toEqual(['a', 'b'])
		expect(value({ op: 'email_domain', of: lit('Ops@Widgets.Example') })).toBe('widgets.example')
		expect(value({ op: 'email_domain', of: lit(['a@x.test', 'b@y.test']) })).toEqual([
			'x.test',
			'y.test',
		])
		for (const bad of ['no-at-sign', '@x.test', 'a@', 'a@nodot', 7]) {
			expect(value({ op: 'email_domain', of: lit(bad) })).toBe(U)
		}
		expect(value({ op: 'lower', of: lit(['a', 1]) })).toBe(U)
	})

	it('in uses structural equality', () => {
		expect(value({ op: 'in', value: lit('b'), list: lit(['a', 'b']) })).toBe(true)
		expect(value({ op: 'in', value: lit({ x: 1, y: 2 }), list: lit([{ y: 2, x: 1 }]) })).toBe(true)
		expect(value({ op: 'in', value: lit('c'), list: lit(['a', 'b']) })).toBe(false)
		expect(value({ op: 'in', value: missing, list: lit(['a']) })).toBe(U)
		expect(value({ op: 'in', value: lit('a'), list: lit('a') })).toBe(U)
	})
})

describe('comparisons', () => {
	it.each([
		['eq', 3, 3, true],
		['eq', 3, 4, false],
		['ne', 3, 4, true],
		['lt', 3, 4, true],
		['lt', 4, 4, false],
		['lte', 4, 4, true],
		['gt', 5, 4, true],
		['gte', 4, 5, false],
	] as const)('%s(%s, %s) is %s', (op, l, r, expected) => {
		expect(value({ op, left: lit(l), right: lit(r) })).toBe(expected)
	})

	it('eq compares JSON structurally', () => {
		expect(
			value({ op: 'eq', left: lit({ a: [1, { b: 2 }] }), right: lit({ a: [1, { b: 2 }] }) }),
		).toBe(true)
		expect(value({ op: 'eq', left: lit([1, 2]), right: lit([2, 1]) })).toBe(false)
		expect(value({ op: 'eq', left: lit(null), right: lit(0) })).toBe(false)
	})

	it('ordering is defined only on safe integers', () => {
		expect(codes(run({ op: 'lt', left: lit('a'), right: lit('b') }))).toEqual(['non_integer'])
		const ctx = ctxWith({ f: known(0.5), big: known(2 ** 60) })
		expect(codes(run({ op: 'lt', left: v('f'), right: lit(1) }, ctx))).toEqual(['non_integer'])
		expect(codes(run({ op: 'gt', left: v('big'), right: lit(1) }, ctx))).toEqual(['unsafe_integer'])
	})

	it('any unknown side makes every comparison unknown', () => {
		for (const op of ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const) {
			expect(value({ op, left: missing, right: lit(1) })).toBe(U)
			expect(value({ op, left: lit(1), right: missing })).toBe(U)
		}
	})
})

describe('logic operators', () => {
	const T = lit(true)
	const F = lit(false)

	it('and / or / not follow Kleene and propagate unknown', () => {
		expect(value({ op: 'and', args: [T, missing] })).toBe(U)
		expect(value({ op: 'and', args: [F, missing] })).toBe(false)
		expect(value({ op: 'or', args: [T, missing] })).toBe(true)
		expect(value({ op: 'or', args: [F, missing] })).toBe(U)
		expect(value({ op: 'not', of: missing })).toBe(U)
		expect(value({ op: 'not', of: F })).toBe(true)
	})

	it('a non-boolean operand is unknown', () => {
		const r = run({ op: 'and', args: [T, lit(1)] })
		expect(r.value).toBe(U)
		expect(codes(r)).toEqual(['type_mismatch'])
	})

	it('a decided junction cites only the deciding operands', () => {
		const ctx = ctxWith({ t: known(true, ['t1']), f: known(false, ['f1']) })
		expect(run({ op: 'and', args: [v('t'), v('f')] }, ctx).eventIds).toEqual(['f1'])
		expect(run({ op: 'or', args: [v('t'), v('f')] }, ctx).eventIds).toEqual(['t1'])
		expect(run({ op: 'and', args: [v('t'), v('t')] }, ctx).eventIds).toEqual(['t1'])
	})
})

describe('quantifiers', () => {
	const big: Expr = { op: 'gt', left: { op: 'get', of: v('x'), path: ['n'] }, right: lit(2) }
	const list = (...ns: (number | null)[]) =>
		lit(ns.map((n): JsonValue => (n === null ? {} : { n })))

	it('all / any with binding', () => {
		expect(value({ op: 'all', in: list(3, 4), as: 'x', test: big })).toBe(true)
		expect(value({ op: 'all', in: list(3, 1), as: 'x', test: big })).toBe(false)
		expect(value({ op: 'any', in: list(1, 3), as: 'x', test: big })).toBe(true)
		expect(value({ op: 'any', in: list(1, 2), as: 'x', test: big })).toBe(false)
	})

	it('unknown elements propagate unless another element decides', () => {
		expect(value({ op: 'all', in: list(3, null), as: 'x', test: big })).toBe(U)
		expect(value({ op: 'all', in: list(1, null), as: 'x', test: big })).toBe(false)
		expect(value({ op: 'any', in: list(1, null), as: 'x', test: big })).toBe(U)
		expect(value({ op: 'any', in: list(3, null), as: 'x', test: big })).toBe(true)
	})

	it('empty lists are vacuous', () => {
		expect(value({ op: 'all', in: lit([]), as: 'x', test: big })).toBe(true)
		expect(value({ op: 'any', in: lit([]), as: 'x', test: big })).toBe(false)
	})

	it('a partial list cannot prove "every" or "none", only a witness', () => {
		const partial = res([{ n: 3 }], [], { partial: true, eventIds: ['e1'] })
		const ctx = ctxWith({ xs: partial })
		const all = run({ op: 'all', in: v('xs'), as: 'x', test: big }, ctx)
		expect(all.value).toBe(U)
		expect(codes(all)).toEqual(['incomplete_list'])
		expect(value({ op: 'any', in: v('xs'), as: 'x', test: big }, ctx)).toBe(true)
		expect(value({ op: 'count', of: v('xs') }, ctx)).toBe(U)
		expect(value({ op: 'sum', of: v('xs'), field: ['n'] }, ctx)).toBe(U)
		expect(value({ op: 'in', value: lit({ n: 3 }), list: v('xs') }, ctx)).toBe(true)
		expect(value({ op: 'in', value: lit({ n: 4 }), list: v('xs') }, ctx)).toBe(U)
	})

	it('a quantifier variable shadows an outer one', () => {
		const ctx = ctxWith({ x: known({ n: 0 }) })
		expect(value({ op: 'all', in: list(3), as: 'x', test: big }, ctx)).toBe(true)
	})
})
