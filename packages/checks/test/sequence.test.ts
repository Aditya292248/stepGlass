import { type CheckDefinition, CheckResultSchema, type Expr } from '@stepglass/schema'
import { describe, expect, it } from 'vitest'
import { indexTrace, inspectCheck } from '../src/index.js'
import { recorder } from './fixtures/widget.js'

const tool = (name: string): Expr => ({ op: 'events', where: { type: 'tool', tool: name } })
const check = (assert: Expr): CheckDefinition => ({
	schemaVersion: 1,
	id: 'widget-sequence',
	version: 1,
	title: 'Followed the widget procedure',
	severity: 'error',
	assert,
})
const readFirst = check({
	op: 'required_before',
	first: tool('widget_get'),
	second: tool('widget_update'),
})
const noUpdateAfterLock = (unless?: Expr) =>
	check({
		op: 'forbidden_after_unless',
		trigger: tool('widget_lock'),
		forbidden: tool('widget_update'),
		...(unless ? { unless } : {}),
	})
const approved = tool('widget_approve')

const inspect = (def: CheckDefinition, events: Parameters<typeof indexTrace>[0]) => {
	const out = inspectCheck(def, indexTrace(events))
	expect(CheckResultSchema.safeParse(out.result).success).toBe(true)
	return { ...out, codes: out.result.reasons.map((r) => r.code) }
}

describe('required_before', () => {
	it('passes when the first action succeeded before, citing both', () => {
		const r = recorder().start()
		const get = r.tool('widget_get')
		const update = r.tool('widget_update')
		r.finish()
		const { result, expected } = inspect(readFirst, r.events)
		expect(result.outcome).toBe('pass')
		// The witness pair, plus the gated list and session bounds behind "every update".
		expect(result.reasons[0]?.eventIds).toEqual(
			expect.arrayContaining([get.startedId, get.finishedId, update.startedId, r.events[0]?.id]),
		)
		expect(expected).toEqual([])
	})

	it('a missing first step fails and exposes the expected-not-recorded row', () => {
		const r = recorder().start()
		const update = r.tool('widget_update')
		r.finish()
		const { result, expected, codes } = inspect(readFirst, r.events)
		expect(result.outcome).toBe('fail')
		expect(codes).toEqual(['expected_not_recorded'])
		expect(result.reasons[0]?.message).toBe(
			'Expected widget_get before widget_update; not recorded.',
		)
		expect(expected).toEqual([
			{
				tool: 'widget_get',
				before: { actionId: update.actionId, tool: 'widget_update', eventId: update.startedId },
			},
		])
	})

	it('a missing first step is unknown, still with the row, when events were lost', () => {
		const r = recorder().start()
		r.gap()
		r.tool('widget_update')
		r.finish()
		const { result, expected, codes } = inspect(readFirst, r.events)
		expect(result.outcome).toBe('unknown')
		expect(codes).toEqual(['expected_not_recorded'])
		expect(expected).toHaveLength(1)
	})

	it('out of order fails', () => {
		const r = recorder().start()
		r.tool('widget_update')
		r.tool('widget_get')
		r.finish()
		const { result, codes } = inspect(readFirst, r.events)
		expect(result.outcome).toBe('fail')
		expect(codes).toEqual(['out_of_order'])
	})

	it('a first step that failed does not count', () => {
		const r = recorder().start()
		r.tool('widget_get', { status: 'failed' })
		r.tool('widget_update')
		r.finish()
		const { result, codes } = inspect(readFirst, r.events)
		expect(result.outcome).toBe('fail')
		expect(codes).toEqual(['not_successful'])
	})

	it('a first step that never finished is unknown', () => {
		const r = recorder().start()
		r.tool('widget_get', { status: null })
		r.tool('widget_update')
		r.finish()
		expect(inspect(readFirst, r.events).result.outcome).toBe('unknown')
	})

	it('each gated action needs its own predecessor', () => {
		const r = recorder().start()
		r.tool('widget_get')
		r.tool('widget_update')
		r.tool('widget_update')
		r.finish()
		// One read before both updates satisfies "a read happened before each update".
		expect(inspect(readFirst, r.events).result.outcome).toBe('pass')
		const late = recorder().start()
		late.tool('widget_update')
		late.tool('widget_get')
		late.tool('widget_update')
		late.finish()
		const { result, codes } = inspect(readFirst, late.events)
		expect(result.outcome).toBe('fail')
		expect(codes).toEqual(['out_of_order'])
	})

	it('no gated action passes only over a complete recording', () => {
		const r = recorder().start()
		r.tool('widget_get')
		r.finish()
		const { result } = inspect(readFirst, r.events)
		expect(result.outcome).toBe('pass')
		expect(result.reasons[0]?.eventIds).toEqual([r.events[0]?.id, r.events.at(-1)?.id])
		const open = recorder().start()
		open.tool('widget_get')
		expect(inspect(readFirst, open.events).result.outcome).toBe('unknown')
	})

	it('cross-producer events with equal timestamps cannot be ordered', () => {
		const r = recorder().start()
		r.tool('widget_get', { producer: 'p2' })
		r.tool('widget_update')
		r.finish()
		const events = r.events.map((e, i, all) =>
			e.type === 'action.started' && e.producer.id === 'p1'
				? { ...e, occurredAt: all[i - 1]?.occurredAt ?? e.occurredAt }
				: e,
		)
		const { result, codes } = inspect(readFirst, events)
		expect(result.outcome).toBe('unknown')
		expect(codes).toEqual(['order_unknown'])
	})
})

