import { PublicSessionIdSchema, SessionSchema, TraceEventSchema } from '@stepglass/schema'
import { and, asc, desc, eq, gt, lt } from 'drizzle-orm'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../db/client.js'
import { events, sessions } from '../db/schema.js'
import { ProblemSchema, sendProblem } from '../problem.js'
import {
	CreatedSessionSchema,
	CreateSessionRequestSchema,
	createSession,
	toSession,
} from '../sessions.js'

const LimitSchema = (fallback: number, max: number) =>
	z.coerce.number().int().min(1).max(max).default(fallback)

/** The cursor is the last row ID seen; opaque to clients so the ordering key can change. */
const encodeCursor = (id: string) => Buffer.from(id, 'utf8').toString('base64url')
const CursorSchema = z
	.string()
	.transform((c) => Buffer.from(c, 'base64url').toString('utf8'))
	.pipe(z.uuid())

const SessionPageSchema = z.strictObject({
	items: z.array(SessionSchema),
	/** Pass back as `cursor` for the next page; null on the last page. */
	nextCursor: z.string().nullable(),
})

const StoredEventSchema = z.strictObject({
	seq: z.int().min(1),
	receivedAt: z.iso.datetime({ offset: true }),
	event: TraceEventSchema,
})

const EventPageSchema = z.strictObject({
	items: z.array(StoredEventSchema),
	/** Pass back as `after_seq` to continue; equals the request's value when nothing is new. */
	nextAfterSeq: z.int().min(0),
})

const PublicIdParams = z.strictObject({ publicId: PublicSessionIdSchema })

export const sessionRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
	app.post(
		'/v1/sessions',
		{
			schema: {
				summary: 'Open a session; the response carries its token, once',
				tags: ['sessions'],
				body: CreateSessionRequestSchema,
				response: { 201: CreatedSessionSchema, 400: ProblemSchema },
			},
		},
		async (request, reply) => {
			const created = await createSession(db, request.body)
			reply.header('cache-control', 'no-store')
			return reply.code(201).send(created)
		},
	)

	app.get(
		'/v1/sessions',
		{
			schema: {
				summary: 'List sessions, newest first',
				tags: ['sessions'],
				querystring: z.strictObject({
					limit: LimitSchema(50, 100),
					cursor: CursorSchema.optional(),
				}),
				response: { 200: SessionPageSchema, 400: ProblemSchema },
			},
		},
		async (request) => {
			const { limit, cursor } = request.query
			const rows = await db
				.select()
				.from(sessions)
				.where(cursor === undefined ? undefined : lt(sessions.id, cursor))
				.orderBy(desc(sessions.id))
				.limit(limit + 1)
			const page = rows.slice(0, limit)
			const last = page.at(-1)
			return {
				items: page.map(toSession),
				nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null,
			}
		},
	)

	app.get(
		'/v1/sessions/:publicId',
		{
			schema: {
				summary: 'Get one session',
				tags: ['sessions'],
				params: PublicIdParams,
				response: { 200: SessionSchema, 404: ProblemSchema },
			},
		},
		async (request, reply) => {
			const [row] = await db
				.select()
				.from(sessions)
				.where(eq(sessions.publicId, request.params.publicId))
			if (!row) return sendProblem(reply, 404, 'session_not_found')
			return toSession(row)
		},
	)

	app.get(
		'/v1/sessions/:publicId/events',
		{
			schema: {
				summary: "A session's events in seq order, after a given seq",
				tags: ['sessions'],
				params: PublicIdParams,
				querystring: z.strictObject({
					after_seq: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
					limit: LimitSchema(500, 1000),
				}),
				response: { 200: EventPageSchema, 400: ProblemSchema, 404: ProblemSchema },
			},
		},
		async (request, reply) => {
			const { after_seq: afterSeq, limit } = request.query
			const [session] = await db
				.select({ id: sessions.id })
				.from(sessions)
				.where(eq(sessions.publicId, request.params.publicId))
			if (!session) return sendProblem(reply, 404, 'session_not_found')
			const rows = await db
				.select({ seq: events.seq, receivedAt: events.receivedAt, payload: events.payload })
				.from(events)
				.where(and(eq(events.sessionId, session.id), gt(events.seq, afterSeq)))
				.orderBy(asc(events.seq))
				.limit(limit)
			return {
				items: rows.map((r) => ({
					seq: r.seq,
					receivedAt: r.receivedAt.toISOString(),
					event: TraceEventSchema.parse(r.payload),
				})),
				nextAfterSeq: rows.at(-1)?.seq ?? afterSeq,
			}
		},
	)
}
