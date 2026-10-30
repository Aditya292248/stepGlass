import { deriveEvidenceLabel, type Expr, type JsonValue } from '@stepglass/schema'
import { type EvalContext, evaluate } from './evaluate.js'
import { UNKNOWN } from './logic.js'
import { actionValue, type Trace } from './trace.js'
import { describe, getPath, type Reason, type Res, res, truthOf, unknownRes } from './value.js'

type EventsWhere = (Expr & { op: 'events' })['where']
type ObjectRef = (Expr & { op: 'snapshot' })['object']

function noTrace(op: string): Res {
	return unknownRes('no_session', `"${op}" needs a recorded session.`)
}

/**
 * The actions matching a selector, as a list whose items cite each action's events. The list is
 * partial when the recording is incomplete or when membership of some action is undecidable
 * (its status was never recorded, or `inputMatches` was unknown for it). A complete list also
 * cites the session bounds, because "these are all of them" rests on the whole recording.
 */
export function selectEvents(where: EventsWhere, ctx: EvalContext): Res {
	const trace = ctx.trace
	if (!trace) return noTrace('events')
	const items: Res[] = []
	const values: JsonValue[] = []
	let partial = trace.incomplete.length > 0
	for (const rec of trace.actions) {
		const s = rec.started
		if (!s) continue
		if (where.type !== undefined && s.kind !== where.type) continue
		if (where.tool !== undefined && s.tool?.name !== where.tool) continue
		if (where.status !== undefined) {
			if (!rec.finished) {
				partial = true
				continue
			}
			if (rec.finished.status !== where.status) continue
		}
		const ids = rec.finished ? [s.id, rec.finished.id] : [s.id]
		const value = actionValue(rec)
		const item = res(value, [], { eventIds: ids })
		if (where.inputMatches !== undefined) {
			const input = getPath(value, ['input'])
			const vars = new Map(ctx.vars)
			vars.set('action', item)
			vars.set(
				'input',
				input === UNKNOWN
					? unknownRes('missing_field', 'No input was recorded.')
					: res(input, [item]),
			)
			const { truth } = truthOf(evaluate(where.inputMatches, { ...ctx, vars }))
			if (truth === UNKNOWN) partial = true
			if (truth !== true) continue
		}
		items.push(item)
		values.push(value)
	}
	return res(values, items, { items, partial, eventIds: partial ? [] : trace.bounds })
}

/** Resolves an object reference to its type and ID; the ID must evaluate to a string. */
export function resolveObject(
	object: ObjectRef,
	ctx: EvalContext,
): { ok: true; type: string; id: string; res: Res } | { ok: false; res: Res } {
	const idRes = evaluate(object.id, ctx)
	if (idRes.value === UNKNOWN) return { ok: false, res: idRes }
	if (typeof idRes.value !== 'string') {
		const msg = `An object ID must be text, got ${describe(idRes.value)}.`
		return { ok: false, res: unknownRes('type_mismatch', msg, [idRes]) }
	}
	return { ok: true, type: object.type, id: idRes.value, res: idRes }
}

/**
 * The recorded state of one object: the first `before` or the last `after` snapshot in the
 * session, so a value spans every action that touched the object. Reading state is a claim about
 * the world, so state backed only by the tool's own report is marked unverified.
 */
export function readSnapshot(object: ObjectRef, phase: 'before' | 'after', ctx: EvalContext): Res {
	const trace = ctx.trace
	if (!trace) return noTrace('snapshot')
	const ref = resolveObject(object, ctx)
	if (!ref.ok) return ref.res
	const matches = trace.evidence.filter(
		(e) =>
			e.snapshot.object.type === ref.type &&
			e.snapshot.object.id === ref.id &&
			e.snapshot.phase === phase,
	)
	const ev = phase === 'before' ? matches[0] : matches.at(-1)
	if (!ev) {
		const msg = `No ${phase} snapshot of ${ref.type} ${ref.id} was recorded.`
		return unknownRes('missing_snapshot', msg, [ref.res])
	}
	return res(ev.snapshot.state, [ref.res], {
		eventIds: [ev.id],
		unverified: unverifiedSnapshot(trace, ev.snapshot.actionId, [ev.id]),
	})
}

/**
 * Labels the action that recorded a snapshot with the schema's own rule, so the engine, API and
 * UI agree on what "verified" means. Anything below a verified label is reported here.
 */
export function unverifiedSnapshot(
	trace: Trace,
	actionId: string,
	eventIds: readonly string[],
): Reason[] {
	const rec = trace.actionsById.get(actionId)
	const { label, reasons } = deriveEvidenceLabel({
		toolKind: 'write',
		...(rec?.finished ? { finishedStatus: rec.finished.status } : {}),
		snapshots: rec?.evidence.map((e) => e.snapshot) ?? [],
	})
	if (label.startsWith('verified_')) return []
	const why = reasons.length > 0 ? ` (${reasons.join(', ')})` : ''
	return [
		{
			code: 'unverified_evidence',
			message: `Evidence for action ${actionId} is ${label}, not verified${why}.`,
			eventIds: [...eventIds],
		},
	]
}
