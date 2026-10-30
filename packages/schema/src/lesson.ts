import { z } from 'zod'
import { ExprSchema } from './check.js'
import {
	LessonDeliveryModeSchema,
	LessonIdSchema,
	SchemaVersionSchema,
	SlugSchema,
	TimestampSchema,
	Uuidv7Schema,
	VersionSchema,
} from './common.js'

/**
 * A reviewer's correction, turned into data that is delivered on matching tool calls. Matching
 * uses the same restricted expression language as checks, so a lesson can never run code.
 */
export const LessonSchema = z
	.strictObject({
		schemaVersion: SchemaVersionSchema,
		id: LessonIdSchema,
		version: VersionSchema,
		text: z.string().min(1).max(500),
		/** The failure that prompted the lesson, so its effect can be traced back. */
		source: z.strictObject({ checkId: SlugSchema, sessionId: Uuidv7Schema }).optional(),
		condition: z.strictObject({ tool: SlugSchema, when: ExprSchema.optional() }),
		scope: z.strictObject({ agent: SlugSchema.optional(), connector: SlugSchema.optional() }),
		delivery: z.strictObject({ mode: LessonDeliveryModeSchema, attachTo: SlugSchema.optional() }),
		status: z.enum(['draft', 'active', 'paused']),
		createdAt: TimestampSchema,
	})
	.refine(
		// A guard runs before the matched call itself, so it cannot attach to a different tool.
		(l) =>
			l.delivery.mode !== 'pre_call_guard' ||
			l.delivery.attachTo === undefined ||
			l.delivery.attachTo === l.condition.tool,
		{ message: 'pre_call_guard must attach to condition.tool', path: ['delivery', 'attachTo'] },
	)
/** See {@link LessonSchema}. */
export type Lesson = z.infer<typeof LessonSchema>

/**
 * Exactly what is appended to a tool result. It is phrased as data, not an instruction, under a
 * namespaced key, so an agent reads it as context and a prompt-injection filter can recognise it.
 */
export const LessonNoteSchema = z.strictObject({
	stepglass_note: z.strictObject({
		lesson_id: LessonIdSchema,
		lesson_version: VersionSchema,
		text: z.string().min(1).max(500),
	}),
})
/** See {@link LessonNoteSchema}. */
export type LessonNote = z.infer<typeof LessonNoteSchema>
