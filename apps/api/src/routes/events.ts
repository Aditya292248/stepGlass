import { EventBatchAckSchema, MAX_EVENTS_PER_BATCH } from '@stepglass/schema'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { type AuthenticatedSession, authenticate } from '../auth.js'
import type { Db } from '../db/client.js'
import { ingestBatch } from '../ingest.js'
import { ProblemSchema, sendUnauthorized } from '../problem.js'

/**
 * Only the envelope is validated up front; each event is checked on its own so the ack can
 * reject single events (`rejected[].code = invalid`) instead of failing the whole batch.
 */
const BatchEnvelopeSchema = z.strictObject({
	events: z
		.array(z.unknown().meta({ description: 'A TraceEvent; validated individually.' }))
		.min(1)
		.max(MAX_EVENTS_PER_BATCH),
})

declare module 'fastify' {
	interface FastifyRequest {
		session: AuthenticatedSession | null
	}
}

export interface EventRoutesOptions {
	db: Db
	bodyLimit: number
}

export const eventRoutes: FastifyPluginAsyncZod<EventRoutesOptions> = async (
	app,
	{ db, bodyLimit },
) => {
	app.decorateRequest('session', null)

	app.post(
		'/v1/sessions/events',
		{
			bodyLimit,
			// Authenticate before the body is read, so unauthenticated clients can't make us parse megabytes.
			onRequest: async (request, reply) => {
				request.session = await authenticate(db, request.headers.authorization)
				if (!request.session) return sendUnauthorized(reply)
			},
			schema: {
				summary: 'Append a batch of events to the session the bearer token belongs to',
				tags: ['ingestion'],
				security: [{ sessionToken: [] }],
				body: BatchEnvelopeSchema,
				response: {
					200: EventBatchAckSchema,
					400: ProblemSchema,
					401: ProblemSchema,
					413: ProblemSchema,
				},
			},
		},
		async (request) => {
			const session = request.session
			if (!session) throw new Error('onRequest guarantees an authenticated session')
			return ingestBatch(db, session, request.body.events)
		},
	)
}
