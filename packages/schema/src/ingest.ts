import { z } from 'zod'
import { Uuidv7Schema } from './common.js'
import { TraceEventSchema } from './event.js'

/** Upper bound on one batch, so a single request has bounded memory and transaction size. */
export const MAX_EVENTS_PER_BATCH = 500

/** What a producer POSTs. Batching amortizes round trips; the cap keeps one request cheap. */
export const EventBatchRequestSchema = z.strictObject({
	events: z.array(TraceEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
})
/** See {@link EventBatchRequestSchema}. */
export type EventBatchRequest = z.infer<typeof EventBatchRequestSchema>

/**
 * The server's answer to a batch. It is sent only after every accepted event is durably stored,
 * so a producer may drop anything listed in `accepted` or `duplicates` from its buffer.
 * `conflict` means an event ID arrived again with a different payload: the stored one wins.
 */
export const EventBatchAckSchema = z.strictObject({
	accepted: z.array(Uuidv7Schema),
	duplicates: z.array(Uuidv7Schema),
	rejected: z.array(
		z.strictObject({
			/** Not a UUID schema: the ID of an invalid event may itself be the invalid part. */
			id: z.string(),
			code: z.enum(['invalid', 'conflict', 'unknown_session']),
			message: z.string(),
		}),
	),
})
/** See {@link EventBatchAckSchema}. */
export type EventBatchAck = z.infer<typeof EventBatchAckSchema>
