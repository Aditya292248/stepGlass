import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
	EventBatchAckSchema,
	EventBatchRequestSchema,
	PublicSessionIdSchema,
	SafeIntSchema,
	SessionSchema,
	SessionTokenSchema,
	TimestampSchema,
	TraceEventSchema,
} from '../src/index.js'
import { events, id, session } from './fixtures/widget.js'

const roundTrip = (schema: z.ZodType, value: unknown) =>
	expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value)

describe('session', () => {
	it('round-trips', () => roundTrip(SessionSchema, session))

	it('rejects a session token smuggled into a session', () => {
		const token = 'sgt_AAAAAAAAAAAAAAAAAAAAAAAA'
		expect(SessionTokenSchema.safeParse(token).success).toBe(true)
		expect(SessionSchema.safeParse({ ...session, token }).success).toBe(false)
	})

	it('rejects malformed IDs and offset-less timestamps', () => {
		expect(PublicSessionIdSchema.safeParse('ses_ABC').success).toBe(false)
		expect(
			SessionSchema.safeParse({ ...session, id: '9b2c1e4a-3f5d-4c6b-8a7e-1d2f3a4b5c6d' }).success,
		).toBe(false)
		expect(TimestampSchema.safeParse('2026-10-29T12:00:00').success).toBe(false)
	})

	it('only accepts safe integers', () => {
		expect(SafeIntSchema.safeParse(1.5).success).toBe(false)
		expect(SafeIntSchema.safeParse(2 ** 53).success).toBe(false)
	})
})

describe('trace events', () => {
	it('round-trips every event type', () => {
		for (const e of events) roundTrip(TraceEventSchema, e)
	})

	it('rejects tool/model mismatch on action.started', () => {
		const started = events[1]
		expect(TraceEventSchema.safeParse({ ...started, kind: 'model' }).success).toBe(false)
		expect(
			TraceEventSchema.safeParse({ ...started, model: { provider: 'test', name: 'm1' } }).success,
		).toBe(false)
	})

	it('rejects session.finished with status running', () => {
		expect(TraceEventSchema.safeParse({ ...events.at(-1), status: 'running' }).success).toBe(false)
	})

	it('rejects unknown keys and negative producer seq', () => {
		expect(TraceEventSchema.safeParse({ ...events[0], extra: 1 }).success).toBe(false)
		const bad = { ...events[0], producer: { id: 'p1', seq: -1 } }
		expect(TraceEventSchema.safeParse(bad).success).toBe(false)
	})
})

describe('ingestion', () => {
	it('accepts 1–500 events', () => {
		expect(EventBatchRequestSchema.safeParse({ events }).success).toBe(true)
		expect(EventBatchRequestSchema.safeParse({ events: [] }).success).toBe(false)
		const tooMany = Array.from({ length: 501 }, () => events[0])
		expect(EventBatchRequestSchema.safeParse({ events: tooMany }).success).toBe(false)
	})

	it('round-trips an ack', () =>
		roundTrip(EventBatchAckSchema, {
			accepted: [id(100)],
			duplicates: [id(101)],
			rejected: [{ id: 'nope', code: 'invalid', message: 'bad id' }],
		}))
})