describe('forbidden_after_unless', () => {
	it('passes when the forbidden action came before the trigger', () => {
		const r = recorder().start()
		r.tool('widget_update')
		r.tool('widget_lock')
		r.finish()
		expect(inspect(noUpdateAfterLock(approved), r.events).result.outcome).toBe('pass')
	})

	it('fails when the forbidden action follows the trigger with no excuse', () => {
		const r = recorder().start()
		const lock = r.tool('widget_lock')
		const update = r.tool('widget_update')
		r.finish()
		const { result, codes } = inspect(noUpdateAfterLock(approved), r.events)
		expect(result.outcome).toBe('fail')
		expect(codes).toEqual(['forbidden_after'])
		expect(result.reasons[0]?.message).toBe(
			'widget_update followed widget_lock without widget_approve in between.',
		)
		expect(result.reasons[0]?.eventIds).toEqual([lock.startedId, lock.finishedId, update.startedId])
	})

	it('passes when the unless action succeeded in between, citing it', () => {
		const r = recorder().start()
		r.tool('widget_lock')
		const ok = r.tool('widget_approve')
		r.tool('widget_update')
		r.finish()
		const { result } = inspect(noUpdateAfterLock(approved), r.events)
		expect(result.outcome).toBe('pass')
		expect(result.reasons[0]?.eventIds).toContain(ok.finishedId)
	})

	it('an unless action that failed, or came too early or too late, does not excuse', () => {
		const failed = recorder().start()
		failed.tool('widget_lock')
		failed.tool('widget_approve', { status: 'failed' })
		failed.tool('widget_update')
		failed.finish()
		expect(inspect(noUpdateAfterLock(approved), failed.events).result.outcome).toBe('fail')

		const early = recorder().start()
		early.tool('widget_approve')
		early.tool('widget_lock')
		early.tool('widget_update')
		early.tool('widget_approve')
		early.finish()
		expect(inspect(noUpdateAfterLock(approved), early.events).result.outcome).toBe('fail')
	})

	it('an unless action that never finished leaves it unknown', () => {
		const r = recorder().start()
		r.tool('widget_lock')
		r.tool('widget_approve', { status: null })
		r.tool('widget_update')
		r.finish()
		const { result, codes } = inspect(noUpdateAfterLock(approved), r.events)
		expect(result.outcome).toBe('unknown')
		expect(codes).toEqual(['order_unknown'])
	})

	it('without unless, any following forbidden action fails', () => {
		const r = recorder().start()
		r.tool('widget_lock')
		r.tool('widget_approve')
		r.tool('widget_update')
		r.finish()
		expect(inspect(noUpdateAfterLock(), r.events).result.outcome).toBe('fail')
	})

	it('no trigger passes on a complete recording and is unknown over a gap', () => {
		const r = recorder().start()
		r.tool('widget_update')
		r.finish()
		expect(inspect(noUpdateAfterLock(approved), r.events).result.outcome).toBe('pass')
		const lossy = recorder().start()
		lossy.tool('widget_update')
		lossy.gap()
		lossy.finish()
		const { result, codes } = inspect(noUpdateAfterLock(approved), lossy.events)
		expect(result.outcome).toBe('unknown')
		expect(codes).toEqual(['incomplete_list'])
	})

	it('a violation over a gap is unknown, since the excuse may be in the lost range', () => {
		const r = recorder().start()
		r.tool('widget_lock')
		r.gap()
		r.tool('widget_update')
		r.finish()
		expect(inspect(noUpdateAfterLock(approved), r.events).result.outcome).toBe('unknown')
		expect(inspect(noUpdateAfterLock(), r.events).result.outcome).toBe('fail')
	})
})

describe('sequence rules over non-action values', () => {
	it('are type errors, not decisions', () => {
		const r = recorder().start()
		r.tool('widget_get')
		r.finish()
		const bad = check({
			op: 'required_before',
			first: { op: 'lit', value: [1] },
			second: tool('widget_get'),
		})
		const { result, codes } = inspect(bad, r.events)
		expect(result.outcome).toBe('unknown')
		expect(codes).toEqual(['type_mismatch'])
	})
})
