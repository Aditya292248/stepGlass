import { z } from 'zod'

/**
 * Every internal ID, and every client-generated event ID, is a UUIDv7 so IDs sort by creation
 * time and a client can mint the idempotency key before the server ever sees the event.
 */
export const Uuidv7Schema = z.uuid({ version: 'v7' })
/** A UUIDv7 string; see {@link Uuidv7Schema}. */
export type Uuidv7 = z.infer<typeof Uuidv7Schema>

/** The short ID shown to reviewers and in links. It identifies a session but grants no access. */
export const PublicSessionIdSchema = z.string().regex(/^ses_[0-9a-z]{8,26}$/)
/** See {@link PublicSessionIdSchema}. */
export type PublicSessionId = z.infer<typeof PublicSessionIdSchema>

/**
 * The bearer secret a client uses to append events to one session (at least 128 bits,
 * base64url). It is deliberately a separate type that no read model contains, so it cannot leak
 * through an API response or an export.
 */
export const SessionTokenSchema = z.string().regex(/^sgt_[A-Za-z0-9_-]{22,}$/)
/** See {@link SessionTokenSchema}. */
export type SessionToken = z.infer<typeof SessionTokenSchema>

/** ISO-8601 with an explicit offset, so timestamps from different producers compare correctly. */
export const TimestampSchema = z.iso.datetime({ offset: true })
/** See {@link TimestampSchema}. */
export type Timestamp = z.infer<typeof TimestampSchema>

/**
 * Stable machine names (tools, checks, object types, agents). Lowercase and ASCII so they are
 * safe as URL segments, file names and database keys without escaping.
 */
export const SlugSchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/)
/** See {@link SlugSchema}. */
export type Slug = z.infer<typeof SlugSchema>

/** Stamped on every stored document so a future breaking change can be migrated explicitly. */
export const SchemaVersionSchema = z.literal(1)

/** Free-form payloads (tool input/output, object state) are opaque JSON to the core. */
export const JsonValueSchema = z.json()
/** See {@link JsonValueSchema}. */
export type JsonValue = z.infer<typeof JsonValueSchema>

/** Object state is always a JSON object so field paths like `after.color` resolve. */
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema)
/** See {@link JsonObjectSchema}. */
export type JsonObject = z.infer<typeof JsonObjectSchema>

/**
 * Integers only, within the range a JS number represents exactly. Policy numbers are integers by
 * construction (money in minor units, percentages in basis points) so a comparison can never be
 * decided by floating-point rounding.
 */
export const SafeIntSchema = z.int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)

/** A positive version counter; versions start at 1 so 0 can never be mistaken for "unset". */
export const VersionSchema = z.int().min(1).max(Number.MAX_SAFE_INTEGER)

/** ISO 4217 code. Only meaningful next to a `currency_minor` amount. */
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/)

/** Lesson IDs are human-readable (`L-12`) because reviewers quote them in conversation. */
export const LessonIdSchema = z.string().regex(/^L-\d+$/)

/**
 * How a lesson reaches the agent. Shared by lessons and by the event that records a delivery,
 * so both sides agree on the vocabulary.
 */
export const LessonDeliveryModeSchema = z.enum(['tool_result_note', 'pre_call_guard'])
