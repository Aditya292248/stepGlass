import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { createDatabase, type Database } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'

/** The server every test file points at; each file gets its own database inside it. */
export function adminUrl(): string {
	const url = process.env.DATABASE_URL
	if (!url) {
		throw new Error(
			'DATABASE_URL is not set. Start Postgres with `docker compose up -d` and copy .env.example to .env.',
		)
	}
	return url
}

export interface TestDatabase extends Database {
	url: string
	drop(): Promise<void>
}

/** Creates a migrated, empty database for one test file. Call `drop()` in `afterAll`. */
export async function createTestDatabase(): Promise<TestDatabase> {
	const name = `stepglass_test_${randomBytes(6).toString('hex')}`
	const admin = new pg.Client({ connectionString: adminUrl() })
	await admin.connect()
	await admin.query(`CREATE DATABASE ${name}`)
	await admin.end()

	const url = new URL(adminUrl())
	url.pathname = `/${name}`
	const database = createDatabase(url.toString())
	await runMigrations(database.db)

	return {
		...database,
		url: url.toString(),
		async drop() {
			await database.pool.end()
			const admin = new pg.Client({ connectionString: adminUrl() })
			await admin.connect()
			await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
			await admin.end()
		},
	}
}
