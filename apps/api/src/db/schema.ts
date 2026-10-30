import { sql } from 'drizzle-orm'
import {
	bigint,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'

// Postgres 18 ships uuidv7(), so row IDs sort by creation time without an extension.
const uuidv7 = sql`uuidv7()`
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

/**
 * One recorded agent run. `next_seq` is the next server sequence number to hand out; ingestion
 * bumps it under the row lock, so seqs are dense and commit in order.
 */
export const sessions = pgTable('sessions', {
	id: uuid('id').primaryKey().default(uuidv7),
	publicId: text('public_id').notNull().unique(),
	/** Hex SHA-256 of the `sgt_` token. The token itself is never stored. */
	tokenHash: text('token_hash').notNull().unique(),
	goal: text('goal').notNull(),
	client: jsonb('client').notNull(),
	agent: text('agent'),
	coverage: text('coverage').notNull(),
	dataLabel: text('data_label').notNull(),
	runStatus: text('run_status').notNull().default('running'),
	startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
	endedAt: timestamp('ended_at', { withTimezone: true }),
	nextSeq: bigint('next_seq', { mode: 'number' }).notNull().default(1),
	createdAt: createdAt(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** The append-only event log. `seq` is server-assigned; `event_id` is the producer's key. */
export const events = pgTable(
	'events',
	{
		id: uuid('id').primaryKey().default(uuidv7),
		sessionId: uuid('session_id')
			.notNull()
			.references(() => sessions.id, { onDelete: 'cascade' }),
		seq: bigint('seq', { mode: 'number' }).notNull(),
		eventId: uuid('event_id').notNull(),
		type: text('type').notNull(),
		payload: jsonb('payload').notNull(),
		producerId: text('producer_id').notNull(),
		producerSeq: bigint('producer_seq', { mode: 'number' }).notNull(),
		receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		unique('events_session_seq_unique').on(t.sessionId, t.seq),
		unique('events_session_event_id_unique').on(t.sessionId, t.eventId),
		index('events_session_producer_seq_idx').on(t.sessionId, t.producerId, t.producerSeq),
	],
)

/** Immutable once written: a `(tool, version)` pair always means the same document. */
export const toolDescriptors = pgTable(
	'tool_descriptors',
	{
		tool: text('tool').notNull(),
		version: integer('version').notNull(),
		document: jsonb('document').notNull(),
		createdAt: createdAt(),
	},
	(t) => [primaryKey({ columns: [t.tool, t.version] })],
)

/** Immutable once written: a `(bundle_id, version)` pair always means the same checks. */
export const checkBundles = pgTable(
	'check_bundles',
	{
		bundleId: text('bundle_id').notNull(),
		version: integer('version').notNull(),
		document: jsonb('document').notNull(),
		createdAt: createdAt(),
	},
	(t) => [primaryKey({ columns: [t.bundleId, t.version] })],
)
