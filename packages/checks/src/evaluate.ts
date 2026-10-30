import type { Expr, JsonValue } from '@stepglass/schema'
import { and3, not3, or3, type Truth, UNKNOWN } from './logic.js'
import {
	describe,
	getPath,
	isSafeInt,
	jsonEqual,
	type Res,
	res,
	truthOf,
	unknownRes,
} from './value.js'

/** What an expression can see: variables bound by the caller or by a quantifier. */
export interface EvalContext {
	readonly vars: ReadonlyMap<string, Res>
}

/** An empty context, for expressions that read only literals. */
export const EMPTY_CONTEXT: EvalContext = { vars: new Map() }

/**
 * Evaluates one expression. Total: malformed or missing evidence yields `unknown` with a reason,
 * never an exception, so one bad field cannot take down a whole bundle.
 */
export function evaluate(e: Expr, ctx: EvalContext): Res {
	switch (e.op) {
		case 'lit':
			return res(e.value)
		case 'var':
			return (
				ctx.vars.get(e.name) ?? unknownRes('unbound_variable', `Nothing is bound to "${e.name}".`)
			)
		case 'get':
			return get(evaluate(e.of, ctx), e.path)
		case 'count':
			return count(evaluate(e.of, ctx))
		case 'sum':
			return sum(evaluate(e.of, ctx), e.field)
		case 'email_domain':
			return mapStrings(evaluate(e.of, ctx), 'an email address', emailDomain)
		case 'lower':
			return mapStrings(evaluate(e.of, ctx), 'text', (s) => s.toLowerCase())
		case 'in':
			return member(evaluate(e.value, ctx), evaluate(e.list, ctx))
		case 'eq':
		case 'ne':
		case 'lt':
		case 'lte':
		case 'gt':
		case 'gte':
			return compare(e.op, evaluate(e.left, ctx), evaluate(e.right, ctx))
		case 'and':
		case 'or':
			return junction(
				e.op,
				e.args.map((a) => evaluate(a, ctx)),
			)
		case 'not': {
			const { truth, res: r } = truthOf(evaluate(e.of, ctx))
			return res(not3(truth), [r])
		}
		case 'all':
		case 'any':
			return quantify(e.op, evaluate(e.in, ctx), e.as, e.test, ctx)
		case 'events':
		case 'snapshot':
		case 'required_before':
		case 'forbidden_after_unless':
		case 'only_changed':
			return unknownRes('unsupported_operator', `"${e.op}" needs a recorded session.`)
		default:
			return e satisfies never
	}
}

function get(of: Res, path: readonly string[]): Res {
	if (of.value === UNKNOWN) return of
	const v = getPath(of.value, path)
	if (v === UNKNOWN)
		return unknownRes('missing_field', `No field "${path.join('.')}" was recorded.`, [of])
	return res(v, [of])
}

/** The elements of a list result, each with its own evidence when the list carries it. */
export function elements(list: Res): readonly Res[] | undefined {
	if (!Array.isArray(list.value)) return undefined
	if (list.items) return list.items
	return list.value.map((v) => res(v, [], { eventIds: list.eventIds }))
}

function notAList(r: Res): Res {
	return unknownRes('type_mismatch', `Expected a list, got ${describe(r.value)}.`, [r])
}

function incomplete(r: Res, what: string): Res {
	return unknownRes('incomplete_list', `The recording may be missing ${what}.`, [r])
}

function count(of: Res): Res {
	if (of.value === UNKNOWN) return of
	if (!Array.isArray(of.value)) return notAList(of)
	if (of.partial) return incomplete(of, 'elements, so the count is a lower bound')
	return res(of.value.length, [of])
}

/** Integer-only addition; an inexact intermediate total makes the whole sum unknown. */
function sum(of: Res, field: readonly string[]): Res {
	if (of.value === UNKNOWN) return of
	const items = elements(of)
	if (!items) return notAList(of)
	if (of.partial) return incomplete(of, 'elements, so the sum is a lower bound')
	let total = 0
	for (const item of items) {
		const v = get(item, field)
		if (v.value === UNKNOWN) return res(UNKNOWN, [of, v])
		if (!isSafeInt(v.value)) return nonInteger(v, [of])
		total += v.value
		if (!Number.isSafeInteger(total)) {
			return unknownRes('unsafe_integer', 'The sum exceeds the exactly representable range.', [of])
		}
	}
	return res(total, [of])
}

