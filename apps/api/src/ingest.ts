import { type EventBatchAck, type TraceEvent, TraceEventSchema } from '@stepglass/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AuthenticatedSession } from './auth.js'
import { canonicalJson, containsNul } from './canonical.js'
import type { Db } from './db/client.js'
import { events, sessions } from './db/schema.js'

type Rejection = EventBatchAck['rejected'][number]
type Gap = EventBatchAck['gaps'][number]
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** The best ID to report for an event that failed validation. */
function reportedId(item: unknown, index: number): string {
	if (item !== null && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
		return item.id
	}
	return `#${index}`
}

const conflict = (id: string): Rejection => ({
	id,
	code: 'conflict',
	message: 'this event ID was already stored with a different payload; the stored one wins',
})

/**
 * Validates and stores one batch for `session`, returning the ack. Events are validated one by
 * one so a single bad event cannot hold back the rest of a producer's buffer.
 *
 * Sequence allocation: the session row is locked first, which serializes ingestion per session.
 * Under that lock the batch is split into new events and re-sends (by event ID), `next_seq` is
 * bumped by the number of new events with `UPDATE … RETURNING`, and the new events take the
 * reserved range in batch order. Seqs are therefore dense, never reused, and a later seq never
 * commits before an earlier one, which a bigserial cannot promise. Re-sends keep their original
 * seq. If anything fails, the transaction rolls back and the reserved range with it.
 */
export async function ingestBatch(
	db: Db,
	session: AuthenticatedSession,
	items: readonly unknown[],
): Promise<EventBatchAck> {
	const accepted: string[] = []
	const duplicates: string[] = []
	const rejected: Rejection[] = []
	const candidates: { event: TraceEvent; canonical: string }[] = []
	const inBatch = new Map<string, string>()

	items.forEach((item, index) => {
		const parsed = TraceEventSchema.safeParse(item)
		if (!parsed.success) {
			const message = z.prettifyError(parsed.error)
			rejected.push({ id: reportedId(item, index), code: 'invalid', message })
			return
		}
		const event = parsed.data
		if (event.sessionId !== session.id) {
			rejected.push({
				id: event.id,
				code: 'unknown_session',
				message: 'sessionId does not match the session this token belongs to',
			})
			return
		}
		if (containsNul(event)) {
			rejected.push({ id: event.id, code: 'invalid', message: 'strings must not contain U+0000' })
			return
		}
		const canonical = canonicalJson(event)
		const earlier = inBatch.get(event.id)
		if (earlier !== undefined) {
			if (earlier === canonical) duplicates.push(event.id)
			else rejected.push(conflict(event.id))
			return
		}
		inBatch.set(event.id, canonical)
		candidates.push({ event, canonical })
	})

	if (candidates.length === 0) return { accepted, duplicates, rejected, gaps: [] }

	const gaps = await db.transaction(async (tx) => {
		await tx
			.select({ id: sessions.id })
			.from(sessions)
			.where(eq(sessions.id, session.id))
			.for('update')

		const stored = await tx
			.select({ eventId: events.eventId, payload: events.payload })
			.from(events)
			.where(
				and(
					eq(events.sessionId, session.id),
					inArray(
						events.eventId,
						candidates.map((c) => c.event.id),
					),
				),
			)
		const storedById = new Map(stored.map((r) => [r.eventId, canonicalJson(r.payload)]))

		const fresh: TraceEvent[] = []
		for (const { event, canonical } of candidates) {
			const prior = storedById.get(event.id)
			if (prior === undefined) fresh.push(event)
			else if (prior === canonical) duplicates.push(event.id)
			else rejected.push(conflict(event.id))
		}

		if (fresh.length > 0) {
			const [bumped] = await tx
				.update(sessions)
				.set({ nextSeq: sql`${sessions.nextSeq} + ${fresh.length}`, updatedAt: sql`now()` })
				.where(eq(sessions.id, session.id))
				.returning({ nextSeq: sessions.nextSeq })
			if (!bumped) throw new Error(`session ${session.id} disappeared during ingestion`)
			const first = bumped.nextSeq - fresh.length

			const inserted = await tx
				.insert(events)
				.values(
					fresh.map((event, i) => ({
						sessionId: session.id,
						seq: first + i,
						eventId: event.id,
						type: event.type,
						payload: event,
						producerId: event.producer.id,
						producerSeq: event.producer.seq,
					})),
				)
				.onConflictDoNothing({ target: [events.sessionId, events.eventId] })
				.returning({ eventId: events.eventId })
			// The row lock makes a concurrent insert of the same ID impossible; if one slipped
			// through anyway, the reserved seqs would have a hole, so fail rather than ack it.
			if (inserted.length !== fresh.length) {
				throw new Error('event insert raced despite the session lock')
			}

			const finished = fresh.findLast((e) => e.type === 'session.finished')
			if (finished?.type === 'session.finished') {
				await tx
					.update(sessions)
					.set({ runStatus: finished.status, endedAt: new Date(finished.occurredAt) })
					.where(eq(sessions.id, session.id))
			}
			accepted.push(...fresh.map((e) => e.id))
		}

		const producers = [...new Set(candidates.map((c) => c.event.producer.id))]
		return findGaps(tx, session.id, producers)
	})

	return { accepted, duplicates, rejected, gaps }
}

/**
 * Open holes in each producer's seq, counting from 0, after this batch. Computed over everything
 * stored for those producers, so a hole that a later batch fills stops being reported.
 */
async function findGaps(tx: Tx, sessionId: string, producerIds: string[]): Promise<Gap[]> {
	const result = await tx.execute<{ producer_id: string; from_seq: string; to_seq: string }>(sql`
		SELECT producer_id, prev + 1 AS from_seq, producer_seq - 1 AS to_seq
		FROM (
			SELECT producer_id, producer_seq,
				lag(producer_seq, 1, -1::bigint) OVER (PARTITION BY producer_id ORDER BY producer_seq) AS prev
			FROM ${events}
			WHERE ${and(eq(events.sessionId, sessionId), inArray(events.producerId, producerIds))}
		) AS ordered
		WHERE producer_seq > prev + 1
		ORDER BY producer_id, from_seq
	`)
	return result.rows.map((r) => ({
		producerId: r.producer_id,
		fromSeq: Number(r.from_seq),
		toSeq: Number(r.to_seq),
	}))
}
