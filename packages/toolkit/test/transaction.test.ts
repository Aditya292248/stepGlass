import { describe, expect, it } from 'vitest'
import { MemoryStore, relayOutbox, ToolOutputError } from '../src/index.js'
import {
	as,
	createWidget,
	parsed,
	recorder,
	seed,
	setWidgetColor,
	types,
} from './fixtures/widget.js'

describe('in-transaction evidence', () => {
	it('records before and after snapshots between started and finished', async () => {
		const store = seed()
		const rec = recorder()
		const out = await setWidgetColor(store).call({ id: 'W-1', color: 'blue' }, { recorder: rec })
		expect(out).toEqual({ id: 'W-1', color: 'blue' })

		const events = parsed(rec.events)
		expect(types(events)).toEqual([
			'action.started',
			'evidence.recorded',
			'evidence.recorded',
			'action.finished',
		])
		expect(events.map((e) => e.producer.seq)).toEqual([0, 1, 2, 3])
		const actionId = as(events[0], 'action.started').actionId
		const before = as(events[1], 'evidence.recorded').snapshot
		const after = as(events[2], 'evidence.recorded').snapshot
		expect(before).toMatchObject({
			actionId,
			object: { type: 'widget', id: 'W-1' },
			phase: 'before',
			state: { color: 'red', count: 3 },
			source: 'in_transaction',
			version: '1',
			computedFields: ['count'],
		})
		expect(after).toMatchObject({
			actionId,
			phase: 'after',
			state: { color: 'blue', count: 4 },
			source: 'in_transaction',
			version: '2',
		})
		expect(store.get('widget', 'W-1')?.state.color).toBe('blue')
		expect(await store.outbox.pending()).toEqual([])
	})

	it('removes sensitive state fields from snapshots', async () => {
		const rec = recorder()
		await setWidgetColor(seed()).call({ id: 'W-1', color: 'blue' }, { recorder: rec })
		for (const e of parsed(rec.events).filter((e) => e.type === 'evidence.recorded')) {
			const snap = as(e, 'evidence.recorded')
			expect(snap.snapshot.state).not.toHaveProperty('serial')
			expect(snap.capture).toEqual({
				completeness: 'redacted',
				omittedFields: [`${snap.snapshot.phase}.serial`],
			})
		}
	})

	it('records only an after snapshot when the object is named by the output', async () => {
		const rec = recorder()
		await createWidget(seed()).call({ color: 'green' }, { recorder: rec })
		const events = parsed(rec.events)
		expect(types(events)).toEqual(['action.started', 'evidence.recorded', 'action.finished'])
		expect(as(events[1], 'evidence.recorded').snapshot).toMatchObject({
			object: { id: 'W-100' },
			phase: 'after',
			state: { color: 'green', count: 0 },
		})
	})
})

describe('rollback', () => {
	it('a failure after the write rolls back the change and leaves no evidence', async () => {
		const store = seed()
		const rec = recorder()
		const call = setWidgetColor(store, { failAfterWrite: true }).call(
			{ id: 'W-1', color: 'blue' },
			{ recorder: rec },
		)
		await expect(call).rejects.toThrow('backend exploded')
		expect(types(parsed(rec.events))).toEqual(['action.started', 'action.finished'])
		expect(as(rec.events[1], 'action.finished').status).toBe('failed')
		expect(store.get('widget', 'W-1')).toMatchObject({ state: { color: 'red' }, version: '1' })
		expect(await store.outbox.pending()).toEqual([])
	})

	it('an abort rolls back and is recorded as cancelled', async () => {
		const store = seed()
		const rec = recorder()
		const controller = new AbortController()
		const call = setWidgetColor(store, { hangAfterWrite: true }).call(
			{ id: 'W-1', color: 'blue' },
			{ recorder: rec, signal: controller.signal },
		)
		// Let the run reach its write before aborting.
		await new Promise((resolve) => setTimeout(resolve, 5))
		controller.abort(new Error('stop'))
		await expect(call).rejects.toThrow('stop')
		expect(types(parsed(rec.events))).toEqual(['action.started', 'action.finished'])
		expect(as(rec.events[1], 'action.finished').status).toBe('cancelled')
		expect(store.get('widget', 'W-1')?.state.color).toBe('red')
	})

	it('an output that fails its schema rolls back the write', async () => {
		const store = seed()
		const rec = recorder()
		const call = setWidgetColor(store, { badOutput: true }).call(
			{ id: 'W-1', color: 'blue' },
			{ recorder: rec },
		)
		await expect(call).rejects.toBeInstanceOf(ToolOutputError)
		expect(store.get('widget', 'W-1')?.state.color).toBe('red')
		expect(types(rec.events)).toEqual(['action.started', 'action.finished'])
	})
})

describe('MemoryStore and the outbox', () => {
	const draft = {
		type: 'recording.gap',
		producerId: 'x',
		fromSeq: 1,
		toSeq: 1,
		reason: 'unknown',
		capture: { completeness: 'full' },
	} as const

	it('sees its own writes, commits atomically and serializes transactions', async () => {
		const store = new MemoryStore()
		const order: string[] = []
		const slow = store.transaction(async (tx) => {
			tx.put('widget', 'W-1', { color: 'red' })
			expect(tx.get('widget', 'W-1')?.state).toEqual({ color: 'red' })
			expect(store.get('widget', 'W-1')).toBeNull()
			await new Promise((resolve) => setTimeout(resolve, 5))
			order.push('slow')
		})
		const fast = store.transaction(async (tx) => {
			order.push('fast')
			expect(tx.get('widget', 'W-1')?.version).toBe('1')
			tx.delete('widget', 'W-1')
		})
		await Promise.all([slow, fast])
		expect(order).toEqual(['slow', 'fast'])
		expect(store.get('widget', 'W-1')).toBeNull()
	})

	it('relays only committed entries, once', async () => {
		const store = new MemoryStore()
		const rec = recorder()
		await store.transaction(async (tx) => {
			store.outbox.append(tx, [{ id: 'e1', actionId: 'a1', draft }])
		})
		await expect(
			store.transaction(async (tx) => {
				store.outbox.append(tx, [{ id: 'e2', actionId: 'a1', draft }])
				throw new Error('rollback')
			}),
		).rejects.toThrow('rollback')
		expect(await relayOutbox(store.outbox, rec, 'other')).toBe(0)
		expect(await relayOutbox(store.outbox, rec)).toBe(1)
		expect(await relayOutbox(store.outbox, rec)).toBe(0)
		expect(parsed(rec.events)).toHaveLength(1)
	})

	it('rejects use of a finished transaction', async () => {
		const store = new MemoryStore()
		let leaked: Parameters<Parameters<MemoryStore['transaction']>[0]>[0] | undefined
		await store.transaction(async (tx) => {
			leaked = tx
		})
		expect(() => leaked?.put('widget', 'W-1', {})).toThrow('transaction is closed')
		expect(() => leaked && store.outbox.append(leaked, [])).toThrow('open transaction')
	})
})
