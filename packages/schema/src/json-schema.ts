import { z } from 'zod'
import { CheckBundleSchema, CheckDefinitionSchema, CheckResultSchema } from './check.js'
import { ToolDescriptorSchema } from './descriptor.js'
import { TraceEventSchema } from './event.js'
import { SnapshotSchema } from './evidence.js'
import { EventBatchAckSchema, EventBatchRequestSchema } from './ingest.js'
import { LessonNoteSchema, LessonSchema } from './lesson.js'
import { SessionSchema } from './session.js'

/** Every top-level contract, keyed by the file name its JSON Schema is written to. */
export const CONTRACTS = {
	Session: SessionSchema,
	TraceEvent: TraceEventSchema,
	Snapshot: SnapshotSchema,
	CheckDefinition: CheckDefinitionSchema,
	CheckBundle: CheckBundleSchema,
	CheckResult: CheckResultSchema,
	ToolDescriptor: ToolDescriptorSchema,
	Lesson: LessonSchema,
	LessonNote: LessonNoteSchema,
	EventBatchRequest: EventBatchRequestSchema,
	EventBatchAck: EventBatchAckSchema,
} as const

/**
 * JSON Schema for each contract, so non-TypeScript clients (the Python SDK) validate against the
 * same definitions. Refinements don't survive the conversion; the server stays authoritative.
 */
export function exportJsonSchemas(): Record<keyof typeof CONTRACTS, z.core.JSONSchema.BaseSchema> {
	const entries = Object.entries(CONTRACTS).map(([name, schema]) => [name, z.toJSONSchema(schema)])
	return Object.fromEntries(entries)
}
