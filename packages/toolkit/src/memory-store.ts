import type { JsonObject } from '@stepglass/schema'
import type { ObjectState, Outbox, OutboxEntry, OutboxStore } from './store.js'

/** A transaction over a {@link MemoryStore}; reads see its own uncommitted writes. */
export interface MemoryTx {
	get(type: string, id: string): ObjectState | null
	/** Writes the whole state and bumps the object's version. */
	put(type: string, id: string, state: JsonObject): void
	delete(type: string, id: string): void
}

interface Row {
	state: JsonObject
	version: number
}

interface TxState {
	open: boolean
	writes: Map<string, Row | null>
	outbox: OutboxEntry[]
}

const key = (type: string, id: string) => `${type}/${id}`
const view = (row: Row): ObjectState => ({
	state: structuredClone(row.state),
	version: String(row.version),
})

/**
 * An in-memory, serializable store for tests and sandbox backends. Transactions run one at a
 * time, see their own writes, and apply all writes and outbox entries together on commit or
 * none of them on rollback. Writes through a finished transaction throw, so a run that outlives
 * its transaction (after an abort, say) cannot change committed state.
 */
export class MemoryStore implements OutboxStore<MemoryTx> {
	readonly #rows = new Map<string, Row>()
	readonly #txs = new WeakMap<MemoryTx, TxState>()
	readonly #outbox: { entry: OutboxEntry; relayed: boolean }[] = []
	#queue: Promise<unknown> = Promise.resolve()

	constructor(seed: Record<string, Record<string, JsonObject>> = {}) {
		for (const [type, objects] of Object.entries(seed)) {
			for (const [id, state] of Object.entries(objects)) {
				this.#rows.set(key(type, id), { state: structuredClone(state), version: 1 })
			}
		}
	}

	/** Reads committed state, outside any transaction. */
	get(type: string, id: string): ObjectState | null {
		const row = this.#rows.get(key(type, id))
		return row ? view(row) : null
	}

	transaction<R>(fn: (tx: MemoryTx) => Promise<R>): Promise<R> {
		const result = this.#queue.then(() => this.#run(fn))
		this.#queue = result.catch(() => {})
		return result
	}

	async #run<R>(fn: (tx: MemoryTx) => Promise<R>): Promise<R> {
		const state: TxState = { open: true, writes: new Map(), outbox: [] }
		const ensureOpen = () => {
			if (!state.open) throw new Error('transaction is closed')
		}
		const current = (k: string) => (state.writes.has(k) ? state.writes.get(k) : this.#rows.get(k))
		const tx: MemoryTx = {
			get: (type, id) => {
				ensureOpen()
				const row = current(key(type, id))
				return row ? view(row) : null
			},
			put: (type, id, next) => {
				ensureOpen()
				const k = key(type, id)
				const version = (current(k)?.version ?? 0) + 1
				state.writes.set(k, { state: structuredClone(next), version })
			},
			delete: (type, id) => {
				ensureOpen()
				state.writes.set(key(type, id), null)
			},
		}
		this.#txs.set(tx, state)
		try {
			const result = await fn(tx)
			ensureOpen()
			for (const [k, row] of state.writes) {
				if (row) this.#rows.set(k, row)
				else this.#rows.delete(k)
			}
			for (const entry of state.outbox) this.#outbox.push({ entry, relayed: false })
			return result
		} finally {
			state.open = false
		}
	}

	readonly outbox: Outbox<MemoryTx> = {
		append: (tx, entries) => {
			const state = this.#txs.get(tx)
			if (!state?.open) throw new Error('outbox entries need an open transaction of this store')
			state.outbox.push(...entries)
		},
		pending: (actionId) =>
			this.#outbox
				.filter((o) => !o.relayed && (actionId === undefined || o.entry.actionId === actionId))
				.map((o) => o.entry),
		markRelayed: (ids) => {
			const set = new Set(ids)
			for (const o of this.#outbox) if (set.has(o.entry.id)) o.relayed = true
		},
	}
}
