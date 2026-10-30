import type { Expr, JsonObject, JsonValue } from '@stepglass/schema'
import type { EvalContext } from './evaluate.js'
import { UNKNOWN } from './logic.js'
import { resolveObject, unverifiedSnapshot } from './selectors.js'
import type { EvidenceEvent } from './trace.js'
import { isObject, jsonEqual, type Reason, type Res, res, unknownRes } from './value.js'

/**
 * The dot paths whose values differ between two states. Objects are compared key by key; any
 * other value, arrays included, is compared whole. `ignore` lists paths (and their subtrees) the
 * store computes itself, so a derived field never counts as the agent's change.
 */
export function diffPaths(
	before: JsonObject,
	after: JsonObject,
	ignore: readonly string[] = [],
): string[] {
	const out: string[] = []
	const skip = (path: string) => ignore.some((i) => path === i || path.startsWith(`${i}.`))
	const walk = (a: JsonValue | undefined, b: JsonValue | undefined, path: string) => {
		if (path && skip(path)) return
		if (a !== undefined && b !== undefined && isObject(a) && isObject(b)) {
			const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
			for (const k of keys) walk(a[k], b[k], path ? `${path}.${k}` : k)
			return
		}
		if (a === undefined || b === undefined || !jsonEqual(a, b)) out.push(path)
	}
	walk(before, after, '')
	return out
}

interface ObjectHistory {
	readonly type: string
	readonly id: string
	before?: EvidenceEvent
	after?: EvidenceEvent
}

/**
 * Only the listed objects may have changed. Each recorded object is judged by its net change
 * over the session (first `before` against last `after`). A change outside the list fails and is
 * listed with its paths. An unlisted object with half a pair, an incomplete recording, or a
 * session with no snapshots at all is unknown. Unlisted objects are claimed unchanged, so their
 * snapshots must be verified for a pass; a change they show can still fail.
 */
export function onlyChanged(e: Expr & { op: 'only_changed' }, ctx: EvalContext): Res {
	const trace = ctx.trace
	if (!trace) return unknownRes('no_session', '"only_changed" needs a recorded session.')
	const allowed = new Set<string>()
	const refs: Res[] = []
	for (const object of e.objects) {
		const ref = resolveObject(object, ctx)
		if (!ref.ok) return ref.res
		allowed.add(`${ref.type}/${ref.id}`)
		refs.push(ref.res)
	}

	const objects = new Map<string, ObjectHistory>()
	for (const ev of trace.evidence) {
		const { type, id } = ev.snapshot.object
		const key = `${type}/${id}`
		const h = objects.get(key) ?? { type, id }
		if (ev.snapshot.phase === 'before') h.before ??= ev
		else h.after = ev
		objects.set(key, h)
	}
	if (objects.size === 0) {
		return unknownRes(
			'no_snapshots',
			'No snapshots were recorded, so changes cannot be judged.',
			refs,
		)
	}

	const violations: Reason[] = []
	const missing: Reason[] = []
	const unverified: Reason[] = []
	const cited: string[] = []
	for (const [key, h] of objects) {
		const ids = [h.before?.id, h.after?.id].filter((x) => x !== undefined)
		cited.push(...ids)
		if (allowed.has(key)) continue
		const label = `${h.type} ${h.id}`
		if (!h.before || !h.after) {
			const phase = h.before ? 'after' : 'before'
			missing.push({
				code: 'missing_snapshot',
				message: `No ${phase} snapshot of ${label} was recorded, so its change is unknown.`,
				eventIds: ids,
			})
			continue
		}
		const ignore = [
			...(h.before.snapshot.computedFields ?? []),
			...(h.after.snapshot.computedFields ?? []),
		]
		const changed = diffPaths(h.before.snapshot.state, h.after.snapshot.state, ignore)
		if (changed.length > 0) {
			violations.push({
				code: 'unexpected_change',
				message: `${label} changed outside the allowed objects: ${changed.join(', ')}.`,
				eventIds: ids,
			})
		}
		for (const ev of [h.before, h.after]) {
			unverified.push(...unverifiedSnapshot(trace, ev.snapshot.actionId, [ev.id]))
		}
	}

	if (violations.length > 0) return res(false, refs, { reasons: violations })
	if (missing.length > 0) return res(UNKNOWN, refs, { reasons: missing })
	if (trace.incomplete.length > 0) {
		const message = `Changes may be unrecorded: ${trace.incomplete.join('; ')}.`
		return unknownRes('incomplete_recording', message, refs)
	}
	return res(true, refs, { eventIds: [...cited, ...trace.bounds], unverified })
}
