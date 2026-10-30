import type { TraceEvent } from '@stepglass/schema'
import type { EventDraft, Recorder } from './contract.js'
import { uuidv7Generator } from './uuid.js'

/**
 * A recorder that keeps events in memory, for tests and for hosts that ship events themselves.
 * Producer `seq` starts at 0 and increases by one per event, so any hole is a provable gap.
 */
export function createMemoryRecorder(opts: {
	sessionId: string
	producerId?: string
	source?: 'mcp' | 'sdk'
	clock?: () => Date
}): Recorder & { readonly events: readonly TraceEvent[] } {
	const clock = opts.clock ?? (() => new Date())
	const newId = uuidv7Generator(clock)
	const producerId = opts.producerId ?? `memory-${newId()}`
	const source = opts.source ?? 'sdk'
	const events: TraceEvent[] = []
	let seq = 0
	const now = () => clock().toISOString()
	return {
		events,
		newId,
		now,
		emit(draft: EventDraft) {
			// The spread keeps the draft's own discriminant, so the union stays sound.
			events.push({
				...draft,
				schemaVersion: 1,
				id: newId(),
				sessionId: opts.sessionId,
				occurredAt: now(),
				source,
				producer: { id: producerId, seq: seq++ },
			} as TraceEvent)
		},
		flush: async () => {},
	}
}
