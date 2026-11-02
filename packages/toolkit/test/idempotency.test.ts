import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { MemoryStore } from '../src/index.js'
import { defineTool } from '../src/index.js'
import { as, parsed, recorder, seed, setWidgetColorDescriptor, types } from './fixtures/widget.js'

/** set_widget_color with an idempotency key; counts how often `run` really executes. */
function idempotentSetColor(
	store: MemoryStore,
	opts: { failFirst?: boolean; delayMs?: number } = {},
) {
	let runs = 0
	const tool = defineTool({
		name: 'set_widget_color',
		description: 'Set the color of a widget.',
		input: z.object({ id: z.string(), color: z.string(), requestId: z.string().optional() }),
		descriptor: setWidgetColorDescriptor,
		transaction: { store, read: (tx, id) => tx.get('widget', id) },
		idempotencyKey: (input) => input.requestId,
		async run({ id, color }, { tx }) {
			runs += 1
			if (opts.delayMs) await new Promise((resolve) => setTimeout(resolve, opts.delayMs))
			if (opts.failFirst && runs === 1) throw new Error('flaky')
			const current = tx.get('widget', id)
			tx.put('widget', id, { ...current?.state, color })
			return { id, color, run: runs }
		},
	})
	return { tool, runs: () => runs }
}

describe('idempotent replay', () => {
	it('answers a retry with the first result and records it as a replay', async () => {
		const store = seed()
		const { tool, runs } = idempotentSetColor(store)
		const rec = recorder()
		const call = { id: 'W-1', color: 'blue', requestId: 'r-1' }
		const first = await tool.call(call, { recorder: rec })
		const retry = await tool.call(call, { recorder: rec })

		expect(retry).toEqual(first)
		expect(runs()).toBe(1)
		expect(store.get('widget', 'W-1')?.version).toBe('2')
		const events = parsed(rec.events)
		expect(types(events)).toEqual([
			'action.started',
			'evidence.recorded',
			'evidence.recorded',
			'action.finished',
			'action.started',
			'action.finished',
		])
		const original = as(events[0], 'action.started')
		const replay = as(events[4], 'action.started')
		expect(original.replayOf).toBeUndefined()
		expect(replay.replayOf).toBe(original.actionId)
		expect(replay.actionId).not.toBe(original.actionId)
		expect(as(events[5], 'action.finished')).toMatchObject({
			actionId: replay.actionId,
			status: 'succeeded',
			output: first,
		})
	})

	it('runs again for another key, without a key, or in another session', async () => {
		const { tool, runs } = idempotentSetColor(seed())
		const rec = recorder()
		await tool.call({ id: 'W-1', color: 'blue', requestId: 'r-1' }, { recorder: rec })
		await tool.call({ id: 'W-1', color: 'blue', requestId: 'r-2' }, { recorder: rec })
		await tool.call({ id: 'W-1', color: 'blue' }, { recorder: rec })
		await tool.call({ id: 'W-1', color: 'blue' }, { recorder: rec })
		await tool.call({ id: 'W-1', color: 'blue', requestId: 'r-1' }, { recorder: recorder() })
		expect(runs()).toBe(5)
		expect(parsed(rec.events).filter((e) => e.type === 'action.started' && e.replayOf)).toEqual([])
	})

	it('runs a retry again when the first call failed', async () => {
		const store = seed()
		const { tool, runs } = idempotentSetColor(store, { failFirst: true })
		const rec = recorder()
		const call = { id: 'W-1', color: 'blue', requestId: 'r-1' }
		await expect(tool.call(call, { recorder: rec })).rejects.toThrow('flaky')
		await tool.call(call, { recorder: rec })
		await tool.call(call, { recorder: rec })
		expect(runs()).toBe(2)
		expect(store.get('widget', 'W-1')?.state.color).toBe('blue')
		const replays = parsed(rec.events).filter((e) => e.type === 'action.started' && e.replayOf)
		expect(replays).toHaveLength(1)
	})

	it('makes a concurrent retry wait for the first call instead of writing twice', async () => {
		const store = seed()
		const { tool, runs } = idempotentSetColor(store, { delayMs: 5 })
		const rec = recorder()
		const call = { id: 'W-1', color: 'blue', requestId: 'r-1' }
		const [a, b] = await Promise.all([
			tool.call(call, { recorder: rec }),
			tool.call(call, { recorder: rec }),
		])
		expect(a).toEqual(b)
		expect(runs()).toBe(1)
		expect(store.get('widget', 'W-1')?.version).toBe('2')
	})
})
