import { deriveEvidenceLabel, type TraceEvent } from '@stepglass/schema'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineTool } from '../src/index.js'
import {
	as,
	paintWidget,
	paintWidgetDescriptor,
	parsed,
	recorder,
	seed,
	setWidgetColor,
	types,
	WidgetApi,
} from './fixtures/widget.js'

/** Labels the one tool action in `events`, exactly as the API and UI would. */
function labelOf(events: readonly TraceEvent[]) {
	const finished = events.find((e) => e.type === 'action.finished')
	return deriveEvidenceLabel({
		toolKind: 'write',
		...(finished ? { finishedStatus: finished.status } : {}),
		snapshots: events.flatMap((e) => (e.type === 'evidence.recorded' ? [e.snapshot] : [])),
	})
}

const snapshots = (events: readonly TraceEvent[]) =>
	events.flatMap((e) => (e.type === 'evidence.recorded' ? [e.snapshot] : []))

const paint = async (api: WidgetApi, opts?: { reported?: boolean }) => {
	const rec = recorder()
	await paintWidget(api, opts).call({ id: 'W-1', color: 'blue' }, { recorder: rec })
	return parsed(rec.events)
}

describe('read-back verification', () => {
	it('records a read_back pair with versions when the re-read shows the change', async () => {
		const events = await paint(new WidgetApi())
		expect(types(events)).toEqual([
			'action.started',
			'evidence.recorded',
			'evidence.recorded',
			'action.finished',
		])
		const [before, after] = snapshots(events)
		expect(before).toMatchObject({ phase: 'before', source: 'read_back', version: 'v1' })
		expect(before?.state).toEqual({ color: 'red', count: 3 })
		expect(after).toMatchObject({ phase: 'after', source: 'read_back', version: 'v2' })
		expect(after?.state).toEqual({ color: 'blue', count: 3 })
		expect(after?.computedFields).toEqual(['count'])
	})

	it('retries a lagging API until the change shows', async () => {
		const api = new WidgetApi()
		api.staleReads = 2
		const events = await paint(api)
		expect(snapshots(events).map((s) => [s.phase, s.source, s.version])).toEqual([
			['before', 'read_back', 'v1'],
			['after', 'read_back', 'v2'],
		])
	})

	it('gives up after its attempts when the API lags too long', async () => {
		const api = new WidgetApi()
		api.staleReads = 3
		const events = await paint(api, { reported: false })
		expect(snapshots(events).map((s) => s.phase)).toEqual(['before'])
	})

	it('falls back to the tool_reported claim when the change never shows', async () => {
		const api = new WidgetApi()
		api.dropsWrites = true
		const events = await paint(api)
		const [before, after] = snapshots(events)
		expect(before?.source).toBe('read_back')
		expect(after).toMatchObject({
			phase: 'after',
			source: 'tool_reported',
			state: { color: 'blue' },
		})
		expect(as(events.at(-1), 'action.finished').status).toBe('succeeded')
	})

	it('leaves the pair incomplete when there is no claim to fall back to', async () => {
		const api = new WidgetApi()
		api.dropsWrites = true
		const events = await paint(api, { reported: false })
		expect(snapshots(events).map((s) => s.phase)).toEqual(['before'])
	})

	it('records no snapshots when reads fail, without failing the write', async () => {
		const api = new WidgetApi()
		api.readsFail = true
		const events = await paint(api, { reported: false })
		expect(snapshots(events)).toEqual([])
		expect(as(events.at(-1), 'action.finished').status).toBe('succeeded')
	})

	it('does not trust a re-read whose version did not move', async () => {
		/** A cache that shows `before` first, then the new color under an unchanged version. */
		const cachedTool = (before: string) => {
			let reads = 0
			return defineTool({
				name: 'paint_widget',
				description: 'Paint a widget.',
				input: z.object({ id: z.string(), color: z.string() }),
				descriptor: paintWidgetDescriptor,
				run: async ({ id, color }) => ({ id, color }),
				readBack: {
					read: async () => ({ state: { color: reads++ === 0 ? before : 'blue' }, version: 'v1' }),
					expect: (input) => ({ color: input.color }),
					attempts: 2,
					retryDelayMs: 1,
				},
			})
		}
		const phases = async (before: string) => {
			const rec = recorder()
			await cachedTool(before).call({ id: 'W-1', color: 'blue' }, { recorder: rec })
			return snapshots(parsed(rec.events)).map((s) => s.phase)
		}
		// A change was expected, so the same version means the read is stale.
		expect(await phases('red')).toEqual(['before'])
		// Already blue: no change expected, so an unchanged version is fine.
		expect(await phases('blue')).toEqual(['before', 'after'])
	})

	it('does not re-read after a failed write', async () => {
		const api = new WidgetApi()
		api.writesFail = true
		const rec = recorder()
		await expect(
			paintWidget(api).call({ id: 'W-1', color: 'blue' }, { recorder: rec }),
		).rejects.toThrow('503')
		expect(snapshots(parsed(rec.events)).map((s) => s.phase)).toEqual(['before'])
	})
})

describe('evidence labels, end to end', () => {
	it('verified_in_transaction for a committed in-transaction write', async () => {
		const rec = recorder()
		await setWidgetColor(seed()).call({ id: 'W-1', color: 'blue' }, { recorder: rec })
		expect(labelOf(parsed(rec.events))).toEqual({ label: 'verified_in_transaction', reasons: [] })
	})

	it('verified_read_back when the re-read confirms the write', async () => {
		expect(labelOf(await paint(new WidgetApi())).label).toBe('verified_read_back')
	})

	it('reported when the re-read never confirms the write', async () => {
		const api = new WidgetApi()
		api.dropsWrites = true
		expect(labelOf(await paint(api))).toEqual({
			label: 'reported',
			reasons: ['tool_reported:widget/W-1'],
		})
		expect(labelOf(await paint(api, { reported: false }))).toEqual({
			label: 'reported',
			reasons: ['missing_pair:widget/W-1'],
		})
	})

	it('unknown for a rolled-back, failed or cancelled write', async () => {
		const rolledBack = recorder()
		await expect(
			setWidgetColor(seed(), { failAfterWrite: true }).call(
				{ id: 'W-1', color: 'blue' },
				{ recorder: rolledBack },
			),
		).rejects.toThrow()
		expect(labelOf(parsed(rolledBack.events)).label).toBe('unknown')

		const api = new WidgetApi()
		api.writesFail = true
		const failed = recorder()
		await expect(
			paintWidget(api).call({ id: 'W-1', color: 'blue' }, { recorder: failed }),
		).rejects.toThrow()
		expect(labelOf(parsed(failed.events)).label).toBe('unknown')

		const cancelled = recorder()
		const controller = new AbortController()
		const call = setWidgetColor(seed(), { hangAfterWrite: true }).call(
			{ id: 'W-1', color: 'blue' },
			{ recorder: cancelled, signal: controller.signal },
		)
		controller.abort()
		await expect(call).rejects.toThrow()
		expect(labelOf(parsed(cancelled.events))).toEqual({ label: 'unknown', reasons: ['cancelled'] })
	})
})
