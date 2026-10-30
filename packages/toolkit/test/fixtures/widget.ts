// A neutral domain for tests: widgets with a color, a count and an access code.
import { type ToolDescriptor, type TraceEvent, TraceEventSchema } from '@stepglass/schema'
import { expect } from 'vitest'
import { z } from 'zod'
import { createMemoryRecorder, defineTool } from '../../src/index.js'

export const SESSION_ID = '0192f0a0-0000-7000-8000-000000000001'

/** A recorder on a fixed clock that ticks one second per reading, so timestamps are distinct. */
export function recorder() {
	let t = Date.parse('2026-10-29T12:00:00Z')
	const clock = () => {
		t += 1000
		return new Date(t)
	}
	return createMemoryRecorder({ sessionId: SESSION_ID, producerId: 'test', clock })
}

/** Every recorded event must satisfy the shared contract; returns them for further asserts. */
export function parsed(events: readonly TraceEvent[]): TraceEvent[] {
	return events.map((e) => TraceEventSchema.parse(e))
}

export const types = (events: readonly TraceEvent[]) => events.map((e) => e.type)

/** Narrows to one event type, failing the test if the event is something else. */
export function as<T extends TraceEvent['type']>(
	e: TraceEvent | undefined,
	type: T,
): Extract<TraceEvent, { type: T }> {
	expect(e?.type).toBe(type)
	return e as Extract<TraceEvent, { type: T }>
}

export interface Widget {
	id: string
	color: string
	count: number
}

export const getWidgetDescriptor: ToolDescriptor = {
	schemaVersion: 1,
	tool: 'get_widget',
	version: 2,
	kind: 'read',
	title: 'Looked up widget {input.id|id}',
	fields: {
		'input.id': { label: 'Widget', format: 'id' },
		'input.accessCode': { label: 'Access code', format: 'text', sensitive: true },
		'output.owner.email': { label: 'Owner', format: 'email', sensitive: true },
	},
	verification: 'none',
	capture: { input: 'full', output: 'full' },
}

/** A read tool over a plain map; `fail` and `hang` simulate a broken or slow backend. */
export function getWidget(
	widgets: Map<string, Widget>,
	opts: { fail?: Error; hang?: boolean } = {},
) {
	return defineTool({
		name: 'get_widget',
		description: 'Look up a widget by ID.',
		input: z.object({ id: z.string(), accessCode: z.string().optional() }),
		descriptor: getWidgetDescriptor,
		async run({ id }, { signal }) {
			if (opts.hang) await new Promise((_, reject) => signal?.addEventListener('abort', reject))
			if (opts.fail) throw opts.fail
			const w = widgets.get(id)
			if (!w) throw Object.assign(new Error(`no widget ${id}`), { code: 'not_found' })
			return { ...w, owner: { email: 'owner@example.test', name: 'Owner' } }
		},
	})
}
