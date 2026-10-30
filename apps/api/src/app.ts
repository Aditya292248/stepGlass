import Fastify, { type FastifyServerOptions } from 'fastify'
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import type { Db } from './db/client.js'
import { problemErrorHandler, sendProblem } from './problem.js'
import { eventRoutes } from './routes/events.js'

export interface AppOptions {
	db: Db
	/** Pino options, or false to disable logging. Redaction is always added. */
	logger?: Exclude<FastifyServerOptions['logger'], true> | undefined
	ingestBodyLimit?: number
}

/** Paths pino blanks out, so a bearer token never reaches a log line. */
export const REDACTED_PATHS = [
	'req.headers.authorization',
	'req.headers.cookie',
	'headers.authorization',
	'token',
	'*.token',
]

/** Builds the app without listening, so tests can drive it with `app.inject()`. */
export async function buildApp(options: AppOptions) {
	const logger =
		options.logger === false
			? false
			: { ...options.logger, redact: { paths: REDACTED_PATHS, censor: '[redacted]' } }
	const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>()
	app.setValidatorCompiler(validatorCompiler)
	app.setSerializerCompiler(serializerCompiler)
	app.setErrorHandler(problemErrorHandler)
	app.setNotFoundHandler((_request, reply) => sendProblem(reply, 404, 'not_found'))

	await app.register(eventRoutes, {
		db: options.db,
		bodyLimit: options.ingestBodyLimit ?? 4 * 1024 * 1024,
	})
	return app
}
