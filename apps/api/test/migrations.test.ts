import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from '../src/db/migrate.js'
import { createTestDatabase, type TestDatabase } from './db.js'

let t: TestDatabase

beforeAll(async () => {
	t = await createTestDatabase()
})
afterAll(() => t.drop())

async function insertSession(publicId: string, tokenHash: string): Promise<string> {
	const { rows } = await t.pool.query<{ id: string }>(
		`INSERT INTO sessions (public_id, token_hash, goal, client, coverage, data_label)
		 VALUES ($1, $2, 'goal', '{"name":"t","transport":"sdk"}', 'tool_activity', 'sandbox')
		 RETURNING id`,
		[publicId, tokenHash],
	)
	return rows[0]?.id ?? ''
}

describe('migrations', () => {
	it('are idempotent', async () => {
		await runMigrations(t.db)
		const { rows } = await t.pool.query(
			'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
		)
		expect(rows[0].n).toBeGreaterThan(0)
	})

	it('create every table', async () => {
		const { rows } = await t.pool.query<{ table_name: string }>(
			`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
		)
		expect(rows.map((r) => r.table_name)).toEqual([
			'check_bundles',
			'events',
			'sessions',
			'tool_descriptors',
		])
	})

	it('default row IDs to uuidv7 and next_seq to 1', async () => {
		const id = await insertSession('ses_migrate01', 'a'.repeat(64))
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/)
		const { rows } = await t.pool.query('SELECT next_seq FROM sessions WHERE id = $1', [id])
		expect(rows[0].next_seq).toBe('1')
	})

	it('keep public IDs, token hashes and per-session seqs and event IDs unique', async () => {
		const id = await insertSession('ses_migrate02', 'b'.repeat(64))
		await expect(insertSession('ses_migrate02', 'c'.repeat(64))).rejects.toThrow(/unique/)
		await expect(insertSession('ses_migrate03', 'b'.repeat(64))).rejects.toThrow(/unique/)

		const insert = (seq: number, eventId: string) =>
			t.pool.query(
				`INSERT INTO events (session_id, seq, event_id, type, payload, producer_id, producer_seq)
				 VALUES ($1, $2, $3, 'action.started', '{}', 'p', 0)`,
				[id, seq, eventId],
			)
		await insert(1, '019a0000-0000-7000-8000-000000000001')
		await expect(insert(1, '019a0000-0000-7000-8000-000000000002')).rejects.toThrow(/unique/)
		await expect(insert(2, '019a0000-0000-7000-8000-000000000001')).rejects.toThrow(/unique/)
	})

	it('keep descriptor and bundle versions unique', async () => {
		const descriptor = `INSERT INTO tool_descriptors (tool, version, document) VALUES ('t.x', 1, '{}')`
		await t.pool.query(descriptor)
		await expect(t.pool.query(descriptor)).rejects.toThrow(/unique/)
		const bundle = `INSERT INTO check_bundles (bundle_id, version, document) VALUES ('b.x', 1, '{}')`
		await t.pool.query(bundle)
		await expect(t.pool.query(bundle)).rejects.toThrow(/unique/)
	})
})
