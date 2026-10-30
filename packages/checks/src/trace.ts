import type { JsonValue, TraceEvent } from '@stepglass/schema'
import type { Truth } from './logic.js'
import { UNKNOWN } from './logic.js'
import { isObject } from './value.js'

type EventOf<T extends TraceEvent['type']> = Extract<TraceEvent, { type: T }>
export type ActionStartedEvent = EventOf<'action.started'>
export type ActionFinishedEvent = EventOf<'action.finished'>
export type EvidenceEvent = EventOf<'evidence.recorded'>

/** One action, assembled from its start, its finish and the snapshots recorded for it. */
export interface ActionRecord {
	readonly actionId: string
	readonly started?: ActionStartedEvent
	readonly finished?: ActionFinishedEvent
	/** Snapshot events for this action, in session order. */
	readonly evidence: readonly EvidenceEvent[]
}

/** A session's events indexed for evaluation. Built once and shared by every check. */
export interface Trace {
	readonly sessionId: string
	/** Deduplicated by event ID and in session order (see {@link compareEvents}). */
	readonly events: readonly TraceEvent[]
	/** Actions that have an `action.started`, in start order. */
	readonly actions: readonly ActionRecord[]
	readonly actionsById: ReadonlyMap<string, ActionRecord>
	/** Every snapshot event, in session order. */
	readonly evidence: readonly EvidenceEvent[]
	/** The session's start and finish events, which back any claim that something is absent. */
	readonly bounds: readonly string[]
	/**
	 * Why the recording may be missing events, empty when it is provably complete: the session
	 * finished, no gap was reported, and every finish or snapshot has its action's start.
	 */
	readonly incomplete: readonly string[]
	/** The highest producer `seq` seen; the result cursor. */
	readonly throughSeq: number
	/** The latest `occurredAt` seen, in epoch milliseconds; results are stamped with it. */
	readonly throughMs: number
}

/**
 * Session order. Within one producer `seq` is authoritative; across producers only timestamps
 * relate events, and ties fall back to producer ID so the order is still deterministic.
 */
export function compareEvents(a: TraceEvent, b: TraceEvent): number {
	if (a.producer.id === b.producer.id) return a.producer.seq - b.producer.seq
	const dt = Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
	if (dt !== 0) return dt
	return a.producer.id < b.producer.id ? -1 : 1
}

/**
 * Happens-before. Same producer: decided by `seq`. Different producers: decided by timestamps
 * when they differ, and unknown when they are equal, because neither order can be proven.
 */
export function happensBefore(a: TraceEvent, b: TraceEvent): Truth {
	if (a.id === b.id) return false
	if (a.producer.id === b.producer.id) return a.producer.seq < b.producer.seq
	const dt = Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
	return dt === 0 ? UNKNOWN : dt < 0
}

/** Indexes one session. Throws if the events are empty or span sessions: that is a caller bug. */
export function indexTrace(input: readonly TraceEvent[]): Trace {
	const first = input[0]
	if (!first) throw new Error('indexTrace needs at least one event')
	const sessionId = first.sessionId
	const byId = new Map<string, TraceEvent>()
	for (const e of input) {
		if (e.sessionId !== sessionId) throw new Error(`event ${e.id} is from another session`)
		if (!byId.has(e.id)) byId.set(e.id, e)
	}
	const events = [...byId.values()].sort(compareEvents)

	const records = new Map<
		string,
		{ started?: ActionStartedEvent; finished?: ActionFinishedEvent; evidence: EvidenceEvent[] }
	>()
	const record = (actionId: string) => {
		let r = records.get(actionId)
		if (!r) {
			r = { evidence: [] }
			records.set(actionId, r)
		}
		return r
	}
	const evidence: EvidenceEvent[] = []
	const incomplete: string[] = []
	const bounds: string[] = []
	let started = false
	let finished = false
	for (const e of events) {
		if (e.type === 'action.started') record(e.actionId).started ??= e
		else if (e.type === 'action.finished') record(e.actionId).finished ??= e
		else if (e.type === 'evidence.recorded') {
			record(e.snapshot.actionId).evidence.push(e)
			evidence.push(e)
		} else if (e.type === 'recording.gap') {
			incomplete.push(`events ${e.fromSeq}-${e.toSeq} from ${e.producerId} were lost (${e.reason})`)
		} else if (e.type === 'session.started') {
			bounds.push(e.id)
			started = true
		} else if (e.type === 'session.finished') {
			bounds.push(e.id)
			finished = true
		}
	}
	if (!finished) incomplete.push('the session has not finished')
	if (!started) incomplete.push('the session start was not recorded')

	const actions: ActionRecord[] = []
	const actionsById = new Map<string, ActionRecord>()
	for (const [actionId, r] of records) {
		const rec: ActionRecord = { actionId, ...r }
		actionsById.set(actionId, rec)
		if (r.started) actions.push(rec)
		else incomplete.push(`action ${actionId} has no recorded start`)
	}

	return {
		sessionId,
		events,
		actions,
		actionsById,
		evidence,
		bounds,
		incomplete,
		throughSeq: Math.max(...events.map((e) => e.producer.seq)),
		throughMs: Math.max(...events.map((e) => Date.parse(e.occurredAt))),
	}
}

/**
 * The JSON an expression sees for one action. Field names follow the descriptor addressing
 * scheme (`input`, `output`, `before`, `after`). Anything not captured is left out, so reading
 * it is `unknown` rather than an empty value.
 */
export function actionValue(rec: ActionRecord): JsonValue {
	const s = rec.started
	const f = rec.finished
	const v: { [key: string]: JsonValue } = { actionId: rec.actionId }
	if (s) {
		v.kind = s.kind
		if (s.tool) v.tool = s.tool.name
		if (s.model) v.model = { ...s.model }
		v.startedAt = s.occurredAt
		if (s.input !== undefined) Object.assign(v, captured(s, { input: s.input }))
	}
	if (f) {
		v.status = f.status
		v.finishedAt = f.occurredAt
		const out: { [key: string]: JsonValue } = {}
		if (f.output !== undefined) out.output = f.output
		if (f.error) out.error = { ...f.error }
		Object.assign(v, captured(f, out))
	}
	const objects = new Set(
		rec.evidence.map((e) => `${e.snapshot.object.type}/${e.snapshot.object.id}`),
	)
	if (objects.size === 1) {
		const before = rec.evidence.find((e) => e.snapshot.phase === 'before')
		const after = rec.evidence.findLast((e) => e.snapshot.phase === 'after')
		if (before) v.before = before.snapshot.state
		if (after) v.after = after.snapshot.state
	}
	return v
}

/** Drops payload fields the producer did not capture; `omittedFields` are dot paths. */
function captured(
	e: TraceEvent,
	payload: { [key: string]: JsonValue },
): { [key: string]: JsonValue } {
	const { completeness, omittedFields = [] } = e.capture
	if (completeness === 'metadata_only' || completeness === 'redacted') return {}
	const copy = cloneJson(payload)
	for (const path of omittedFields) {
		const keys = path.split('.')
		const last = keys.pop()
		let cur: JsonValue | undefined = copy
		for (const k of keys) cur = cur !== undefined && isObject(cur) ? cur[k] : undefined
		if (last !== undefined && cur !== undefined && isObject(cur)) delete cur[last]
	}
	return copy
}

function cloneJson<T extends JsonValue>(v: T): T
function cloneJson(v: JsonValue): JsonValue {
	if (Array.isArray(v)) return v.map(cloneJson)
	if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cloneJson(x)]))
	return v
}
