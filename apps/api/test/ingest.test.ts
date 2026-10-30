import { EventBatchAckSchema, MAX_EVENTS_PER_BATCH } from '@stepglass/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actionStarted, createHarness, type Harness, uuidv7 } from './fixtures.js'

let h: Harness

beforeAll(async () => {
	h = await createHarness({ ingestBodyLimit: 64 * 1024 })
})
afterAll(() => h.close())

function post(token: string | undefined, body: unknown) {
	return h.app.inject({
		method: 'POST',
		url: '/v1/sessions/events',
		headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
		payload: body as object,
	})
}

async function ingest(token: string, events: unknown[]) {
	const res = await post(token, { events })
	expect(res.statusCode, res.body).toBe(200)
	return EventBatchAckSchema.parse(res.json())
}

async function storedSeqs(sessionId: string): Promise<{ event_id: string; seq: number }[]> {
	const { rows } = await h.t.pool.query<{ event_id: string; seq: string }>(
		'SELECT event_id, seq FROM events WHERE session_id = $1 ORDER BY seq',
		[sessionId],
	)
	return rows.map((r) => ({ event_id: r.event_id, seq: Number(r.seq) }))
}

async function nextSeq(sessionId: string): Promise<number> {
	const { rows } = await h.t.pool.query('SELECT next_seq FROM sessions WHERE id = $1', [sessionId])
	return Number(rows[0].next_seq)
}

describe('authentication', () => {
	it('rejects a missing token with a bearer challenge', async () => {
		const res = await post(undefined, { events: [{}] })
		expect(res.statusCode).toBe(401)
		expect(res.headers['content-type']).toMatch(/^application\/problem\+json/)
		expect(res.headers['www-authenticate']).toMatch(/^Bearer /)
		expect(res.json()).toMatchObject({ status: 401, code: 'invalid_token' })
	})

	it('rejects a malformed and an unknown token', async () => {
		expect((await post('not-a-token', { events: [{}] })).statusCode).toBe(401)
		const unknown = `sgt_${'A'.repeat(43)}`
		expect((await post(unknown, { events: [{}] })).statusCode).toBe(401)
	})

	it('authenticates before reading the body', async () => {
		const res = await post(undefined, { nonsense: true })
		expect(res.statusCode).toBe(401)
	})
})

describe('sequence allocation', () => {
	it('assigns dense seqs from 1 in batch order and acks every new event', async () => {
		const s = await h.newSession()
		const events = [0, 1, 2].map((i) => actionStarted(s.id, i))
		const ack = await ingest(s.token, events)
		expect(ack).toEqual({
			accepted: events.map((e) => e.id),
			duplicates: [],
			rejected: [],
			gaps: [],
		})
		expect(await storedSeqs(s.id)).toEqual(events.map((e, i) => ({ event_id: e.id, seq: i + 1 })))
		expect(await nextSeq(s.id)).toBe(4)
	})

	it('keeps original seqs on re-send and only numbers the new events', async () => {
		const s = await h.newSession()
		const first = [0, 1].map((i) => actionStarted(s.id, i))
		await ingest(s.token, first)
		const third = actionStarted(s.id, 2)
		// Same events in a different key order are still the same events.
		const reordered = Object.fromEntries(Object.entries(first[1] ?? {}).reverse())
		const ack = await ingest(s.token, [third, reordered, first[0]])
		expect(ack.accepted).toEqual([third.id])
		expect(ack.duplicates.sort()).toEqual([first[0]?.id, first[1]?.id].sort())
		expect(await storedSeqs(s.id)).toEqual([
			{ event_id: first[0]?.id, seq: 1 },
			{ event_id: first[1]?.id, seq: 2 },
			{ event_id: third.id, seq: 3 },
		])
		expect(await nextSeq(s.id)).toBe(4)
	})

	it('gives concurrent batches to one session contiguous unique seqs', async () => {
		const s = await h.newSession()
		const batches = Array.from({ length: 8 }, (_, b) =>
			Array.from({ length: 25 }, (_, i) =>
				actionStarted(s.id, b * 25 + i, { producer: { id: `p${b}`, seq: i } }),
			),
		)
		const acks = await Promise.all(batches.map((batch) => ingest(s.token, batch)))
		expect(acks.flatMap((a) => a.accepted)).toHaveLength(200)
		const seqs = (await storedSeqs(s.id)).map((r) => r.seq)
		expect(seqs).toEqual(Array.from({ length: 200 }, (_, i) => i + 1))
		// Each batch holds one contiguous range, because the lock serializes whole batches.
		for (const batch of batches) {
			const ids = new Set(batch.map((e) => e.id))
			const mine = (await storedSeqs(s.id)).filter((r) => ids.has(r.event_id)).map((r) => r.seq)
			expect((mine.at(-1) ?? 0) - (mine[0] ?? 0)).toBe(24)
		}
	})

	it('acks only after commit: a failing insert rolls back the reserved seqs', async () => {
		const s = await h.newSession()
		// A real trigger makes the insert fail inside the transaction, after next_seq was bumped.
		await h.t.pool.query(`
			CREATE FUNCTION refuse_marked() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN
				IF NEW.payload->'input'->>'refuse' = 'true' THEN RAISE EXCEPTION 'refused by test'; END IF;
				RETURN NEW;
			END $$;
			CREATE TRIGGER refuse_marked BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION refuse_marked();
		`)
		const good = actionStarted(s.id, 0)
		const bad = actionStarted(s.id, 1, { input: { refuse: true } })
		try {
			const res = await post(s.token, { events: [good, bad] })
			expect(res.statusCode).toBe(500)
			expect(res.json()).toMatchObject({ status: 500, code: 'internal_error' })
			expect(res.body).not.toContain('refused by test')
			expect(await storedSeqs(s.id)).toEqual([])
			expect(await nextSeq(s.id)).toBe(1)
		} finally {
			await h.t.pool.query('DROP TRIGGER refuse_marked ON events; DROP FUNCTION refuse_marked()')
		}
		const ack = await ingest(s.token, [good])
		expect(ack.accepted).toEqual([good.id])
		expect(await storedSeqs(s.id)).toEqual([{ event_id: good.id, seq: 1 }])
	})
})

