import { z } from 'zod'
import {
	PublicSessionIdSchema,
	SchemaVersionSchema,
	SlugSchema,
	TimestampSchema,
	Uuidv7Schema,
} from './common.js'

/**
 * Whether the run itself completed. Kept apart from check outcomes: a run can finish cleanly and
 * still fail every check, and an errored run can still pass the checks that matter.
 */
export const RunStatusSchema = z.enum(['running', 'finished', 'errored', 'cancelled', 'unfinished'])
/** See {@link RunStatusSchema}. */
export type RunStatus = z.infer<typeof RunStatusSchema>

/** Who recorded the session and over which channel, so gaps can be attributed to a transport. */
export const ClientInfoSchema = z.strictObject({
	name: z.string().min(1).max(100),
	version: z.string().min(1).max(50).optional(),
	transport: z.enum(['stdio', 'http', 'sdk', 'otlp']),
})
/** See {@link ClientInfoSchema}. */
export type ClientInfo = z.infer<typeof ClientInfoSchema>

/**
 * The read model of one agent run. Strict, so a {@link SessionToken} (or any other secret) that
 * sneaks in is rejected instead of silently passed through to readers.
 */
export const SessionSchema = z.strictObject({
	schemaVersion: SchemaVersionSchema,
	id: Uuidv7Schema,
	publicId: PublicSessionIdSchema,
	goal: z.string().min(1).max(500),
	client: ClientInfoSchema,
	agent: SlugSchema.optional(),
	startedAt: TimestampSchema,
	endedAt: TimestampSchema.optional(),
	runStatus: RunStatusSchema,
	/** How much of the agent loop was observed; tool-only capture cannot see the model's reasoning. */
	coverage: z.enum(['tool_activity', 'full_loop', 'partial']),
	/** Sandbox and live data are never mixed in one session, and the UI must say which it is. */
	dataLabel: z.enum(['sandbox', 'live']),
})
/** See {@link SessionSchema}. */
export type Session = z.infer<typeof SessionSchema>
