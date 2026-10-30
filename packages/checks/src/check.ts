import {
	type CheckDefinition,
	CheckDefinitionSchema,
	type CheckResult,
	CheckResultSchema,
} from '@stepglass/schema'
import { type EvalContext, evaluate } from './evaluate.js'
import { deterministicUuidv7 } from './id.js'
import type { Trace } from './trace.js'
import { dedupe, type Reason, type Res, res, truthOf } from './value.js'

const MAX_MESSAGE = 2000

/**
 * The variables every check can read: the session's `goal` and `agent`, when recorded. They come
 * from the `session.started` event and cite it.
 */
export function sessionVars(trace: Trace): Map<string, Res> {
	const vars = new Map<string, Res>()
	const started = trace.events.find((e) => e.type === 'session.started')
	if (started?.type === 'session.started') {
		vars.set('goal', res(started.goal, [], { eventIds: [started.id] }))
		if (started.agent) vars.set('agent', res(started.agent, [], { eventIds: [started.id] }))
	}
	return vars
}

/** The root evaluation of one check, before it is shaped into a result. */
export function evaluateAssertion(def: CheckDefinition, trace: Trace): Res {
	const ctx: EvalContext = { vars: sessionVars(trace), trace }
	return truthOf(evaluate(def.assert, ctx)).res
}

/**
 * Evaluates one check over one session and returns a schema-valid result.
 *
 * Outcome rules, in order: a false assertion fails; an unknown one is unknown; a true one passes
 * only if it cites at least one event and none of the evidence it relied on is unverified.
 * Otherwise it is unknown, because a pass the evidence cannot back is exactly the lie this
 * engine exists to prevent.
 */
export function evaluateCheck(definition: CheckDefinition, trace: Trace): CheckResult {
	const def = CheckDefinitionSchema.parse(definition)
	const r = evaluateAssertion(def, trace)
	const { outcome, reasons } = decide(def, r)
	const result: CheckResult = {
		schemaVersion: 1,
		id: deterministicUuidv7(
			trace.throughMs,
			`${trace.sessionId}/${def.id}@${def.version}/${trace.throughSeq}`,
		),
		sessionId: trace.sessionId,
		checkId: def.id,
		checkVersion: def.version,
		outcome,
		reasons: reasons.map(clamp),
		...(r.measurement ? { measurement: r.measurement } : {}),
		evaluatedThroughSeq: trace.throughSeq,
		evaluatedAt: new Date(trace.throughMs).toISOString(),
	}
	return CheckResultSchema.parse(result)
}

function decide(def: CheckDefinition, r: Res): Pick<CheckResult, 'outcome' | 'reasons'> {
	const own = uniqueReasons(r.reasons)
	if (r.value === false) {
		return { outcome: 'fail', reasons: orDefault(own, 'violated', `Not met: ${def.title}`, r) }
	}
	if (r.value !== true) {
		return {
			outcome: 'unknown',
			reasons: orDefault(own, 'undetermined', `Could not decide: ${def.title}`, r),
		}
	}
	if (r.unverified.length > 0) return { outcome: 'unknown', reasons: uniqueReasons(r.unverified) }
	if (r.eventIds.length === 0) {
		const message = 'Nothing recorded backs this pass, so it is not one.'
		return { outcome: 'unknown', reasons: [{ code: 'no_evidence', message, eventIds: [] }] }
	}
	return {
		outcome: 'pass',
		reasons: [{ code: 'satisfied', message: def.title, eventIds: [...r.eventIds] }],
	}
}

function orDefault(reasons: Reason[], code: string, message: string, r: Res): Reason[] {
	return reasons.length > 0 ? reasons : [{ code, message, eventIds: [...r.eventIds] }]
}

/** Drops repeats of the same explanation, merging the events each repeat cited. */
function uniqueReasons(reasons: readonly Reason[]): Reason[] {
	const byKey = new Map<string, Reason>()
	for (const r of reasons) {
		const key = `${r.code}\n${r.message}`
		const seen = byKey.get(key)
		byKey.set(key, seen ? { ...seen, eventIds: dedupe([...seen.eventIds, ...r.eventIds]) } : r)
	}
	return [...byKey.values()]
}

function clamp(r: Reason): Reason {
	const long = r.message.length > MAX_MESSAGE
	const message = long ? `${r.message.slice(0, MAX_MESSAGE - 3)}...` : r.message
	return { ...r, message, eventIds: [...r.eventIds] }
}
