import { z } from 'zod'
import {
	JsonValueSchema,
	LessonDeliveryModeSchema,
	LessonIdSchema,
	SafeIntSchema,
	SchemaVersionSchema,
	SlugSchema,
	TimestampSchema,
	Uuidv7Schema,
	VersionSchema,
} from './common.js'
import { ClientInfoSchema, RunStatusSchema } from './session.js'

/** Which recording path produced an event; `system` marks events the server wrote itself. */
export const EventSourceSchema = z.enum(['mcp', 'sdk', 'otlp', 'system'])

/**
 * A per-producer sequence number. Arrival order is not trusted, but a hole in one producer's
 * `seq` is a provable gap, which is what makes `recording.gap` and `unknown` outcomes honest.
 */
export const ProducerSchema = z.strictObject({
	id: z.string().min(1).max(128),
	seq: SafeIntSchema.min(0),
})

/** Whether payloads were kept in full; checks over redacted fields must answer `unknown`. */
export const CaptureSchema = z.strictObject({
	completeness: z.enum(['full', 'partial', 'metadata_only', 'redacted']),
	omittedFields: z.array(z.string().min(1)).optional(),
})

const base = {
	schemaVersion: SchemaVersionSchema,
	/** Client-generated; the ingestion idempotency key. */
	id: Uuidv7Schema,
	sessionId: Uuidv7Schema,
	occurredAt: TimestampSchema,
	source: EventSourceSchema,
	producer: ProducerSchema,
	capture: CaptureSchema,
}

/** How an action ended. `cancelled` means the outcome was never observed. */
export const ActionStatusSchema = z.enum(['succeeded', 'failed', 'cancelled'])
/** See {@link ActionStatusSchema}. */
export type ActionStatus = z.infer<typeof ActionStatusSchema>

/** Opens a session; carries the goal so a reviewer sees intent before any action. */
export const SessionStartedEventSchema = z.strictObject({
	...base,
	type: z.literal('session.started'),
	goal: z.string().min(1).max(500),
	client: ClientInfoSchema,
	agent: SlugSchema.optional(),
})

/** Closes a session. `running` is excluded because a finish event cannot say "still running". */
export const SessionFinishedEventSchema = z.strictObject({
	...base,
	type: z.literal('session.finished'),
	status: RunStatusSchema.exclude(['running']),
	reply: z
		.strictObject({ text: z.string().max(10_000), via: z.literal('finish_session') })
		.optional(),
})

/**
 * Opens an action. An action's interval runs from this event's `occurredAt` to the matching
 * `action.finished.occurredAt`; ordering checks compare these intervals (happens-before), never
 * arrival order, because events from one run can arrive late or out of order.
 */
export const ActionStartedEventSchema = z
	.strictObject({
		...base,
		type: z.literal('action.started'),
		actionId: Uuidv7Schema,
		parentActionId: Uuidv7Schema.optional(),
		kind: z.enum(['tool', 'model']),
		tool: z
			.strictObject({ name: SlugSchema, descriptorVersion: VersionSchema.optional() })
			.optional(),
		model: z.strictObject({ provider: z.string().min(1), name: z.string().min(1) }).optional(),
		input: JsonValueSchema.optional(),
	})
	.superRefine((e, ctx) => {
		const ok = e.kind === 'tool' ? e.tool && !e.model : e.model && !e.tool
		if (!ok) {
			ctx.addIssue({
				code: 'custom',
				path: [e.kind],
				message: `a ${e.kind} action needs exactly \`${e.kind}\` and not the other`,
			})
		}
	})

/** Closes an action. Events are append-only, so the outcome is a new event, never an update. */
export const ActionFinishedEventSchema = z.strictObject({
	...base,
	type: z.literal('action.finished'),
	actionId: Uuidv7Schema,
	status: ActionStatusSchema,
	output: JsonValueSchema.optional(),
	error: z
		.strictObject({ message: z.string().max(10_000), code: z.string().optional() })
		.optional(),
})

/** Records exactly which lesson text the agent saw, so its effect can be audited later. */
export const LessonDeliveredEventSchema = z.strictObject({
	...base,
	type: z.literal('lesson.delivered'),
	lessonId: LessonIdSchema,
	lessonVersion: VersionSchema,
	actionId: Uuidv7Schema,
	mode: LessonDeliveryModeSchema,
	text: z.string().min(1).max(500),
})

/** Makes lost events explicit, so checks over the missing range answer `unknown`, not `pass`. */
export const RecordingGapEventSchema = z.strictObject({
	...base,
	type: z.literal('recording.gap'),
	producerId: z.string().min(1).max(128),
	fromSeq: SafeIntSchema.min(0),
	toSeq: SafeIntSchema.min(0),
	reason: z.enum(['buffer_overflow', 'disconnect', 'unknown']),
})

/**
 * Everything that can happen in a session, as an append-only log. Discriminated on `type` so
 * consumers get exhaustive narrowing.
 */
export const TraceEventSchema = z.discriminatedUnion('type', [
	SessionStartedEventSchema,
	SessionFinishedEventSchema,
	ActionStartedEventSchema,
	ActionFinishedEventSchema,
	LessonDeliveredEventSchema,
	RecordingGapEventSchema,
])
/** See {@link TraceEventSchema}. */
export type TraceEvent = z.infer<typeof TraceEventSchema>
/** The set of event discriminators, for exhaustive switches in consumers. */
export type TraceEventType = TraceEvent['type']
