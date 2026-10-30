import swagger from '@fastify/swagger'
import Fastify, { type FastifyServerOptions, type onRouteHookHandler } from 'fastify'
import {
	jsonSchemaTransform,
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import type { Db } from './db/client.js'
import { problemErrorHandler, sendProblem } from './problem.js'
import { documentRoutes } from './routes/documents.js'
import { eventRoutes } from './routes/events.js'
import { healthRoutes } from './routes/health.js'
import { sessionRoutes } from './routes/sessions.js'

export interface AppOptions {
	db: Db
	/** Pino options, or false to disable logging. Redaction is always added. */
	logger?: Exclude<FastifyServerOptions['logger'], true> | undefined
	ingestBodyLimit?: number
	/** Observes every route as it is registered (route listings, coverage tests). */
	onRoute?: onRouteHookHandler
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
	if (options.onRoute) app.addHook('onRoute', options.onRoute)

	// Registered before the routes so its onRoute hook sees every one of them.
	await app.register(swagger, {
		openapi: {
			openapi: '3.1.0',
			info: {
				title: 'Stepglass API',
				version: '0.0.0',
				description: 'Event ingestion and session read API.',
			},
			components: {
				securitySchemes: {
					sessionToken: {
						type: 'http',
						scheme: 'bearer',
						description: 'The `sgt_…` token returned once by `POST /v1/sessions`.',
					},
				},
			},
		},
		transform: jsonSchemaTransform,
	})
	app.get('/openapi.json', { schema: { hide: true } }, () => app.swagger())

	await app.register(healthRoutes, { db: options.db })
	await app.register(sessionRoutes, { db: options.db })
	await app.register(eventRoutes, {
		db: options.db,
		bodyLimit: options.ingestBodyLimit ?? 4 * 1024 * 1024,
	})
	await app.register(documentRoutes, { db: options.db })
	return app
}
