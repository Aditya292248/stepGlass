import {
	type CheckDefinition,
	CheckResultSchema,
	type Expr,
	type JsonValue,
	Uuidv7Schema,
} from '@stepglass/schema'
import { describe, expect, it } from 'vitest'
import {
	deterministicUuidv7,
	evaluate,
	evaluateCheck,
	happensBefore,
	indexTrace,
	sessionVars,
	UNKNOWN,
} from '../src/index.js'
import { id, recolorSession, recorder, SESSION_ID } from './fixtures/widget.js'

const lit = (value: JsonValue): Expr => ({ op: 'lit', value })
const after: Expr = {
	op: 'snapshot',
	object: { type: 'widget', id: lit('W-1') },
	phase: 'after',
}
const afterColor: Expr = { op: 'get', of: after, path: ['color'] }
const check = (assert: Expr): CheckDefinition => ({
	schemaVersion: 1,
	id: 'widget-color',
	version: 1,
	title: 'Left widget W-1 blue',
	severity: 'error',
	assert,
})
const isBlue = check({ op: 'eq', left: afterColor, right: lit('blue') })
const valueIn = (events: Parameters<typeof indexTrace>[0], e: Expr) => {
	const trace = indexTrace(events)
	return evaluate(e, { vars: sessionVars(trace), trace })
}

describe('indexTrace', () => {
	it('orders by seq, not arrival, and drops duplicate event IDs', () => {
		const s = recolorSession()
		const shuffled = [...s.events].reverse()
		const first = s.events[0]
		if (!first) throw new Error('empty fixture')
		const trace = indexTrace([...shuffled, first])
		expect(trace.events.map((e) => e.id)).toEqual(s.events.map((e) => e.id))
		expect(trace.actions).toHaveLength(2)
		expect(trace.incomplete).toEqual([])
		expect(trace.throughSeq).toBe(s.events.length - 1)
	})

	it('rejects an empty or mixed-session input', () => {
		expect(() => indexTrace([])).toThrow()
		const [a, ...rest] = recolorSession().events
		if (!a) throw new Error('empty fixture')
		expect(() => indexTrace([{ ...a, sessionId: id(999) }, ...rest])).toThrow(/another session/)
	})

	it('lists every reason the recording may be incomplete', () => {
		const r = recorder()
		r.tool('widget_get')
		r.gap()
		const orphan = r.tool('widget_update')
		r.events.splice(
			r.events.findIndex((e) => e.id === orphan.startedId),
			1,
		)
		expect(indexTrace(r.events).incomplete).toEqual([
			'events 90-95 from p1 were lost (disconnect)',
			'the session has not finished',
			'the session start was not recorded',
			`action ${orphan.actionId} has no recorded start`,
		])
	})

	it('happens-before uses seq within a producer and is unknown on cross-producer ties', () => {
		const r = recorder()
		r.tool('widget_get')
		r.tool('widget_get', { producer: 'p2' })
		const [a, b, c] = r.events
		if (!a || !b || !c) throw new Error('fixture too short')
		expect(happensBefore(a, b)).toBe(true)
		expect(happensBefore(b, a)).toBe(false)
		expect(happensBefore(a, c)).toBe(true)
		expect(happensBefore(a, { ...c, occurredAt: a.occurredAt })).toBe(UNKNOWN)
	})
})

describe('events selector', () => {
	it('filters by kind, tool, status and input', () => {
		const r = recorder().start()
		r.tool('widget_get', { input: { id: 'W-1' } })
		r.tool('widget_get', { input: { id: 'W-2' }, status: 'failed' })
		r.model()
		r.finish()
		const n = (where: (Expr & { op: 'events' })['where']) =>
			valueIn(r.events, { op: 'count', of: { op: 'events', where } }).value
		expect(n({})).toBe(3)
		expect(n({ type: 'tool' })).toBe(2)
		expect(n({ type: 'model' })).toBe(1)
		expect(n({ tool: 'widget_get', status: 'failed' })).toBe(1)
		const w2: Expr = {
			op: 'eq',
			left: { op: 'get', of: { op: 'var', name: 'input' }, path: ['id'] },
			right: lit('W-2'),
		}
		expect(n({ tool: 'widget_get', inputMatches: w2 })).toBe(1)
		// The model action has no input, so whether it matches is unknown and the count is too.
		expect(n({ inputMatches: w2 })).toBe(UNKNOWN)
	})

	it('an unfinished action makes a status-filtered list partial, so absence is unknown', () => {
		const r = recorder().start()
		r.tool('widget_update', { status: null })
		r.finish()
		const failed: Expr = { op: 'events', where: { status: 'failed' } }
		const none = valueIn(r.events, { op: 'eq', left: { op: 'count', of: failed }, right: lit(0) })
		expect(none.value).toBe(UNKNOWN)
		expect(none.reasons.map((x) => x.code)).toEqual(['incomplete_list'])
	})

	it('a payload that was not captured is unknown, not empty', () => {
		const r = recorder().start()
		r.tool('widget_get', { input: { id: 'W-1', note: 'x' } })
		r.finish()
		const [, started] = r.events
		if (started?.type !== 'action.started') throw new Error('fixture changed')
		const color = (capture: typeof started.capture) => {
			const events = r.events.map((e) => (e.id === started.id ? { ...started, capture } : e))
			const first: Expr = { op: 'events', where: { tool: 'widget_get' } }
			const input: Expr = { op: 'get', of: first, path: ['0', 'input', 'note'] }
			return valueIn(events, input).value
		}
		expect(color({ completeness: 'full' })).toBe('x')
		expect(color({ completeness: 'metadata_only' })).toBe(UNKNOWN)
		expect(color({ completeness: 'partial', omittedFields: ['input.note'] })).toBe(UNKNOWN)
	})
})

