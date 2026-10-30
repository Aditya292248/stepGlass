import { sql } from 'drizzle-orm'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../db/client.js'
import { ProblemSchema, sendProblem } from '../problem.js'

export const healthRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
	app.get(
		'/healthz',
		{
			schema: {
				summary: 'Liveness and database reachability',
				tags: ['health'],
				response: { 200: z.strictObject({ status: z.literal('ok') }), 503: ProblemSchema },
			},
		},
		async (request, reply) => {
			try {
				await db.execute(sql`SELECT 1`)
				return { status: 'ok' as const }
			} catch (err) {
				request.log.warn({ err }, 'database unreachable')
				return sendProblem(reply, 503, 'database_unavailable')
			}
		},
	)
}
