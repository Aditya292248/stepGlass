// A neutral domain for tests: widgets with a color, a count and an access code.
import {
	type JsonObject,
	type ToolDescriptor,
	type TraceEvent,
	TraceEventSchema,
} from '@stepglass/schema'
import { expect } from 'vitest'
import { z } from 'zod'
import { createMemoryRecorder, defineTool, MemoryStore } from '../../src/index.js'

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

export const setWidgetColorDescriptor: ToolDescriptor = {
	schemaVersion: 1,
	tool: 'set_widget_color',
	version: 1,
	kind: 'write',
	title: 'Recolored {input.id} from {before.color} to {after.color}',
	object: { type: 'widget', idPath: 'input.id', label: 'Widget {input.id}' },
	fields: {
		'before.color': { label: 'Old color', format: 'text' },
		'after.color': { label: 'New color', format: 'text' },
		'after.count': { label: 'Count', format: 'integer', computed: true },
		'before.serial': { label: 'Serial', format: 'text', sensitive: true },
		'after.serial': { label: 'Serial', format: 'text', sensitive: true },
	},
	verification: 'in_transaction',
	capture: { input: 'full', output: 'full' },
}

export const seed = () =>
	new MemoryStore({ widget: { 'W-1': { color: 'red', count: 3, serial: 'S-123' } } })

/**
 * Recolors a widget in a store the connector owns. `failAfterWrite` and `hangAfterWrite` throw
 * or block after the write, to show that a rollback leaves no change and no evidence.
 */
export function setWidgetColor(
	store: MemoryStore,
	opts: { failAfterWrite?: boolean; hangAfterWrite?: boolean; badOutput?: boolean } = {},
) {
	return defineTool({
		name: 'set_widget_color',
		description: 'Set the color of a widget.',
		input: z.object({ id: z.string(), color: z.string() }),
		output: z.object({ id: z.string(), color: z.string() }),
		descriptor: setWidgetColorDescriptor,
		transaction: { store, read: (tx, id) => tx.get('widget', id) },
		async run({ id, color }, { tx, signal }) {
			const current = tx.get('widget', id)
			if (!current) throw Object.assign(new Error(`no widget ${id}`), { code: 'not_found' })
			tx.put('widget', id, { ...current.state, color, count: Number(current.state.count) + 1 })
			if (opts.failAfterWrite) throw new Error('backend exploded')
			if (opts.hangAfterWrite) {
				await new Promise((_, reject) => signal?.addEventListener('abort', reject))
			}
			return opts.badOutput ? ({ id } as { id: string; color: string }) : { id, color }
		},
	})
}

/** Creates a widget; its ID comes from the output, so there is no before snapshot. */
export function createWidget(store: MemoryStore) {
	let next = 100
	return defineTool({
		name: 'create_widget',
		description: 'Create a widget.',
		input: z.object({ color: z.string() }),
		descriptor: {
			...setWidgetColorDescriptor,
			tool: 'create_widget',
			title: 'Created widget {output.id}',
			object: { type: 'widget', idPath: 'output.id', label: 'Widget {output.id}' },
			fields: { 'output.id': { label: 'Widget', format: 'id' } },
		},
		transaction: { store, read: (tx, id) => tx.get('widget', id) },
		async run({ color }, { tx }) {
			const id = `W-${next++}`
			tx.put('widget', id, { color, count: 0 })
			return { id }
		},
	})
}

/**
 * A stand-in for a third-party widget API the connector does not own. It can lag behind its
 * writes (the first `staleReads` reads after a write return the old state), fail reads, or
 * acknowledge writes it then drops.
 */
export class WidgetApi {
	readonly #widgets = new Map<string, { state: JsonObject; version: number }>()
	readonly #previous = new Map<string, { state: JsonObject; version: number }>()
	#lagging = 0
	staleReads = 0
	readsFail = false
	dropsWrites = false
	writesFail = false

	constructor(seedState: Record<string, JsonObject> = { 'W-1': { color: 'red', count: 3 } }) {
		for (const [id, state] of Object.entries(seedState))
			this.#widgets.set(id, { state, version: 1 })
	}

	async get(id: string) {
		if (this.readsFail) throw new Error('read timed out')
		const row = this.#lagging > 0 ? this.#previous.get(id) : this.#widgets.get(id)
		if (this.#lagging > 0) this.#lagging -= 1
		return row ? { state: structuredClone(row.state), version: `v${row.version}` } : null
	}

	async patch(id: string, fields: JsonObject) {
		if (this.writesFail) throw new Error('503 from upstream')
		const row = this.#widgets.get(id)
		if (!row) throw new Error(`no widget ${id}`)
		const next = { state: { ...row.state, ...fields }, version: row.version + 1 }
		if (!this.dropsWrites) {
			this.#previous.set(id, row)
			this.#widgets.set(id, next)
			this.#lagging = this.staleReads
		}
		return { id, ...next.state }
	}
}

export const paintWidgetDescriptor: ToolDescriptor = {
	...setWidgetColorDescriptor,
	tool: 'paint_widget',
	verification: 'read_back',
}

/** Recolors a widget through {@link WidgetApi}, verified by reading it back. */
export function paintWidget(api: WidgetApi, opts: { reported?: boolean } = {}) {
	return defineTool({
		name: 'paint_widget',
		description: 'Paint a widget through the widget API.',
		input: z.object({ id: z.string(), color: z.string() }),
		descriptor: paintWidgetDescriptor,
		// `run` comes before the hooks so TypeScript infers the output type the hooks receive.
		run: ({ id, color }) => api.patch(id, { color }) as Promise<{ id: string; color: string }>,
		readBack: {
			read: (id) => api.get(id),
			expect: (input) => ({ color: input.color }),
			reported: opts.reported === false ? undefined : (_, out) => ({ color: out.color }),
			attempts: 3,
			retryDelayMs: 1,
		},
	})
}