describe('evaluateCheck', () => {
	it('passes on verified evidence and cites the snapshot event', () => {
		const s = recolorSession()
		const result = evaluateCheck(isBlue, indexTrace(s.events))
		expect(result.outcome).toBe('pass')
		expect(result.reasons).toEqual([
			{ code: 'satisfied', message: 'Left widget W-1 blue', eventIds: [s.after] },
		])
		expect(result.sessionId).toBe(SESSION_ID)
		expect(CheckResultSchema.safeParse(result).success).toBe(true)
	})

	it('fails with the evidence that decided it', () => {
		const s = recolorSession()
		const red = check({ op: 'eq', left: afterColor, right: lit('red') })
		const result = evaluateCheck(red, indexTrace(s.events))
		expect(result.outcome).toBe('fail')
		expect(result.reasons[0]?.eventIds).toEqual([s.after])
	})

	it('a missing snapshot is unknown, not a fail', () => {
		const r = recorder().start()
		r.tool('widget_update', { input: { id: 'W-1', color: 'blue' } })
		r.finish()
		const result = evaluateCheck(isBlue, indexTrace(r.events))
		expect(result.outcome).toBe('unknown')
		expect(result.reasons.map((x) => x.code)).toEqual(['missing_snapshot'])
	})

	it('tool-reported state cannot pass, but can still fail', () => {
		const r = recorder().start()
		const u = r.tool('widget_update')
		const source = { source: 'tool_reported' } as const
		r.snapshot(u.actionId, 'before', { color: 'red' }, source)
		r.snapshot(u.actionId, 'after', { color: 'blue' }, { ...source, id: id(900) })
		r.finish()
		const trace = indexTrace(r.events)
		const pass = evaluateCheck(isBlue, trace)
		expect(pass.outcome).toBe('unknown')
		expect(pass.reasons.map((x) => x.code)).toEqual(['unverified_evidence'])
		expect(pass.reasons[0]?.message).toContain('reported')
		const red = check({ op: 'eq', left: afterColor, right: lit('red') })
		expect(evaluateCheck(red, trace).outcome).toBe('fail')
	})

	it('an after snapshot without its before pair is unverified', () => {
		const r = recorder().start()
		const u = r.tool('widget_update')
		r.snapshot(u.actionId, 'after', { color: 'blue' })
		r.finish()
		const result = evaluateCheck(isBlue, indexTrace(r.events))
		expect(result.outcome).toBe('unknown')
		expect(result.reasons[0]?.message).toContain('missing_pair:widget/W-1')
	})

	it('a true assertion that cites nothing is unknown, not a pass', () => {
		const result = evaluateCheck(check(lit(true)), indexTrace(recolorSession().events))
		expect(result.outcome).toBe('unknown')
		expect(result.reasons.map((x) => x.code)).toEqual(['no_evidence'])
	})

	it('a non-boolean assertion is unknown', () => {
		const result = evaluateCheck(check(afterColor), indexTrace(recolorSession().events))
		expect(result.outcome).toBe('unknown')
		expect(result.reasons.map((x) => x.code)).toEqual(['type_mismatch'])
	})

	it('reads session variables', () => {
		const agent: Expr = { op: 'eq', left: { op: 'var', name: 'agent' }, right: lit('widget-agent') }
		const s = recolorSession()
		const result = evaluateCheck(check(agent), indexTrace(s.events))
		expect(result.outcome).toBe('pass')
		expect(result.reasons[0]?.eventIds).toEqual([s.events[0]?.id])
	})

	it('is deterministic, stamped from the events, and never reads the clock', () => {
		const s = recolorSession()
		const a = evaluateCheck(isBlue, indexTrace(s.events))
		const b = evaluateCheck(isBlue, indexTrace([...s.events].reverse()))
		expect(a).toEqual(b)
		const last = s.events.at(-1)
		expect(a.evaluatedAt).toBe(last?.occurredAt)
		expect(a.evaluatedThroughSeq).toBe(last?.producer.seq)
	})

	it('rejects an invalid definition', () => {
		const bad = { ...isBlue, assert: { op: 'eval', src: '1' } } as unknown as CheckDefinition
		expect(() => evaluateCheck(bad, indexTrace(recolorSession().events))).toThrow()
	})
})

describe('deterministicUuidv7', () => {
	it('is a valid UUIDv7 that sorts by time and varies by key', () => {
		const a = deterministicUuidv7(1_000, 'k')
		expect(Uuidv7Schema.safeParse(a).success).toBe(true)
		expect(deterministicUuidv7(1_000, 'k')).toBe(a)
		expect(deterministicUuidv7(1_000, 'j')).not.toBe(a)
		expect(deterministicUuidv7(2_000, 'k') > a).toBe(true)
		expect(() => deterministicUuidv7(-1, 'k')).toThrow()
	})
})