describe('per-event outcomes', () => {
	it('rejects a re-sent ID with a different payload as a conflict and keeps the stored one', async () => {
		const s = await h.newSession()
		const original = actionStarted(s.id, 0)
		await ingest(s.token, [original])
		const changed = { ...original, input: { text: 'something else' } }
		const ack = await ingest(s.token, [changed])
		expect(ack.rejected).toEqual([expect.objectContaining({ id: original.id, code: 'conflict' })])
		const { rows } = await h.t.pool.query('SELECT payload FROM events WHERE event_id = $1', [
			original.id,
		])
		expect(rows[0].payload.input).toEqual(original.input)
	})

	it('treats a repeat inside one batch as a duplicate or a conflict', async () => {
		const s = await h.newSession()
		const e = actionStarted(s.id, 0)
		const ack = await ingest(s.token, [e, e, { ...e, input: { other: 1 } }])
		expect(ack.accepted).toEqual([e.id])
		expect(ack.duplicates).toEqual([e.id])
		expect(ack.rejected.map((r) => r.code)).toEqual(['conflict'])
		expect(await nextSeq(s.id)).toBe(2)
	})

	it('rejects invalid events individually and stores the rest', async () => {
		const s = await h.newSession()
		const good = actionStarted(s.id, 0)
		const badId = actionStarted(s.id, 1, { id: 'not-a-uuid' })
		const noId = { type: 'action.started' }
		const nul = actionStarted(s.id, 2, { input: { text: 'a\u0000b' } })
		const ack = await ingest(s.token, [good, badId, noId, nul])
		expect(ack.accepted).toEqual([good.id])
		expect(ack.rejected).toEqual([
			expect.objectContaining({ id: 'not-a-uuid', code: 'invalid' }),
			expect.objectContaining({ id: '#2', code: 'invalid' }),
			expect.objectContaining({ id: nul.id, code: 'invalid' }),
		])
	})

	it("rejects events stamped with another session's ID", async () => {
		const s = await h.newSession()
		const other = await h.newSession()
		const ack = await ingest(s.token, [actionStarted(other.id, 0)])
		expect(ack.accepted).toEqual([])
		expect(ack.rejected.map((r) => r.code)).toEqual(['unknown_session'])
		expect(await storedSeqs(other.id)).toEqual([])
	})

	it('reports holes in producer seq until a later batch fills them', async () => {
		const s = await h.newSession()
		const withProducer = (id: string, seq: number) =>
			actionStarted(s.id, seq, { producer: { id, seq } })
		const ack = await ingest(s.token, [
			withProducer('a', 1),
			withProducer('a', 4),
			withProducer('b', 0),
		])
		expect(ack.gaps).toEqual([
			{ producerId: 'a', fromSeq: 0, toSeq: 0 },
			{ producerId: 'a', fromSeq: 2, toSeq: 3 },
		])
		const filled = await ingest(
			s.token,
			[0, 2, 3].map((seq) => withProducer('a', seq)),
		)
		expect(filled.gaps).toEqual([])
	})

	it('closes the session on session.finished', async () => {
		const s = await h.newSession()
		const finishedAt = '2026-10-01T12:00:00.000Z'
		const finished = {
			...actionStarted(s.id, 0),
			type: 'session.finished',
			status: 'finished',
			occurredAt: finishedAt,
		}
		for (const key of ['actionId', 'kind', 'tool', 'input'])
			delete finished[key as keyof typeof finished]
		const ack = await ingest(s.token, [finished])
		expect(ack.accepted).toHaveLength(1)
		const { rows } = await h.t.pool.query(
			'SELECT run_status, ended_at FROM sessions WHERE id = $1',
			[s.id],
		)
		expect(rows[0].run_status).toBe('finished')
		expect((rows[0].ended_at as Date).toISOString()).toBe(finishedAt)
	})
})

describe('batch limits', () => {
	it(`rejects an empty batch and one over ${MAX_EVENTS_PER_BATCH} events`, async () => {
		const s = await h.newSession()
		const empty = await post(s.token, { events: [] })
		expect(empty.statusCode).toBe(400)
		expect(empty.json()).toMatchObject({ code: 'validation_failed' })
		const tooMany = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => ({ id: uuidv7() }))
		const big = await h.app.inject({
			method: 'POST',
			url: '/v1/sessions/events',
			headers: { authorization: `Bearer ${s.token}` },
			payload: { events: tooMany },
		})
		// ~25 KiB, under the body limit, so this is the count check speaking.
		expect(big.statusCode).toBe(400)
		expect(big.json()).toMatchObject({ code: 'validation_failed' })
		expect(big.json().errors[0].path).toMatch(/^body\/events/)
	})

	it('rejects a body over the size limit with 413', async () => {
		const s = await h.newSession()
		const huge = actionStarted(s.id, 0, { input: { blob: 'x'.repeat(70 * 1024) } })
		const res = await post(s.token, { events: [huge] })
		expect(res.statusCode).toBe(413)
		expect(res.json()).toMatchObject({ status: 413, code: 'body_too_large' })
		expect(await storedSeqs(s.id)).toEqual([])
	})
})
