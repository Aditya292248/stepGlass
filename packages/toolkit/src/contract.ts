// The contract shared with every host (MCP server, SDKs). Change it only together with them.
import type { CheckBundle, JsonValue, Slug, ToolDescriptor, TraceEvent } from '@stepglass/schema'
import type { z } from 'zod'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
/** An event before the recorder stamps identity, time, ordering and source. */
export type EventDraft = DistributiveOmit<
	TraceEvent,
	'schemaVersion' | 'id' | 'sessionId' | 'occurredAt' | 'source' | 'producer'
>

export interface Recorder {
	/** Stamps base fields (uuidv7 id, sessionId, occurredAt, source, producer id+seq) and queues the event. Never throws on transport failure. */
	emit(draft: EventDraft): void
	newId(): string // uuidv7
	now(): string // ISO 8601 with offset
	flush(): Promise<void>
}

export interface ToolContext {
	recorder: Recorder
	signal?: AbortSignal
}

/** Type-erased so packs can hold heterogeneous tools; `call` validates raw input itself. */
export interface DefinedTool {
	readonly name: Slug
	/** Shown to the model. */
	readonly description: string
	readonly input: z.ZodType
	readonly descriptor: ToolDescriptor
	/** Parses input, records action.started / evidence / action.finished, returns JSON output; rethrows tool errors after recording them. */
	call(rawInput: unknown, ctx: ToolContext): Promise<JsonValue>
}

export interface ToolPack {
	readonly name: Slug
	readonly version: string
	readonly tools: readonly DefinedTool[]
	readonly checks?: readonly CheckBundle[]
}

export { defineToolPack } from './pack.js'
export { createMemoryRecorder } from './recorder.js'
