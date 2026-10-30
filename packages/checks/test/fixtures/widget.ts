// A neutral domain for tests: an agent reads widgets with `widget_get`, recolors them with
// `widget_update`, and may ask for sign-off with `widget_approve`.
import type { ActionStatus, JsonObject, JsonValue, Snapshot, TraceEvent } from '@stepglass/schema'

/** Deterministic UUIDv7s: `id(1)`, `id(2)`, … */
export const id = (n: number) => `0192f0a0-0000-7000-8000-${n.toString(16).padStart(12, '0')}`

export const SESSION_ID = id(1)
const T0 = Date.UTC(2026, 9, 29, 12, 0, 0)
export const at = (sec: number) => new Date(T0 + sec * 1000).toISOString()

export interface ToolOptions {
	input?: JsonValue
	output?: JsonValue
	/** `null` records the start only, as if the action never finished. */
	status?: ActionStatus | null
	producer?: string
}

export interface Recorded {
	actionId: string
	startedId: string
	finishedId?: string
}

/**
 * Appends events in the order calls are made: each call gets the next `seq` on its producer and
 * the next second on the clock, so tests read top to bottom like the session they describe.
 */
export function recorder() {
	const events: TraceEvent[] = []
	const seqs = new Map<string, number>()
	let n = 100
	let clock = 0
	const base = (producer = 'p1') => {
		const seq = seqs.get(producer) ?? 0
		seqs.set(producer, seq + 1)
		return {
			schemaVersion: 1,
			id: id(n++),
			sessionId: SESSION_ID,
			occurredAt: at(clock++),
			source: 'sdk',
			producer: { id: producer, seq },
			capture: { completeness: 'full' },
		} as const
	}

	return {
		events,
		start(agent = 'widget-agent') {
			events.push({
				...base(),
				type: 'session.started',
				goal: 'Recolor widget W-1',
				client: { name: 'test-client', transport: 'sdk' },
				agent,
			})
			return this
		},
		finish() {
			events.push({ ...base(), type: 'session.finished', status: 'finished' })
			return this
		},
		gap() {
			events.push({
				...base(),
				type: 'recording.gap',
				producerId: 'p1',
				fromSeq: 90,
				toSeq: 95,
				reason: 'disconnect',
			})
			return this
		},
		tool(name: string, opts: ToolOptions = {}): Recorded {
			const actionId = id(n++)
			const started = base(opts.producer)
			events.push({
				...started,
				type: 'action.started',
				actionId,
				kind: 'tool',
				tool: { name },
				...(opts.input !== undefined ? { input: opts.input } : {}),
			})
			const status = opts.status === undefined ? 'succeeded' : opts.status
			if (status === null) return { actionId, startedId: started.id }
			const finished = base(opts.producer)
			events.push({
				...finished,
				type: 'action.finished',
				actionId,
				status,
				...(opts.output !== undefined ? { output: opts.output } : {}),
			})
			return { actionId, startedId: started.id, finishedId: finished.id }
		},
		model(): Recorded {
			const actionId = id(n++)
			const started = base()
			events.push({
				...started,
				type: 'action.started',
				actionId,
				kind: 'model',
				model: { provider: 'test', name: 'm1' },
			})
			return { actionId, startedId: started.id }
		},
		snapshot(
			actionId: string,
			phase: 'before' | 'after',
			state: JsonObject,
			over: Partial<Snapshot> = {},
		): string {
			const e = base()
			events.push({
				...e,
				type: 'evidence.recorded',
				snapshot: {
					id: id(n++),
					actionId,
					object: { type: 'widget', id: 'W-1' },
					phase,
					state,
					capturedAt: e.occurredAt,
					source: 'in_transaction',
					...over,
				},
			})
			return e.id
		},
	}
}

/** The canonical run: read W-1, recolor it red to blue with a verified before/after pair. */
export function recolorSession() {
	const r = recorder().start()
	const get = r.tool('widget_get', { input: { id: 'W-1' }, output: { color: 'red', count: 3 } })
	const update = r.tool('widget_update', { input: { id: 'W-1', color: 'blue' } })
	const before = r.snapshot(update.actionId, 'before', { color: 'red', count: 3 })
	const after = r.snapshot(update.actionId, 'after', { color: 'blue', count: 3 })
	r.finish()
	return { ...r, get, update, before, after }
}
