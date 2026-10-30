import type { Expr, TraceEvent } from '@stepglass/schema'
import { type EvalContext, elements, evaluate, junction } from './evaluate.js'
import { and3, not3, or3, type Truth, UNKNOWN } from './logic.js'
import type { ActionRecord, ActionStartedEvent, Trace } from './trace.js'
import { happensBefore } from './trace.js'
import { describe, type ExpectedStep, isObject, type Res, res, unknownRes } from './value.js'

interface Listed {
	readonly item: Res
	readonly rec: ActionRecord
	readonly start: ActionStartedEvent
}

/** The actions in a list result, or a reason why it is not a list of actions. */
function actionsOf(list: Res, trace: Trace): Listed[] | Res {
	if (list.value === UNKNOWN) return list
	const items = elements(list)
	if (!items)
		return unknownRes('type_mismatch', `Expected actions, got ${describe(list.value)}.`, [list])
	const out: Listed[] = []
	for (const item of items) {
		const v = item.value
		const actionId = v !== UNKNOWN && isObject(v) ? v.actionId : undefined
		const rec = typeof actionId === 'string' ? trace.actionsById.get(actionId) : undefined
		if (!rec?.started) {
			return unknownRes('type_mismatch', `Expected actions, got ${describe(v)}.`, [list])
		}
		out.push({ item, rec, start: rec.started })
	}
	return out
}

/** The moment an action is over: its finish, or its start when no finish was recorded. */
const endOf = (a: Listed): TraceEvent => a.rec.finished ?? a.start

/** Succeeded is known only once a finish is recorded. */
function succeeded(a: Listed): Truth {
	return a.rec.finished ? a.rec.finished.status === 'succeeded' : UNKNOWN
}

/** What a selector asks for, for messages and the "Expected, not recorded" row. */
function selected(e: Expr): { tool?: string; kind?: 'tool' | 'model'; text: string } {
	if (e.op !== 'events') return { text: 'the required action' }
	const { tool, type } = e.where
	if (tool) return { tool, text: tool }
	if (type) return { kind: type, text: `a ${type} action` }
	return { text: 'a matching action' }
}

const name = (a: Listed) => a.start.tool?.name ?? `${a.start.kind} action`

function noTrace(op: string): Res {
	return unknownRes('no_session', `"${op}" needs a recorded session.`)
}

/**
 * Every `second` action must be preceded by a `first` action that succeeded and finished before
 * it started. A `second` with no `first` at all is a fail when the recording is complete and
 * unknown otherwise (the step may be in the lost range); both expose the missing step.
 */
export function requiredBefore(e: Expr & { op: 'required_before' }, ctx: EvalContext): Res {
	const trace = ctx.trace
	if (!trace) return noTrace(e.op)
	const firstRes = evaluate(e.first, ctx)
	const secondRes = evaluate(e.second, ctx)
	const firsts = actionsOf(firstRes, trace)
	if (!Array.isArray(firsts)) return firsts
	const seconds = actionsOf(secondRes, trace)
	if (!Array.isArray(seconds)) return seconds
	const want = selected(e.first)

	const perSecond = seconds.map((y): Res => {
		const checks = firsts.map((x): { x: Listed; ordered: Truth; ok: Truth } => ({
			x,
			ordered: happensBefore(endOf(x), y.start),
			ok: succeeded(x),
		}))
		const truth = or3(...checks.map((c) => and3(c.ordered, c.ok)))
		const yIds = [y.start.id]
		if (truth === true) {
			const witness = checks.find((c) => c.ordered === true && c.ok === true)
			return res(true, witness ? [witness.x.item] : [], { eventIds: yIds })
		}
		if (firsts.length === 0) {
			const expected: ExpectedStep = {
				...(want.tool ? { tool: want.tool } : {}),
				...(want.kind ? { kind: want.kind } : {}),
				before: { actionId: y.rec.actionId, tool: y.start.tool?.name, eventId: y.start.id },
			}
			const message = `Expected ${want.text} before ${name(y)}; not recorded.`
			const reason = { code: 'expected_not_recorded', message, eventIds: yIds }
			const value = firstRes.partial ? UNKNOWN : false
			return res(value, [], { eventIds: yIds, reasons: [reason], expected: [expected] })
		}
		const cited = checks.flatMap((c) => c.x.item.eventIds)
		if (truth === UNKNOWN) {
			const message = `Could not order ${want.text} against ${name(y)}, or its outcome is unknown.`
			return unknownRes('order_unknown', message, [
				res(UNKNOWN, [], { eventIds: [...cited, ...yIds] }),
			])
		}
		if (firstRes.partial) {
			const message = `No ${want.text} that succeeded before ${name(y)} was recorded, but the recording is incomplete.`
			return unknownRes('incomplete_list', message, [res(UNKNOWN, [], { eventIds: yIds })])
		}
		const failedBefore = checks.some((c) => c.ordered === true && c.ok === false)
		const code = failedBefore ? 'not_successful' : 'out_of_order'
		const message = failedBefore
			? `${want.text} ran before ${name(y)} but did not succeed.`
			: `${want.text} ran only after ${name(y)}.`
		return res(false, [], {
			eventIds: [...cited, ...yIds],
			reasons: [{ code, message, eventIds: [...cited, ...yIds] }],
		})
	})

	if (perSecond.length === 0) {
		if (secondRes.partial) {
			return unknownRes('incomplete_list', 'The recording may be missing the gated action.', [
				secondRes,
			])
		}
		return res(true, [secondRes])
	}
	return junction('and', perSecond, secondRes)
}