function nonInteger(r: Res, parts: readonly Res[] = []): Res {
	const code =
		typeof r.value === 'number' && Number.isInteger(r.value) ? 'unsafe_integer' : 'non_integer'
	return unknownRes(code, `Expected a safe integer, got ${describe(r.value)}.`, [...parts, r])
}

function emailDomain(s: string): string | undefined {
	const at = s.lastIndexOf('@')
	const domain = s.slice(at + 1).toLowerCase()
	return at > 0 && /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(domain) ? domain : undefined
}

/** Applies a string function to a string or to every string in a list. */
function mapStrings(of: Res, what: string, f: (s: string) => string | undefined): Res {
	if (of.value === UNKNOWN) return of
	const one = (v: JsonValue): string | undefined => (typeof v === 'string' ? f(v) : undefined)
	const bad = (v: JsonValue) =>
		unknownRes('type_mismatch', `Expected ${what}, got ${describe(v)}.`, [of])
	if (!Array.isArray(of.value)) {
		const out = one(of.value)
		return out === undefined ? bad(of.value) : res(out, [of])
	}
	const out: string[] = []
	for (const v of of.value) {
		const mapped = one(v)
		if (mapped === undefined) return bad(v)
		out.push(mapped)
	}
	return res(out, [of], of.partial ? { partial: true } : {})
}

function member(value: Res, list: Res): Res {
	if (value.value === UNKNOWN) return res(UNKNOWN, [value, list])
	if (list.value === UNKNOWN) return list
	const items = elements(list)
	if (!items) return notAList(list)
	const needle = value.value
	const hit = items.find((i) => i.value !== UNKNOWN && jsonEqual(i.value, needle))
	if (hit) return res(true, [value, hit])
	if (list.partial) return incomplete(list, `an element equal to ${describe(needle)}`)
	return res(false, [value, list])
}

type CompareOp = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'

/** Equality is structural over JSON; ordering is defined only on safe integers. */
export function compare(op: CompareOp, left: Res, right: Res): Res {
	const l = left.value
	const r = right.value
	if (l === UNKNOWN || r === UNKNOWN) return res(UNKNOWN, [left, right])
	if (op === 'eq') return res(jsonEqual(l, r), [left, right])
	if (op === 'ne') return res(!jsonEqual(l, r), [left, right])
	if (!isSafeInt(l)) return nonInteger(left, [right])
	if (!isSafeInt(r)) return nonInteger(right, [left])
	const ordered = { lt: l < r, lte: l <= r, gt: l > r, gte: l >= r }[op]
	return res(ordered, [left, right])
}

/**
 * Kleene `and` / `or`. The result keeps only the evidence of the operands that decided it: a
 * false conjunct alone explains a false `and`, so the others are not cited. When the operands
 * come from a list, a verdict that needs every element (all true, none true) also cites the list,
 * and is unknown if the list may be incomplete.
 */
export function junction(op: 'and' | 'or', parts: readonly Res[], list?: Res): Res {
	const read = parts.map(truthOf)
	const truths = read.map((x) => x.truth)
	const decider = op === 'or'
	const truth: Truth = op === 'and' ? and3(...truths) : or3(...truths)
	if (truth === UNKNOWN) return res(UNKNOWN, pick(read, UNKNOWN))
	if (truth === decider) return res(truth, pick(read, decider))
	const used = read.map((x) => x.res)
	if (!list) return res(truth, used)
	if (list.partial) {
		const what = decider ? 'an element that passes the test' : 'an element that fails the test'
		return incomplete(res(UNKNOWN, [...used, list]), what)
	}
	return res(truth, [...used, list])
}

function pick(read: readonly { truth: Truth; res: Res }[], truth: Truth): Res[] {
	return read.filter((x) => x.truth === truth).map((x) => x.res)
}

function quantify(op: 'all' | 'any', list: Res, as: string, test: Expr, ctx: EvalContext): Res {
	if (list.value === UNKNOWN) return list
	const items = elements(list)
	if (!items) return notAList(list)
	const results = items.map((item) =>
		evaluate(test, { ...ctx, vars: new Map([...ctx.vars, [as, item]]) }),
	)
	if (results.length === 0) {
		if (list.partial) return incomplete(list, 'elements')
		// Vacuous truth; the list's own evidence (e.g. a complete recording) is what backs it.
		return res(op === 'all', [list])
	}
	return junction(op === 'all' ? 'and' : 'or', results, list)
}

/** Exposed for callers that build their own values, e.g. tests and lesson matching. */
export function known(value: JsonValue, eventIds: readonly string[] = []): Res {
	return res(value, [], { eventIds })
}
