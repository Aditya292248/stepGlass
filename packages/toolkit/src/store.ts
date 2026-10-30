import type { JsonObject } from '@stepglass/schema'
import type { EventDraft, Recorder } from './contract.js'

type Awaitable<T> = T | Promise<T>

/** One object's state as a store or API reports it. */
export interface ObjectState {
	state: JsonObject
	/** Opaque version (row version, ETag) when the store exposes one. */
	version?: string
}

/** Any store that can run a function atomically: it commits when `fn` resolves, rolls back when it throws. */
export interface TransactionalStore<Tx> {
	transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R>
}

/** An event written inside a transaction and relayed to a recorder after commit. */
export interface OutboxEntry {
	readonly id: string
	readonly actionId: string
	readonly draft: EventDraft
}

/**
 * The transactional outbox: entries appended inside a transaction become visible to `pending`
 * only if it commits, so a rolled-back write can never leave evidence behind.
 */
export interface Outbox<Tx> {
	append(tx: Tx, entries: readonly OutboxEntry[]): Awaitable<void>
	/** Committed entries not yet relayed, oldest first; only `actionId`'s when given. */
	pending(actionId?: string): Awaitable<readonly OutboxEntry[]>
	markRelayed(ids: readonly string[]): Awaitable<void>
}

/** A store a tool can verify writes in: its transactions also carry the outbox. */
export interface OutboxStore<Tx> extends TransactionalStore<Tx> {
	readonly outbox: Outbox<Tx>
}

/**
 * Emits committed outbox entries to `recorder` and marks them relayed. Delivery is at least
 * once: entries left pending by a crash between emit and mark are relayed again by the next
 * call. Hosts can call it at startup to relay what a previous process committed.
 */
export async function relayOutbox<Tx>(
	outbox: Outbox<Tx>,
	recorder: Recorder,
	actionId?: string,
): Promise<number> {
	const entries = await outbox.pending(actionId)
	for (const entry of entries) recorder.emit(entry.draft)
	if (entries.length > 0) await outbox.markRelayed(entries.map((e) => e.id))
	return entries.length
}