/**
 * No `forbidden` action may start after a `trigger` action is over, unless an `unless` action
 * succeeded strictly in between. Absence of a violation is a pass only over a complete recording.
 */
export function forbiddenAfterUnless(
	e: Expr & { op: 'forbidden_after_unless' },
	ctx: EvalContext,
): Res {
	const trace = ctx.trace
	if (!trace) return noTrace(e.op)
	const triggerRes = evaluate(e.trigger, ctx)
	const forbiddenRes = evaluate(e.forbidden, ctx)
	const unlessRes = e.unless ? evaluate(e.unless, ctx) : undefined
	const triggers = actionsOf(triggerRes, trace)
	if (!Array.isArray(triggers)) return triggers
	const forbidden = actionsOf(forbiddenRes, trace)
	if (!Array.isArray(forbidden)) return forbidden
	const excuses = unlessRes ? actionsOf(unlessRes, trace) : []
	if (!Array.isArray(excuses)) return excuses
	const excuse = e.unless ? selected(e.unless).text : undefined

	const pairs: Res[] = []
	for (const x of triggers) {
		for (const y of forbidden) {
			if (x.rec.actionId === y.rec.actionId) continue
			const follows = happensBefore(endOf(x), y.start)
			if (follows === false) continue
			const between = excuses.map((z) =>
				and3(succeeded(z), happensBefore(endOf(x), z.start), happensBefore(endOf(z), y.start)),
			)
			let excused = or3(...between)
			if (excused === false && unlessRes?.partial) excused = UNKNOWN
			const ok = or3(not3(follows), excused)
			const ids = [x.start.id, ...(x.rec.finished ? [x.rec.finished.id] : []), y.start.id]
			if (ok === true) {
				const z = excuses.find((_, i) => between[i] === true)
				pairs.push(res(true, z ? [z.item] : [], { eventIds: ids }))
				continue
			}
			const without = excuse ? ` without ${excuse} in between` : ''
			const message =
				ok === false
					? `${name(y)} followed ${name(x)}${without}.`
					: `Could not rule out that ${name(y)} followed ${name(x)}${without}.`
			const code = ok === false ? 'forbidden_after' : 'order_unknown'
			pairs.push(res(ok, [], { eventIds: ids, reasons: [{ code, message, eventIds: ids }] }))
		}
	}

	const lists = res(UNKNOWN, [triggerRes, forbiddenRes], {
		partial: Boolean(triggerRes.partial || forbiddenRes.partial),
	})
	if (pairs.length === 0) {
		if (lists.partial) {
			return unknownRes('incomplete_list', 'The recording may be missing a later action.', [lists])
		}
		return res(true, [lists])
	}
	return junction('and', pairs, lists)
}
